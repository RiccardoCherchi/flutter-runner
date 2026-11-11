const { spawn } = require('node:child_process');
const { realpath } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');

function runFr(executable, args, cwd, onOutput = () => {}, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let diagnostics = '';
    child.stdout.on('data', data => { stdout += data; onOutput(data.toString()); });
    child.stderr.on('data', data => {
      diagnostics = (diagnostics + data).slice(-8000);
      onOutput(data.toString());
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`fr ${args[0]} failed (${code}): ${diagnostics.trim() || stdout.trim()}`));
    });
  });
}

async function listInstances(executable, root, signal) {
  const rows = JSON.parse(await runFr(executable, ['status', '--json'], root, undefined, signal));
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.root !== 'string' || typeof row.device !== 'string' || typeof row.uri !== 'string')) {
    throw new Error('Invalid response from fr status --json');
  }
  return rows.filter(row => row.root === root);
}

async function prepareSession(root, { executable, deviceId, toolArgs = [], choose, onOutput, signal }) {
  root = await realpath(root);
  if ((deviceId !== undefined && (typeof deviceId !== 'string' || !deviceId)) || !Array.isArray(toolArgs) || toolArgs.some(arg => typeof arg !== 'string')) {
    throw new Error('deviceId must be a non-empty string and toolArgs an array of strings');
  }
  if (toolArgs.some(arg => /^(--release|--profile|--machine|--pid-file|--vmservice-out-file)(=|$)/.test(arg))) {
    throw new Error('Flutter Runner requires debug mode and manages its own process files');
  }
  let rows = await listInstances(executable, root, signal);
  if (deviceId) rows = rows.filter(row => row.device === deviceId);
  let instance = rows[0];
  if (rows.length > 1) {
    if (!choose) throw new Error('Several instances running; select a device');
    instance = await choose(rows);
    if (!instance) return undefined;
  }
  if (!instance) {
    await runFr(executable, ['start', ...(deviceId ? ['-d', deviceId] : []), '--', ...toolArgs], root, onOutput, signal);
    rows = await listInstances(executable, root, signal);
    instance = rows.find(row => !deviceId || row.device === deviceId);
    if (!instance) throw new Error('fr start finished without a running instance for this checkout');
  }
  const deadline = Date.now() + 15 * 60 * 1000;
  while (instance.state === 'starting') {
    if (Date.now() >= deadline) throw new Error('Build still starting after 15 minutes; check fr logs');
    await delay(500, undefined, { signal });
    instance = (await listInstances(executable, root, signal)).find(row => row.device === instance.device);
    if (!instance) throw new Error('Flutter build exited; check fr logs');
  }
  if (instance.state !== 'running' || !/^https?:\/\/|^wss?:\/\//.test(instance.uri)) {
    throw new Error('Instance has no VM Service URI; check fr logs');
  }
  return instance;
}

module.exports = { runFr, listInstances, prepareSession };
