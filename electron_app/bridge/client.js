const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');

class BridgeClient {
  constructor({ packaged = false, resourcesPath = '', log = () => {}, spawnProcess = spawn } = {}) {
    const executable = packaged
      ? path.join(resourcesPath, 'ti-bridge', 'ti-bridge.exe')
      : (process.env.BQ_PYTHON || (process.platform === 'win32' ? 'py' : 'python3'));
    const args = packaged ? [] : [
      ...(process.platform === 'win32' && !process.env.BQ_PYTHON ? ['-3-32'] : []),
      '-u', path.join(__dirname, 'ti_bridge.py'),
    ];
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.child = spawnProcess(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch {
        log(`TI bridge: ${line}`, 'warning');
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    this.child.stderr.on('data', data => log(`TI bridge: ${data.toString().trim()}`, 'warning'));
    this.child.on('error', error => this.fail(new Error(`Cannot start TI bridge: ${error.message}`)));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`TI bridge exited (${signal || code})`)));
  }

  fail(error) {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.lines.close();
  }

  request(op, data = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error('TI bridge is closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.fail(new Error(`TI ${op} timed out after ${timeoutMs} ms; reconnect the adapter`));
        this.child.kill(); // RegisterPIDwithCM lets TI clean up its manager after this process exits.
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...data, id, op }) + '\n', error => {
        if (error) this.fail(error);
      });
    });
  }

  async close() {
    try {
      if (!this.closed) await this.request('close', {}, 2000);
    } finally {
      this.child.stdin.end();
      this.fail(new Error('TI bridge closed'));
      this.child.kill();
    }
  }
}

module.exports = { BridgeClient };
