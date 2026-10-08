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
    this.queue = Promise.resolve();
    this.commandsPending = 0;
    this.maintenance = null;
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
      this.maintenance = null;
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
    this.timer = null;
    if (this.commandsPending || this.maintenance) return;
    const start = Date.now();
    try {
      const data = await this.enqueue(bridge, generation, 'sample');
      if (generation !== this.generation) return;
      this.emit('telemetry', data);
      if (!data.hasValidData) {
        throw new Error(Object.values(data.errors || {}).join('; ') || 'No battery response');
      }
      if (!this.commandsPending && !this.maintenance) this.schedule(bridge, generation, Math.max(0, this.intervalMs - (Date.now() - start)));
    } catch (error) {
      if (generation !== this.generation) return;
      await this.disconnect(error.message);
    }
  }

  schedule(bridge, generation, delay = 0) {
    if (generation !== this.generation || bridge !== this.bridge) return;
    clearTimeout(this.timer);
    if (generation === this.generation && bridge === this.bridge && !this.maintenance && !this.commandsPending) {
      this.timer = setTimeout(() => this.poll(bridge, generation), delay);
    }
  }

  enqueue(bridge, generation, op, data = {}) {
    const task = this.queue.then(() => {
      if (generation !== this.generation || bridge !== this.bridge) throw new Error('Connection changed; command cancelled');
      return bridge.request(op, data);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async command(op, data = {}) {
    if (!this.bridge || this.connecting) throw new Error('EV2400 is not connected');
    const bridge = this.bridge, generation = this.generation;
    this.commandsPending++;
    clearTimeout(this.timer); this.timer = null;
    try {
      const result = await this.enqueue(bridge, generation, op, data);
      if (generation !== this.generation) throw new Error('Connection changed; result discarded');
      if (Object.hasOwn(result, 'maintenance') && (op !== 'catalog' || result.maintenance)) this.maintenance = result.maintenance;
      if (result.disconnect) await this.disconnect('Command sent; reconnect after the device is ready');
      return result;
    } catch (error) {
      if (op === 'execute' && data.action !== 'read' && generation === this.generation) this.maintenance = 'uncertain';
      throw error;
    } finally {
      if (generation === this.generation) {
        this.commandsPending--;
        this.schedule(bridge, generation);
      }
    }
  }

  async disconnect(message = 'Disconnected') {
    ++this.generation;
    this.commandsPending = 0;
    clearTimeout(this.timer);
    this.timer = null;
    const bridge = this.bridge;
    this.bridge = null;
    this.emit('state', { connected: false, message });
    if (bridge) await bridge.close().catch(error => this.emit('log', error.message, 'warning'));
  }
}

module.exports = { Session };
