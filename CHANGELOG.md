# Changelog

All notable changes to this project will be documented in this file.

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
