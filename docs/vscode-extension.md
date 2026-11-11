# VS Code integration

Approved behavior: F5 starts or reuses an instance owned by the current checkout through `fr`, then attaches the native Dart-Code Flutter debugger. Disconnect leaves the instance running. Stopping an instance is a separate command.

The extension lives in `vscode/`, uses plain JavaScript and Node built-ins, and depends on the installed Dart-Code Flutter extension. For F5, its `flutter-runner` debug configuration resolves into a `dart` attach configuration before Dart-Code resolves the SDK/debug adapter. Flutter attach always enables the VM debugger, so Ctrl+F5 instead uses a minimal inline run adapter that forwards reload/restart to `fr` and streams app logs. This adapter never connects to the VM Service. Disconnect stops only its log follower. The extension never invokes `flutter run` directly.

Launch options are a literal device ID and an array of Flutter arguments. The workspace folder is the checkout root. Existing sessions are selected only by that root and optional device; no fallback to another checkout. Multiple matching instances require a choice. A starting instance is reused through `fr start` and readiness is checked before attach. Build output appears in a Flutter Runner output channel. Workspace trust is required.

Implementation plan:

1. Test the runner boundary with an executable fixture: correct arguments, checkout isolation, reuse, ambiguous devices, startup failures, cancellation and readiness. Implement with Node subprocess APIs.
2. Register the debug configuration and commands. Forward resolved configurations to Dart-Code with the selected instance URI. Do not forward a device ID: URI attach must not depend on device discovery. Stop only an explicitly selected instance belonging to this workspace.
3. Run Node tests and an extension-host smoke check, package a VSIX, and document installation and F5 usage. Native reload/breakpoint behavior requires a running Flutter app for full end-to-end verification.

No CLI changes, runtime dependencies or Marketplace publication.
