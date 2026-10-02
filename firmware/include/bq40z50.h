/*
 * bq40z50.h - BQ40Z50-R5 SMBus Register Definitions and Telemetry Structure
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#ifndef BQ40Z50_H_
#define BQ40Z50_H_

#include <stdint.h>
#include <stdbool.h>

// SMBus Slave Address for BQ40Z50-R5 (7-bit address 0x0B or 0x16 8-bit write)
#define BQ40Z50_SMBUS_ADDR          0x0B

// Standard SBS Commands (Standard Smart Battery Data Spec)
#define SBS_MANUFACTURER_ACCESS     0x00
#define SBS_REMAINING_CAPACITY_ALM  0x01
#define SBS_REMAINING_TIME_ALM      0x02
#define SBS_BATTERY_MODE            0x03
#define SBS_AT_RATE                 0x04
#define SBS_AT_RATE_TIME_TO_FULL    0x05
#define SBS_AT_RATE_TIME_TO_EMPTY   0x06
#define SBS_AT_RATE_OK              0x07
#define SBS_TEMPERATURE             0x08 // 0.1 K
#define SBS_VOLTAGE                 0x09 // mV
#define SBS_CURRENT                 0x0A // mA (signed)
#define SBS_AVERAGE_CURRENT         0x0B // mA (signed)
#define SBS_MAX_ERROR               0x0C // %
#define SBS_RELATIVE_SOC            0x0D // %
#define SBS_ABSOLUTE_SOC            0x0E // %
#define SBS_REMAINING_CAPACITY      0x0F // mAh
#define SBS_FULL_CHARGE_CAPACITY    0x10 // mAh
#define SBS_RUN_TIME_TO_EMPTY       0x11 // min
#define SBS_AVERAGE_TIME_TO_EMPTY   0x12 // min
#define SBS_AVERAGE_TIME_TO_FULL    0x13 // min
#define SBS_CHARGING_CURRENT        0x14 // mA
#define SBS_CHARGING_VOLTAGE        0x15 // mV
#define SBS_BATTERY_STATUS          0x16 // Flags
#define SBS_CYCLE_COUNT             0x17 // count
#define SBS_DESIGN_CAPACITY         0x18 // mAh
#define SBS_DESIGN_VOLTAGE          0x19 // mV

// BQ40Z50 Specific Extension Commands
#define BQ_CELL_VOLTAGE_4           0x3C // mV
#define BQ_CELL_VOLTAGE_3           0x3D // mV
#define BQ_CELL_VOLTAGE_2           0x3E // mV
#define BQ_CELL_VOLTAGE_1           0x3F // mV
#define BQ_SAFETY_ALERT             0x50 // Bitfield (4 bytes block or word)
#define BQ_SAFETY_STATUS            0x51 // Bitfield (4 bytes block or word)
#define BQ_PF_ALERT                 0x52 // Bitfield
#define BQ_PF_STATUS                0x53 // Bitfield
#define BQ_OPERATION_STATUS         0x54 // Bitfield
#define BQ_CHARGING_STATUS          0x55 // Bitfield
#define BQ_GAUGING_STATUS           0x56 // Bitfield
#define BQ_MANUFACTURER_STATUS      0x57 // Bitfield

// ManufacturerAccess (0x00) Subcommands
#define BQ_SUB_DEVICE_TYPE          0x0001
#define BQ_SUB_FW_VERSION           0x0002
#define BQ_SUB_HW_VERSION           0x0003
#define BQ_SUB_SAFETY_ALERT         0x0050
#define BQ_SUB_SAFETY_STATUS        0x0051
#define BQ_SUB_PF_ALERT             0x0052
#define BQ_SUB_PF_STATUS            0x0053
#define BQ_SUB_OPERATION_STATUS     0x0054
#define BQ_SUB_CHARGING_STATUS      0x0055
#define BQ_SUB_GAUGING_STATUS       0x0056
#define BQ_SUB_MANUFACTURER_STATUS  0x0057
#define BQ_SUB_DA_STATUS_1          0x0071
#define BQ_SUB_DA_STATUS_2          0x0072
#define BQ_SUB_FET_CONTROL          0x0022
#define BQ_SUB_SEAL                 0x0020

// SafetyStatus Bit definitions (Word 0 & Word 1)
#define SAFETY_CUV                  (1UL << 0)  // Cell Undervoltage
#define SAFETY_COV                  (1UL << 1)  // Cell Overvoltage
#define SAFETY_OCC                  (1UL << 2)  // Overcurrent in Charge
#define SAFETY_OCD                  (1UL << 3)  // Overcurrent in Discharge
#define SAFETY_AOLD                 (1UL << 4)  // Overload in Discharge
#define SAFETY_ASCC                 (1UL << 5)  // Short Circuit in Charge
#define SAFETY_ASCD                 (1UL << 6)  // Short Circuit in Discharge
#define SAFETY_OTC                  (1UL << 7)  // Overtemperature in Charge
#define SAFETY_OTD                  (1UL << 8)  // Overtemperature in Discharge
#define SAFETY_CUBL                 (1UL << 9)  // Cell Undervoltage Lockout
#define SAFETY_COBL                 (1UL << 10) // Cell Overvoltage Lockout
#define SAFETY_PTO                  (1UL << 11) // Pre-charge Timeout
#define SAFETY_CTO                  (1UL << 12) // Charge Timeout
#define SAFETY_UTD                  (1UL << 14) // Undertemperature in Discharge
#define SAFETY_UTC                  (1UL << 15) // Undertemperature in Charge

// OperationStatus Bit definitions
#define OP_PRES                     (1UL << 0)  // System Present pin high
#define OP_DSG                      (1UL << 1)  // Discharge FET active
#define OP_CHG                      (1UL << 2)  // Charge FET active
#define OP_PCHG                     (1UL << 3)  // Pre-charge FET active
#define OP_FUSE                     (1UL << 4)  // Fuse pin active
#define OP_CB                       (1UL << 5)  // Cell Balancing active
#define OP_SEC0                     (1UL << 8)  // Security level 0
#define OP_SEC1                     (1UL << 9)  // Security level 1
#define OP_SDM                      (1UL << 12) // Shutdown command
#define OP_SLEEP                    (1UL << 15) // Sleep mode

// Structure to hold complete BQ40Z50 Telemetry Frame
typedef struct {
    uint32_t timestamp_ms;
    uint16_t voltage_mv;        // Pack voltage in mV
    int16_t  current_ma;        // Pack current in mA (+ charge, - discharge)
    int16_t  avg_current_ma;    // Average current in mA
    uint16_t temperature_dK;    // Temperature in 0.1 Kelvin
    uint8_t  relative_soc;      // SoC in %
    uint8_t  absolute_soc;      // Absolute SoC in %
    uint16_t rem_capacity_mah;  // Remaining capacity
    uint16_t full_capacity_mah; // Full charge capacity
    uint16_t cell1_mv;          // Cell 1 voltage
    uint16_t cell2_mv;          // Cell 2 voltage
    uint16_t cell3_mv;          // Cell 3 voltage
    uint16_t cell4_mv;          // Cell 4 voltage
    uint32_t safety_status;     // SafetyStatus 32-bit field
    uint32_t safety_alert;      // SafetyAlert 32-bit field
    uint32_t operation_status;  // OperationStatus 32-bit field
    uint16_t battery_status;    // BatteryStatus 16-bit field
    bool     valid;             // Data integrity flag
} BQ40Z50_Telemetry_t;

// Function prototypes
void BQ40Z50_Init(void);
bool BQ40Z50_ReadTelemetry(BQ40Z50_Telemetry_t *telemetry);
bool BQ40Z50_ReadWord(uint8_t cmd, uint16_t *value);
bool BQ40Z50_WriteWord(uint8_t cmd, uint16_t value);
bool BQ40Z50_ReadSubcommand(uint16_t subcmd, uint8_t *data, uint8_t len);

#endif /* BQ40Z50_H_ */
