"""
TI EV2400 / EV2300 & Universal USB-SMBus Hardware Driver (Multi-Engine)
Project: BQ_tester
Description: Features 3 redundant detection engines:
  1. Native TI spb.dll / bqEV2400.dll Windows DLL loader (from TI Battery Management Studio)
  2. Broad Windows USB-HID Enumerator (scans all HID devices without VID restriction)
  3. Direct USB HID Force-Connector
"""

import sys
import os
import time
import ctypes
from ctypes import wintypes

try:
    import hid
    HAS_HID = True
except ImportError:
    HAS_HID = False

# Known Vendor & Product IDs
TI_VID = 0x0451
KNOWN_TI_PIDS = [0x0036, 0x0034, 0x0035, 0x0037, 0x0038, 0x16A8, 0x3410]
CP2112_VID = 0x10C4
CP2112_PID = 0xEA90

BQ40Z50_7BIT_ADDR = 0x0B
BQ40Z50_8BIT_ADDR = 0x16

class TIEV2400Adapter:
    def __init__(self):
        self.dev = None
        self.is_connected = False
        self.active_engine = None
        self.dll_handle = None

    @staticmethod
    def detect_all_devices():
        """
        Scans all connected hardware using multiple detection engines.
        Returns a list of detailed device dictionaries.
        """
        devices = []
        seen_paths = set()

        # ENGINE 1: Check for TI Native spb.dll / bme.dll in common Windows paths
        spb_path = TIEV2400Adapter._find_ti_dll()
        if spb_path:
            devices.append({
                "name": f"🔌 TI Native DLL Driver ({os.path.basename(spb_path)})",
                "type": "TI_DLL",
                "path": spb_path,
                "engine": "TI_DLL"
            })

        # ENGINE 2: Unrestricted HID Enumeration
        if HAS_HID:
            try:
                # Enumerate ALL HID devices on system
                all_hid = hid.enumerate(0, 0)
                for d in all_hid:
                    vid = d.get('vendor_id', 0)
                    pid = d.get('product_id', 0)
                    path = d.get('path', b'').decode('utf-8', errors='ignore') if isinstance(d.get('path'), bytes) else str(d.get('path', ''))
                    mfg = d.get('manufacturer_string', '') or ''
                    prod = d.get('product_string', '') or ''
                    if path in seen_paths:
                        continue

                    is_match = False
                    dev_type = "UNKNOWN"

                    # Check Texas Instruments VID (0x0451)
                    if vid == TI_VID:
                        is_match = True
                        dev_type = "EV2400" if pid == 0x0036 else ("EV2300" if pid == 0x0034 else "TI_USB")
                    # Check Keyword match in Product / Mfg strings
                    elif any(kw in prod.upper() for kw in ["EV2400", "EV2300", "TEXAS", "BQ", "SMBUS", "BMS"]):
                        is_match = True
                        dev_type = "EV2400_COMPAT"
                    elif vid == CP2112_VID and pid == CP2112_PID:
                        is_match = True
                        dev_type = "CP2112"

                    if is_match:
                        seen_paths.add(path)
                        interface = d.get('interface_number', -1)
                        devices.append({
                            "name": f"🔌 {dev_type}: {prod or 'EV2400/EV2300'} (VID:0x{vid:04X} PID:0x{pid:04X} IF:{interface})",
                            "type": dev_type,
                            "path": path,
                            "vid": vid,
                            "pid": pid,
                            "interface": interface,
                            "engine": "HID"
                        })
            except Exception as e:
                print(f"[HID Enum Error]: {e}")

        # ENGINE 3: Always add Force-Open TI EV2400 Default Option
        devices.append({
            "name": "⚡ Force Connect TI EV2400 (Default VID:0x0451 PID:0x0036)",
            "type": "EV2400_FORCE",
            "vid": TI_VID,
            "pid": 0x0036,
            "engine": "FORCE"
        })

        return devices

    @staticmethod
    def _find_ti_dll():
        """Searches Windows system for TI bqStudio spb.dll or bme.dll"""
        if sys.platform != 'win32':
            return None

        candidates = [
            r"C:\Program Files (x86)\Texas Instruments\Battery Management Studio\spb.dll",
            r"C:\Program Files\Texas Instruments\Battery Management Studio\spb.dll",
            r"C:\Texas Instruments\Battery Management Studio\spb.dll",
            r"C:\Program Files (x86)\Texas Instruments\Battery Management Studio\bme.dll",
            r"spb.dll"
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return None

    def open(self, device_info):
        engine = device_info.get('engine', 'FORCE')

        if engine == 'TI_DLL':
            return self._open_ti_dll(device_info.get('path'))
        else:
            return self._open_hid(device_info)

    def _open_ti_dll(self, dll_path):
        try:
            self.dll_handle = ctypes.windll.LoadLibrary(dll_path)
            self.is_connected = True
            self.active_engine = "TI_DLL"
            return True
        except Exception as e:
            raise RuntimeError(f"Failed to load TI DLL {dll_path}: {e}")

    def _open_hid(self, device_info):
        if not HAS_HID:
            raise RuntimeError("hidapi module is missing. Install via `pip install hidapi`.")

        try:
            self.dev = hid.device()
            path = device_info.get('path')
            if path and path != 'FORCE':
                self.dev.open_path(path.encode('utf-8') if isinstance(path, str) else path)
            else:
                vid = device_info.get('vid', TI_VID)
                pid = device_info.get('pid', 0x0036)
                self.dev.open(vid, pid)

            self.dev.set_nonblocking(False)
            self.is_connected = True
            self.active_engine = "HID"
            return True
        except Exception as e:
            self.is_connected = False
            raise RuntimeError(f"Failed to open USB HID device. Make sure TI bqStudio is CLOSED. Error: {e}")

    def close(self):
        if self.dev:
            try:
                self.dev.close()
            except Exception:
                pass
            self.dev = None
        self.dll_handle = None
        self.is_connected = False

    def read_smbus_word(self, reg_cmd, slave_addr=BQ40Z50_8BIT_ADDR):
        if self.active_engine == "TI_DLL" and self.dll_handle:
            return self._read_dll_word(reg_cmd, slave_addr)
        else:
            return self._read_hid_word(reg_cmd, slave_addr)

    def _read_dll_word(self, reg_cmd, slave_addr):
        # Calls TI spb.dll function: spbReadWord(slaveAddr, regCmd, pData)
        try:
            if hasattr(self.dll_handle, 'spbReadWord'):
                val = ctypes.c_uint16(0)
                res = self.dll_handle.spbReadWord(slave_addr, reg_cmd, ctypes.byref(val))
                if res == 0:
                    return val.value
        except Exception:
            pass
        return None

    def _read_hid_word(self, reg_cmd, slave_addr):
        if not self.dev:
            return None

        # EV2400 HID Report formatting:
        # Standard EV2400 SMBus Read Word packet:
        # Byte 0: 0x00 (Report ID)
        # Byte 1: 0x33 or 0x0B (SMBus Read Word command)
        # Byte 2: 0x16 (BQ40Z50 8-bit Write Address)
        # Byte 3: reg_cmd
        # Byte 4: 0x02
        attempts = [
            bytearray([0x00, 0x33, slave_addr & 0xFE, reg_cmd & 0xFF, 0x02] + [0]*59),
            bytearray([0x00, 0x0B, slave_addr & 0xFE, reg_cmd & 0xFF, 0x02] + [0]*59),
            bytearray([0x00, 0x03, slave_addr & 0xFE, reg_cmd & 0xFF, 0x02] + [0]*59)
        ]

        for pkt in attempts:
            try:
                self.dev.write(pkt)
                rx = self.dev.read(64, timeout_ms=200)
                if rx and len(rx) >= 3:
                    # Parse Little Endian word from response
                    if len(rx) >= 4 and (rx[0] == 0x00 or rx[0] == 0x33):
                        return rx[2] | (rx[3] << 8)
                    else:
                        return rx[1] | (rx[2] << 8)
            except Exception:
                continue

        return None

    def read_telemetry(self):
        v = self.read_smbus_word(0x09)
        i_raw = self.read_smbus_word(0x0A)
        c1 = self.read_smbus_word(0x3F)
        c2 = self.read_smbus_word(0x3E)
        c3 = self.read_smbus_word(0x3D)
        c4 = self.read_smbus_word(0x3C)
        soc = self.read_smbus_word(0x0D)
        temp = self.read_smbus_word(0x08)
        sf = self.read_smbus_word(0x51)
        op = self.read_smbus_word(0x54)

        if v is None and c1 is None:
            return None

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
