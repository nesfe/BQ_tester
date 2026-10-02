/*
 * smbus.h - SMBus / I2C Master Driver for MSP430 with PEC support
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#ifndef SMBUS_H_
#define SMBUS_H_

#include <stdint.h>
#include <stdbool.h>

// SMBus Return Status Codes
typedef enum {
    SMBUS_OK = 0,
    SMBUS_ERR_NACK,
    SMBUS_ERR_TIMEOUT,
    SMBUS_ERR_PEC_FAIL,
    SMBUS_ERR_BUS_BUSY
} SMBus_Status_t;

// Function prototypes
void SMBus_Init(void);
SMBus_Status_t SMBus_ReadWord(uint8_t slaveAddr, uint8_t command, uint16_t *data);
SMBus_Status_t SMBus_WriteWord(uint8_t slaveAddr, uint8_t command, uint16_t data);
SMBus_Status_t SMBus_ReadBlock(uint8_t slaveAddr, uint8_t command, uint8_t *buffer, uint8_t *length);
SMBus_Status_t SMBus_WriteBlock(uint8_t slaveAddr, uint8_t command, const uint8_t *buffer, uint8_t length);

// PEC (Packet Error Checking) CRC-8 polynomial calculation
uint8_t SMBus_CalculatePEC(const uint8_t *bytes, uint8_t count);

#endif /* SMBUS_H_ */
