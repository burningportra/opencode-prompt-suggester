# opencode-prompt-suggester

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/burningportra/opencode-prompt-suggester/releases/tag/v0.1.1)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D1.18.0-orange.svg)](https://opencode.ai)

> **Intent-aware next-prompt ghost suggestions for OpenCode.** After a turn finishes, an instant heuristic + background model drafts the message you are most likely to send next and displays it as ghost placeholder text in the prompt box. **Space** or **Right Arrow** accepts.

![opencode-prompt-suggester demo](./demo.gif)

Independent OpenCode port of the [pi-prompt-suggester](https://github.com/guwidoe/pi-prompt-suggester) architecture (MIT). Not affiliated with OpenCode.

```jsonc
// ~/.config/opencode/opencode.json & ~/.config/opencode/tui.json
{
  "plugin": ["file:///path/to/opencode-prompt-suggester"]
}
```

---

## TL;DR

### The Problem
Working with conversational coding agents involves repetitive follow-ups ("Yes.", "Go ahead.", "Run the tests.", "Fix the type error."). Typing these manually adds friction, breaks flow, and forces you to stare at an empty input box deciding how to prompt the next step.

### The Solution
`opencode-prompt-suggester` runs immediately when OpenCode finishes an assistant turn. It renders an instant heuristic fallback in `<1ms`, streams an intent-grounded suggestion in the background, and displays it directly in the empty prompt placeholder. Pressing **Space** or **Right Arrow** immediately accepts the text into the editor.

### Why Use opencode-prompt-suggester?

| Feature | What It Does | Why It Matters |
|---|---|---|
| **Ghost Text Placeholder** | Renders suggestions directly inside the empty prompt input | Zero visual clutter; disappears instantly when you start typing |
| **Instant Heuristic Fallback** | Generates zero-latency suggestions (`Yes.`, `Go ahead.`) immediately | No waiting for API round-trips to keep moving |
| **Repo Intent Seeding** | Agentic explorer analyzes repo vision, architecture, and principles | Suggestions stay aligned with real project goals |
| **Adaptive Steering** | Tracks accepted, edited, and rejected suggestions | Learns user intent and avoids repeating rejected directions |
| **Hidden Session Isolation** | Runs all inference in background `[prompt-suggester]` sessions | Never pollutes active chat history or context windows |
| **Native Ergonomics** | **Space** or **Right Arrow** accepts; **Tab** preserved for mode switching | Works seamlessly with native terminal keybindings |

---

## Quick Example

```bash
# 1. Start OpenCode in your repository
opencode

# 2. Ask OpenCode to perform a task
> "Add a health check endpoint to src/server.ts"

# 3. OpenCode finishes the turn:
# Assistant: "I added the /healthz route. Should I run the test suite now?"

# 4. The empty prompt immediately displays ghost suggestion:
# [ Yes. Run the test suite. ]

# 5. Press Right Arrow (or Space) to accept into the prompt box
# > Yes. Run the test suite._

# 6. Press Enter to execute!
```

---

## Design Philosophy

1. **Zero Latency Over Perfection**: An instant heuristic suggestion is painted immediately upon turn completion so you never wait on network inference. The LLM suggestion seamlessly replaces it when ready.
2. **Grounded Project Intent**: Prompts should not be generic autocomplete. The seeder agent explores key files, guidelines, and active task state to suggest contextually relevant next steps.
3. **Total Chat Isolation**: Background suggestions must never inject synthetic turns or extra messages into your primary conversation history.
4. **Unobtrusive Terminal Ergonomics**: Suggestions live inside the empty prompt placeholder. Typing any character immediately overrides the ghost text without extra keystrokes.
5. **Adaptive Steering**: Every accepted, edited, or rejected suggestion is recorded as a steering signal, refining future recommendations in the current session.

---

## Comparison

| Capability | Vanilla OpenCode | Static Snippets / Aliases | opencode-prompt-suggester |
|---|:---:|:---:|:---:|
| **Next-Turn Guidance** | ❌ Manual typing | ⚠️ Fixed static text | ✅ Context-aware dynamic suggestions |
| **Project Intent Awareness** | ❌ None | ❌ None | ✅ Background repo exploration |
| **Keyboard Acceptance** | ❌ None | ⚠️ Manual snippet expansion | ✅ Single keystroke (`Space` / `Right`) |
| **Chat History Hygiene** | ✅ Clean | ✅ Clean | ✅ Clean (isolated hidden sessions) |
| **Zero-Latency Response** | ❌ N/A | ✅ Instant | ✅ Instant heuristic + LLM refinement |
| **Error / Abort Handling** | ❌ Manual | ❌ Static | ✅ Auto-pivots on aborts & errors |

---

## Installation

Both the server plugin (`opencode.json`) and TUI plugin (`tui.json`) must be configured.

### Local Installation (Recommended)

Clone the repository to your local machine:

```bash
git clone https://github.com/burningportra/opencode-prompt-suggester.git ~/.config/opencode/plugins/opencode-prompt-suggester
```

Add the plugin to your OpenCode configuration files:

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///Users/YOUR_USERNAME/.config/opencode/plugins/opencode-prompt-suggester"
  ]
}
```

```jsonc
// ~/.config/opencode/tui.json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "file:///Users/YOUR_USERNAME/.config/opencode/plugins/opencode-prompt-suggester"
  ]
}
```

Restart OpenCode.

---

## Quick Start

1. **Open any project directory**:
   ```bash
   cd ~/my-project
   opencode
   ```
2. **Run a prompt**: Send any normal instruction to OpenCode.
3. **Accept suggestion**: When the turn completes and OpenCode goes idle, press **Space** or **Right Arrow** to accept the suggestion.
4. **Dismiss suggestion**: Press **Backspace** or start typing your own prompt to clear the ghost text.

---

## Command Reference

The plugin registers interactive slash commands in OpenCode:

| Command | Action | Example |
|---|---|---|
| `/suggester` | Display current plugin status, active model, and seed state | `/suggester` |
| `/suggester on` | Enable prompt suggestions for the current project | `/suggester on` |
| `/suggester off` | Disable prompt suggestions for the current project | `/suggester off` |
| `/suggester reseed` | Invalidate cached project intent and trigger fresh repo analysis | `/suggester reseed` |

---

## Configuration

Custom configuration can be set globally in `~/.local/state/opencode/opencode-prompt-suggester/config.json` or per-project in `~/.local/state/opencode/opencode-prompt-suggester/projects/<project-key>/config.json`.

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

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            OpenCode Session                                 │
│                                                                             │
│  User Turn ──> Assistant Executes Tools ──> Turn Completes (session.idle)   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     opencode-prompt-suggester (Server)                      │
│                                                                             │
│  1. Extract Turn Context (tools, touched files, questions, steering memory) │
│  2. Instant Fallback ("Yes.", "Go ahead.") ──> writes live.json (<1ms)      │
│  3. Background Prompt ──> Hidden Session [prompt-suggester]                 │
│  4. Normalized Output ──> updates live.json with refined suggestion         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OpenCode TUI (Slot & Keymap)                          │
│                                                                             │
│  1. Injects ghost text placeholder into active Prompt renderable            │
│  2. Intercepts Space / Right Arrow keypress when editor is empty            │
│  3. Populates prompt input buffer (promptRef.set) ──> ready to submit!      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### 1. Suggestions do not appear in the prompt box
- Verify that both `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json` include the plugin path. TUI plugins are not auto-scanned from `plugins/`.
- Run `/suggester` in OpenCode to verify that `Enabled: true` is displayed.

### 2. Tab key switches mode instead of accepting suggestions
- This is intentional: `Tab` is intentionally preserved for OpenCode's native mode switching (e.g., switching between agent modes). Use **Space** or **Right Arrow** to accept suggestions.

### 3. Suggestions feel generic or unaware of repository structure
- Run `/suggester reseed` to force the background seeder to re-explore key architecture files, READMEs, and codebase conventions.

### 4. Background inference fails or takes too long
- By default, suggestions use `"small"` model routing. You can configure `"suggesterModel"` in `config.json` to any specific provider/model (e.g. `"openai/gpt-4o-mini"` or `"anthropic/claude-3-5-haiku-20241022"`).

### 5. Ghost suggestion persists after typing
- Typing any non-space character automatically clears the ghost text. Pressing **Backspace** on an empty prompt explicitly dismisses the current suggestion.

---

## Limitations

- **Terminal Placeholder Wrapping**: The plugin renders suggestions using the TUI renderable's native placeholder slot. Extremely long terminal resize events may occasionally re-render placeholder text on the next tick.
- **Single-Line Suggestions**: Suggestions are intentionally limited to single-line prompts (max 200 characters) to optimize speed and conversational flow.
- **Provider Availability**: Background inference requires an active provider model configuration in OpenCode.

---

## FAQ

#### How does this differ from GitHub Copilot ghost text?
Copilot predicts code completions inside a file buffer. `opencode-prompt-suggester` predicts your next *instructional prompt* to the AI agent based on what the assistant just finished doing.

#### Does this add cost or slow down my chat turns?
Primary turns execute at normal speed. Suggestion generation occurs *after* the turn completes and runs in a separate hidden session using lightweight/small models (`gpt-4o-mini`, `claude-3-5-haiku`).

#### What happens if the assistant encounters an error?
When a turn ends in an error, the plugin detects the failure and suggests a recovery prompt (e.g., `continue` or fix instructions).

#### Can I customize the suggestions?
Yes. Set `suggestion.customInstruction` in your `config.json` to bias suggestions (e.g. `"prefer concise confirmations"` or `"always ask for unit tests"`).

#### Where is state stored?
All state, seeds, steering memory, and logs are stored locally under `~/.local/state/opencode/opencode-prompt-suggester/`.

---

## About Contributions

> *About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

[MIT](LICENSE) © 2026 opencode-prompt-suggester contributors.

Portions adapted from the [pi-prompt-suggester](https://github.com/guwidoe/pi-prompt-suggester) architecture (MIT).
