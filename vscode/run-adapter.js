const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { runFr } = require('./runner');

class RunAdapter {
  constructor({ cwd, executable, device }) {
    this.cwd = cwd;
    this.executable = executable;
    this.device = device;
    this.messages = new EventEmitter();
    this.sequence = 0;
    this.controller = new AbortController();
    this.onDidSendMessage = listener => {
      this.messages.on('message', listener);
      return { dispose: () => this.messages.off('message', listener) };
    };
  }

  send(message) {
    this.messages.emit('message', { seq: ++this.sequence, ...message });
  }

  output(text, category = 'console') {
    this.send({ type: 'event', event: 'output', body: { category, output: text } });
  }

  async handleMessage(request) {
    if (request.type !== 'request') return;
    const response = { type: 'response', request_seq: request.seq, command: request.command, success: true };
    try {
      switch (request.command) {
        case 'initialize':
          response.body = { supportsRestartRequest: true };
          break;
        case 'launch':
          this.followLogs();
          break;
        case 'hotReload':
        case 'hotRestart':
        case 'restart':
          await runFr(this.executable, [request.command === 'hotReload' ? 'reload' : 'restart', '-d', this.device], this.cwd, text => this.output(text), this.controller.signal);
          break;
        case 'threads':
          response.body = { threads: [] };
          break;
        case 'setBreakpoints':
          response.body = { breakpoints: [] };
          break;
        case 'setExceptionBreakpoints':
        case 'configurationDone':
        case 'disconnect':
          break;
        default:
          throw new Error(`Unsupported request in run mode: ${request.command}`);
      }
    } catch (error) {
      response.success = false;
      response.message = error.message;
    }
    this.send(response);
    if (request.command === 'initialize') this.send({ type: 'event', event: 'initialized' });
    if (request.command === 'disconnect') this.end();
  }

  followLogs() {
    // Own a separate process group so disconnect also stops fr's tail child.
    this.logs = spawn(this.executable, ['logs', '-f', '-d', this.device], {
      cwd: this.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.logs.stdout.on('data', data => this.output(data.toString(), 'stdout'));
    this.logs.stderr.on('data', data => this.output(data.toString(), 'stderr'));
    this.logs.on('error', error => { this.output(`${error.message}\n`, 'stderr'); this.end(); });
    this.logs.on('close', () => this.end());
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.dispose();
    this.send({ type: 'event', event: 'terminated' });
  }

  dispose() {
    this.controller.abort();
    if (this.logs?.pid) {
      try { process.kill(-this.logs.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      this.logs = undefined;
    }
  }
}

module.exports = { RunAdapter };
