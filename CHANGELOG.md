# Changelog

All notable changes to this project will be documented in this file.

## [v2.0.0] - 2026-11-06

### Changed
- Ported the plugin to the OpenCode V2 plugin API (`Plugin.define`, RPC, event
  subscriptions, and `ctx.session.hook`).
- Replaced V1 hidden `[prompt-suggester]` sessions with the stateless
  `ctx.experimental.generate.text` API. Suggestion and seeder inference no
  longer write to session history.
- Rewrote the server entry around `session.execution.succeeded`, `failed`,
  `interrupted`, and `started` events.
- Rewrote the TUI entry as a V2 TUI plugin with a suggestion bar above the
  composer, `/suggester` commands, and `ctrl+alt+n` / `ctrl+alt+x` bindings.
- Added optional `space` / `right` insertion through the patched `ui.prompt`
  API.
- Added a Desktop GUI bundle (`dist/gui-experimental.cjs`) that renders ghost
  text through `ComposerPlaceholder` when available and falls back to the
  composer placeholder node.
- Added an RPC contract with `get`, `refresh`, `clear`, `status`, `configure`,
  and `reseed` methods.
- Configuration, seed, steering, usage, and state storage remain compatible
  with 1.x.
- Added `patches/tui-prompt-api.patch` and
  `patches/composer-placeholder.patch` for hosts that want the first-class
  prompt and placeholder APIs.

### Removed
- Removed the V1 `chat.message` / client SDK plumbing and hidden-session
  bookkeeping.

---

## [v0.1.3] - 2026-08-21

### Fixed
- Fixed ghost suggestions not rendering in the prompt box. The TUI previously toggled `showPlaceholder` off whenever a suggestion was ready and tried to force the placeholder through the renderer internals; it now uses the first-class `placeholders` prop (`{ normal: [text] }`) so the ghost renders natively and reliably.
- Removed the fragile `renderer.currentFocusedRenderable` mutation and the 100ms re-paint loop.

---

## [v0.1.2] - 2026-08-17

### Documentation
- Completely overhauled `README.md` following open-source documentation standards.
- Added TL;DR section with problem/solution breakdown and feature matrix.
- Added ASCII data flow architecture diagram mapping lifecycle from `session.idle` to TUI prompt injection.
- Added comparison table vs vanilla OpenCode and static snippet alternatives.
- Added full commented configuration reference covering seed, reseed, suggestion, steering, and inference settings.
- Added comprehensive troubleshooting guide and FAQ covering top usage scenarios.
- Added formal contributions policy and license attribution.

---

## [v0.1.1] - 2026-08-17

### Added
- Added high-quality demo animation (`demo.gif`) accelerated 2x for fast visual onboarding.
- Added demo asset reference to `README.md`.

### Fixed
- Fixed Right Arrow key acceptance in TUI via direct terminal raw input stream sequence matching.
- Excluded Tab key from ghost acceptance to preserve native OpenCode mode switching.

---

## [v0.1.0] - 2026-08-17

### Added
- Initial release of **opencode-prompt-suggester**.
- Intent-aware next-prompt ghost suggestions for OpenCode.
- Fast fallback heuristics + LLM generation in hidden `[prompt-suggester]` sessions.
- Multi-step background repository intent seeder.
- Adaptive steering memory (accepted, edited, changed course).
- Built-in slash commands: `/suggester`, `/suggester on`, `/suggester off`, `/suggester reseed`.
