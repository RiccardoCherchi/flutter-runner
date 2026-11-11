const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const extension = vscode.extensions.getExtension('RiccardoCherchi.flutter-runner');
  assert.ok(extension, 'Development extension is discoverable');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('flutterRunner.startDebugging'));
  assert.ok(commands.includes('flutterRunner.stop'));

  const runMessages = [];
  const runTracker = vscode.debug.registerDebugAdapterTrackerFactory('flutter-runner', {
    createDebugAdapterTracker() {
      return { onDidSendMessage: message => runMessages.push(message) };
    },
  });
  let runSession;
  const started = vscode.debug.onDidStartDebugSession(session => {
    if (session.type === 'flutter-runner') runSession = session;
  });
  try {
    assert.equal(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders[0], {
      type: 'flutter-runner', request: 'launch', name: 'Flutter Runner without debugging',
    }, { noDebug: true }), true);
    assert.ok(runSession, 'Ctrl+F5 creates a run session instead of attaching Dart-Code');
    assert.equal(runSession.configuration.noDebug, true);
    assert.equal(runSession.configuration.vmServiceUri, undefined);
    await vscode.commands.executeCommand('flutterRunner.hotReload');
    await vscode.commands.executeCommand('workbench.action.debug.restart');
    await vscode.debug.stopDebugging(runSession);
    assert.ok(runMessages.some(message => message.command === 'hotReload' && message.success));
    assert.ok(runMessages.some(message => message.command === 'restart' && message.success));
  } finally {
    started.dispose();
    runTracker.dispose();
  }

  let resolveAttach;
  const attached = new Promise(resolve => { resolveAttach = resolve; });
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('dart', {
    createDebugAdapterTracker(session) {
      return {
        onWillReceiveMessage(message) {
          if (message.command === 'attach') resolveAttach({ session, config: message.arguments });
        },
      };
    },
  });
  let timer;
  try {
    const starting = vscode.debug.startDebugging(vscode.workspace.workspaceFolders[0], {
      type: 'flutter-runner', request: 'launch', name: 'Flutter Runner smoke test',
    });
    const { session, config } = await Promise.race([
      attached,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native Dart attach request not observed within 45s')), 45000); }),
    ]);
    assert.equal(session.type, 'dart');
    assert.equal(config.cwd, root);
    assert.equal(config.vmServiceUri, 'http://127.0.0.1:9/');
    assert.equal(config.deviceId, undefined, 'URI attach must not require device discovery');
    assert.ok(config.flutterSdkPath, 'Dart-Code selected the Flutter SDK adapter');
    await fs.writeFile(path.join(root, 'smoke-result.json'), JSON.stringify({ passed: true, noDebug: true, hotReload: true, hotRestart: true, debugType: session.type, flutterSdkPath: config.flutterSdkPath }));
    await vscode.debug.stopDebugging(session);
    await starting;
  } finally {
    clearTimeout(timer);
    tracker.dispose();
  }
}

module.exports = { run };
