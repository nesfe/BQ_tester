"""TI CMAPI cdecl bridge. JSON lines on stdin/stdout; no raw HID probing.

ABI: TI CMAPI.h / Communications Manager API 0.0.1.84.
Run in an x86 process for the x86 DLL shipped with bqStudio.
"""
import ctypes as C
import json
import os
from pathlib import Path
import struct
import sys
import time
from commands import CommandMixin

ADDRESS = 0x16  # TI SMBus API uses the 8-bit write address (7-bit address 0x0B).
BUFFER_SIZE = 256
BACKGROUND = 1  # CMAPI.h constant (the prose in section 4.1.2.32 has a typo).
WORDS = {"v": 0x09, "i": 0x0A, "c1": 0x3F, "c2": 0x3E,
         "c3": 0x3D, "c4": 0x3C, "soc": 0x0D, "temp": 0x08}


def pe_bits(path):
    with open(path, "rb") as stream:
        if stream.read(2) != b"MZ":
            raise ValueError(f"Not a Windows DLL: {path}")
        stream.seek(0x3C)
        offset = struct.unpack("<I", stream.read(4))[0]
        stream.seek(offset)
        if stream.read(4) != b"PE\0\0":
            raise ValueError(f"Invalid PE header: {path}")
        machine = struct.unpack("<H", stream.read(2))[0]
    if machine not in (0x14C, 0x8664):
        raise ValueError(f"Unsupported DLL machine: 0x{machine:04X}")
    return 32 if machine == 0x14C else 64


def find_installations(directory=None):
    if sys.platform != "win32":
        raise RuntimeError("TI CMAPI requires Windows and an installed copy of bqStudio / bqTools SDK.")
    roots = []
    if directory or os.environ.get("BQ_TI_DIR"):
        roots.append(Path(directory or os.environ["BQ_TI_DIR"]))
    else:
        roots += [Path(r"C:\ti"), Path(r"C:\Texas Instruments")]
        for key in ("ProgramFiles", "ProgramFiles(x86)"):
            if os.environ.get(key):
                roots += [Path(os.environ[key]) / "Texas Instruments",
                          Path(os.environ[key]) / "TI"]
    found = []
    seen = set()
    for root in roots:
        if not root.is_dir():
            continue
        for base, dirs, files in os.walk(root):
            if len(Path(base).relative_to(root).parts) >= 6:
                dirs[:] = []
            names = {name.lower(): name for name in files}
            if "cmapi.dll" not in names or "commmgr.exe" not in names:
                continue
            dll = str(Path(base, names["cmapi.dll"]).resolve())
            if dll.lower() in seen:
                continue
            seen.add(dll.lower())
            found.append({"name": f"TI EV2400 — first free adapter ({base})",
                          "path": dll, "type": "TI_CMAPI",
                          "commManager": str(Path(base, names["commmgr.exe"]).resolve())})
    if not found:
        raise RuntimeError("CMAPI.dll and commmgr.exe were not found together. Select the TI libraries "
                           "folder from your bqStudio / bqTools SDK installation (keep its dependent DLLs).")
    return found


class Adapter(CommandMixin):
    def __init__(self, dll):
        self.dll = dll
        self.command = C.create_string_buffer(BUFFER_SIZE)
        self.data = C.create_string_buffer(BUFFER_SIZE)
        self.priority = C.create_string_buffer(BUFFER_SIZE)
        self.device = C.create_string_buffer(BUFFER_SIZE)
        self.opened = False
        signatures = {
            "SetupAppwithFirstFreeAdapter": ([C.c_char_p] * 5 + [C.c_int, C.c_int], C.c_int),
            "RegisterPIDwithCM": ([C.c_char_p], None),
            "SDKCloseDevice": ([C.c_char_p], None),
            "TerminateCM": ([C.c_char_p], C.c_int),
            "TranslateCommError": ([C.c_int], C.c_char_p),
            "SDKReadSMBWord": ([C.c_char_p, C.c_short, C.POINTER(C.c_short), C.c_short], C.c_int),
            "SDKWriteSMBWordReadBlock": ([C.c_char_p, C.c_short, C.c_int, C.c_short,
                C.c_short, C.POINTER(C.c_ubyte), C.c_int, C.POINTER(C.c_short), C.c_short], C.c_int),
        }
        for name, (args, result) in signatures.items():
            function = getattr(dll, name)  # Missing exports fail before accessing hardware.
            function.argtypes = args
            function.restype = result

    def check(self, code, operation):
        if code:
            message = self.dll.TranslateCommError(code)
            detail = message.decode("mbcs" if sys.platform == "win32" else "utf-8", errors="replace") if message else "Unknown TI error"
            raise RuntimeError(f"{operation}: TI error {code} (0x{code & 0xFFFFFFFF:X}): {detail}")

    def open(self, manager):
        # CMAPI launches a command line; quote paths with spaces and allocate a writable buffer.
        command_line = C.create_string_buffer(('"' + str(manager) + '"').encode("mbcs" if sys.platform == "win32" else "utf-8"), BUFFER_SIZE)
        self.check(self.dll.SetupAppwithFirstFreeAdapter(self.command, self.data, self.priority,
                   self.device, command_line, BUFFER_SIZE, BACKGROUND), "Open EV2400 (close bqStudio first)")
        self.opened = True
        try:
            self.dll.RegisterPIDwithCM(self.command)
            name = self.device.value.decode("mbcs" if sys.platform == "win32" else "utf-8", errors="replace")
            if "vid_0451&pid_0037" not in name.lower():
                raise RuntimeError(f"TI opened an unsupported adapter: {name}. Connect only EV2400 (0451:0037).")
            self.read_word(0x09)  # A USB handle alone does not establish battery communication.
            return {"device": name, "address": ADDRESS}
        except Exception:
            self.close()
            raise

    def read_word(self, command):
        value = C.c_short()
        self.check(self.dll.SDKReadSMBWord(self.data, command, C.byref(value), ADDRESS),
                   f"SMBus ReadWord 0x{command:02X}")
        return value.value & 0xFFFF  # 0 and 0xFFFF are data, not transport status.

    def read_status(self, command):
        # Select a documented read-only MAC query through ManufacturerAccess(0x00),
        # then read ManufacturerData(0x23). This also works with a SEALED gauge.
        data = (C.c_ubyte * 32)()
        count = C.c_short()
        self.check(self.dll.SDKWriteSMBWordReadBlock(self.data, 0x00, command, 0, 0x23,
                   data, len(data), C.byref(count), ADDRESS), f"MAC status 0x{command:04X}")
        if count.value != 4:
            raise RuntimeError(f"MAC 0x{command:04X}: expected 4 status bytes, received {count.value}")
        return int.from_bytes(bytes(data[:4]), "little")

    def sample(self):
        if self.maintenance:
            raise RuntimeError("Normal telemetry is suspended during " + self.maintenance)
        if not self.opened:
            raise RuntimeError("EV2400 is not connected")
        result = {key: None for key in (*WORDS, "sf", "op")}
        errors = {}
        for key, command in WORDS.items():
            try:
                result[key] = self.read_word(command)
            except RuntimeError as error:
                errors[key] = str(error)
        if result["i"] is not None and result["i"] >= 0x8000:
            result["i"] -= 0x10000
        for key, command in (("sf", 0x0051), ("op", 0x0054)):
            try:
                result[key] = self.read_status(command)
            except RuntimeError as error:
                errors[key] = str(error)
        result.update(errors=errors, hasValidData=any(result[key] is not None for key in WORDS),
                      timestamp=int(time.time() * 1000))
        return result

    def close(self):
        if self.opened:
            self.opened = False
            try:
                self.dll.SDKCloseDevice(self.data)
            finally:
                self.check(self.dll.TerminateCM(self.command), "Close TI communication manager")


def load_adapter(info):
    if sys.platform != "win32":
        raise RuntimeError("TI CMAPI requires Windows")
    dll_path = Path(info["path"]).resolve(strict=True)
    manager = Path(info["commManager"]).resolve(strict=True)
    bits = pe_bits(dll_path)
    if bits != C.sizeof(C.c_void_p) * 8:
        raise RuntimeError(f"CMAPI.dll is {bits}-bit but the bridge is {C.sizeof(C.c_void_p) * 8}-bit. "
                           "Select the x86 TI libraries or run the source bridge with matching Python.")
    # Python 3.8+ restricts dependency lookup. Keep the directory handle alive.
    dll_directory = os.add_dll_directory(str(dll_path.parent))
    try:
        # PyInstaller sets a private DLL directory; don't pass it to TI's child process.
        C.windll.kernel32.SetDllDirectoryW(None)
        dll = C.CDLL(str(dll_path))  # CMAPI.h uses cdecl, not WinDLL/stdcall.
        adapter = Adapter(dll)
        adapter.dll_directory = dll_directory
        return adapter, manager
    except Exception:
        dll_directory.close()
        raise


def serve(input_stream=sys.stdin, output_stream=sys.stdout):
    adapter = None
    try:
        for line in input_stream:
            request = {}
            try:
                request = json.loads(line)
                operation = request["op"]
                if operation == "scan":
                    result = find_installations(request.get("directory"))
                elif operation == "open":
                    if adapter:
                        adapter.close()
                        raise RuntimeError("Restart the bridge before opening another TI installation")
                    adapter, manager = load_adapter(request["device"])
                    result = adapter.open(manager)
                elif operation == "sample":
                    if not adapter:
                        raise RuntimeError("EV2400 is not connected")
                    result = adapter.sample()
                elif operation in ("identify", "catalog", "execute"):
                    if not adapter:
                        raise RuntimeError("EV2400 is not connected")
                    result = adapter.execute(request) if operation == "execute" else getattr(adapter, operation)()
                elif operation == "close":
                    if adapter:
                        adapter.close()
                    result = {"success": True}
                else:
                    raise ValueError(f"Unknown operation: {operation}")
                reply = {"id": request.get("id"), "result": result}
            except Exception as error:
                reply = {"id": request.get("id"), "error": str(error)}
            output_stream.write(json.dumps(reply, ensure_ascii=True) + "\n")
            output_stream.flush()
    finally:
        if adapter:
            adapter.close()


if __name__ == "__main__":
    serve()
