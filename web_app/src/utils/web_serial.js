// WebSerial Manager for MSP430 UART Connection

export class WebSerialManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.readableStreamClosed = null;
    this.isConnected = false;
    this.onDataCallback = null;
    this.onStatusChangeCallback = null;
    this.buffer = "";
  }

  isSupported() {
    return "serial" in navigator;
  }

  async connect(baudRate = 115200) {
    if (!this.isSupported()) {
      throw new Error("WebSerial API is not supported in this browser. Please use Chrome, Edge, or Brave.");
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate });

      this.isConnected = true;
      if (this.onStatusChangeCallback) this.onStatusChangeCallback(true);

      this.startReading();
      return true;
    } catch (err) {
      this.isConnected = false;
      if (this.onStatusChangeCallback) this.onStatusChangeCallback(false, err.message);
      throw err;
    }
  }

  async startReading() {
    const textDecoder = new TextDecoderStream();
    this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value) {
          this.buffer += value;
          this.processBuffer();
        }
      }
    } catch (error) {
      console.error("Error reading from serial port:", error);
    } finally {
      this.reader.releaseLock();
    }
  }

  processBuffer() {
    const lines = this.buffer.split("\n");
    // Keep last incomplete line in buffer
    this.buffer = lines.pop();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          const parsed = JSON.parse(line);
          if (this.onDataCallback) {
            this.onDataCallback(parsed);
          }
        } catch (e) {
          console.warn("Malformed JSON received:", line);
        }
      }
    }
  }

  async disconnect() {
    if (this.reader) {
      await this.reader.cancel();
      await this.readableStreamClosed.catch(() => {});
      this.reader = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    this.isConnected = false;
    if (this.onStatusChangeCallback) this.onStatusChangeCallback(false);
  }
}
