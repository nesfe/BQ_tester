import ctypes as C
import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from ti_bridge import Adapter, find_installations, pe_bits, serve


class Function:
    def __init__(self, callback):
        self.callback = callback
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        return self.callback(*args)


class FakeTI:
    def __init__(self):
        self.words = {0x09: 14800, 0x0A: 0xFFFF, 0x08: 2982, 0x0D: 0}
        self.fail_registers = set()
        self.block_length = 4
        self.setup_error = 0
        self.SetupAppwithFirstFreeAdapter = Function(self.setup)
        self.RegisterPIDwithCM = Function(lambda *args: None)
        self.SDKCloseDevice = Function(lambda *args: None)
        self.TerminateCM = Function(lambda *args: 0)
        self.TranslateCommError = Function(lambda code: b"SMBus NACK")
        self.SDKReadSMBWord = Function(self.read_word)
        self.SDKWriteSMBWordReadBlock = Function(self.read_block)

    def setup(self, command, data, priority, device, executable, size, style):
        assert size == 256 and style == 1
        assert executable.value.startswith(b'"') and executable.value.endswith(b'"')
        command.value = b"command"
        data.value = b"data"
        device.value = b"\\\\?\\hid#vid_0451&pid_0037#test"
        return self.setup_error

    def read_word(self, pipe, command, pointer, address):
        assert address == 0x16
        if command in self.fail_registers:
            return 123
        C.cast(pointer, C.POINTER(C.c_short))[0] = self.words.get(command, 3700)
        return 0

    def read_block(self, pipe, word_cmd, mac, delay, block_cmd, buffer, size, count, address):
        assert (word_cmd, block_cmd, address, delay, size) == (0, 0x23, 0x16, 0, 32)
        value = 0 if mac == 0x51 else 0x10000006
        for index, byte in enumerate(value.to_bytes(4, 'little')):
            buffer[index] = byte
        C.cast(count, C.POINTER(C.c_short))[0] = self.block_length
        return 0


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.dll = FakeTI()
        self.adapter = Adapter(self.dll)
        self.adapter.open(r'C:\Program Files\TI\commmgr.exe')

    def test_zero_and_signed_minus_one_and_high_status_bits(self):
        sample = self.adapter.sample()
        self.assertEqual(sample['soc'], 0)
        self.assertEqual(sample['sf'], 0)
        self.assertEqual(sample['i'], -1)
        self.assertEqual(sample['op'], 0x10000006)
        self.assertEqual(sample['temp'], 2982)
        self.assertTrue(sample['hasValidData'])
        self.assertEqual(sample['errors'], {})

    def test_failed_reads_are_null_with_original_ti_error(self):
        self.dll.fail_registers.update((0x09, 0x08))
        sample = self.adapter.sample()
        self.assertIsNone(sample['v'])
        self.assertIsNone(sample['temp'])
        self.assertIn('TI error 123 (0x7B): SMBus NACK', sample['errors']['v'])
        self.assertTrue(sample['hasValidData'])

    def test_truncated_or_oversized_status_is_rejected(self):
        for length in (0, 2, 5, 33, -1):
            self.dll.block_length = length
            sample = self.adapter.sample()
            self.assertIsNone(sample['sf'])
            self.assertIsNone(sample['op'])
            self.assertIn('expected 4 status bytes', sample['errors']['sf'])

    def test_all_words_fail_no_valid_data(self):
        self.dll.fail_registers.update(range(256))
        self.assertFalse(self.adapter.sample()['hasValidData'])

    def test_close_is_idempotent(self):
        self.adapter.close()
        self.adapter.close()
        self.assertEqual(len(self.dll.SDKCloseDevice.calls), 1)
        self.assertEqual(len(self.dll.TerminateCM.calls), 1)

    def test_failed_initial_battery_read_releases_owned_manager(self):
        self.adapter.close()
        self.dll.fail_registers.add(0x09)
        with self.assertRaisesRegex(RuntimeError, 'ReadWord 0x09'):
            self.adapter.open('commmgr.exe')
        self.assertFalse(self.adapter.opened)
        self.assertEqual(len(self.dll.TerminateCM.calls), 2)

    def test_failed_setup_does_not_terminate_unowned_manager(self):
        self.adapter.close()
        self.dll.setup_error = 123
        with self.assertRaisesRegex(RuntimeError, 'Open EV2400'):
            self.adapter.open('commmgr.exe')
        self.assertEqual(len(self.dll.TerminateCM.calls), 1)

    def test_short_pointer_and_cdecl_abi_signatures(self):
        self.assertEqual(self.dll.SDKReadSMBWord.argtypes,
                         [C.c_char_p, C.c_short, C.POINTER(C.c_short), C.c_short])
        self.assertIsNone(self.dll.SDKCloseDevice.restype)
        self.assertEqual(self.dll.TranslateCommError.restype, C.c_char_p)


class DiscoveryTests(unittest.TestCase):
    def test_nested_installation_requires_matching_manager(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = Path(temporary, 'plugins', 'ti')
            install.mkdir(parents=True)
            (install / 'CMAPI.dll').touch()
            with patch('ti_bridge.sys.platform', 'win32'):
                with self.assertRaisesRegex(RuntimeError, 'not found together'):
                    find_installations(temporary)
                (install / 'commmgr.exe').touch()
                result = find_installations(temporary)
                self.assertEqual(len(result), 1)
                self.assertEqual(result[0]['path'], str((install / 'CMAPI.dll').resolve()))

    def test_pe_architecture(self):
        with tempfile.TemporaryDirectory() as temporary:
            dll = Path(temporary, 'CMAPI.dll')
            for machine, bits in ((0x14c, 32), (0x8664, 64)):
                data = bytearray(128)
                data[:2] = b'MZ'
                data[0x3c:0x40] = (64).to_bytes(4, 'little')
                data[64:68] = b'PE\0\0'
                data[68:70] = machine.to_bytes(2, 'little')
                dll.write_bytes(data)
                self.assertEqual(pe_bits(dll), bits)

    def test_json_protocol_errors_and_eof_cleanup(self):
        source = io.StringIO('{"id":1,"op":"sample"}\n{"id":2,"op":"close"}\n')
        output = io.StringIO()
        serve(source, output)
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(replies[0]['id'], 1)
        self.assertIn('not connected', replies[0]['error'])
        self.assertTrue(replies[1]['result']['success'])


if __name__ == '__main__':
    unittest.main()
