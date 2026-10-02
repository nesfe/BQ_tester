export const SBS_REGISTERS = [
  { addr: 0x08, name: "Temperature", unit: "°C", scale: 0.1, offset: -273.15, desc: "Pack Temperature" },
  { addr: 0x09, name: "Voltage", unit: "mV", scale: 1, desc: "Pack Total Voltage" },
  { addr: 0x0A, name: "Current", unit: "mA", scale: 1, signed: true, desc: "Pack Current (+ Charge, - Discharge)" },
  { addr: 0x0B, name: "AverageCurrent", unit: "mA", scale: 1, signed: true, desc: "Rolling Average Pack Current" },
  { addr: 0x0D, name: "RelativeStateOfCharge", unit: "%", scale: 1, desc: "State of Charge" },
  { addr: 0x0E, name: "AbsoluteStateOfCharge", unit: "%", scale: 1, desc: "Absolute SoC" },
  { addr: 0x0F, name: "RemainingCapacity", unit: "mAh", scale: 1, desc: "Remaining Capacity" },
  { addr: 0x10, name: "FullChargeCapacity", unit: "mAh", scale: 1, desc: "Full Charge Capacity" },
  { addr: 0x3C, name: "CellVoltage4", unit: "mV", scale: 1, desc: "Cell 4 Voltage" },
  { addr: 0x3D, name: "CellVoltage3", unit: "mV", scale: 1, desc: "Cell 3 Voltage" },
  { addr: 0x3E, name: "CellVoltage2", unit: "mV", scale: 1, desc: "Cell 2 Voltage" },
  { addr: 0x3F, name: "CellVoltage1", unit: "mV", scale: 1, desc: "Cell 1 Voltage" },
  { addr: 0x51, name: "SafetyStatus", unit: "HEX", scale: 1, isBitfield: true, desc: "Safety Protection Status Flags" },
  { addr: 0x54, name: "OperationStatus", unit: "HEX", scale: 1, isBitfield: true, desc: "System & FET Operating Status Flags" },
];

export const SAFETY_STATUS_FLAGS = [
  { bit: 0, code: "CUV", label: "Cell Undervoltage", severity: "danger", desc: "One or more cells dropped below CUV threshold" },
  { bit: 1, code: "COV", label: "Cell Overvoltage", severity: "danger", desc: "One or more cells exceeded COV threshold" },
  { bit: 2, code: "OCC", label: "Overcurrent Charge", severity: "warning", desc: "Charging current exceeded safety limit" },
  { bit: 3, code: "OCD", label: "Overcurrent Discharge", severity: "danger", desc: "Discharging current exceeded safety limit" },
  { bit: 4, code: "AOLD", label: "Overload Discharge", severity: "danger", desc: "Hardware discharge overload trip" },
  { bit: 5, code: "ASCC", label: "Short Circuit Charge", severity: "danger", desc: "Hardware short circuit detected during charge" },
  { bit: 6, code: "ASCD", label: "Short Circuit Discharge", severity: "danger", desc: "Hardware short circuit detected during discharge" },
  { bit: 7, code: "OTC", label: "Overtemp Charge", severity: "warning", desc: "Temperature too high for charging" },
  { bit: 8, code: "OTD", label: "Overtemp Discharge", severity: "danger", desc: "Temperature too high for discharging" },
  { bit: 9, code: "CUBL", label: "Cell UV Lockout", severity: "danger", desc: "Cell undervoltage lockout active" },
  { bit: 10, code: "COBL", label: "Cell OV Lockout", severity: "danger", desc: "Cell overvoltage lockout active" },
  { bit: 11, code: "PTO", label: "Pre-charge Timeout", severity: "warning", desc: "Pre-charge timer exceeded safety limit" },
  { bit: 12, code: "CTO", label: "Charge Timeout", severity: "warning", desc: "Fast charge timer exceeded safety limit" },
  { bit: 14, code: "UTD", label: "Undertemp Discharge", severity: "warning", desc: "Temperature too low for discharge" },
  { bit: 15, code: "UTC", label: "Undertemp Charge", severity: "warning", desc: "Temperature too low for charging" },
];

export const OPERATION_STATUS_FLAGS = [
  { bit: 0, code: "PRES", label: "System Present", severity: "info", desc: "PRES pin asserted (pack attached to host)" },
  { bit: 1, code: "DSG", label: "Discharge FET ON", severity: "success", desc: "Discharge MOSFET driver enabled" },
  { bit: 2, code: "CHG", label: "Charge FET ON", severity: "success", desc: "Charge MOSFET driver enabled" },
  { bit: 3, code: "PCHG", label: "Pre-charge FET ON", severity: "info", desc: "Pre-charge MOSFET driver active" },
  { bit: 4, code: "FUSE", label: "Fuse Pin Active", severity: "danger", desc: "Chemical fuse blown" },
  { bit: 5, code: "CB", label: "Cell Balancing Active", severity: "info", desc: "Cell balancing active on one or more cells" },
  { bit: 15, code: "SLEEP", label: "Sleep Mode", severity: "info", desc: "BMS in low power sleep state" },
];
