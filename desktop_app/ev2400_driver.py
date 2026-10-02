"""
TI EV2400 / EV2300 Universal USB-HID & DLL Driver Bridge
Project: BQ_tester
Description: Full support for TI EV2400 PID 0x0037 / 0x0036 / 0x0034 with SMBus Header Auto-Probing.
"""

import sys
import os
import time
import ctypes

try:
    import hid
    HAS_HID = True
except ImportError:
    HAS_HID = False

TI_VID = 0x0451
# Include PID 0x0037 explicitly alongside 0x0036 and 0x0034
EV2400_PIDS = [0x0037, 0x0036, 0x0034, 0x0035, 0x0038, 0x16A8, 0x3410]

BQ40Z50_7BIT_ADDR = 0x0B
BQ40Z50_8BIT_ADDR = 0x16

class TIEV2400Adapter:
    def __init__(self):
        self.dev = None
        self.dll_handle = None
        self.is_connected = False
        self.active_engine = None
        self.working_header = 0x33 # Default EV2400 header

    @staticmethod
    def detect_all_devices():
        """
        Scans system for TI EV2400/EV2300 using TI DLLs, HID (PID 0x0037/0x0036), and WinUSB.
        """
        devices = []
        seen_paths = set()

        # 1. Check TI bqStudio Native DLLs
        found_dlls = TIEV2400Adapter._find_ti_dlls()
        for dll_path in found_dlls:
            dll_name = os.path.basename(dll_path)
            devices.append({
                "name": f"🔌 TI Native DLL Driver ({dll_name})",
                "type": "TI_DLL",
                "path": dll_path,
                "engine": "TI_DLL"
            })

        # 2. Scan HID API devices explicitly checking PID 0x0037, 0x0036, 0x0034
        if HAS_HID:
            try:
                all_hid = hid.enumerate(0, 0)
                for d in all_hid:
                    vid = d.get('vendor_id', 0)
                    pid = d.get('product_id', 0)
                    mfg = d.get('manufacturer_string', '') or ''
                    prod = d.get('product_string', '') or ''
                    path = d.get('path', b'').decode('utf-8', errors='ignore') if isinstance(d.get('path'), bytes) else str(d.get('path', ''))

                    if path in seen_paths:
                        continue

                    # Check TI VID 0x0451 or PID 0x0037/0x0036
                    if vid == TI_VID or pid in EV2400_PIDS or "EV2400" in prod.upper() or "EV2300" in prod.upper():
                        seen_paths.add(path)
                        iface = d.get('interface_number', 0)
                        dev_name = f"🔌 TI {prod or 'EV2400'} (VID:0x{vid:04X} PID:0x{pid:04X} IF:{iface})"
                        devices.append({
                            "name": dev_name,
                            "type": "EV2400_HID",
                            "path": path,
                            "vid": vid,
                            "pid": pid,
                            "interface": iface,
                            "engine": "HID"
                        })
            except Exception as e:
                print(f"[HID Enum Error]: {e}")

        # 3. Add Direct PID 0x0037 / PID 0x0036 Fallback Entries
        devices.append({
            "name": "⚡ Force Direct TI EV2400 (PID 0x0037 / 0x0036 Auto-Connect)",
            "type": "EV2400_FORCE",
            "vid": TI_VID,
            "pid": 0x0037,
            "engine": "FORCE"
        })

        return devices

    @staticmethod
    def _find_ti_dlls():
        if sys.platform != 'win32':
            return []

        search_dirs = [
            r"C:\Program Files (x86)\Texas Instruments\Battery Management Studio",
            r"C:\Program Files\Texas Instruments\Battery Management Studio",
            r"C:\Texas Instruments\Battery Management Studio",
            r"C:\ti\Battery Management Studio",
            os.getcwd()
        ]

        dll_names = ["spb_Win64.dll", "spb.dll", "bqEV2400.dll", "bme.dll", "spb32.dll"]
        found = []

        for s_dir in search_dirs:
            if os.path.exists(s_dir):
                for name in dll_names:
                    full_path = os.path.join(s_dir, name)
                    if os.path.exists(full_path) and full_path not in found:
                        found.append(full_path)

        return found

    def open(self, device_info):
        engine = device_info.get('engine', 'FORCE')

        if engine == 'TI_DLL':
            res = self._open_ti_dll(device_info.get('path'))
        elif engine == 'HID':
            res = self._open_hid(device_info.get('path'))
        else:
            res = self._open_force_hid(device_info.get('vid', TI_VID), device_info.get('pid', 0x0037))

        if res:
            # Auto-probe working SMBus HID packet header
            self._probe_working_header()

        return res

    def _open_ti_dll(self, dll_path):
        try:
            self.dll_handle = ctypes.windll.LoadLibrary(dll_path)
            self.active_engine = "TI_DLL"
            self.is_connected = True
            return True
        except Exception as e:
            raise RuntimeError(f"Failed to load TI DLL ({dll_path}): {e}")

    def _open_hid(self, path):
        if not HAS_HID:
            raise RuntimeError("hidapi module is missing. Install via `pip install hidapi`.")
        try:
            self.dev = hid.device()
            self.dev.open_path(path.encode('utf-8') if isinstance(path, str) else path)
            self.dev.set_nonblocking(False)
            self.active_engine = "HID"
            self.is_connected = True
            return True
        except Exception as e:
            raise RuntimeError(f"Could not open EV2400 HID path. Ensure bqStudio is CLOSED! Error: {e}")

    def _open_force_hid(self, vid, pid):
        if not HAS_HID:
            raise RuntimeError("hidapi module is missing.")
        
        # Try PID 0x0037 first, then PID 0x0036
        for p in [pid, 0x0037, 0x0036, 0x0034]:
            try:
                self.dev = hid.device()
                self.dev.open(vid, p)
                self.dev.set_nonblocking(False)
                self.active_engine = "HID"
                self.is_connected = True
                return True
            except Exception:
                pass

        raise RuntimeError("Could not connect to TI EV2400 (PID 0x0037/0x0036). Ensure bqStudio is CLOSED!")

    def _probe_working_header(self):
        """Auto-probes EV2400 SMBus packet headers to lock onto the working protocol format"""
        if self.active_engine != "HID" or not self.dev:
            return

        candidate_headers = [0x33, 0x0B, 0x03, 0x16, 0x2C, 0x00]
        for hdr in candidate_headers:
            val = self._try_read_with_header(hdr, 0x09) # Try reading Voltage (0x09)
            if val is not None and val > 2000 and val < 30000: # Valid pack voltage (2V to 30V)
                self.working_header = hdr
                print(f"[EV2400 Header Auto-Detect] Locked onto header: 0x{hdr:02X}")
                return

            val_temp = self._try_read_with_header(hdr, 0x08) # Try reading Temp (0x08)
            if val_temp is not None and val_temp > 2500 and val_temp < 3500: # Valid Kelvin temp
                self.working_header = hdr
                print(f"[EV2400 Header Auto-Detect] Locked onto header: 0x{hdr:02X}")
                return

    def _try_read_with_header(self, hdr, reg_cmd, slave_addr=BQ40Z50_8BIT_ADDR):
        if not self.dev:
            return None

        # Build 64-byte EV2400 HID Report
        pkt = bytearray(64)
        pkt[0] = 0x00      # Report ID
        pkt[1] = hdr       # Command header
        pkt[2] = slave_addr & 0xFE # 8-bit Write Address (0x16)
        pkt[3] = reg_cmd & 0xFF    # Register Command
        pkt[4] = 0x02              # Read length

        try:
            self.dev.write(pkt)
            rx = self.dev.read(64, timeout_ms=150)
            if rx and len(rx) >= 3:
                # Check response formats
                if len(rx) >= 4 and rx[0] in [0x00, hdr]:
                    val = rx[2] | (rx[3] << 8)
                    return val if val != 0xFFFF else None
                else:
                    val = rx[1] | (rx[2] << 8)
                    return val if val != 0xFFFF else None
        except Exception:
            pass

        return None

    def read_smbus_word(self, reg_cmd, slave_addr=BQ40Z50_8BIT_ADDR):
        if self.active_engine == "TI_DLL" and self.dll_handle:
            return self._read_dll_word(reg_cmd, slave_addr)
        elif self.dev:
            # First try with auto-detected working header
            val = self._try_read_with_header(self.working_header, reg_cmd, slave_addr)
            if val is not None:
                return val
            
            # Fallback scan other headers if working header failed
            for hdr in [0x33, 0x0B, 0x03, 0x16, 0x2C]:
                val = self._try_read_with_header(hdr, reg_cmd, slave_addr)
                if val is not None:
                    self.working_header = hdr
                    return val

        return None

    def _read_dll_word(self, reg_cmd, slave_addr):
        try:
            if hasattr(self.dll_handle, 'spbReadWord'):
                val = ctypes.c_uint16(0)
                res = self.dll_handle.spbReadWord(ctypes.c_uint8(slave_addr), ctypes.c_uint8(reg_cmd), ctypes.byref(val))
                if res == 0:
                    return val.value
            if hasattr(self.dll_handle, 'BQEV2400_ReadWord'):
                val = ctypes.c_uint16(0)
                res = self.dll_handle.BQEV2400_ReadWord(ctypes.c_uint8(reg_cmd), ctypes.byref(val))
                if res == 0:
                    return val.value
        except Exception as e:
            print(f"[TI DLL Read Error]: {e}")
        return None

    def close(self):
        if self.dev:
            try:
                self.dev.close()
            except Exception:
                pass
            self.dev = None
        self.dll_handle = None
        self.is_connected = False

    def read_telemetry(self):
        v = self.read_smbus_word(0x09)       # Voltage (mV)
        i_raw = self.read_smbus_word(0x0A)   # Current (mA)
        c1 = self.read_smbus_word(0x3F)      # Cell 1 (mV)
        c2 = self.read_smbus_word(0x3E)      # Cell 2 (mV)
        c3 = self.read_smbus_word(0x3D)      # Cell 3 (mV)
        c4 = self.read_smbus_word(0x3C)      # Cell 4 (mV)
        soc = self.read_smbus_word(0x0D)     # SoC (%)
        temp = self.read_smbus_word(0x08)    # Temp (0.1 K)
        sf = self.read_smbus_word(0x51)      # SafetyStatus
        op = self.read_smbus_word(0x54)      # OperationStatus

        # Fallback cell voltages if 0x3F-0x3C empty
        if c1 is None:
            c1 = self.read_smbus_word(0x3F, 0x16)

        if v is None and c1 is None and temp is None:
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
