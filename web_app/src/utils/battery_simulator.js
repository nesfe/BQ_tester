// Real-Time BQ40Z50 Battery Simulator Engine

export class BatterySimulator {
  constructor() {
    this.soc = 82; // %
    this.capacity = 4500; // mAh
    this.cell1 = 3850; // mV
    this.cell2 = 3845; // mV
    this.cell3 = 3820; // mV (slightly lower to simulate imbalance)
    this.cell4 = 3852; // mV
    this.temp_c = 26.5; // °C
    this.current_mode = "discharge"; // 'idle', 'charge', 'discharge', 'pulse_load'
    this.load_current_ma = -2500; // mA
    this.safety_flags = 0;
    this.op_flags = 0x0007; // PRES | DSG | CHG
    this.intervalId = null;
    this.onTelemetryCallback = null;
    this.tickCount = 0;
  }

  start(callback, intervalMs = 200) {
    this.onTelemetryCallback = callback;
    if (this.intervalId) clearInterval(this.intervalId);

    this.intervalId = setInterval(() => {
      this.step();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setMode(mode) {
    this.current_mode = mode;
    if (mode === "charge") {
      this.load_current_ma = 3000;
      this.op_flags |= (1 << 2); // CHG
    } else if (mode === "discharge") {
      this.load_current_ma = -2800;
      this.op_flags |= (1 << 1); // DSG
    } else if (mode === "idle") {
      this.load_current_ma = 0;
    } else if (mode === "pulse_load") {
      this.load_current_ma = -8500; // High current discharge
    }
  }

  injectFault(faultBit) {
    this.safety_flags ^= (1 << faultBit);
  }

  step() {
    this.tickCount++;

    // Calculate current fluctuations with realistic noise
    let noise = (Math.random() - 0.5) * 150;
    let actual_current = this.load_current_ma;

    if (this.current_mode === "pulse_load") {
      // Periodic current pulse pattern
      actual_current = (Math.sin(this.tickCount / 5) > 0) ? -9200 : -1200;
    }

    actual_current += noise;

    // Cell voltage variations based on internal resistance IR (e.g. ~15mOhm per cell)
    let ir_drop = (actual_current / 1000.0) * 18; // mV drop per cell

    // Drain/charge capacity slowly
    let cap_delta = (actual_current / 3600.0) * 0.2; // mAh in 200ms
    this.soc = Math.max(0, Math.min(100, this.soc + cap_delta / 45));

    let nominal_base = 3200 + (this.soc / 100.0) * 1000;

    this.cell1 = Math.round(nominal_base + 12 + ir_drop + (Math.random() - 0.5) * 3);
    this.cell2 = Math.round(nominal_base + 8 + ir_drop + (Math.random() - 0.5) * 3);
    this.cell3 = Math.round(nominal_base - 18 + ir_drop + (Math.random() - 0.5) * 3); // Imbalance cell
    this.cell4 = Math.round(nominal_base + 14 + ir_drop + (Math.random() - 0.5) * 3);

    // Total pack voltage
    let total_v = this.cell1 + this.cell2 + this.cell3 + this.cell4;

    // Heating up under high discharge
    if (Math.abs(actual_current) > 5000) {
      this.temp_c = Math.min(65.0, this.temp_c + 0.08);
    } else if (this.temp_c > 25.0) {
      this.temp_c -= 0.02;
    }

    // Auto trigger Cell Balancing if delta > 30mV
    let cell_min = Math.min(this.cell1, this.cell2, this.cell3, this.cell4);
    let cell_max = Math.max(this.cell1, this.cell2, this.cell3, this.cell4);
    if (cell_max - cell_min > 30) {
      this.op_flags |= (1 << 5); // CB active
    } else {
      this.op_flags &= ~(1 << 5);
    }

    // Automatic Safety Alerts based on thresholds
    if (actual_current < -8000) {
      this.safety_flags |= (1 << 3); // OCD
    } else if (actual_current > -7000) {
      this.safety_flags &= ~(1 << 3);
    }

    if (cell_min < 3000) {
      this.safety_flags |= (1 << 0); // CUV
    } else {
      this.safety_flags &= ~(1 << 0);
    }

    if (this.temp_c > 55.0) {
      this.safety_flags |= (1 << 8); // OTD
    } else {
      this.safety_flags &= ~(1 << 8);
    }

    const telemetry = {
      type: "telemetry",
      v: Math.round(total_v),
      i: Math.round(actual_current),
      c1: this.cell1,
      c2: this.cell2,
      c3: this.cell3,
      c4: this.cell4,
      soc: Math.round(this.soc),
      temp: Math.round(this.temp_c * 10),
      sf: this.safety_flags,
      op: this.op_flags,
      timestamp: Date.now()
    };

    if (this.onTelemetryCallback) {
      this.onTelemetryCallback(telemetry);
    }
  }
}
