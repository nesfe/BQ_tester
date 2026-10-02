#!/usr/bin/env python3
"""
BQ40Z50-R5 Real-Time Battery Telemetry Logger & CSV Recorder
Project: BQ_tester
"""

import serial
import json
import csv
import sys
import time
import argparse
from datetime import datetime

SAFETY_BIT_MAP = {
    (1 << 0): "CUV (Cell Undervoltage)",
    (1 << 1): "COV (Cell Overvoltage)",
    (1 << 2): "OCC (Overcurrent Charge)",
    (1 << 3): "OCD (Overcurrent Discharge)",
    (1 << 4): "AOLD (Overload Discharge)",
    (1 << 5): "ASCC (Short Circuit Charge)",
    (1 << 6): "ASCD (Short Circuit Discharge)",
    (1 << 7): "OTC (Overtemp Charge)",
    (1 << 8): "OTD (Overtemp Discharge)",
    (1 << 9): "CUBL (Cell Undervoltage Lockout)",
    (1 << 10): "COBL (Cell Overvoltage Lockout)",
    (1 << 11): "PTO (Pre-charge Timeout)",
    (1 << 12): "CTO (Charge Timeout)",
    (1 << 14): "UTD (Undertemp Discharge)",
    (1 << 15): "UTC (Undertemp Charge)",
}

OPERATION_BIT_MAP = {
    (1 << 0): "PRES (System Present)",
    (1 << 1): "DSG (Discharge FET ON)",
    (1 << 2): "CHG (Charge FET ON)",
    (1 << 3): "PCHG (Pre-charge FET ON)",
    (1 << 4): "FUSE (Fuse Blown)",
    (1 << 5): "CB (Cell Balancing Active)",
    (1 << 15): "SLEEP (Sleep Mode)",
}

def decode_bits(bitfield, mapping):
    active = []
    for bit, name in mapping.items():
        if bitfield & bit:
            active.append(name)
    return active if active else ["NORMAL"]

def main():
    parser = argparse.ArgumentParser(description="BQ40Z50-R5 Serial Telemetry Logger")
    parser.add_argument("--port", "-p", default="/dev/ttyACM0", help="Serial port (e.g. /dev/ttyACM0 or COM3)")
    parser.add_argument("--baud", "-b", type=int, default=115200, help="Baud rate")
    parser.add_argument("--output", "-o", default="", help="CSV output filepath")
    args = parser.parse_args()

    filename = args.output if args.output else f"bq40z50_telemetry_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    print(f"[BQ_tester] Opening serial port {args.port} at {args.baud} baud...")
    print(f"[BQ_tester] Recording data to {filename}")

    try:
        ser = serial.Serial(args.port, args.baud, timeout=2.0)
    except Exception as e:
        print(f"[Error] Failed to open serial port: {e}")
        sys.exit(1)

    with open(filename, mode='w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            "Timestamp", "Pack_Voltage_mV", "Pack_Current_mA",
            "Cell1_mV", "Cell2_mV", "Cell3_mV", "Cell4_mV",
            "SoC_Percent", "Temp_C", "Safety_Status_Hex", "Safety_Status_Decoded",
            "Operation_Status_Hex", "Operation_Status_Decoded"
        ])

        print("-" * 95)
        print(f"{'Timestamp':<12} | {'Voltage':<8} | {'Current':<9} | {'Cell1-4 (mV)':<22} | {'SoC':<4} | {'Temp':<6} | {'Safety Status'}")
        print("-" * 95)

        last_safety_state = None

        while True:
            try:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if not line:
                    continue

                if line.startswith("{") and line.endswith("}"):
                    data = json.loads(line)
                    if data.get("type") == "telemetry":
                        now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                        v = data.get("v", 0)
                        i = data.get("i", 0)
                        c1 = data.get("c1", 0)
                        c2 = data.get("c2", 0)
                        c3 = data.get("c3", 0)
                        c4 = data.get("c4", 0)
                        soc = data.get("soc", 0)
                        temp_c = data.get("temp", 0) / 10.0
                        sf = data.get("sf", 0)
                        op = data.get("op", 0)

                        safety_decoded = decode_bits(sf, SAFETY_BIT_MAP)
                        op_decoded = decode_bits(op, OPERATION_BIT_MAP)

                        # Write row to CSV file
                        writer.writerow([
                            now_str, v, i, c1, c2, c3, c4, soc, temp_c,
                            hex(sf), "|".join(safety_decoded),
                            hex(op), "|".join(op_decoded)
                        ])
                        f.flush()

                        # Print real-time console telemetry
                        cells_str = f"{c1}/{c2}/{c3}/{c4}"
                        safety_str = ", ".join(safety_decoded)

                        # Highlight safety state change
                        if sf != last_safety_state:
                            if sf != 0:
                                print(f"\n⚡ [ALERT TRIGGERED AT {now_str}] Safety Flags: {safety_str}\n")
                            else:
                                print(f"\n✅ [STATUS NORMAL AT {now_str}] All safety flags cleared\n")
                            last_safety_state = sf

                        print(f"{now_str:<12} | {v/1000.0:6.3f}V  | {i:7d}mA | {cells_str:<22} | {soc:3d}% | {temp_c:5.1f}°C | {safety_str}")

            except KeyboardInterrupt:
                print("\n[BQ_tester] Logging stopped by user.")
                break
            except Exception as e:
                print(f"[Warning] Frame parsing error: {e}")

if __name__ == "__main__":
    main()
