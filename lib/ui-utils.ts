export interface SpacePalette {
  hex: string
  key: 'indigo' | 'emerald' | 'amber' | 'pink' | 'violet' | 'cyan'
  bar: string
  dot: string
  countBg: string
  countText: string
  countRing: string
  countRingHover: string
  switchBg: string
  switchRing: string
  rowAccent: string
  rowHoverBg: string
  chipHoverBg: string
  chipHoverText: string
  headerHoverGradient: string
}

const PALETTE: Record<SpacePalette['key'], SpacePalette> = {
  indigo: {
    hex: '#6366F1',
    key: 'indigo',
    bar: 'bg-indigo-500',
    dot: 'bg-indigo-500',
    countBg: 'bg-indigo-50 dark:bg-indigo-900/30',
    countText: 'text-indigo-700 dark:text-indigo-300',
    countRing: 'ring-indigo-200/60 dark:ring-indigo-700/40',
    countRingHover: 'group-hover/card:ring-indigo-300 dark:group-hover/card:ring-indigo-600/70',
    switchBg: 'bg-indigo-600 hover:bg-indigo-700',
    switchRing: 'focus-visible:ring-indigo-500/40',
    rowAccent: 'group-hover/row:border-indigo-500',
    rowHoverBg: 'hover:bg-indigo-50/60 dark:hover:bg-indigo-900/15',
    chipHoverBg: 'group-hover/row:bg-indigo-50 dark:group-hover/row:bg-indigo-900/30',
    chipHoverText: 'group-hover/row:text-indigo-700 dark:group-hover/row:text-indigo-300',
    headerHoverGradient: 'group-hover/card:bg-gradient-to-br group-hover/card:from-indigo-50/40 group-hover/card:to-transparent dark:group-hover/card:from-indigo-900/10',
  },
  emerald: {
    hex: '#10B981',
    key: 'emerald',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    countBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    countText: 'text-emerald-700 dark:text-emerald-300',
    countRing: 'ring-emerald-200/60 dark:ring-emerald-700/40',
    countRingHover: 'group-hover/card:ring-emerald-300 dark:group-hover/card:ring-emerald-600/70',
    switchBg: 'bg-emerald-600 hover:bg-emerald-700',
    switchRing: 'focus-visible:ring-emerald-500/40',
    rowAccent: 'group-hover/row:border-emerald-500',
    rowHoverBg: 'hover:bg-emerald-50/60 dark:hover:bg-emerald-900/15',
    chipHoverBg: 'group-hover/row:bg-emerald-50 dark:group-hover/row:bg-emerald-900/30',
    chipHoverText: 'group-hover/row:text-emerald-700 dark:group-hover/row:text-emerald-300',
    headerHoverGradient: 'group-hover/card:bg-gradient-to-br group-hover/card:from-emerald-50/40 group-hover/card:to-transparent dark:group-hover/card:from-emerald-900/10',
  },
  amber: {
    hex: '#F59E0B',
    key: 'amber',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
    countBg: 'bg-amber-50 dark:bg-amber-900/30',
    countText: 'text-amber-700 dark:text-amber-300',
    countRing: 'ring-amber-200/60 dark:ring-amber-700/40',
    countRingHover: 'group-hover/card:ring-amber-300 dark:group-hover/card:ring-amber-600/70',
    switchBg: 'bg-amber-600 hover:bg-amber-700',
    switchRing: 'focus-visible:ring-amber-500/40',
    rowAccent: 'group-hover/row:border-amber-500',
    rowHoverBg: 'hover:bg-amber-50/60 dark:hover:bg-amber-900/15',
    chipHoverBg: 'group-hover/row:bg-amber-50 dark:group-hover/row:bg-amber-900/30',
    chipHoverText: 'group-hover/row:text-amber-700 dark:group-hover/row:text-amber-300',
    headerHoverGradient: 'group-hover/card:bg-gradient-to-br group-hover/card:from-amber-50/40 group-hover/card:to-transparent dark:group-hover/card:from-amber-900/10',
  },
  pink: {
    hex: '#EC4899',
    key: 'pink',
    bar: 'bg-pink-500',
    dot: 'bg-pink-500',
    countBg: 'bg-pink-50 dark:bg-pink-900/30',
    countText: 'text-pink-700 dark:text-pink-300',
    countRing: 'ring-pink-200/60 dark:ring-pink-700/40',
    countRingHover: 'group-hover/card:ring-pink-300 dark:group-hover/card:ring-pink-600/70',
    switchBg: 'bg-pink-600 hover:bg-pink-700',
    switchRing: 'focus-visible:ring-pink-500/40',
    rowAccent: 'group-hover/row:border-pink-500',
    rowHoverBg: 'hover:bg-pink-50/60 dark:hover:bg-pink-900/15',
    chipHoverBg: 'group-hover/row:bg-pink-50 dark:group-hover/row:bg-pink-900/30',
    chipHoverText: 'group-hover/row:text-pink-700 dark:group-hover/row:text-pink-300',
    headerHoverGradient: 'group-hover/card:bg-gradient-to-br group-hover/card:from-pink-50/40 group-hover/card:to-transparent dark:group-hover/card:from-pink-900/10',
  },
  violet: {
    hex: '#8B5CF6',
    key: 'violet',
    bar: 'bg-violet-500',
    dot: 'bg-violet-500',
    countBg: 'bg-violet-50 dark:bg-violet-900/30',
    countText: 'text-violet-700 dark:text-violet-300',
    countRing: 'ring-violet-200/60 dark:ring-violet-700/40',
    countRingHover: 'group-hover/card:ring-violet-300 dark:group-hover/card:ring-violet-600/70',
    switchBg: 'bg-violet-600 hover:bg-violet-700',
    switchRing: 'focus-visible:ring-violet-500/40',
    rowAccent: 'group-hover/row:border-violet-500',
    rowHoverBg: 'hover:bg-violet-50/60 dark:hover:bg-violet-900/15',
    chipHoverBg: 'group-hover/row:bg-violet-50 dark:group-hover/row:bg-violet-900/30',
    chipHoverText: 'group-hover/row:text-violet-700 dark:group-hover/row:text-violet-300',
    headerHoverGradient: 'group-hover/card:bg-gradient-to-br group-hover/card:from-violet-50/40 group-hover/card:to-transparent dark:group-hover/card:from-violet-900/10',
  },
  cyan: {
    hex: '#06B6D4',
    key: 'cyan',
    bar: 'bg-cyan-500',
    dot: 'bg-cyan-500',
    countBg: 'bg-cyan-50 dark:bg-cyan-900/30',
    countText: 'text-cyan-700 dark:text-cyan-300',
    countRing: 'ring-cyan-200/60 dark:ring-cyan-700/40',
    countRingHover: 'group-hover/card:ring-cyan-300 dark:group-hover/card:ring-cyan-600/70',
    switchBg: 'bg-cyan-600 hover:bg-cyan-700',
    switchRing: 'focus-visible:ring-cyan-500/40',
    rowAccent: 'group-hover/row:border-cyan-500',
    rowHoverBg: 'hover:bg-cyan-50/60 dark:hover:bg-cyan-900/15',
    chipHoverBg: 'group-hover/row:bg-cyan-50 dark:group-hover/row:bg-cyan-900/30',
    chipHoverText: 'group-hover/row:text-cyan-700 dark:group-hover/row:text-cyan-300',
    headerHoverGradient: 'group-hover/card:bg-gradient-to-br group-hover/card:from-cyan-50/40 group-hover/card:to-transparent dark:group-hover/card:from-cyan-900/10',
  },
}

const KEYS: SpacePalette['key'][] = ['indigo', 'emerald', 'amber', 'pink', 'violet', 'cyan']

export function colorForSpace(id: string): SpacePalette {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return PALETTE[KEYS[Math.abs(h) % KEYS.length]!]
}

export function relativeTime(
  ts: number,
  t: (key: string, params?: Record<string, string | number>) => string,
  now: number = Date.now(),
): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  const hr = Math.floor(diff / 3_600_000)
  const day = Math.floor(diff / 86_400_000)
  if (min < 1) return t('timeJustNow')
  if (min < 60) return t('timeMinutesAgo', { n: min })
  if (hr < 24) return t('timeHoursAgo', { n: hr })
  if (day === 1) return t('timeYesterday')
  if (day < 7) return t('timeDaysAgo', { n: day })
  if (day < 30) return t('timeWeeksAgo', { n: Math.floor(day / 7) })
  if (day < 365) return t('timeMonthsAgo', { n: Math.floor(day / 30) })
  return t('timeYearsAgo', { n: Math.floor(day / 365) })
}
