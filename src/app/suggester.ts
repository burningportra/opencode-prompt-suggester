import type { SuggesterConfig } from "../domain/config.ts"
import type { SeedArtifact } from "../domain/seed.ts"
import { classifySteering, type SteeringEvent } from "../domain/steering.ts"
import { normalizeSuggestion, type LiveSuggestion, type TurnStatus } from "../domain/suggestion.ts"
import { addUsage } from "../domain/usage.ts"
import { appendLog, loadConfig, loadSeed, loadSessionState, saveLive, saveSeed, saveSessionState } from "../infra/store.ts"
import { HIDDEN_SESSION_TITLE } from "../infra/paths.ts"
import { sdkCall } from "../infra/sdk.ts"
import { renderSuggestionPrompt } from "../prompts/suggestion-template.ts"
import { buildSuggestionContext } from "./context.ts"
import { completeHidden } from "./hidden.ts"
import { runSeeder, staleTrigger } from "./seeder.ts"

type Client = Parameters<typeof completeHidden>[0]["client"] & {
  session: Parameters<typeof completeHidden>[0]["client"]["session"] & {
    messages?: (...args: never[]) => Promise<unknown>
    get?: (...args: never[]) => Promise<unknown>
  }
}

const reseeding = new Map<string, Promise<void>>()
const smallModelByDir = new Map<string, string | undefined>()

export function rememberSmallModel(directory: string, spec?: string): void {
  smallModelByDir.set(directory, spec)
}

export async function onSessionIdle(input: {
  client: Client
  directory: string
  worktree: string
  sessionID: string
}): Promise<void> {
  const session = await getSession(input.client, input.sessionID, input.directory)
  if (session?.title === HIDDEN_SESSION_TITLE) return
  const config = await loadConfig(input.worktree)
  if (!config.enabled) return

  await saveLive(input.worktree, pending(input.sessionID))
  const state = await loadSessionState(input.worktree, input.sessionID)
  state.turnCount = (state.turnCount ?? 0) + 1

  if (
    config.reseed.enabled &&
    (state.turnCount === 1 || state.turnCount % config.reseed.turnCheckInterval === 0)
  ) {
    queueReseed(input, config, "idle")
  }

  const messages = await listMessages(input.client, input.sessionID, input.directory)
  const turnStatus = inferTurnStatus(messages)
  if (turnStatus !== "success" && config.suggestion.fastPathContinueOnError) {
    await publish(input.worktree, input.sessionID, "continue", state)
    return
  }

  const seed = await loadSeed(input.worktree)
  const context = buildSuggestionContext({
    config,
    seed,
    messages,
    steering: state.steering,
    turnStatus,
  })
  const result = await completeHidden({
    client: input.client,
    hiddenSessionID: state.hiddenSessionID,
    directory: input.directory,
    system: "You write the user's next OpenCode prompt. Return only that prompt text.",
    prompt: renderSuggestionPrompt(context),
    modelSpec: config.inference.suggesterModel,
    smallModel: smallModelByDir.get(input.directory),
  })
  state.hiddenSessionID = result.sessionID
  const text = normalizeSuggestion(
    result.text,
    config.suggestion.noSuggestionToken,
    config.suggestion.maxSuggestionChars,
  )
  await appendLog(input.worktree, {
    kind: text ? "suggestion.generated" : "suggestion.none",
    sessionID: input.sessionID,
    text,
  })
  await publish(input.worktree, input.sessionID, text, state)
}

export async function onUserMessage(input: {
  directory: string
  worktree: string
  sessionID: string
  text: string
}): Promise<void> {
  const config = await loadConfig(input.worktree)
  const state = await loadSessionState(input.worktree, input.sessionID)
  if (!state.lastSuggestion || !input.text.trim()) return
  const verdict = classifySteering(
    state.lastSuggestion,
    input.text.trim(),
    config.steering.acceptedThreshold,
  )
  const event: SteeringEvent = {
    at: new Date().toISOString(),
    kind: verdict.kind,
    suggestedPrompt: state.lastSuggestion,
    actualUserPrompt: input.text.trim(),
    score: verdict.score,
  }
  state.steering = [...state.steering, event].slice(-config.steering.historyWindow)
  await saveSessionState(input.worktree, input.sessionID, state)
  await appendLog(input.worktree, {
    kind: "steering",
    sessionID: input.sessionID,
    steering: event.kind,
    suggestedPrompt: event.suggestedPrompt,
    actualUserPrompt: event.actualUserPrompt,
    score: event.score,
  })
}

export async function requestReseed(input: {
  client: Client
  directory: string
  worktree: string
  sessionID: string
}): Promise<void> {
  const config = await loadConfig(input.worktree)
  await runReseed(input, config, { reason: "manual", changedFiles: [] })
}

export async function statusText(worktree: string, sessionID: string): Promise<string> {
  const config = await loadConfig(worktree)
  const seed = await loadSeed(worktree)
  const state = await loadSessionState(worktree, sessionID)
  return [
    `enabled: ${config.enabled}`,
    `suggester model: ${config.inference.suggesterModel}`,
    `seeder model: ${config.inference.seederModel}`,
    `last suggestion: ${state.lastSuggestion ?? "(none)"}`,
    `seed: ${seed ? `${seed.generatedAt} (${seed.lastReseedReason ?? "unknown"})` : "(missing)"}`,
    `usage: suggestions=${state.usage.suggestionCalls} seeders=${state.usage.seederCalls} seederSteps=${state.usage.seederSteps}`,
    `steering events: ${state.steering.length}`,
  ].join("\n")
}

function queueReseed(
  input: { client: Client; directory: string; worktree: string; sessionID: string },
  config: SuggesterConfig,
  _why: string,
): void {
  const key = input.worktree
  if (reseeding.has(key)) return
  const job = (async () => {
    try {
      const seed = await loadSeed(input.worktree)
      const trigger = await staleTrigger(input.directory, config, seed)
      if (!trigger) return
      await runReseed(input, config, trigger)
    } catch (error) {
      await appendLog(input.worktree, { kind: "seeder.failed", error: String(error) })
    } finally {
      reseeding.delete(key)
    }
  })()
  reseeding.set(key, job)
}

async function runReseed(
  input: { client: Client; directory: string; worktree: string; sessionID: string },
  config: SuggesterConfig,
  trigger: Parameters<typeof runSeeder>[0]["trigger"],
): Promise<void> {
  await appendLog(input.worktree, { kind: "seeder.start", reason: trigger.reason })
  const state = await loadSessionState(input.worktree, input.sessionID)
  const result = await runSeeder({
    client: input.client,
    directory: input.directory,
    worktree: input.worktree,
    config,
    previous: await loadSeed(input.worktree),
    trigger,
    hiddenSessionID: state.hiddenSessionID,
    smallModel: smallModelByDir.get(input.directory),
  })
  state.hiddenSessionID = result.hiddenSessionID
  state.usage = addUsage(state.usage, { seederCalls: 1, seederSteps: result.steps })
  await saveSeed(input.worktree, result.seed)
  await saveSessionState(input.worktree, input.sessionID, state)
  await appendLog(input.worktree, { kind: "seeder.done", reason: trigger.reason, steps: result.steps })
}

async function publish(
  worktree: string,
  sessionID: string,
  text: string | null,
  state: Awaited<ReturnType<typeof loadSessionState>>,
): Promise<void> {
  const live: LiveSuggestion = {
    sessionID,
    text: text ?? "",
    status: text ? "ready" : "none",
    updatedAt: new Date().toISOString(),
  }
  state.lastSuggestion = text ?? undefined
  if (text) state.usage = addUsage(state.usage, { suggestionCalls: 1, suggestionChars: text.length })
  await saveSessionState(worktree, sessionID, state)
  await saveLive(worktree, live)
}

function pending(sessionID: string): LiveSuggestion {
  return { sessionID, text: "", status: "pending", updatedAt: new Date().toISOString() }
}

async function listMessages(client: Client, sessionID: string, directory: string): Promise<any[]> {
  if (!client.session.messages) return []
  const result = await sdkCall<any[]>(
    client.session.messages.bind(client.session),
    { path: { sessionID }, query: { directory } },
    { path: { id: sessionID }, query: { directory } },
    { sessionID, directory },
  )
  return Array.isArray(result) ? result : []
}

async function getSession(
  client: Client,
  sessionID: string,
  directory: string,
): Promise<{ title?: string } | null> {
  if (!client.session.get) return null
  try {
    return await sdkCall(
      client.session.get.bind(client.session),
      { path: { sessionID }, query: { directory } },
      { path: { id: sessionID }, query: { directory } },
      { sessionID, directory },
    )
  } catch {
    return null
  }
}

function inferTurnStatus(messages: any[]): TurnStatus {
  const latest = [...messages].reverse().find((message) => message?.info?.role === "assistant")
  if (latest?.info?.error) return "error"
  return "success"
}
