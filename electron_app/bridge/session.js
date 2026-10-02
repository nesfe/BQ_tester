const { EventEmitter } = require('node:events');

// One request at a time. Session generations prevent late USB replies after disconnect.
class Session extends EventEmitter {
  constructor(createBridge, intervalMs = 100) {
    super();
    this.createBridge = createBridge;
    this.intervalMs = intervalMs;
    this.generation = 0;
    this.bridge = null;
    this.timer = null;
    this.connecting = false;
  }

  async connect(device) {
    if (this.connecting || this.bridge) throw new Error('Already connecting or connected');
    this.connecting = true;
    const generation = ++this.generation;
    let bridge;
    try {
      bridge = this.createBridge();
      this.bridge = bridge;
      const info = await bridge.request('open', { device });
      if (generation !== this.generation) throw new Error('Connection cancelled');
      this.emit('state', { connected: true, message: 'Connected via TI CMAPI' });
      this.timer = setTimeout(() => this.poll(bridge, generation), 0);
      return { success: true, ...info };
    } catch (error) {
      if (generation === this.generation) {
        this.bridge = null;
        this.emit('state', { connected: false, message: error.message });
      }
      if (bridge) await bridge.close().catch(() => {});
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async poll(bridge, generation) {
    if (generation !== this.generation) return;
    const start = Date.now();
    try {
      const data = await bridge.request('sample');
      if (generation !== this.generation) return;
      this.emit('telemetry', data);
      if (!data.hasValidData) {
        throw new Error(Object.values(data.errors || {}).join('; ') || 'No battery response');
      }
      this.timer = setTimeout(() => this.poll(bridge, generation),
        Math.max(0, this.intervalMs - (Date.now() - start)));
    } catch (error) {
      if (generation !== this.generation) return;
      await this.disconnect(error.message);
    }
  }

  async disconnect(message = 'Disconnected') {
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = null;
    const bridge = this.bridge;
    this.bridge = null;
    this.emit('state', { connected: false, message });
    if (bridge) await bridge.close().catch(error => this.emit('log', error.message, 'warning'));
  }
}

module.exports = { Session };
