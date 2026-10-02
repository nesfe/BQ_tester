/*
 * uart.c - MSP430 UART Driver & Telemetry Serializer
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#include <msp430.h>
#include <stdio.h>
#include <string.h>
#include "uart.h"

void UART_Init(void) {
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_A0__)
    P3SEL |= BIT3 | BIT4;                      // P3.3 = TXD, P3.4 = RXD
    UCA0CTL1 |= UCSWRST;                       // Reset USCI
    UCA0CTL1 |= UCSSEL_2;                      // SMCLK
    UCA0BR0 = 138;                             // 16MHz / 115200 = 138
    UCA0BR1 = 0;
    UCA0MCTL = UCBRS_7 | UCBRF_0;              // Modulation
    UCA0CTL1 &= ~UCSWRST;                      // Initialize USCI
    UCA0IE |= UCRXIE;                          // Enable RX Interrupt
#else
    // Generic fallback initialization
#endif
}

void UART_SendByte(uint8_t byte) {
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_A0__)
    while (!(UCTXIFG & UCA0IFG));
    UCA0TXBUF = byte;
#endif
}

void UART_SendString(const char *str) {
    while (*str) {
        UART_SendByte((uint8_t)*str++);
    }
}

void UART_SendTelemetryJSON(const BQ40Z50_Telemetry_t *t) {
    if (!t) return;
    char buffer[256];
    
    // Convert 0.1 K to °C ( (dK - 2731) / 10.0 )
    int16_t temp_c_x10 = (int16_t)t->temperature_dK - 2731;
    
    // Format JSON line with clear, parsed fields
    snprintf(buffer, sizeof(buffer),
        "{\"type\":\"telemetry\",\"v\":%u,\"i\":%d,\"c1\":%u,\"c2\":%u,\"c3\":%u,\"c4\":%u,\"soc\":%u,\"temp\":%d,\"sf\":%lu,\"op\":%lu}\n",
        t->voltage_mv,
        t->current_ma,
        t->cell1_mv,
        t->cell2_mv,
        t->cell3_mv,
        t->cell4_mv,
        t->relative_soc,
        temp_c_x10,
        (unsigned long)t->safety_status,
        (unsigned long)t->operation_status
    );
    
    UART_SendString(buffer);
}

bool UART_Available(void) {
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_A0__)
    return (UCRXIFG & UCA0IFG) != 0;
#else
    return false;
#endif
}

uint8_t UART_ReadByte(void) {
#if defined(__MSP430F5529__) || defined(__MSP430_HAS_USCI_A0__)
    return UCA0RXBUF;
#else
    return 0;
#endif
}
