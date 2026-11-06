# opencode-prompt-suggester

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/burningportra/opencode-prompt-suggester)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D2.0.0-orange.svg)](https://opencode.ai)

> **Intent-aware next-prompt suggestions for OpenCode V2, in the TUI and Desktop.**
> After a turn finishes, an instant heuristic plus a background model draft the
> message you are most likely to send next and show it as ghost text in the
> composer. Accept it with one key, or start typing to ignore it.

![opencode-prompt-suggester demo](./demo.gif)

Independent OpenCode port of the [pi-prompt-suggester](https://github.com/guwidoe/pi-prompt-suggester) architecture (MIT). Not affiliated with OpenCode.

---

## What changed in 2.0

Version 2.0 is a port to the OpenCode V2 plugin API:

- Uses `Plugin.define`, `ctx.event.subscribe`, `ctx.session.hook`, and RPC
  instead of V1 client and `chat.message` plumbing.
- Generates suggestions with the stateless
  `ctx.experimental.generate.text` API. There are no hidden
  `[prompt-suggester]` sessions, so nothing is written to session history.
- Ships a V2 server part, a TUI part, an RPC contract, and a Desktop
  `gui-experimental` bundle.
- Keeps the existing seed, steering, usage, and prompt-template engine and the
  on-disk state layout.
- TUI shows a suggestion bar above the composer. Desktop shows faint ghost text
  in the empty composer.

---

## Behavior

- **TUI**
  - A `↳ <suggestion>` line appears above the composer.
  - `ctrl+alt+n` submits the suggestion through the normal composer path, so
    the selected agent, model, and attachments are preserved.
  - `ctrl+alt+x` dismisses it.
  - With the `ui.prompt` host patch applied, `space` / `right` insert the
    suggestion into the composer, and `backspace` dismisses it.
  - `/suggester` shows status, `/suggester on`, `/suggester off`, and
    `/suggester reseed` manage the plugin.
- **Desktop**
  - The suggestion appears as faint ghost text in the empty composer.
  - `tab` inserts it so you can edit it.
  - `enter` submits it through the normal composer path.
  - `escape` dismisses it.
  - `/suggester` supports the same `on`, `off`, `reseed`, and `refresh`
    arguments.

Suggestions are generated after `session.execution.succeeded`, failed, or
interrupted events and are cleared when the next execution starts. Subagent
sessions are ignored.

---

## Installation

Clone the plugin into OpenCode's plugin directory:

```bash
git clone https://github.com/burningportra/opencode-prompt-suggester.git \
  ~/.config/opencode/plugins/opencode-prompt-suggester
```

Add it to `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/opencode-prompt-suggester"
    }
  ]
}
```

Use `"package": "opencode-prompt-suggester"` instead when installing from npm.

The server and TUI parts are loaded from `src/`. Build the Desktop bundle after
changing `src/gui.tsx`:

```bash
cd ~/.config/opencode/plugins/opencode-prompt-suggester
npm ci
npm run build
```

The repository already contains the built bundle at
`dist/gui-experimental.cjs`, so this step is only needed after editing the GUI.

### Upgrading from 1.x

Remove the old path from `plugin` in `opencode.json` and `tui.json`, then add the
package under the V2 `plugins` array in `opencode.json`. State and configuration
files are compatible.

### Verifying installation

Restart OpenCode and run:

```text
/suggester
```

You should see a toast with the enabled flag, configured model, and seed state.

---

## Configuration

Configuration is read from the same state directory as 1.x:

- Global: `~/.local/state/opencode/opencode-prompt-suggester/config.json`
- Per project: `~/.local/state/opencode/opencode-prompt-suggester/projects/<project-key>/config.json`

```jsonc
{
  "schemaVersion": 1,
  "enabled": true,
  "seed": {
    "maxDiffChars": 3000,
    "maxSteps": 8
  },
  "reseed": {
    "enabled": false,
    "checkOnSessionStart": false,
    "checkAfterEveryTurn": false,
    "turnCheckInterval": 10
  },
  "suggestion": {
    "noSuggestionToken": "[no suggestion]",
    "customInstruction": "",
    "fastPathContinueOnError": true,
    "ghostAcceptKeys": ["space", "right"],
    "maxAssistantTurnChars": 1800,
    "maxRecentUserPrompts": 5,
    "maxRecentUserPromptChars": 180,
    "maxToolSignals": 8,
    "maxToolSignalChars": 240,
    "maxTouchedFiles": 8,
    "maxUnresolvedQuestions": 6,
    "maxAbortContextChars": 280,
    "maxSuggestionChars": 200,
    "prefillOnlyWhenEditorEmpty": true
  },
  "steering": {
    "historyWindow": 20,
    "acceptedThreshold": 0.82,
    "maxChangedExamples": 3
  },
  "inference": {
    "seederModel": "session-default",
    "suggesterModel": "small"
  }
}
```

`inference.suggesterModel` and `inference.seederModel` accept `"small"`,
`"session-default"`, or an explicit `provider/model` string. `"small"` resolves
to the default model when no small-model option is available in the host.

The V2 plugin entry can also provide a small model for `"small"` inference:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/opencode-prompt-suggester",
      "options": {
        "smallModel": "openai/gpt-4o-mini"
      }
    }
  ]
}
```

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            OpenCode Session                                 │
│                                                                             │
│  User Turn ──> Assistant Executes Tools ──> Execution Succeeded/Failed      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  opencode-prompt-suggester (server part)                    │
│                                                                             │
│  1. Extract turn context (tools, files, questions, steering memory)         │
│  2. Instant fallback ("Yes.", "Go ahead.") ──> live.json (<1ms)             │
│  3. Stateless ctx.experimental.generate.text call                           │
│  4. Normalize output ──> update live.json with the refined suggestion       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ live.json + RPC
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────────┐
│      OpenCode TUI part          │   │     OpenCode Desktop GUI bundle     │
│                                 │   │                                     │
│  Suggestion bar above composer  │   │  Composer ghost / placeholder text  │
│  ctrl+alt+n  submit             │   │  tab insert · enter send            │
│  ctrl+alt+x  dismiss            │   │  escape dismiss                     │
└─────────────────────────────────┘   └─────────────────────────────────────┘
```

The server registers its RPC at every active location and stores per-session
suggestions under the project state directory. The TUI polls that state; the
Desktop uses the RPC `get` / `refresh` / `clear` methods.

---

## Host patches

Two optional OpenCode patches make the plugin use first-class host APIs instead
of fallbacks:

```text
patches/tui-prompt-api.patch        TUI ui.prompt set/submit API
patches/composer-placeholder.patch  Desktop ComposerPlaceholder registry
```

Apply them from an OpenCode checkout:

```bash
git apply ~/.config/opencode/plugins/opencode-prompt-suggester/patches/tui-prompt-api.patch
git apply ~/.config/opencode/plugins/opencode-prompt-suggester/patches/composer-placeholder.patch
```

See [`patches/README.md`](patches/README.md) for details and verification steps.

Without the TUI patch, `ctrl+alt+n` shows a warning instead of bypassing the
composer. Without the Desktop registry, the GUI falls back to the composer's
existing faint placeholder node.

---

## Diagnostics

The RPC contract exposes `get`, `refresh`, `clear`, `status`, `configure`, and
`reseed`:

```bash
opencode api post /api/rpc/prompt-suggester/status \
  --param 'location[directory]=/path/to/project' \
  --data '{"input":{"sessionID":"ses_..."}}'
```

---

## Troubleshooting

### Suggestions do not appear

- Confirm the package is listed under `plugins` in `~/.config/opencode/opencode.json`.
- Run `/suggester` and check that `Enabled: true` is shown.
- Make sure the session is a root session. Subagent sessions are ignored.

### TUI accepts nothing

- Install the `ui.prompt` patch, or use the Desktop app. The stock V2 TUI does
  not expose a safe way to submit the composer from a plugin.
- `/suggester` still works without the patch and reports status.

### Suggestions feel generic

- Run `/suggester reseed` to clear the cached project intent seed. A new seed is
  generated on the next eligible turn when reseeding is enabled.

### Desktop ghost text is missing

- Rebuild `dist/gui-experimental.cjs` with `npm run build`.
- Without the `ComposerPlaceholder` patch the plugin uses a DOM fallback; some
  Desktop themes may change the placeholder node structure.

### Background inference fails

- Suggestions use `inference.suggesterModel`. Set it to an explicit
  `provider/model` if `"small"` is unavailable in your host.

---

## Limitations

- TUI ghost insertion (`space` / `right`) and submission require the
  `ui.prompt` host patch.
- Desktop prefers the `ComposerPlaceholder` registry; older hosts use the DOM
  fallback.
- Suggestions are single-line and capped by `suggestion.maxSuggestionChars`.
- The server part uses the experimental `experimental.generate.text` API, so the
  plugin requires OpenCode V2 and `@opencode/plugin` 2.2.5 or newer.

---

## FAQ

#### How does this differ from code ghost text?

Code completion predicts source code inside a file buffer.
`opencode-prompt-suggester` predicts your next *instructional prompt* to the
agent based on what the assistant just finished doing.

#### Does this add cost or slow down chat turns?

Primary turns run at normal speed. Suggestion generation happens after the turn
completes and uses the configured suggester model.

#### What happens when a turn fails or is interrupted?

The plugin publishes a short recovery suggestion (`continue`) immediately, then
refines it with the model when possible.

#### Can I customize the suggestions?

Set `suggestion.customInstruction` in `config.json` to bias suggestions, for
example `"prefer concise confirmations"` or `"always ask for unit tests"`.

#### Where is state stored?

Seeds, steering memory, live suggestions, usage counters, and logs live under
`~/.local/state/opencode/opencode-prompt-suggester/`.

---

## About Contributions

> *About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

[MIT](LICENSE) © 2026 opencode-prompt-suggester contributors.

Portions adapted from the [pi-prompt-suggester](https://github.com/guwidoe/pi-prompt-suggester) architecture (MIT).
