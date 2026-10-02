"""
TI EV2400 / EV2300 Direct USB HID Driver for BQ40Z50-R5
Project: BQ_tester
Description: Handles USB HID communication specifically targeting EV2400 SMBus Interface 0.
"""

import sys
import time

try:
    import hid
    HAS_HID = True
except ImportError:
    HAS_HID = False

# Texas Instruments Vendor ID
TI_VID = 0x0451
# EV2400 Product ID
EV2400_PID = 0x0036
# EV2300 Product ID
EV2300_PID = 0x0034

# BQ40Z50 7-bit SMBus Address (0x0B => 8-bit write address 0x16)
BQ40Z50_7BIT_ADDR = 0x0B
BQ40Z50_8BIT_ADDR = 0x16

class TIEV2400Adapter:
    def __init__(self):
        self.dev = None
        self.is_connected = False
        self.active_path = None
        self.interface_num = 0

    @staticmethod
    def detect_adapters():
        """Scans USB HID bus specifically for EV2400 SMBus Interface (Interface 0)"""
        if not HAS_HID:
            return []

        found = []
        try:
            device_list = hid.enumerate(TI_VID, EV2400_PID)
            for d in device_list:
                path = d.get('path', b'').decode('utf-8', errors='ignore') if isinstance(d.get('path'), bytes) else d.get('path', '')
                interface = d.get('interface_number', -1)
                product = d.get('product_string', 'EV2400')

                # EV2400 Interface 0 is the primary SMBus channel
                found.append({
                    "name": f"TI EV2400 SMBus (Interface {interface})",
                    "type": "EV2400",
                    "path": path,
                    "interface": interface,
                    "product": product
                })

            # Also check EV2300
            ev2300_list = hid.enumerate(TI_VID, EV2300_PID)
            for d in ev2300_list:
                path = d.get('path', b'').decode('utf-8', errors='ignore') if isinstance(d.get('path'), bytes) else d.get('path', '')
                interface = d.get('interface_number', -1)
                found.append({
                    "name": f"TI EV2300 SMBus (Interface {interface})",
                    "type": "EV2300",
                    "path": path,
                    "interface": interface,
                    "product": "EV2300"
                })
        except Exception as e:
            print(f"[EV2400 Enum Error]: {e}")

        return found

    def open(self, path=None):
        if not HAS_HID:
            raise RuntimeError("hidapi module not installed. Run `pip install hidapi`.")

        try:
            self.dev = hid.device()
            if path:
                self.dev.open_path(path.encode('utf-8') if isinstance(path, str) else path)
            else:
                # Fallback open by VID/PID
                self.dev.open(TI_VID, EV2400_PID)

            self.dev.set_nonblocking(False)
            self.is_connected = True
            self.active_path = path
            return True
        except Exception as e:
            self.is_connected = False
            raise RuntimeError(f"Could not open EV2400 USB device. Ensure TI bqStudio is closed! Error: {e}")

    def close(self):
        if self.dev:
            try:
                self.dev.close()
            except Exception:
                pass
            self.dev = None
        self.is_connected = False

    def read_smbus_word(self, reg_cmd, slave_addr=BQ40Z50_8BIT_ADDR):
        """
        Sends EV2400 USB HID packet to read 16-bit word from BQ40Z50.
        EV2400 HID Report format for SMBus channel 0:
        Report ID: 0x00
        Cmd: 0x33 (Read Word)
        Address: 0x16 (BQ40Z50 8-bit write address)
        Register: reg_cmd
        Length: 0x02
        """
        if not self.dev:
            return None

        # Build 64-byte HID feature/output report
        pkt = bytearray(64)
        pkt[0] = 0x00  # Report ID
        pkt[1] = 0x33  # SMBus Read Word command
        pkt[2] = slave_addr & 0xFE # Target Address (0x16)
        pkt[3] = reg_cmd & 0xFF    # Register Command
        pkt[4] = 0x02              # 2 bytes expected

        try:
            self.dev.write(pkt)
            rx = self.dev.read(64, timeout_ms=300)
            if rx and len(rx) >= 4:
                # Protocol response structure: [status, len, low_byte, high_byte, ...]
                # Check status byte or payload bytes
                if len(rx) >= 4 and rx[0] == 0x00:
                    val = rx[2] | (rx[3] << 8)
                    return val
                elif len(rx) >= 3:
                    val = rx[1] | (rx[2] << 8)
                    return val
        except Exception as e:
            print(f"[EV2400 Read Failure reg 0x{reg_cmd:02X}]: {e}")

        return None

    def read_telemetry(self):
        """Reads complete pack telemetry from BQ40Z50-R5"""
        v = self.read_smbus_word(0x09)       # Pack Voltage (mV)
        i_raw = self.read_smbus_word(0x0A)   # Current (mA)
        c1 = self.read_smbus_word(0x3F)      # Cell 1 (mV)
        c2 = self.read_smbus_word(0x3E)      # Cell 2 (mV)
        c3 = self.read_smbus_word(0x3D)      # Cell 3 (mV)
        c4 = self.read_smbus_word(0x3C)      # Cell 4 (mV)
        soc = self.read_smbus_word(0x0D)     # Relative SoC (%)
        temp = self.read_smbus_word(0x08)    # Temp (0.1K)
        sf = self.read_smbus_word(0x51)      # SafetyStatus
        op = self.read_smbus_word(0x54)      # OperationStatus

        if v is None and c1 is None:
            return None

        # Convert signed current
        i_val = 0
        if i_raw is not None:
            i_val = i_raw if i_raw < 32768 else (i_raw - 65536)

        return {
            "type": "telemetry",
            "v": v if v is not None else 0,
            "i": i_val,
            "c1": c1 if c1 is not None else 0,
            "c2": c2 if c2 is not None else 0,
            "c3": c3 if c3 is not None else 0,
            "c4": c4 if c4 is not None else 0,
            "soc": soc if soc is not None else 0,
            "temp": temp if temp is not None else 2982,
            "sf": sf if sf is not None else 0,
            "op": op if op is not None else 0x0007,
            "timestamp": time.time()
        }
