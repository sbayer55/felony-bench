const DAY = 86_400_000

export function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }): string {
  if (!iso) return '—'
  return parseDate(iso).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const then = parseDate(iso).getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.floor((today - then) / DAY))
}

export function relativeTime(isoTimestamp: string | null, now: Date = new Date()): string {
  if (!isoTimestamp) return 'never'
  const diff = now.getTime() - new Date(isoTimestamp).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days} d ago`
  return formatDate(isoTimestamp.slice(0, 10))
}

/** Scores are integers, but a leaderboard that doesn't print two decimals isn't trying. */
export function formatScore(n: number): string {
  return n.toFixed(2)
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/)
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}
