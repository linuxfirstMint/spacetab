export type StartupDiagnosticRecord = {
  phase: string
  at: string
  build: string
  diagnosticBuild: string
  details?: Record<string, unknown>
  [key: string]: unknown
}

export const STARTUP_DIAGNOSTIC_HISTORY_LIMIT = 20

function isStartupDiagnosticRecord(value: unknown): value is StartupDiagnosticRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.phase === 'string'
    && typeof record.at === 'string'
    && typeof record.build === 'string'
    && typeof record.diagnosticBuild === 'string'
}

/** Merges the bounded history, or migrates old per-phase keys on first write. */
export function appendStartupDiagnostic(
  current: unknown,
  legacy: unknown[],
  entry: StartupDiagnosticRecord,
): StartupDiagnosticRecord[] {
  const prior = Array.isArray(current) ? current : legacy
  const history = [...prior, entry]
    .filter(isStartupDiagnosticRecord)
    .filter((item, index, all) => all.findIndex(other => other.phase === item.phase && other.at === item.at) === index)
    .sort((a, b) => a.at.localeCompare(b.at))
  return history.slice(-STARTUP_DIAGNOSTIC_HISTORY_LIMIT)
}
