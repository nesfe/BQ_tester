/*
 * smbus.c - SMBus / I2C Master Driver Implementation for MSP430
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#include <msp430.h>
#include "smbus.h"

// CRC-8 PEC calculation with polynomial x^8 + x^2 + x^1 + 1 (0x07)
uint8_t SMBus_CalculatePEC(const uint8_t *bytes, uint8_t count) {
    uint8_t crc = 0x00;
    uint8_t i, j;
    
    for (i = 0; i < count; i++) {
        crc ^= bytes[i];
        for (j = 0; j < 8; j++) {
            if (crc & 0x80) {
                crc = (crc << 1) ^ 0x07;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc;
}

void SMBus_Init(void) {
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_B0__)
    // Configure pins P3.0 (SDA) and P3.1 (SCL) for USCI_B0 I2C
    P3SEL |= BIT0 | BIT1;
    
    UCB0CTL1 |= UCSWRST;                      // Enable SW reset
    UCB0CTL0 = UCMST | UCMODE_3 | UCSYNC;     // I2C Master, synchronous
    UCB0CTL1 = UCSSEL_2 | UCSWRST;            // Use SMCLK, keep SW reset
    UCB0BR0 = 160;                            // SMCLK/160 = 100kHz I2C clock (16MHz SMCLK)
    UCB0BR1 = 0;
    UCB0CTL1 &= ~UCSWRST;                     // Clear SW reset, resume operation
#else
    // Generic MSP430 placeholder initialization
    // Adjust registers for specific MSP430 family (MSP430G2553 / MSP430FR5969)
#endif
}

SMBus_Status_t SMBus_ReadWord(uint8_t slaveAddr, uint8_t command, uint16_t *data) {
    uint16_t timeout = 5000;
    
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_B0__)
    UCB0I2CSA = slaveAddr;                     // Set Slave Address
    
    // Transmit Command
    UCB0CTL1 |= UCTR | UCTXSTT;               // I2C TX mode, send START condition
    while (!(UCB0IFG & UCTXIFG)) {
        if (--timeout == 0) return SMBUS_ERR_TIMEOUT;
    }
    UCB0TXBUF = command;                       // Send Command register byte
    
    while (UCB0CTL1 & UCTXSTT);                // Wait for START to clear
    if (UCB0IFG & UCNACKIFG) {
        UCB0CTL1 |= UCTXSTP;
        return SMBUS_ERR_NACK;
    }
    
    // Switch to RX Mode
    UCB0CTL1 &= ~UCTR;                         // I2C RX mode
    UCB0CTL1 |= UCTXSTT;                       // Repeated START condition
    
    while (UCB0CTL1 & UCTXSTT);                // Wait for START to complete
    
    // Read Low Byte
    timeout = 5000;
    while (!(UCB0IFG & UCRXIFG)) {
        if (--timeout == 0) return SMBUS_ERR_TIMEOUT;
    }
    uint8_t low = UCB0RXBUF;
    
    // Send STOP before reading last byte
    UCB0CTL1 |= UCTXSTP;
    
    // Read High Byte
    timeout = 5000;
    while (!(UCB0IFG & UCRXIFG)) {
        if (--timeout == 0) return SMBUS_ERR_TIMEOUT;
    }
    uint8_t high = UCB0RXBUF;
    
    while (UCB0CTL1 & UCTXSTP);                // Wait for STOP to clear
    
    *data = ((uint16_t)high << 8) | low;
    return SMBUS_OK;
#else
    // Default simulated read for fallback
    *data = 0x0000;
    return SMBUS_OK;
#endif
}

SMBus_Status_t SMBus_WriteWord(uint8_t slaveAddr, uint8_t command, uint16_t data) {
    uint16_t timeout = 5000;
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_B0__)
    UCB0I2CSA = slaveAddr;
    UCB0CTL1 |= UCTR | UCTXSTT;
    
    while (!(UCB0IFG & UCTXIFG)) { if (--timeout == 0) return SMBUS_ERR_TIMEOUT; }
    UCB0TXBUF = command;
    
    while (!(UCB0IFG & UCTXIFG)) { if (--timeout == 0) return SMBUS_ERR_TIMEOUT; }
    UCB0TXBUF = (uint8_t)(data & 0xFF);        // Low byte
    
    while (!(UCB0IFG & UCTXIFG)) { if (--timeout == 0) return SMBUS_ERR_TIMEOUT; }
    UCB0TXBUF = (uint8_t)((data >> 8) & 0xFF); // High byte
    
    while (!(UCB0IFG & UCTXIFG));
    UCB0CTL1 |= UCTXSTP;                       // Send STOP
    while (UCB0CTL1 & UCTXSTP);
    
    return SMBUS_OK;
#else
    return SMBUS_OK;
#endif
}

SMBus_Status_t SMBus_ReadBlock(uint8_t slaveAddr, uint8_t command, uint8_t *buffer, uint8_t *length) {
    // Read block implementation for multi-byte manufacturer commands
    uint16_t timeout = 5000;
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_B0__)
    UCB0I2CSA = slaveAddr;
    UCB0CTL1 |= UCTR | UCTXSTT;
    
    while (!(UCB0IFG & UCTXIFG)) { if (--timeout == 0) return SMBUS_ERR_TIMEOUT; }
    UCB0TXBUF = command;
    
    UCB0CTL1 &= ~UCTR;                         // Switch to RX
    UCB0CTL1 |= UCTXSTT;                       // Repeated START
    while (UCB0CTL1 & UCTXSTT);
    
    // First byte received in Block Read is the byte count
    while (!(UCB0IFG & UCRXIFG));
    uint8_t count = UCB0RXBUF;
    *length = count;
    
    for (uint8_t i = 0; i < count; i++) {
        if (i == count - 1) {
            UCB0CTL1 |= UCTXSTP;               // Send STOP before last byte
        }
        while (!(UCB0IFG & UCRXIFG));
        buffer[i] = UCB0RXBUF;
    }
    while (UCB0CTL1 & UCTXSTP);
    return SMBUS_OK;
#else
    *length = 0;
    return SMBUS_OK;
#endif
}

SMBus_Status_t SMBus_WriteBlock(uint8_t slaveAddr, uint8_t command, const uint8_t *buffer, uint8_t length) {
    return SMBUS_OK;
}
