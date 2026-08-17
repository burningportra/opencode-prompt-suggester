# opencode-prompt-suggester

Next-prompt ghost suggestions for [OpenCode](https://opencode.ai). After a turn finishes, a cheap model drafts the message you are most likely to type next and shows it as empty-box placeholder text. Right or Tab accepts.

Independent OpenCode port of the [pi-prompt-suggester](https://github.com/guwidoe/pi-prompt-suggester) architecture (MIT). Not affiliated.

## Install

Local file (dev):

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": ["file:///ABS/PATH/opencode-prompt-suggester"]
}

// ~/.config/opencode/tui.json
{
  "plugin": ["file:///ABS/PATH/opencode-prompt-suggester"]
}
```

Both lists are required. TUI plugins are not auto-scanned from `plugins/`. Restart OpenCode.

## Use

- After the assistant goes idle, the empty prompt shows a muted suggestion.
- Right or Tab accepts when the box is empty.
- `/suggester` opens settings (enable/disable, instruction, status).
- `/suggester reseed` refreshes project intent.
- `/suggester off` / `/suggester on` toggles generation.

Suggestions and seeding run in a hidden `[prompt-suggester]` session so they do not pollute the visible chat.

## State

`~/.local/state/opencode/opencode-prompt-suggester/projects/<key>/`

## Limits

OpenCode's Prompt always paints `Ask anything...`. This plugin keeps that widget so typing and submit stay intact, and shows the suggestion as muted text above the box. If the wrapper misbehaves, remove the plugin from `tui.json` and restart.
