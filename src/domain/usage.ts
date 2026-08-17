export interface UsageCounters {
  suggestionCalls: number
  seederCalls: number
  suggestionChars: number
  seederSteps: number
}

export function emptyUsage(): UsageCounters {
  return {
    suggestionCalls: 0,
    seederCalls: 0,
    suggestionChars: 0,
    seederSteps: 0,
  }
}

export function addUsage(base: UsageCounters, delta: Partial<UsageCounters>): UsageCounters {
  return {
    suggestionCalls: base.suggestionCalls + (delta.suggestionCalls ?? 0),
    seederCalls: base.seederCalls + (delta.seederCalls ?? 0),
    suggestionChars: base.suggestionChars + (delta.suggestionChars ?? 0),
    seederSteps: base.seederSteps + (delta.seederSteps ?? 0),
  }
}
