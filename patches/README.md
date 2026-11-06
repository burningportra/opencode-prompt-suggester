# Host patches

Two optional patches make the plugin use first-class host APIs instead of
fallbacks:

```text
tui-prompt-api.patch        TUI ui.prompt set/submit API
composer-placeholder.patch  Desktop ComposerPlaceholder registry
```

## Apply

From an OpenCode checkout on `dev`:

```bash
git apply ~/.config/opencode/plugins/opencode-prompt-suggester/patches/composer-placeholder.patch
git apply ~/.config/opencode/plugins/opencode-prompt-suggester/patches/tui-prompt-api.patch
bun install
```

## Verify

```bash
bun run --cwd packages/plugin typecheck
bun run --cwd packages/app typecheck
bun run --cwd packages/tui typecheck

cd packages/app
bun test --conditions=solid --isolate \
  --preload ../ui/test/solid-jsx.ts \
  --preload ./happydom.ts \
  ./src/session/composer/plugin-placeholder.test.ts
```

## ComposerPlaceholder

Adds a `ComposerPlaceholder` registry to the GUI plugin API:

- `show(input)` receives the routed `MountedSession` and its `SessionScreen`.
- The first non-empty contribution wins, sorted by `order` then contribution
  order.
- The host passes the selected text into `Composer` / `ComposerEditor`, which
  uses it in normal mode before the app's own placeholder.
- Subagent sessions never receive a plugin placeholder.
- A throwing contribution is logged under its plugin and skipped.
- Includes docs and a unit test for the selection helper.

## TUI prompt API

Adds `context.ui.prompt` to the TUI plugin API:

- `text()` returns the active composer text.
- `isEmpty()` reports whether the composer has text, files, agents, skills, or
  pasted parts.
- `focused()` reports whether the composer is focused.
- `set(text)` replaces an empty normal-mode composer with `text` without
  submitting it.
- `submit(text)` replaces an empty normal-mode composer with `text` and submits
  it through OpenCode's normal prompt path, which commits the selected agent,
  model, attachments, and delivery.

`set` and `submit` both return `false` when no composer is mounted, the composer
is in shell mode, or it already has content.
