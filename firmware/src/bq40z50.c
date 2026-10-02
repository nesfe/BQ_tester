/*
 * bq40z50.c - BQ40Z50 Telemetry Handler Implementation
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#include "bq40z50.h"
#include "smbus.h"

static uint32_t system_millis_counter = 0;

void BQ40Z50_Init(void) {
    SMBus_Init();
}

bool BQ40Z50_ReadWord(uint8_t cmd, uint16_t *value) {
    return (SMBus_ReadWord(BQ40Z50_SMBUS_ADDR, cmd, value) == SMBUS_OK);
}

bool BQ40Z50_WriteWord(uint8_t cmd, uint16_t value) {
    return (SMBus_WriteWord(BQ40Z50_SMBUS_ADDR, cmd, value) == SMBUS_OK);
}

bool BQ40Z50_ReadSubcommand(uint16_t subcmd, uint8_t *data, uint8_t len) {
    // Write 2-byte subcommand to 0x00 ManufacturerAccess
    if (SMBus_WriteWord(BQ40Z50_SMBUS_ADDR, SBS_MANUFACTURER_ACCESS, subcmd) != SMBUS_OK) {
        return false;
    }
    
    // Read back buffer from ManufacturerAccess 0x00
    uint8_t actual_len = 0;
    return (SMBus_ReadBlock(BQ40Z50_SMBUS_ADDR, SBS_MANUFACTURER_ACCESS, data, &actual_len) == SMBUS_OK);
}

bool BQ40Z50_ReadTelemetry(BQ40Z50_Telemetry_t *t) {
    if (!t) return false;
    
    uint16_t raw_val = 0;
    t->valid = true;
    t->timestamp_ms = system_millis_counter++;
    
    // 1. Pack Voltage (mV)
    if (BQ40Z50_ReadWord(SBS_VOLTAGE, &t->voltage_mv) != true) t->valid = false;
    
    // 2. Pack Current (mA, signed)
    if (BQ40Z50_ReadWord(SBS_CURRENT, &raw_val)) {
        t->current_ma = (int16_t)raw_val;
    } else t->valid = false;
    
    // 3. Average Current (mA)
    if (BQ40Z50_ReadWord(SBS_AVERAGE_CURRENT, &raw_val)) {
        t->avg_current_ma = (int16_t)raw_val;
    }
    
    // 4. Temperature (0.1 K)
    BQ40Z50_ReadWord(SBS_TEMPERATURE, &t->temperature_dK);
    
    // 5. SoC (%)
    if (BQ40Z50_ReadWord(SBS_RELATIVE_SOC, &raw_val)) {
        t->relative_soc = (uint8_t)raw_val;
    }
    if (BQ40Z50_ReadWord(SBS_ABSOLUTE_SOC, &raw_val)) {
        t->absolute_soc = (uint8_t)raw_val;
    }
    
    // 6. Capacities
    BQ40Z50_ReadWord(SBS_REMAINING_CAPACITY, &t->rem_capacity_mah);
    BQ40Z50_ReadWord(SBS_FULL_CHARGE_CAPACITY, &t->full_capacity_mah);
    
    // 7. Individual Cell Voltages (mV)
    BQ40Z50_ReadWord(BQ_CELL_VOLTAGE_1, &t->cell1_mv);
    BQ40Z50_ReadWord(BQ_CELL_VOLTAGE_2, &t->cell2_mv);
    BQ40Z50_ReadWord(BQ_CELL_VOLTAGE_3, &t->cell3_mv);
    BQ40Z50_ReadWord(BQ_CELL_VOLTAGE_4, &t->cell4_mv);
    
    // 8. Safety & Operation Registers
    uint16_t safety_low = 0, safety_high = 0;
    BQ40Z50_ReadWord(BQ_SAFETY_STATUS, &safety_low);
    // Extended SafetyStatus register upper word read via ManufacturerAccess subcommand if needed
    t->safety_status = (uint32_t)safety_low;
    
    uint16_t op_status_low = 0;
    BQ40Z50_ReadWord(BQ_OPERATION_STATUS, &op_status_low);
    t->operation_status = (uint32_t)op_status_low;
    
    BQ40Z50_ReadWord(SBS_BATTERY_STATUS, &t->battery_status);
    
    return t->valid;
}
