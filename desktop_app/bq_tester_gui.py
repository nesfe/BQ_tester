#!/usr/bin/env python3
"""
BQ_tester Windows Desktop Application (PyQt6 + PyQtGraph)
Real-time SMBus Telemetry & Safety Status Debugger for BQ40Z50-R5
Direct out-of-the-box hardware interface for TI EV2400 / EV2300 & COM Ports
"""

import sys
import json
import time
import csv
from datetime import datetime

from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QThread
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QComboBox, QTableWidget, QTableWidgetItem,
    QHeaderView, QProgressBar, QGroupBox, QSplitter, QFileDialog, QMessageBox
)
from PyQt6.QtGui import QFont, QColor

import pyqtgraph as pg
import serial
import serial.tools.list_ports

from ev2400_driver import TIEV2400Adapter, HAS_HID

# Dark Professional QSS Theme
DARK_QSS = """
QMainWindow {
    background-color: #0b0e14;
}
QWidget {
    background-color: #0b0e14;
    color: #e2e8f0;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
}
QGroupBox {
    background-color: #131722;
    border: 1px solid #2a324b;
    border-radius: 8px;
    margin-top: 12px;
    font-weight: bold;
    color: #6366f1;
}
QGroupBox::title {
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 5px;
}
QPushButton {
    background-color: #1e293b;
    color: #f8fafc;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 6px 14px;
    font-weight: 600;
}
QPushButton:hover {
    background-color: #334155;
    border-color: #6366f1;
}
QPushButton:pressed {
    background-color: #475569;
}
QPushButton#connectBtn {
    background-color: #059669;
    border-color: #10b981;
}
QPushButton#connectBtn:hover {
    background-color: #10b981;
}
QPushButton#disconnectBtn {
    background-color: #dc2626;
    border-color: #ef4444;
}
QPushButton#recordBtnActive {
    background-color: #b91c1c;
    color: #ffffff;
    border: 1px solid #ef4444;
}
QComboBox {
    background-color: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 5px 10px;
    color: #f8fafc;
}
QTableWidget {
    background-color: #131722;
    gridline-color: #1e293b;
    border: 1px solid #2a324b;
    border-radius: 6px;
}
QHeaderView::section {
    background-color: #1e293b;
    color: #94a3b8;
    padding: 6px;
    font-weight: bold;
    border: none;
}
QProgressBar {
    background-color: #1e293b;
    border-radius: 4px;
    text-align: center;
    color: white;
    font-weight: bold;
}
QProgressBar::chunk {
    background-color: #6366f1;
    border-radius: 4px;
}
"""

SAFETY_FLAGS = [
    (0, "CUV", "Cell Undervoltage"),
    (1, "COV", "Cell Overvoltage"),
    (2, "OCC", "Overcurrent Charge"),
    (3, "OCD", "Overcurrent Discharge"),
    (4, "AOLD", "Overload Discharge"),
    (5, "ASCC", "Short Circuit Charge"),
    (6, "ASCD", "Short Circuit Discharge"),
    (7, "OTC", "Overtemp Charge"),
    (8, "OTD", "Overtemp Discharge"),
    (9, "CUBL", "Cell UV Lockout"),
    (10, "COBL", "Cell OV Lockout"),
    (11, "PTO", "Pre-charge Timeout"),
    (12, "CTO", "Charge Timeout"),
    (14, "UTD", "Undertemp Discharge"),
    (15, "UTC", "Undertemp Charge")
]

class EV2400ReaderThread(QThread):
    data_received = pyqtSignal(dict)
    error_occurred = pyqtSignal(str)

    def __init__(self, path=None):
        super().__init__()
        self.path = path
        self.adapter = TIEV2400Adapter()
        self.running = False

    def run(self):
        self.running = True
        try:
            self.adapter.open(self.path)
            fail_count = 0
            while self.running:
                telemetry = self.adapter.read_telemetry()
                if telemetry:
                    fail_count = 0
                    self.data_received.emit(telemetry)
                else:
                    fail_count += 1
                    if fail_count > 20:
                        self.error_occurred.emit("BQ40Z50 SMBus Read Error: Battery pack disconnected or EV2400 channel locked. Make sure TI bqStudio is closed.")
                        break
                time.sleep(0.1) # 10Hz polling rate
            self.adapter.close()
        except Exception as e:
            self.error_occurred.emit(str(e))

    def stop(self):
        self.running = False
        self.wait()

class SerialReaderThread(QThread):
    data_received = pyqtSignal(dict)
    error_occurred = pyqtSignal(str)

    def __init__(self, port, baud=115200):
        super().__init__()
        self.port = port
        self.baud = baud
        self.running = False

    def run(self):
        self.running = True
        try:
            ser = serial.Serial(self.port, self.baud, timeout=1.0)
            while self.running:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line and line.startswith('{') and line.endswith('}'):
                    try:
                        data = json.loads(line)
                        if data.get('type') == 'telemetry':
                            self.data_received.emit(data)
                    except Exception:
                        pass
            ser.close()
        except Exception as e:
            self.error_occurred.emit(str(e))

    def stop(self):
        self.running = False
        self.wait()

class BQTesterMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("BQ_tester — BQ40Z50-R5 Real-Time Battery Debugger (TI EV2400 / EV2300 Direct)")
        self.resize(1400, 900)

        self.worker_thread = None
        self.history_len = 300
        self.time_data = []
        self.current_data = []
        self.cell1_data, self.cell2_data, self.cell3_data, self.cell4_data = [], [], [], []
        self.voltage_data, self.temp_data = [], []

        self.recorded_rows = []
        self.is_recording = False
        self.prev_sf = 0
        self.prev_op = 0

        self.init_ui()
        self.scan_hardware()

    def init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)

        # 1. Top Control Toolbar
        toolbar_layout = QHBoxLayout()

        toolbar_layout.addWidget(QLabel("Hardware Interface:"))
        self.hardware_combo = QComboBox()
        toolbar_layout.addWidget(self.hardware_combo)

        self.refresh_ports_btn = QPushButton("🔄 Scan Hardware")
        self.refresh_ports_btn.clicked.connect(self.scan_hardware)
        toolbar_layout.addWidget(self.refresh_ports_btn)

        self.connect_btn = QPushButton("Connect Device")
        self.connect_btn.setObjectName("connectBtn")
        self.connect_btn.clicked.connect(self.toggle_connection)
        toolbar_layout.addWidget(self.connect_btn)

        toolbar_layout.addSpacing(20)

        self.record_btn = QPushButton("🔴 Start CSV Log")
        self.record_btn.clicked.connect(self.toggle_recording)
        toolbar_layout.addWidget(self.record_btn)

        self.export_btn = QPushButton("💾 Export CSV")
        self.export_btn.clicked.connect(self.export_csv)
        toolbar_layout.addWidget(self.export_btn)

        toolbar_layout.addStretch()
        main_layout.addLayout(toolbar_layout)

        # Notice label for bqStudio conflict
        self.notice_label = QLabel("⚠️ Note: If TI Battery Management Studio (bqStudio) is open, close it so BQ_tester can access the EV2400 USB device.")
        self.notice_label.setStyleSheet("color: #f59e0b; font-weight: bold; margin-bottom: 4px;")
        main_layout.addWidget(self.notice_label)

        # 2. Metric Cards Row
        cards_layout = QHBoxLayout()
        self.card_current = self.create_card("Pack Current", "0.00 A", "#6366f1")
        self.card_voltage = self.create_card("Total Voltage", "0.00 V", "#3b82f6")
        self.card_soc = self.create_card("State of Charge", "0 %", "#06b6d4")
        self.card_delta = self.create_card("Cell ΔV Imbalance", "0 mV", "#f59e0b")
        self.card_temp = self.create_card("Temperature", "0.0 °C", "#10b981")
        self.card_alerts = self.create_card("Safety Status", "NO HARDWARE", "#ef4444")

        cards_layout.addWidget(self.card_current["group"])
        cards_layout.addWidget(self.card_voltage["group"])
        cards_layout.addWidget(self.card_soc["group"])
        cards_layout.addWidget(self.card_delta["group"])
        cards_layout.addWidget(self.card_temp["group"])
        cards_layout.addWidget(self.card_alerts["group"])
        main_layout.addLayout(cards_layout)

        # 3. Middle Section: Real-Time Graphs (PyQtGraph)
        splitter = QSplitter(Qt.Orientation.Vertical)

        pg.setConfigOption('background', '#131722')
        pg.setConfigOption('foreground', '#94a3b8')

        # Graph 1: Current
        self.plot_current_widget = pg.PlotWidget(title="Pack Current Consumption (A)")
        self.plot_current_widget.showGrid(x=True, y=True, alpha=0.3)
        self.curve_current = self.plot_current_widget.plot(pen=pg.mkPen('#6366f1', width=2))
        splitter.addWidget(self.plot_current_widget)

        # Graph 2: Individual Cell Voltages
        self.plot_cells_widget = pg.PlotWidget(title="Individual Cell Voltages 1-4 (mV)")
        self.plot_cells_widget.showGrid(x=True, y=True, alpha=0.3)
        self.plot_cells_widget.addLegend()
        self.curve_c1 = self.plot_cells_widget.plot(pen=pg.mkPen('#6366f1', width=2), name="Cell 1")
        self.curve_c2 = self.plot_cells_widget.plot(pen=pg.mkPen('#10b981', width=2), name="Cell 2")
        self.curve_c3 = self.plot_cells_widget.plot(pen=pg.mkPen('#f59e0b', width=2), name="Cell 3")
        self.curve_c4 = self.plot_cells_widget.plot(pen=pg.mkPen('#ec4899', width=2), name="Cell 4")
        splitter.addWidget(self.plot_cells_widget)

        main_layout.addWidget(splitter, stretch=2)

        # 4. Bottom Section: Cell Gauges & Status Trigger Event Log
        bottom_layout = QHBoxLayout()

        # Cell Progress Bars Group
        cell_group = QGroupBox("4-Series Cell Breakdown")
        cell_box = QVBoxLayout(cell_group)

        self.cell_bars = []
        self.cell_labels = []
        colors = ["#6366f1", "#10b981", "#f59e0b", "#ec4899"]
        for i in range(4):
            lbl = QLabel(f"Cell {i+1}: 0 mV")
            bar = QProgressBar()
            bar.setRange(3000, 4200)
            bar.setStyleSheet(f"QProgressBar::chunk {{ background-color: {colors[i]}; }}")
            cell_box.addWidget(lbl)
            cell_box.addWidget(bar)
            self.cell_labels.append(lbl)
            self.cell_bars.append(bar)

        bottom_layout.addWidget(cell_group, stretch=1)

        # Status Event Log Table
        timeline_group = QGroupBox("Real-Time Status Trigger Timeline (Millisecond Precision)")
        timeline_box = QVBoxLayout(timeline_group)

        self.event_table = QTableWidget(0, 4)
        self.event_table.setHorizontalHeaderLabels(["Timestamp", "State", "Flag Code", "Description"])
        self.event_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        timeline_box.addWidget(self.event_table)

        bottom_layout.addWidget(timeline_group, stretch=2)
        main_layout.addLayout(bottom_layout, stretch=1)

    def create_card(self, title, value, color):
        group = QGroupBox(title)
        layout = QVBoxLayout(group)
        val_label = QLabel(value)
        val_label.setFont(QFont("Segoe UI", 18, QFont.Weight.Bold))
        val_label.setStyleSheet(f"color: {color};")
        val_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(val_label)
        return {"group": group, "label": val_label}

    def scan_hardware(self):
        self.hardware_combo.clear()

        # 1. Scan for TI EV2400 / EV2300 USB HID Adapters
        ev_adapters = TIEV2400Adapter.detect_adapters()
        for adp in ev_adapters:
            self.hardware_combo.addItem(f"🔌 {adp['name']}", {"type": "EV2400", "path": adp['path']})

        # 2. Scan for Serial COM ports
        ports = serial.tools.list_ports.comports()
        for p in ports:
            self.hardware_combo.addItem(f"💻 Serial Port: {p.device} ({p.description})", {"type": "SERIAL", "port": p.device})

        if self.hardware_combo.count() == 0:
            self.hardware_combo.addItem("⚠️ No EV2400 or COM Devices Detected", None)

    def toggle_connection(self):
        if self.worker_thread and self.worker_thread.isRunning():
            self.worker_thread.stop()
            self.worker_thread = None
            self.connect_btn.setText("Connect Device")
            self.connect_btn.setObjectName("connectBtn")
            self.setStyleSheet(DARK_QSS)
            return

        target_data = self.hardware_combo.currentData()
        if not target_data:
            QMessageBox.warning(self, "Hardware Selection", "Please connect a TI EV2400 or COM device and click 'Scan Hardware'.")
            return

        mode_type = target_data.get("type")

        if mode_type == "EV2400":
            path = target_data.get("path")
            self.worker_thread = EV2400ReaderThread(path)
            self.worker_thread.data_received.connect(self.process_telemetry)
            self.worker_thread.error_occurred.connect(self.on_device_error)
            self.worker_thread.start()
            self.connect_btn.setText("Disconnect EV2400")
            self.connect_btn.setObjectName("disconnectBtn")
            self.setStyleSheet(DARK_QSS)
        elif mode_type == "SERIAL":
            port = target_data.get("port")
            self.worker_thread = SerialReaderThread(port)
            self.worker_thread.data_received.connect(self.process_telemetry)
            self.worker_thread.error_occurred.connect(self.on_device_error)
            self.worker_thread.start()
            self.connect_btn.setText("Disconnect Serial")
            self.connect_btn.setObjectName("disconnectBtn")
            self.setStyleSheet(DARK_QSS)

    def on_device_error(self, err):
        QMessageBox.critical(self, "Hardware Error", f"{err}\n\nTroubleshooting:\n1. Make sure TI bqStudio / Battery Management Studio is CLOSED.\n2. Verify SCL/SDA/GND wires are attached securely to your BQ40Z50 board.")
        if self.worker_thread:
            self.worker_thread.stop()
            self.worker_thread = None
        self.connect_btn.setText("Connect Device")
        self.connect_btn.setObjectName("connectBtn")
        self.setStyleSheet(DARK_QSS)

    def process_telemetry(self, data):
        now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        t_idx = len(self.time_data)

        cur_a = data['i'] / 1000.0
        v_v = data['v'] / 1000.0
        temp_c = data['temp'] / 10.0
        c1, c2, c3, c4 = data['c1'], data['c2'], data['c3'], data['c4']
        delta_v = max(c1, c2, c3, c4) - min(c1, c2, c3, c4)

        # Update Card Metrics
        self.card_current["label"].setText(f"{cur_a:.2f} A")
        self.card_voltage["label"].setText(f"{v_v:.2f} V")
        self.card_soc["label"].setText(f"{data['soc']} %")
        self.card_delta["label"].setText(f"{delta_v} mV")
        self.card_temp["label"].setText(f"{temp_c:.1f} °C")

        sf = data.get('sf', 0)
        self.card_alerts["label"].setText(f"0x{sf:04X}" if sf != 0 else "NORMAL")

        # Update History arrays
        self.time_data.append(t_idx)
        self.current_data.append(cur_a)
        self.cell1_data.append(c1)
        self.cell2_data.append(c2)
        self.cell3_data.append(c3)
        self.cell4_data.append(c4)

        if len(self.time_data) > self.history_len:
            self.time_data.pop(0)
            self.current_data.pop(0)
            self.cell1_data.pop(0)
            self.cell2_data.pop(0)
            self.cell3_data.pop(0)
            self.cell4_data.pop(0)

        # Update Plots
        self.curve_current.setData(self.time_data, self.current_data)
        self.curve_c1.setData(self.time_data, self.cell1_data)
        self.curve_c2.setData(self.time_data, self.cell2_data)
        self.curve_c3.setData(self.time_data, self.cell3_data)
        self.curve_c4.setData(self.time_data, self.cell4_data)

        # Update Cell Bars
        cells = [c1, c2, c3, c4]
        for i in range(4):
            self.cell_labels[i].setText(f"Cell {i+1}: {cells[i]} mV")
            self.cell_bars[i].setValue(cells[i])

        # Track Status Trigger Transitions
        if sf != self.prev_sf:
            for bit, code, desc in SAFETY_FLAGS:
                now_act = (sf & (1 << bit)) != 0
                prev_act = (self.prev_sf & (1 << bit)) != 0
                if now_act and not prev_act:
                    self.add_timeline_event(now_str, "ASSERTED", code, desc, "#ef4444")
                elif not now_act and prev_act:
                    self.add_timeline_event(now_str, "CLEARED", code, f"{desc} cleared", "#10b981")
            self.prev_sf = sf

        # Record Data
        if self.is_recording:
            self.recorded_rows.append([
                now_str, data['v'], data['i'], c1, c2, c3, c4, data['soc'], temp_c, hex(sf), hex(data.get('op', 0))
            ])
            self.record_btn.setText(f"🔴 REC ({len(self.recorded_rows)})")

    def add_timeline_event(self, timestamp, state, code, desc, color):
        row = self.event_table.rowCount()
        self.event_table.insertRow(row)

        item_ts = QTableWidgetItem(timestamp)
        item_st = QTableWidgetItem(state)
        item_st.setForeground(QColor(color))
        item_code = QTableWidgetItem(code)
        item_code.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        item_desc = QTableWidgetItem(desc)

        self.event_table.setItem(row, 0, item_ts)
        self.event_table.setItem(row, 1, item_st)
        self.event_table.setItem(row, 2, item_code)
        self.event_table.setItem(row, 3, item_desc)
        self.event_table.scrollToBottom()

    def toggle_recording(self):
        self.is_recording = not self.is_recording
        if self.is_recording:
            self.recorded_rows = []
            self.record_btn.setObjectName("recordBtnActive")
            self.record_btn.setText("🔴 REC (0)")
        else:
            self.record_btn.setObjectName("")
            self.record_btn.setText("🔴 Start CSV Log")
        self.setStyleSheet(DARK_QSS)

    def export_csv(self):
        if not self.recorded_rows:
            QMessageBox.information(self, "Export", "No telemetry data recorded to export!")
            return

        path, _ = QFileDialog.getSaveFileName(self, "Save Telemetry CSV", f"bq40z50_log_{int(time.time())}.csv", "CSV Files (*.csv)")
        if path:
            with open(path, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(["Timestamp", "Pack_mV", "Pack_mA", "Cell1_mV", "Cell2_mV", "Cell3_mV", "Cell4_mV", "SoC", "Temp_C", "SafetyStatus", "OpStatus"])
                writer.writerows(self.recorded_rows)
            QMessageBox.information(self, "Export Success", f"Successfully saved {len(self.recorded_rows)} rows to {path}")

def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_QSS)
    window = BQTesterMainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
