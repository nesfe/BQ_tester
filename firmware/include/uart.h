/*
 * uart.h - MSP430 UART Telemetry Serializer Header
 * Project: BQ_tester
 * Author: Antigravity AI
 */

#ifndef UART_H_
#define UART_H_

#include <stdint.h>
#include <stdbool.h>
#include "bq40z50.h"

void UART_Init(void);
void UART_SendByte(uint8_t byte);
void UART_SendString(const char *str);
void UART_SendTelemetryJSON(const BQ40Z50_Telemetry_t *telemetry);
bool UART_Available(void);
uint8_t UART_ReadByte(void);

#endif /* UART_H_ */
