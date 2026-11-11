const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { prepareSession, listInstances, runFr } = require('./runner');
const { RunAdapter } = require('./run-adapter');

function activate(context) {
  const output = vscode.window.createOutputChannel('Flutter Runner');
  context.subscriptions.push(output);

  async function workspaceFolder(folder) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to run Flutter Runner');
    if (folder) return folder;
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 1) return folders[0];
    if (folders.length > 1) return vscode.window.showWorkspaceFolderPick();
    throw new Error('Open a Flutter project folder first');
  }

  function executable(folder) {
    return vscode.workspace.getConfiguration('flutterRunner', folder.uri).get('executable', 'fr');
  }

  async function choose(rows) {
    const item = await vscode.window.showQuickPick(rows.map(row => ({ label: row.device, description: row.state, instance: row })), { placeHolder: 'Select this checkout\'s Flutter instance' });
    return item?.instance;
  }

  function report(error) {
    if (error.name === 'AbortError') return;
    output.appendLine(error.message);
    output.show(true);
    void vscode.window.showErrorMessage(`Flutter Runner: ${error.message}`);
  }

  const provider = {
    provideDebugConfigurations: () => [{ type: 'flutter-runner', request: 'launch', name: 'Flutter Runner' }],
    async resolveDebugConfiguration(folder, config, token) {
      try {
        folder = await workspaceFolder(folder);
        if (!folder || token.isCancellationRequested) return undefined;
        const root = folder.uri.fsPath;
        await fs.access(path.join(root, 'pubspec.yaml'));
        if ((config.toolArgs !== undefined && !Array.isArray(config.toolArgs)) || (config.program !== undefined && typeof config.program !== 'string')) {
          throw new Error('toolArgs must be an array and program a string');
        }
        const toolArgs = [...(config.toolArgs || [])];
        if (config.program) toolArgs.push('-t', config.program);
        if ([config.deviceId, ...toolArgs].some(value => typeof value === 'string' && value.includes('${'))) {
          throw new Error('Use literal deviceId, program and toolArgs values; launch variable expansion is not supported');
        }
        return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Flutter Runner: starting or connecting', cancellable: true }, async (_, progressToken) => {
          const controller = new AbortController();
          const subscriptions = [token.onCancellationRequested(() => controller.abort()), progressToken.onCancellationRequested(() => controller.abort())];
          if (token.isCancellationRequested || progressToken.isCancellationRequested) controller.abort();
          try {
            output.show(true);
            const instance = await prepareSession(root, {
              executable: executable(folder), deviceId: config.deviceId, toolArgs,
              choose, onOutput: text => output.append(text), signal: controller.signal,
            });
            if (!instance || controller.signal.aborted) return undefined;
            if (config.noDebug) {
              return {
                name: config.name || 'Flutter Runner', type: 'flutter-runner', request: 'launch',
                noDebug: true, cwd: root, frExecutable: executable(folder), frDevice: instance.device,
              };
            }
            // Flutter attach always enables debugging, so use it only for F5.
            return {
              name: config.name || 'Flutter Runner', type: 'dart', request: 'attach',
              cwd: root, program: config.program || 'lib/main.dart',
              vmServiceUri: instance.uri,
              noDebug: false,
            };
          } finally {
            subscriptions.forEach(subscription => subscription.dispose());
          }
        });
      } catch (error) {
        report(error);
        return undefined;
      }
    },
  };

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('flutter-runner', provider),
    vscode.debug.registerDebugAdapterDescriptorFactory('flutter-runner', {
      createDebugAdapterDescriptor(session) {
        const config = session.configuration;
        return new vscode.DebugAdapterInlineImplementation(new RunAdapter({
          cwd: config.cwd, executable: config.frExecutable, device: config.frDevice,
        }));
      },
    }),
    vscode.commands.registerCommand('flutterRunner.hotReload', async () => {
      try {
        const session = vscode.debug.activeDebugSession;
        if (session?.type === 'flutter-runner') await session.customRequest('hotReload');
      } catch (error) { report(error); }
    }),
    vscode.commands.registerCommand('flutterRunner.startDebugging', async () => {
      try {
        const folder = await workspaceFolder();
        if (folder) return vscode.debug.startDebugging(folder, provider.provideDebugConfigurations()[0]);
      } catch (error) { report(error); }
    }),
    vscode.commands.registerCommand('flutterRunner.stop', async () => {
      try {
        const folder = await workspaceFolder();
        if (!folder) return;
        const root = await fs.realpath(folder.uri.fsPath);
        const rows = await listInstances(executable(folder), root);
        if (!rows.length) return vscode.window.showInformationMessage('Flutter Runner: no instance for this checkout');
        const instance = await choose(rows);
        if (instance) await runFr(executable(folder), ['stop', '-d', instance.device], root, text => output.append(text));
      } catch (error) { report(error); }
    }),
  );
}

module.exports = { activate };
