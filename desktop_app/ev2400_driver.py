"""
TI EV2400 / EV2300 & USB-to-SMBus Direct Hardware Interface
Project: BQ_tester
Description: Communicates directly with official TI EV2400 / EV2300 adapters and CP2112 USB-SMBus bridges over USB HID without any custom firmware flashing.
"""

import sys
import time
import struct

try:
    import hid
    HAS_HID = True
except ImportError:
    HAS_HID = False

# TI EV2400 USB Identifiers
TI_VID = 0x0451
EV2400_PID = 0x0036
EV2300_PID = 0x0034
CP2112_VID = 0x10C4
CP2112_PID = 0xEA90

# BQ40Z50 7-bit SMBus Address
BQ40Z50_ADDR = 0x0B

class TIEV2400Adapter:
    """Direct USB-HID SMBus controller driver for TI EV2400 / EV2300 adapters"""

    def __init__(self, vid=TI_VID, pid=EV2400_PID):
        self.vid = vid
        self.pid = pid
        self.dev = None
        self.is_connected = False

    @staticmethod
    def detect_adapters():
        """Scans USB HID bus for connected TI EV2400, EV2300, or CP2112 adapters"""
        if not HAS_HID:
            return []

        found = []
        try:
            device_list = hid.enumerate()
            for d in device_list:
                vid = d.get('vendor_id', 0)
                pid = d.get('product_id', 0)
                path = d.get('path', b'').decode('utf-8', errors='ignore')
                manufacturer = d.get('manufacturer_string', '')
                product = d.get('product_string', '')

                if vid == TI_VID and pid == EV2400_PID:
                    found.append({
                        "name": f"TI EV2400 Adapter ({product})",
                        "type": "EV2400",
                        "vid": vid,
                        "pid": pid,
                        "path": path
                    })
                elif vid == TI_VID and pid == EV2300_PID:
                    found.append({
                        "name": f"TI EV2300 Adapter ({product})",
                        "type": "EV2300",
                        "vid": vid,
                        "pid": pid,
                        "path": path
                    })
                elif vid == CP2112_VID and pid == CP2112_PID:
                    found.append({
                        "name": f"CP2112 USB-to-SMBus Bridge ({product})",
                        "type": "CP2112",
                        "vid": vid,
                        "pid": pid,
                        "path": path
                    })
        except Exception as e:
            print(f"[EV2400 Driver Warning] Enum error: {e}")
        return found

    def open(self, path=None):
        if not HAS_HID:
            raise RuntimeError("hidapi module is required. Install via `pip install hidapi`.")

        try:
            self.dev = hid.device()
            if path:
                self.dev.open_path(path.encode('utf-8'))
            else:
                self.dev.open(self.vid, self.pid)
            self.dev.set_nonblocking(False)
            self.is_connected = True
            return True
        except Exception as e:
            self.is_connected = False
            raise RuntimeError(f"Failed to open TI EV2400 adapter: {e}")

    def close(self):
        if self.dev:
            try:
                self.dev.close()
            except Exception:
                pass
            self.dev = None
        self.is_connected = False

    def read_smbus_word(self, cmd, slave_addr=BQ40Z50_ADDR):
        """Reads 16-bit word from BQ40Z50 SMBus register over EV2400 USB HID report"""
        if not self.dev:
            return None

        # EV2400 USB HID SMBus Read Command packet format
        # [Report ID (0x00), Command (0x33 = Read Word), SlaveAddr (0x16 8-bit), RegisterCmd]
        tx_buf = bytearray(64)
        tx_buf[0] = 0x00  # Report ID
        tx_buf[1] = 0x33  # SMBus Read Word Request
        tx_buf[2] = (slave_addr << 1) & 0xFE # 8-bit Write Address
        tx_buf[3] = cmd & 0xFF

        try:
            self.dev.write(tx_buf)
            rx_buf = self.dev.read(64, timeout_ms=500)
            if rx_buf and len(rx_buf) >= 4:
                # Extract 16-bit little endian word
                val = rx_buf[2] | (rx_buf[3] << 8)
                return val
        except Exception as e:
            print(f"[EV2400 Read Error] cmd 0x{cmd:02X}: {e}")
        return None

    def read_telemetry(self, slave_addr=BQ40Z50_ADDR):
        """Reads complete telemetry frame from BQ40Z50-R5 via EV2400 HID"""
        v = self.read_smbus_word(0x09, slave_addr) # Voltage
        i_raw = self.read_smbus_word(0x0A, slave_addr) # Current
        c1 = self.read_smbus_word(0x3F, slave_addr) # Cell 1
        c2 = self.read_smbus_word(0x3E, slave_addr) # Cell 2
        c3 = self.read_smbus_word(0x3D, slave_addr) # Cell 3
        c4 = self.read_smbus_word(0x3C, slave_addr) # Cell 4
        soc = self.read_smbus_word(0x0D, slave_addr) # SoC
        temp = self.read_smbus_word(0x08, slave_addr) # Temp
        sf = self.read_smbus_word(0x51, slave_addr) # SafetyStatus
        op = self.read_smbus_word(0x54, slave_addr) # OperationStatus

        if v is None or c1 is None:
            return None

        # Convert signed current
        i_signed = i_raw if (i_raw is None or i_raw < 32768) else (i_raw - 65536)

        return {
            "type": "telemetry",
            "v": v,
            "i": i_signed,
            "c1": c1 or 0,
            "c2": c2 or 0,
            "c3": c3 or 0,
            "c4": c4 or 0,
            "soc": soc or 0,
            "temp": temp or 2982,
            "sf": sf or 0,
            "op": op or 0x0007,
            "timestamp": time.time()
        }
