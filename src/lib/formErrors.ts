import type { z } from 'zod'

/** Field path (dot-joined, e.g. "incident.sources.0.url") → message. */
export type FieldErrors = Record<string, string>

const ARRAY_MESSAGES: Record<string, string> = {
  providerIds: 'Choose at least one provider.',
  sources: 'Add at least one source.',
}

/** A message a person can act on, in place of zod's defaults. */
export function friendlyMessage(issue: z.core.$ZodIssue): string {
  const last = issue.path[issue.path.length - 1]
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'array') return ARRAY_MESSAGES[String(last)] ?? `Add at least ${issue.minimum}.`
      if (issue.origin === 'string') return 'Required.'
      return issue.message
    case 'too_big':
      return issue.origin === 'string' ? `At most ${issue.maximum} characters.` : issue.message
    case 'invalid_value':
    case 'invalid_union':
      return 'Choose one.'
    case 'invalid_type':
      return issue.input === undefined || issue.input === '' ? 'Required.' : issue.message
    case 'invalid_format':
      if (issue.format === 'url') return issue.input ? 'Must be a full https:// URL.' : 'Required.'
      if (issue.format === 'regex' && issue.message.includes('YYYY-MM-DD')) return issue.input ? 'Use a full date (YYYY-MM-DD).' : 'Required.'
      if (issue.format === 'regex' && issue.message.includes('slug')) return `"${String(issue.input)}" is not a valid id.`
      return issue.message
    case 'custom':
      return issue.message === 'must be https' ? 'Must start with https://.' : issue.message
    default:
      return issue.message
  }
}

/** First error per path wins. Empty strings fail several checks; the first is the useful one. */
export function issuesToErrors(issues: z.core.$ZodIssue[], prefix?: string): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of issues) {
    const key = [prefix, ...issue.path.map(String)].filter((p) => p !== undefined && p !== '').join('.')
    if (!(key in out)) out[key] = friendlyMessage(issue)
  }
  return out
}
