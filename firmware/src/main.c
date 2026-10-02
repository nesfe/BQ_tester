/*
 * main.c - Main Entry Point for MSP430 BQ40Z50 Real-Time SMBus Bridge
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#include <msp430.h>
#include "bq40z50.h"
#include "smbus.h"
#include "uart.h"

// Sample interval delay (~100ms sample rate)
static void delay_ms(uint16_t ms) {
    while (ms--) {
        __delay_cycles(16000); // Assuming 16MHz MCLK
    }
}

int main(void) {
    WDTCTL = WDTPW | WDTHOLD;   // Stop watchdog timer
    
    // System Clock Initialization to 16MHz (MSP430F5529 default / UCS)
#if defined(__MSP430F5529__)
    // UCS setup for 16MHz DCO
    UCSCTL3 |= SELREF_2;
    UCSCTL4 |= SELA_2;
    __bis_SR_register(SCG0);
    UCSCTL0 = 0x0000;
    UCSCTL1 = DCORSEL_5;
    UCSCTL2 = FLLD_1 + 487;
    __bic_SR_register(SCG0);
    __delay_cycles(375000);
#endif

    // Initialize Peripherals
    UART_Init();
    BQ40Z50_Init();
    
    UART_SendString("{\"type\":\"status\",\"msg\":\"MSP430 BQ40Z50 SMBus Bridge Ready\"}\n");
    
    BQ40Z50_Telemetry_t telemetry;
    
    while (1) {
        // Read real-time battery telemetry from BQ40Z50 over SMBus
        if (BQ40Z50_ReadTelemetry(&telemetry)) {
            // Send formatted JSON packet to Host PC over UART
            UART_SendTelemetryJSON(&telemetry);
        } else {
            // Sensor read retry / fallback notification
            UART_SendString("{\"type\":\"error\",\"msg\":\"SMBus Read Error / Battery Disconnected\"}\n");
        }
        
        // Polling interval (100ms sample rate for high-resolution graph building)
        delay_ms(100);
    }
    
    return 0;
}
