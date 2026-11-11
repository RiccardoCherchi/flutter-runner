const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RunAdapter } = require('../run-adapter');

test('no-debug session reloads/restarts the selected fr instance and disconnects without stopping it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fr-run-adapter-'));
  const executable = path.join(root, 'fr');
  await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'calls'), JSON.stringify(args) + '\\n');
if (args[0] === 'logs') { console.log('Application log'); setInterval(() => {}, 1000); }
else if (args[0] === 'reload') console.log('Reloaded');
else if (args[0] === 'restart') console.log('Restarted');
`, { mode: 0o755 });
  const adapter = new RunAdapter({ cwd: root, executable, device: 'selected-device' });
  t.after(() => { adapter.dispose(); return fs.rm(root, { recursive: true, force: true }); });
  const messages = [];
  adapter.onDidSendMessage(message => messages.push(message));
  let seq = 0;
  async function request(command, args = {}) {
    const request_seq = ++seq;
    await adapter.handleMessage({ type: 'request', seq: request_seq, command, arguments: args });
    return messages.find(message => message.type === 'response' && message.request_seq === request_seq);
  }
  const capabilities = await request('initialize');
  assert.equal(capabilities.body.supportsRestartRequest, true);
  assert.equal((await request('launch', { noDebug: true })).success, true);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('App log not forwarded')), 5000);
    const subscription = adapter.onDidSendMessage(message => {
      if (message.event === 'output' && message.body.output.includes('Application log')) {
        clearTimeout(timeout); subscription.dispose(); resolve();
      }
    });
  });
  assert.equal((await request('hotReload')).success, true);
  assert.equal((await request('restart')).success, true);
  assert.equal((await request('threads')).body.threads.length, 0);
  assert.equal((await request('disconnect')).success, true);
  const calls = (await fs.readFile(path.join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(args => JSON.stringify(args) === '["reload","-d","selected-device"]'));
  assert.ok(calls.some(args => JSON.stringify(args) === '["restart","-d","selected-device"]'));
  assert.equal(calls.some(args => ['start', 'stop', 'attach'].includes(args[0])), false);
  assert.ok(messages.some(message => message.event === 'terminated'));
});

test('reload failures reach the toolbar request as a failed response', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fr-run-error-'));
  const executable = path.join(root, 'fr');
  await fs.writeFile(executable, '#!/bin/sh\necho "Compile error" >&2\nexit 1\n', { mode: 0o755 });
  const adapter = new RunAdapter({ cwd: root, executable, device: 'test-device' });
  t.after(() => { adapter.dispose(); return fs.rm(root, { recursive: true, force: true }); });
  const messages = [];
  adapter.onDidSendMessage(message => messages.push(message));
  await adapter.handleMessage({ type: 'request', seq: 1, command: 'hotReload' });
  const response = messages.find(message => message.type === 'response');
  assert.equal(response.success, false);
  assert.match(response.message, /Compile error/);
});
