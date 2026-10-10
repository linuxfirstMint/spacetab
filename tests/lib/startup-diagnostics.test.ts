import { describe, expect, it } from 'vitest'
import {
  appendStartupDiagnostic,
  STARTUP_DIAGNOSTIC_HISTORY_LIMIT,
  type StartupDiagnosticRecord,
} from '@/lib/startup-diagnostics'

function record(phase: string, at: string, extra: Record<string, unknown> = {}): StartupDiagnosticRecord {
  return { phase, at, build: '1.1.0', diagnosticBuild: 'diagnostic-v1', ...extra }
}

describe('appendStartupDiagnostic', () => {
  it('migrates legacy phase keys and latest record without run ID filtering', () => {
    const latest = record('startup-event-received', '2026-10-10T10:00:02.000Z', { runId: 'old-run' })
    const listener = record('startup-listener-registered', '2026-10-10T10:00:01.000Z', { runId: 'another-run' })

    const history = appendStartupDiagnostic(undefined, [latest, listener, latest], record('background-entered', '2026-10-10T10:00:00.000Z'))

    expect(history.map(item => item.phase)).toEqual([
      'background-entered',
      'startup-listener-registered',
      'startup-event-received',
    ])
    expect(history[1]?.runId).toBe('another-run')
  })

  it('keeps only the newest 20 valid entries', () => {
    const entries = Array.from({ length: STARTUP_DIAGNOSTIC_HISTORY_LIMIT + 4 }, (_, index) =>
      record(`phase-${index}`, `2026-10-10T10:00:${String(index).padStart(2, '0')}.000Z`),
    )

    const history = appendStartupDiagnostic(entries.slice(0, -1), [], entries.at(-1)!)

    expect(history).toHaveLength(20)
    expect(history[0]?.phase).toBe('phase-4')
    expect(history.at(-1)?.phase).toBe('phase-23')
  })

  it('ignores malformed legacy entries and de-duplicates a phase timestamp pair', () => {
    const repeated = record('startup-restored', '2026-10-10T10:00:02.000Z')
    const history = appendStartupDiagnostic([repeated], [null, { phase: 'bad', at: 'x' }, repeated], repeated)

    expect(history).toEqual([repeated])
  })
})
