---
name: flutter-runner
description: Run, hot reload, restart, stop and inspect Flutter apps with the `fr` CLI. Use whenever you need to launch a Flutter app on a simulator, emulator or desktop, apply Dart changes to a running app, read its logs, or get its VM Service URI. Never call `flutter run` directly.
---

# flutter-runner

`fr` runs `flutter run` detached and keeps one machine-wide record of every instance in `~/.local/state/fr`. Every terminal, agent and worktree sees the same instances, so an app you did not start yourself is still reachable.

## Rules

- Never run `flutter run` or `flutter attach` yourself. Use `fr`.
- Run `fr status` before you start an app. If an instance for this checkout is already running, reuse it.
- A device runs one instance. If `fr start` exits with code 3, another checkout owns the device. Do not stop that instance without asking the user.
- Do not use `sleep` to wait for the app. `fr start` blocks until the app is up or the build fails.

## Commands

Run them from the app checkout. Without a device, a command acts on the instance started from the current checkout, or on the only running instance. To pick another instance, pass the number `fr status` shows first (`fr reload 1`) or a prefix of its device id (`fr reload 93D7`).

| Command | Use |
|---|---|
| `fr status` / `fr status --json` | Every instance: device, state, checkout, branch, uptime, pid, VM Service URI |
| `fr start [-d device] [-- flutter run args]` | Start; default device is the booted iOS simulator. Blocks until running |
| `fr reload` | Hot reload after a Dart edit. Exit 1 with the compile error on failure |
| `fr restart` | Hot restart. Use it after changes to `main()`, top-level or `const` initialisers, enums or class shape, or `initState` |
| `fr logs [-n lines]` / `fr logs -f` | Output of `flutter run`; also works after the app died |
| `fr uri` | VM Service URI, also readable at `.dart_tool/fr.uri` |
| `fr stop [instance]` | Stop the instance |

Exit codes: 0 ok, 1 failure (build, reload, not running), 2 usage, 3 device busy.

## When something fails

- `fr reload` exits 1: fix the error it prints, then reload again.
- `fr status` no longer lists the instance: the app died. Read `fr logs` to see why, then `fr start` again.
- Pass extra `flutter run` flags after `--`, for example `fr start -- --flavor prod --dart-define=ENV=stage`.
