const { Worker } = require('worker_threads');
const path = require('path');
const __dir = path.resolve(process.cwd(), 'microservices');
const crypto = require('crypto');

class DissectManager {
  constructor() {
    this.worker = new Worker(path.resolve(__dir, 'dissect-worker.js'));
    this.pending = new Map();

    this.worker.on('message', (msg) => {
      const { id, ...rest } = msg;
      const resolver = this.pending.get(id);
      if (resolver) {
        resolver(rest);
        this.pending.delete(id);
      }
    });
  }

  dissect(text) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, text });
    });
  }
}

module.exports = new DissectManager();