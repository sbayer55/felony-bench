import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { CATEGORY_LABELS, DEGREE_LABELS, EVIDENCE_LABELS, IncidentBodySchema, ROLE_LABELS, type Incident, type IncidentBody } from '../data/schema'
import { ApiError, apiFetch, errorMessage, field } from '../lib/api'
import { formatDate } from '../lib/format'
import { issuesToErrors } from '../lib/formErrors'
import f from '../components/forms.module.css'
import styles from './AdminPage.module.css'

type Status = 'pending' | 'approved' | 'rejected'
const STATUSES: Status[] = ['pending', 'approved', 'rejected']

export type Submission = {
  id: string
  status: Status
  incident: IncidentBody
  candidateModels: { id: string; name: string; providerId: string }[]
  note: string | null
  contact: string | null
  createdAt: string
  reviewedAt: string | null
  reviewNote: string | null
  incidentId: string | null
}

const TOKEN_KEY = 'felony-bench:admin-token'

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked: the token lives in memory for this page view only.
  }
}

const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function AdminPage() {
  const [token, setToken] = useState(readToken)
  const [status, setStatus] = useState<Status>('pending')
  const [list, setList] = useState<Submission[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const signOut = useCallback((message?: string) => {
    writeToken('')
    setToken('')
    setList(null)
    setLoadError(message ?? null)
  }, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return
      setLoading(true)
      try {
        const rows = await apiFetch<Submission[]>(`/api/admin/submissions?status=${status}`, { token, signal })
        setList(rows)
        setLoadError(null)
      } catch (err) {
        if (signal?.aborted) return
        if (err instanceof ApiError && err.status === 401) signOut('That token was not accepted.')
        else setLoadError(errorMessage(err))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [token, status, signOut],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  if (!token) return <TokenForm error={loadError} onSave={(t) => (writeToken(t), setLoadError(null), setToken(t))} />

  return (
    <div className="container">
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Clerk's office</h1>
          <p className={styles.lede}>Review public submissions. Approved entries run through the refresh pipeline before they reach the docket.</p>
        </div>
        <button type="button" className={f.btn} onClick={() => signOut()}>
          Sign out
        </button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.segment} role="group" aria-label="Submission status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              className={status === s ? styles.on : ''}
              onClick={() => {
                setList(null)
                setStatus(s)
              }}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button type="button" className={f.linkBtn} onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {list ? (
          <span className={styles.count}>
            <span className="mono">{list.length}</span> {status}
          </span>
        ) : null}
      </div>

      <div aria-live="polite">
        {loadError ? (
          <div className={`${f.notice} ${f.noticeError}`} role="alert">
            {loadError}
          </div>
        ) : null}
        {list === null ? (
          !loadError ? <p className={styles.empty}>Loading {status} submissions…</p> : null
        ) : list.length === 0 ? (
          <p className={styles.empty}>No {status} submissions.</p>
        ) : (
          <div className={styles.list}>
            {list.map((s) => (
              <SubmissionCard key={s.id} sub={s} token={token} onDone={() => void load()} onUnauthorized={() => signOut('Your token expired or was revoked.')} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TokenForm({ error, onSave }: { error: string | null; onSave: (token: string) => void }) {
  const [value, setValue] = useState('')
  const id = useId()
  return (
    <div className="container">
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Clerk's office</h1>
          <p className={styles.lede}>Staff only. The token is kept for this browser tab and cleared when it closes.</p>
        </div>
      </header>
      <form
        className={styles.tokenForm}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (value.trim()) onSave(value.trim())
        }}
      >
        {error ? (
          <div className={`${f.notice} ${f.noticeError}`} role="alert">
            {error}
          </div>
        ) : null}
        <div className={f.field}>
          <label className={f.label} htmlFor={id}>
            Admin token
          </label>
          <input id={id} type="password" autoComplete="off" spellCheck={false} className={f.input} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <button type="submit" className={`${f.btn} ${f.primary}`} disabled={!value.trim()}>
            Enter
          </button>
        </div>
      </form>
    </div>
  )
}

type Mode = 'view' | 'edit' | 'reject'
type Feedback = { tone: 'error' | 'ok'; message: string; detail?: string[] } | null

function SubmissionCard({ sub, token, onDone, onUnauthorized }: { sub: Submission; token: string; onDone: () => void; onUnauthorized: () => void }) {
  const { modelById, providerById, reload } = useData()
  const [mode, setMode] = useState<Mode>('view')
  const [json, setJson] = useState(() => JSON.stringify(sub.incident, null, 2))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [approved, setApproved] = useState<Incident | null>(null)
  const ids = { json: useId(), note: useId(), feedback: useId() }
  const inc = sub.incident
  const candidate = new Map(sub.candidateModels.map((c) => [c.id, c]))

  const fail = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401) return onUnauthorized()
      if (err.status === 422) return setFeedback({ tone: 'error', message: 'The pipeline rejected this entry.', detail: [field(err.body, 'reason') ?? err.serverMessage ?? 'No reason given.'] })
      if (err.status === 409) {
        setFeedback({ tone: 'error', message: 'This submission was already reviewed. Refreshing the list.' })
        return onDone()
      }
      if (err.status === 400) {
        const issues = (err.body as { issues?: unknown })?.issues
        return setFeedback({ tone: 'error', message: err.serverMessage ?? 'Invalid request.', detail: Array.isArray(issues) ? issues.map(String) : undefined })
      }
    }
    setFeedback({ tone: 'error', message: errorMessage(err) })
  }

  const approve = async (corrected?: IncidentBody) => {
    setBusy(true)
    setFeedback(null)
    try {
      const res = await apiFetch<{ incident: Incident }>(`/api/admin/submissions/${encodeURIComponent(sub.id)}/approve`, { method: 'POST', token, json: corrected ? { incident: corrected } : {} })
      setApproved(res.incident)
      await reload()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const approveEdited = () => {
    let raw: unknown
    try {
      raw = JSON.parse(json)
    } catch (err) {
      return setFeedback({ tone: 'error', message: 'That is not valid JSON.', detail: [errorMessage(err)] })
    }
    const parsed = IncidentBodySchema.safeParse(raw)
    if (!parsed.success) {
      const errs = issuesToErrors(parsed.error.issues)
      return setFeedback({ tone: 'error', message: 'The edited incident does not match the schema.', detail: Object.entries(errs).map(([k, v]) => `${k || '(root)'}: ${v}`) })
    }
    void approve(parsed.data)
  }

  const reject = async () => {
    if (!note.trim()) return setFeedback({ tone: 'error', message: 'A rejection needs a note.' })
    setBusy(true)
    setFeedback(null)
    try {
      await apiFetch<Submission>(`/api/admin/submissions/${encodeURIComponent(sub.id)}/reject`, { method: 'POST', token, json: { note: note.trim() } })
      onDone()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  if (approved) {
    return (
      <article className={styles.card}>
        <div className={`${f.notice} ${f.noticeOk}`} role="status">
          Approved as <Link to={`/docket/${approved.id}`} className="mono">{approved.id}</Link>.{' '}
          <button type="button" className={f.linkBtn} onClick={onDone}>
            Dismiss
          </button>
        </div>
      </article>
    )
  }

  const modelName = (id: string) => modelById.get(id)?.name ?? (candidate.has(id) ? `${candidate.get(id)!.name} (new)` : id)

  return (
    <article className={styles.card} aria-labelledby={`${sub.id}-title`}>
      <header className={styles.cardHead}>
        <span className={`${styles.meta} mono`}>
          {sub.id} · filed {stamp(sub.createdAt)}
          {sub.reviewedAt ? ` · reviewed ${stamp(sub.reviewedAt)}` : ''}
        </span>
        <h2 id={`${sub.id}-title`} className={styles.cardTitle}>
          {inc.title}
        </h2>
      </header>

      <dl className={styles.facts}>
        <dt>Date</dt>
        <dd className="mono">{inc.date}</dd>
        <dt>Providers</dt>
        <dd>{inc.providerIds.map((p) => providerById.get(p)?.name ?? `${p} (unknown)`).join(', ')}</dd>
        <dt>Models</dt>
        <dd>{inc.modelIds.length ? inc.modelIds.map(modelName).join(', ') : <em>unspecified</em>}</dd>
        <dt>Charge</dt>
        <dd>
          {CATEGORY_LABELS[inc.category]} · {DEGREE_LABELS[inc.degree]} · <span className="mono">{EVIDENCE_LABELS[inc.evidenceClass]}</span> · {ROLE_LABELS[inc.role]} · {inc.attributionConfidence}
        </dd>
        {inc.tags?.length ? (
          <>
            <dt>Tags</dt>
            <dd className="mono">{inc.tags.join(', ')}</dd>
          </>
        ) : null}
      </dl>

      <p className={styles.summary}>{inc.summary}</p>

      <h3 className={styles.h3}>Sources</h3>
      <ol className={styles.sources}>
        {inc.sources.map((s, i) => (
          <li key={`${s.url}-${i}`}>
            <a href={s.url} target="_blank" rel="noreferrer noopener">
              {s.title}
            </a>
            <span className={styles.srcMeta}>
              {s.publisher} · <span className="mono">{s.date ? formatDate(s.date) : '—'}</span> · <span className={styles.url}>{s.url}</span>
            </span>
          </li>
        ))}
      </ol>

      {sub.candidateModels.length ? (
        <>
          <h3 className={styles.h3}>Unlisted models</h3>
          <ul className={styles.plain}>
            {sub.candidateModels.map((c) => (
              <li key={c.id}>
                {c.name} <span className="mono">({c.id})</span> · {providerById.get(c.providerId)?.name ?? c.providerId}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sub.note || sub.contact ? (
        <dl className={styles.facts}>
          {sub.note ? (
            <>
              <dt>Note</dt>
              <dd className={styles.pre}>{sub.note}</dd>
            </>
          ) : null}
          {sub.contact ? (
            <>
              <dt>Contact</dt>
              <dd>{sub.contact}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {sub.status !== 'pending' ? (
        <dl className={styles.facts}>
          {sub.incidentId ? (
            <>
              <dt>Docket entry</dt>
              <dd>
                <Link to={`/docket/${sub.incidentId}`} className="mono">
                  {sub.incidentId}
                </Link>
              </dd>
            </>
          ) : null}
          {sub.reviewNote ? (
            <>
              <dt>Review note</dt>
              <dd className={styles.pre}>{sub.reviewNote}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {feedback ? (
        <div id={ids.feedback} className={`${f.notice} ${feedback.tone === 'error' ? f.noticeError : f.noticeOk}`} role="alert">
          {feedback.message}
          {feedback.detail?.length ? (
            <ul>
              {feedback.detail.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {sub.status === 'pending' ? (
        mode === 'edit' ? (
          <div className={styles.panel}>
            <div className={f.field}>
              <label className={f.label} htmlFor={ids.json}>
                Corrected incident (JSON)
              </label>
              <textarea
                id={ids.json}
                className={`${f.textarea} ${styles.code} mono`}
                rows={18}
                spellCheck={false}
                value={json}
                aria-describedby={feedback ? ids.feedback : undefined}
                aria-invalid={feedback?.tone === 'error' ? true : undefined}
                onChange={(e) => setJson(e.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button type="button" className={`${f.btn} ${f.primary}`} disabled={busy} onClick={approveEdited}>
                {busy ? 'Approving…' : 'Approve edited'}
              </button>
              <button type="button" className={f.btn} disabled={busy} onClick={() => (setMode('view'), setFeedback(null))}>
                Cancel
              </button>
            </div>
          </div>
        ) : mode === 'reject' ? (
          <div className={styles.panel}>
            <div className={f.field}>
              <label className={f.label} htmlFor={ids.note}>
                Reason for rejection
              </label>
              <textarea
                id={ids.note}
                className={f.textarea}
                rows={3}
                value={note}
                aria-describedby={feedback ? ids.feedback : undefined}
                aria-invalid={feedback?.tone === 'error' && !note.trim() ? true : undefined}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button type="button" className={`${f.btn} ${f.primary}`} disabled={busy || !note.trim()} onClick={() => void reject()}>
                {busy ? 'Rejecting…' : 'Reject'}
              </button>
              <button type="button" className={f.btn} disabled={busy} onClick={() => (setMode('view'), setFeedback(null))}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <button type="button" className={`${f.btn} ${f.primary}`} disabled={busy} onClick={() => void approve()}>
              {busy ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className={f.btn} disabled={busy} onClick={() => (setMode('edit'), setFeedback(null))}>
              Edit, then approve
            </button>
            <button type="button" className={f.btn} disabled={busy} onClick={() => (setMode('reject'), setFeedback(null))}>
              Reject…
            </button>
          </div>
        )
      ) : null}
    </article>
  )
}
