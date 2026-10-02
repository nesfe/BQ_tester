# MSP430 Firmware for BQ40Z50-R5 SMBus Bridge

This firmware transforms an MSP430 microcontroller (such as MSP430F5529, MSP430G2553, or MSP430FR5969 LaunchPads) into a high-speed SMBus to UART bridge for real-time telemetry extraction from Texas Instruments BQ40Z50-R5 Battery Management ICs.

## Pin Connections

| MSP430 Signal | MSP430 Pin (F5529) | BQ40Z50 Signal | Notes |
| :--- | :--- | :--- | :--- |
| **I2C SCL** | P3.1 | SMBC (SCL) | Needs 10kΩ pull-up to 3.3V |
| **I2C SDA** | P3.0 | SMBD (SDA) | Needs 10kΩ pull-up to 3.3V |
| **GND** | GND | VSS / GND | Common Ground |
| **UART TX** | P3.3 | PC RX / USB-UART | Connect to USB-UART Converter |
| **UART RX** | P3.4 | PC TX / USB-UART | Connect to USB-UART Converter |

## Technical Features
- **Protocol**: SMBus 1.1 / I2C at 100 kHz with optional PEC (CRC-8) verification.
- **Sampling Rate**: 10Hz (100ms per sample) continuous real-time streaming.
- **Output Format**: Structured JSON streams over UART (115200 baud, 8N1).
- **Registers Monitored**: Total Voltage, Current (Charge/Discharge), Cell Voltages 1-4, Temperature, State of Charge, SafetyStatus bitfields, OperationStatus bitfields.

## How to Build in TI Code Composer Studio (CCS)
1. Open TI Code Composer Studio.
2. Select `File -> Import -> CCS Projects`.
3. Browse to the `firmware/` directory and select `BQ_tester_Firmware`.
4. Build target (`Ctrl+B`) and flash onto your MSP430 LaunchPad via USB EZ-FET / FET debugger.
