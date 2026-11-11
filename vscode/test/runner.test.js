const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareSession, runFr } = require('../runner');

async function fixture(t, instances = [], mode = '') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fr test ')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'fake-fr');
  const state = path.join(root, 'state.json');
  await fs.writeFile(state, JSON.stringify(instances));
  await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const state = path.join(__dirname, 'state.json');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'calls'), JSON.stringify(args) + '\\n');
let instances = JSON.parse(fs.readFileSync(state));
if (args[0] === 'status') {
  console.log(JSON.stringify(instances));
  if (${JSON.stringify(mode)} === 'ready') fs.writeFileSync(state, JSON.stringify(instances.map(row => ({...row, state: 'running', uri: 'http://ready/'}))));
}
if (args[0] === 'start') {
  if (${JSON.stringify(mode)} === 'fail') { console.error('Build failed: example'); process.exit(3); }
  if (${JSON.stringify(mode)} === 'wait') { console.error('waiting'); setInterval(() => {}, 1000); }
  else {
    instances.push({id: 0, device: args[1] === '-d' ? args[2] : 'default-device', root: process.cwd(), state: 'running', uri: 'http://127.0.0.1:1234/token=/'});
    fs.writeFileSync(state, JSON.stringify(instances));
    console.error('Build complete');
  }
}
`, { mode: 0o755 });
  return { root, executable, state, calls: async () => (await fs.readFile(path.join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse) };
}

test('starts in the checkout and preserves literal device and Flutter arguments', async (t) => {
  const f = await fixture(t);
  const output = [];
  const result = await prepareSession(f.root, { executable: f.executable, deviceId: 'my device', toolArgs: ['--flavor', 'dev', '--dart-define=TEXT=$(touch nope)'], onOutput: s => output.push(s) });
  assert.equal(result.uri, 'http://127.0.0.1:1234/token=/');
  assert.equal(result.root, await fs.realpath(f.root));
  assert.deepEqual((await f.calls()).find(c => c[0] === 'start'), ['start', '-d', 'my device', '--', '--flavor', 'dev', '--dart-define=TEXT=$(touch nope)']);
  assert.match(output.join(''), /Build complete/);
});

test('reuses only an instance belonging to this checkout', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.state, JSON.stringify([
    { id: 0, device: 'other', root: '/another-checkout', state: 'running', uri: 'http://other/' },
    { id: 1, device: 'ours', root: await fs.realpath(f.root), state: 'running', uri: 'http://ours/' },
  ]));
  assert.equal((await prepareSession(f.root, { executable: f.executable })).device, 'ours');
  assert.equal((await f.calls()).some(c => c[0] === 'start'), false);
});

test('does not attach to the only global instance when it belongs to another checkout', async (t) => {
  const f = await fixture(t, [{ id: 0, device: 'foreign', root: '/another', state: 'running', uri: 'http://foreign/' }]);
  assert.equal((await prepareSession(f.root, { executable: f.executable })).device, 'default-device');
  assert.equal((await f.calls()).some(c => c[0] === 'start'), true);
});

test('multiple matching instances require a selection and cancellation does not launch', async (t) => {
  const f = await fixture(t);
  const instances = ['one', 'two'].map(device => ({ id: 0, device, root: f.root, state: 'running', uri: `http://${device}/` }));
  await fs.writeFile(f.state, JSON.stringify(instances));
  const selected = await prepareSession(f.root, { executable: f.executable, choose: async rows => rows[1] });
  assert.equal(selected.device, 'two');
  assert.equal(await prepareSession(f.root, { executable: f.executable, choose: async () => undefined }), undefined);
  assert.equal((await f.calls()).some(c => c[0] === 'start'), false);
});

test('explicit device does not reuse another device from the same checkout', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.state, JSON.stringify([{ id: 0, device: 'old', root: f.root, state: 'running', uri: 'http://old/' }]));
  assert.equal((await prepareSession(f.root, { executable: f.executable, deviceId: 'new' })).device, 'new');
});

test('build failure reports diagnostics and never returns an attach target', async (t) => {
  const f = await fixture(t, [], 'fail');
  await assert.rejects(prepareSession(f.root, { executable: f.executable }), /Build failed: example/);
});

test('cancellation ends the waiting CLI without stopping any instance', async (t) => {
  const f = await fixture(t, [], 'wait');
  const controller = new AbortController();
  const pending = runFr(f.executable, ['start'], f.root, () => controller.abort(), controller.signal);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await f.calls()).some(c => c[0] === 'stop'), false);
});

test('waits for an existing build without launching it again', async (t) => {
  const f = await fixture(t, [], 'ready');
  const instance = { id: 0, device: 'building', root: f.root, state: 'starting', uri: '' };
  await fs.writeFile(f.state, JSON.stringify([instance]));
  assert.equal((await prepareSession(f.root, { executable: f.executable })).uri, 'http://ready/');
  assert.equal((await f.calls()).some(c => c[0] === 'start'), false);
});

test('rejects unsupported run modes before starting', async (t) => {
  const f = await fixture(t);
  await assert.rejects(prepareSession(f.root, { executable: f.executable, toolArgs: ['--release'] }), /debug mode/);
});
