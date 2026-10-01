import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import {
  ATTRIBUTION,
  CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  DEGREES,
  DEGREE_DESCRIPTIONS,
  DEGREE_LABELS,
  EVIDENCE_CLASSES,
  EVIDENCE_DESCRIPTIONS,
  EVIDENCE_LABELS,
  IncidentBodySchema,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type IncidentBody,
} from '../data/schema'
import { ApiError, apiFetch, errorMessage } from '../lib/api'
import { issuesToErrors, type FieldErrors } from '../lib/formErrors'
import f from '../components/forms.module.css'
import styles from './SubmitPage.module.css'

const TITLE_MAX = 140
const SUMMARY_MAX = 900

const ATTRIBUTION_DESCRIPTIONS: Record<(typeof ATTRIBUTION)[number], string> = {
  confirmed: 'The provider, a court, or a regulator has tied the conduct to this model.',
  reported: 'Reputable reporting names the model, without confirmation from the provider.',
  disputed: 'The provider or another credible party disputes that this model was involved.',
}

type SourceDraft = { key: number; title: string; url: string; publisher: string; date: string }
type CandidateDraft = { key: number; name: string; providerId: string }

type Draft = {
  date: string
  title: string
  summary: string
  providerIds: string[]
  modelIds: string[]
  category: string
  degree: string
  evidenceClass: string
  role: string
  attributionConfidence: string
  sources: SourceDraft[]
  candidates: CandidateDraft[]
  tags: string
  note: string
  contact: string
  website: string
}

let nextKey = 1
const newSource = (): SourceDraft => ({ key: nextKey++, title: '', url: '', publisher: '', date: '' })

const emptyDraft = (): Draft => ({
  date: '',
  title: '',
  summary: '',
  providerIds: [],
  modelIds: [],
  category: '',
  degree: '',
  evidenceClass: '',
  role: '',
  attributionConfidence: '',
  sources: [newSource()],
  candidates: [],
  tags: '',
  note: '',
  contact: '',
  website: '',
})

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

type Result = { kind: 'ok'; id: string } | { kind: 'error'; message: string; issues?: string[] } | null

export function SubmitPage() {
  const { providers, models } = useData()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const summaryRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const sortedProviders = useMemo(() => [...providers].sort((a, b) => a.name.localeCompare(b.name)), [providers])
  const modelsByProvider = useMemo(() => {
    const m = new Map<string, typeof models>()
    for (const model of models) m.set(model.providerId, [...(m.get(model.providerId) ?? []), model])
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return m
  }, [models])

  const toggleProvider = (id: string) =>
    setDraft((d) => {
      const on = d.providerIds.includes(id)
      const providerIds = on ? d.providerIds.filter((p) => p !== id) : [...d.providerIds, id]
      if (!on) return { ...d, providerIds }
      // Dropping a provider drops its models and any unlisted models filed under it.
      const dropModel = new Set((modelsByProvider.get(id) ?? []).map((m) => m.id))
      return {
        ...d,
        providerIds,
        modelIds: d.modelIds.filter((m) => !dropModel.has(m)),
        candidates: d.candidates.map((c) => (c.providerId === id ? { ...c, providerId: '' } : c)),
      }
    })

  const toggleModel = (id: string) => setDraft((d) => ({ ...d, modelIds: d.modelIds.includes(id) ? d.modelIds.filter((m) => m !== id) : [...d.modelIds, id] }))

  const updateSource = (key: number, patch: Partial<SourceDraft>) => setDraft((d) => ({ ...d, sources: d.sources.map((s) => (s.key === key ? { ...s, ...patch } : s)) }))
  const updateCandidate = (key: number, patch: Partial<CandidateDraft>) => setDraft((d) => ({ ...d, candidates: d.candidates.map((c) => (c.key === key ? { ...c, ...patch } : c)) }))

  const build = () => {
    const candidateModels = draft.candidates.map((c) => ({ id: slugify(c.name), name: c.name.trim(), providerId: c.providerId }))
    const tags = draft.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const incident = {
      date: draft.date,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      providerIds: draft.providerIds,
      modelIds: [...draft.modelIds, ...candidateModels.map((c) => c.id).filter(Boolean)],
      category: draft.category,
      degree: draft.degree ? Number(draft.degree) : undefined,
      evidenceClass: draft.evidenceClass,
      role: draft.role,
      attributionConfidence: draft.attributionConfidence,
      sources: draft.sources.map(({ title, url, publisher, date }) => ({ title: title.trim(), url: url.trim(), publisher: publisher.trim(), date })),
      ...(tags.length ? { tags } : {}),
    }
    return { incident, candidateModels }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setResult(null)
    const { incident, candidateModels } = build()
    const parsed = IncidentBodySchema.safeParse(incident)
    const errs: FieldErrors = parsed.success ? {} : issuesToErrors(parsed.error.issues, 'incident')
    draft.candidates.forEach((c, i) => {
      if (!c.name.trim()) errs[`candidate.${i}.name`] = 'Name the model, or remove this row'
      else if (!slugify(c.name)) errs[`candidate.${i}.name`] = 'Use letters or numbers'
      if (!c.providerId) errs[`candidate.${i}.providerId`] = 'Choose one of the selected providers'
    })
    setErrors(errs)
    if (!parsed.success || Object.keys(errs).length) {
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { incident: parsed.data satisfies IncidentBody, website: draft.website }
      if (candidateModels.length) body.candidateModels = candidateModels
      if (draft.note.trim()) body.note = draft.note.trim()
      if (draft.contact.trim()) body.contact = draft.contact.trim()
      const res = await apiFetch<{ id?: string; status?: string } | null>('/api/submissions', { method: 'POST', json: body })
      setResult({ kind: 'ok', id: res?.id ?? '' })
      setDraft(emptyDraft())
      setErrors({})
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setResult({ kind: 'error', message: 'Too many submissions from this address. The limit is five an hour. Try again later.' })
      } else if (err instanceof ApiError && err.status === 400) {
        const issues = (err.body as { issues?: unknown })?.issues
        setResult({ kind: 'error', message: err.serverMessage ?? 'The submission was rejected as invalid.', issues: Array.isArray(issues) ? issues.map(String) : undefined })
      } else {
        setResult({ kind: 'error', message: `The submission could not be sent. ${errorMessage(err)}` })
      }
    } finally {
      setSubmitting(false)
      requestAnimationFrame(() => summaryRef.current?.focus())
    }
  }

  const errorCount = Object.keys(errors).length
  const selectedProviders = sortedProviders.filter((p) => draft.providerIds.includes(p.id))

  if (result?.kind === 'ok') {
    return (
      <div className="container">
        <header className={styles.head}>
          <h1 className={styles.title}>Submit a felony</h1>
        </header>
        <div className={`${f.notice} ${f.noticeOk} ${styles.done}`} role="status" ref={summaryRef} tabIndex={-1}>
          <p>
            <strong>Filed.</strong> Your submission is in the review queue
            {result.id ? (
              <>
                {' '}
                as <span className="mono">{result.id}</span>
              </>
            ) : null}
            . A human will check the sources before it reaches the <Link to="/docket">docket</Link>.
          </p>
          <button type="button" className={f.btn} onClick={() => setResult(null)}>
            Submit another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <header className={styles.head}>
        <h1 className={styles.title}>Submit a felony</h1>
        <p className={styles.lede}>
          Know of an incident that belongs on the docket? File it here. Every submission is reviewed by a human and then run
          through the same checks as the <Link to="/methodology#submit">daily refresh</Link>: schema, roster, duplicates, and a
          live fetch of every source. If it is not sourced, it is not here.
        </p>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate aria-describedby="submit-status">
        <div id="submit-status" ref={summaryRef} tabIndex={-1} className={styles.status} aria-live="polite">
          {errorCount ? (
            <div className={`${f.notice} ${f.noticeError}`} role="alert">
              {errorCount === 1 ? 'One field needs attention.' : `${errorCount} fields need attention.`} Errors are marked below.
            </div>
          ) : result?.kind === 'error' ? (
            <div className={`${f.notice} ${f.noticeError}`} role="alert">
              {result.message}
              {result.issues?.length ? (
                <ul>
                  {result.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <section className={styles.card} aria-labelledby="sec-what">
          <h2 id="sec-what" className={styles.h2}>
            The incident
          </h2>
          <div className={styles.row}>
            <Field label="Date of incident" error={errors['incident.date']} hint="When it happened or was first reported.">
              {(p) => <input {...p} type="date" className={f.input} value={draft.date} onChange={(e) => set('date', e.target.value)} />}
            </Field>
          </div>
          <Field label="Title" error={errors['incident.title']} hint="One line, attributive, under 140 characters." counter={[draft.title.length, TITLE_MAX]}>
            {(p) => <input {...p} type="text" className={f.input} value={draft.title} maxLength={TITLE_MAX + 20} onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field
            label="Summary"
            error={errors['incident.summary']}
            hint='What the sources say, in attributive language: "according to", "the system card states".'
            counter={[draft.summary.length, SUMMARY_MAX]}
          >
            {(p) => <textarea {...p} className={f.textarea} rows={6} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />}
          </Field>
        </section>

        <section className={styles.card} aria-labelledby="sec-who">
          <h2 id="sec-who" className={styles.h2}>
            Defendants
          </h2>
          <Group label="Providers" error={errors['incident.providerIds']} hint="Every provider whose model or systems are named.">
            <div className={f.chips}>
              {sortedProviders.map((p) => (
                <label key={p.id} className={f.chip}>
                  <input type="checkbox" checked={draft.providerIds.includes(p.id)} onChange={() => toggleProvider(p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
          </Group>

          <Group label="Models" optional error={errors['incident.modelIds']} hint={selectedProviders.length ? 'Leave empty if the sources do not name a model.' : 'Choose a provider first.'}>
            {selectedProviders.length ? (
              <div className={styles.modelGroups}>
                {selectedProviders.map((p) => (
                  <div key={p.id} className={styles.modelGroup}>
                    <span className={styles.groupName}>{p.name}</span>
                    {modelsByProvider.get(p.id)?.length ? (
                      <div className={f.chips}>
                        {modelsByProvider.get(p.id)!.map((m) => (
                          <label key={m.id} className={f.chip}>
                            <input type="checkbox" checked={draft.modelIds.includes(m.id)} onChange={() => toggleModel(m.id)} />
                            {m.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <span className={f.hint}>No models on the roster.</span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </Group>

          {draft.candidates.length ? (
            <div className={styles.repeat}>
              {draft.candidates.map((c, i) => (
                <fieldset key={c.key} className={styles.item}>
                  <legend className={styles.itemLegend}>Unlisted model {i + 1}</legend>
                  <div className={styles.row}>
                    <Field label="Model name" error={errors[`candidate.${i}.name`]}>
                      {(p) => <input {...p} type="text" className={f.input} value={c.name} onChange={(e) => updateCandidate(c.key, { name: e.target.value })} />}
                    </Field>
                    <Field label="Provider" error={errors[`candidate.${i}.providerId`]}>
                      {(p) => (
                        <select {...p} className={f.select} value={c.providerId} onChange={(e) => updateCandidate(c.key, { providerId: e.target.value })}>
                          <option value="">Choose…</option>
                          {selectedProviders.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                  <button type="button" className={f.linkBtn} onClick={() => setDraft((d) => ({ ...d, candidates: d.candidates.filter((x) => x.key !== c.key) }))}>
                    Remove unlisted model {i + 1}
                  </button>
                </fieldset>
              ))}
            </div>
          ) : null}
          <div>
            <button type="button" className={f.btn} disabled={!selectedProviders.length} onClick={() => setDraft((d) => ({ ...d, candidates: [...d.candidates, { key: nextKey++, name: '', providerId: d.providerIds.length === 1 ? d.providerIds[0] : '' }] }))}>
              + Model not listed
            </button>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="sec-charge">
          <h2 id="sec-charge" className={styles.h2}>
            The charge
          </h2>
          <div className={styles.grid}>
            <EnumSelect label="Charge" value={draft.category} onChange={(v) => set('category', v)} error={errors['incident.category']} options={CATEGORIES.map((c) => [c, CATEGORY_LABELS[c], CATEGORY_DESCRIPTIONS[c]])} />
            <EnumSelect label="Degree" value={draft.degree} onChange={(v) => set('degree', v)} error={errors['incident.degree']} options={[...DEGREES].reverse().map((d) => [String(d), DEGREE_LABELS[d], DEGREE_DESCRIPTIONS[d]])} />
            <EnumSelect
              label="Evidence class"
              value={draft.evidenceClass}
              onChange={(v) => set('evidenceClass', v)}
              error={errors['incident.evidenceClass']}
              options={EVIDENCE_CLASSES.map((e) => [e, EVIDENCE_LABELS[e], EVIDENCE_DESCRIPTIONS[e]])}
            />
            <EnumSelect label="Role" value={draft.role} onChange={(v) => set('role', v)} error={errors['incident.role']} options={ROLES.map((r) => [r, ROLE_LABELS[r], ROLE_DESCRIPTIONS[r]])} />
            <EnumSelect
              label="Attribution"
              value={draft.attributionConfidence}
              onChange={(v) => set('attributionConfidence', v)}
              error={errors['incident.attributionConfidence']}
              options={ATTRIBUTION.map((a) => [a, a[0].toUpperCase() + a.slice(1), ATTRIBUTION_DESCRIPTIONS[a]])}
            />
          </div>
          <p className={f.hint}>
            Definitions are on the <Link to="/methodology">methodology</Link> page.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="sec-sources">
          <h2 id="sec-sources" className={styles.h2}>
            Sources
          </h2>
          {errors['incident.sources'] ? <p className={f.error}>{errors['incident.sources']}</p> : null}
          <div className={styles.repeat}>
            {draft.sources.map((s, i) => (
              <fieldset key={s.key} className={styles.item}>
                <legend className={styles.itemLegend}>Source {i + 1}</legend>
                <div className={styles.grid}>
                  <Field label="Title" error={errors[`incident.sources.${i}.title`]}>
                    {(p) => <input {...p} type="text" className={f.input} value={s.title} onChange={(e) => updateSource(s.key, { title: e.target.value })} />}
                  </Field>
                  <Field label="URL" error={errors[`incident.sources.${i}.url`]} hint="https only.">
                    {(p) => <input {...p} type="url" inputMode="url" placeholder="https://" className={f.input} value={s.url} onChange={(e) => updateSource(s.key, { url: e.target.value })} />}
                  </Field>
                  <Field label="Publisher" error={errors[`incident.sources.${i}.publisher`]}>
                    {(p) => <input {...p} type="text" className={f.input} value={s.publisher} onChange={(e) => updateSource(s.key, { publisher: e.target.value })} />}
                  </Field>
                  <Field label="Published" error={errors[`incident.sources.${i}.date`]}>
                    {(p) => <input {...p} type="date" className={f.input} value={s.date} onChange={(e) => updateSource(s.key, { date: e.target.value })} />}
                  </Field>
                </div>
                {draft.sources.length > 1 ? (
                  <button type="button" className={f.linkBtn} onClick={() => setDraft((d) => ({ ...d, sources: d.sources.filter((x) => x.key !== s.key) }))}>
                    Remove source {i + 1}
                  </button>
                ) : null}
              </fieldset>
            ))}
          </div>
          <div>
            <button type="button" className={f.btn} onClick={() => setDraft((d) => ({ ...d, sources: [...d.sources, newSource()] }))}>
              + Add source
            </button>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="sec-extra">
          <h2 id="sec-extra" className={styles.h2}>
            For the clerk
          </h2>
          <Field label="Tags" optional error={errors['incident.tags']} hint="Comma-separated, e.g. agentic, coding-assistant.">
            {(p) => <input {...p} type="text" className={f.input} value={draft.tags} onChange={(e) => set('tags', e.target.value)} />}
          </Field>
          <Field label="Note to reviewers" optional hint="Anything that helps verify the entry. Not published.">
            {(p) => <textarea {...p} className={f.textarea} rows={3} value={draft.note} onChange={(e) => set('note', e.target.value)} />}
          </Field>
          <Field label="Contact" optional hint="An email or handle, in case we have questions. Not published.">
            {(p) => <input {...p} type="text" autoComplete="email" className={f.input} value={draft.contact} onChange={(e) => set('contact', e.target.value)} />}
          </Field>
          <div className={f.trap} aria-hidden="true">
            <label>
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={draft.website} onChange={(e) => set('website', e.target.value)} />
            </label>
          </div>
        </section>

        <div className={styles.actions}>
          <button type="submit" className={`${f.btn} ${f.primary}`} disabled={submitting}>
            {submitting ? 'Filing…' : 'File submission'}
          </button>
          <span className={f.hint}>Submissions are limited to five an hour.</span>
        </div>
      </form>
    </div>
  )
}

type ControlProps = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }

function Field({
  label,
  hint,
  error,
  optional,
  counter,
  children,
}: {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  counter?: [number, number]
  children: (props: ControlProps) => ReactNode
}) {
  const id = useId()
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={f.field}>
      <label className={f.label} htmlFor={id}>
        {label}
        {optional ? <span className={f.optional}>optional</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {counter ? (
        <span className={`${f.counter} mono ${counter[0] > counter[1] ? f.counterOver : ''}`} aria-hidden="true">
          {counter[0]}/{counter[1]}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-err`} className={f.error}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={`${id}-hint`} className={f.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/** A fieldset of checkboxes with a legend, an error, and a hint. */
function Group({ label, hint, error, optional, children }: { label: string; hint?: string; error?: string; optional?: boolean; children: ReactNode }) {
  const id = useId()
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  return (
    <fieldset className={styles.group} aria-describedby={describedBy}>
      <legend className={f.label}>
        {label}
        {optional ? <span className={f.optional}>optional</span> : null}
      </legend>
      {hint ? (
        <span id={`${id}-hint`} className={f.hint}>
          {hint}
        </span>
      ) : null}
      {children}
      {error ? (
        <span id={`${id}-err`} className={f.error}>
          {error}
        </span>
      ) : null}
    </fieldset>
  )
}

function EnumSelect({ label, value, onChange, error, options }: { label: string; value: string; onChange: (v: string) => void; error?: string; options: [string, string, string][] }) {
  const desc = options.find(([v]) => v === value)?.[2]
  return (
    <Field label={label} error={error} hint={desc ?? 'Choose one.'}>
      {(p) => (
        <select {...p} className={f.select} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}
