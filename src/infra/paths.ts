import { createHash } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"

export const PLUGIN_ID = "opencode-prompt-suggester"
export const HIDDEN_SESSION_TITLE = "[prompt-suggester]"

export function stateRoot(override?: string): string {
  if (override) return path.join(override, PLUGIN_ID)
  const xdg = process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state")
  return path.join(xdg, "opencode", PLUGIN_ID)
}

export function projectKey(worktree: string): string {
  return createHash("sha1").update(worktree).digest("hex").slice(0, 16)
}

export function projectDir(worktree: string, stateOverride?: string): string {
  return path.join(stateRoot(stateOverride), "projects", projectKey(worktree))
}

export function userConfigPath(stateOverride?: string): string {
  return path.join(stateRoot(stateOverride), "config.json")
}

export function projectConfigPath(worktree: string, stateOverride?: string): string {
  return path.join(projectDir(worktree, stateOverride), "config.json")
}

export function seedPath(worktree: string, stateOverride?: string): string {
  return path.join(projectDir(worktree, stateOverride), "seed.json")
}

export function livePath(worktree: string, sessionID?: string, stateOverride?: string): string {
  if (sessionID) return path.join(sessionDir(worktree, sessionID, stateOverride), "live.json")
  return path.join(projectDir(worktree, stateOverride), "live.json")
}

export function sessionDir(worktree: string, sessionID: string, stateOverride?: string): string {
  return path.join(projectDir(worktree, stateOverride), "sessions", sessionID)
}

export function logPath(worktree: string, stateOverride?: string): string {
  return path.join(projectDir(worktree, stateOverride), "logs", "events.ndjson")
}
