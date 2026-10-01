import { Link } from 'react-router-dom'
import { ACTIONS_URL, REPO_URL } from '../data'
import {
  CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  DEGREES,
  DEGREE_DESCRIPTIONS,
  DEGREE_LABELS,
  EVIDENCE_CLASSES,
  EVIDENCE_DESCRIPTIONS,
  EVIDENCE_LABELS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '../data/schema'

export function MethodologyPage() {
  return (
    <div className="container prose">
      <h1>Methodology</h1>
      <p>
        Felony Bench tracks one benchmark: documented criminal and criminal-adjacent conduct attributed to large language
        models. It is scored by model and by provider. Unlike other leaderboards, the score you want is zero.
      </p>

      <h2>The legal personhood problem</h2>
      <p>
        No large language model has ever been charged with, let alone convicted of, a crime. Models are not legal persons.
        They cannot form intent, be arrested, or be sentenced. Strictly scored, every model on this site is tied at 0.00 and
        the leaderboard is a list of names.
      </p>
      <p>
        So the bench scores conduct, not convictions. An incident qualifies when a model's output or action, in production
        or in a controlled evaluation, matches the shape of a felony if a human had done it: breaking into systems, exposing
        data, escaping containment, lying to its operator, destroying records, blackmail, inventing evidence that was then
        relied upon, or materially helping a human commit a crime that was then investigated or prosecuted. Civil rulings and
        regulatory fines are logged too, at the lowest degree, because they are findings of fact by a court or regulator.
      </p>

      <h2>Scoring</h2>
      <p>
        Every incident carries a <strong>degree</strong> from 1 to 3. A model's <strong>Felony Score</strong> is the sum of
        the degrees of every incident that names it. A provider's score is the sum over incidents that name the provider;
        an incident that names three of a provider's models still counts once for the provider.
      </p>
      <pre>
        <code>{`score(model)    = Σ degree(i)   for i in incidents where model ∈ i.modelIds
score(provider) = Σ degree(i)   for i in incidents where provider ∈ i.providerIds`}</code>
      </pre>
      <p>
        Ranks use competition ranking: equal scores share a rank and the next rank is skipped. Models with no incidents are
        unranked and marked as having a clean record, with the understanding that this is a statement about the record.
      </p>

      <h3>Degrees</h3>
      <table>
        <thead>
          <tr>
            <th>Degree</th>
            <th>Weight</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {[...DEGREES].reverse().map((d) => (
            <tr key={d}>
              <td>{DEGREE_LABELS[d]}</td>
              <td className="mono">{d}</td>
              <td>{DEGREE_DESCRIPTIONS[d]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Charges</h3>
      <table>
        <thead>
          <tr>
            <th>Charge</th>
            <th>Definition</th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => (
            <tr key={c}>
              <td>{CATEGORY_LABELS[c]}</td>
              <td>{CATEGORY_DESCRIPTIONS[c]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Evidence classes</h3>
      <p>
        Every incident is tagged with how we know about it. The leaderboard filter "Outside the lab" hides evaluation-only
        incidents, which is the honest view of what has actually happened to someone.
      </p>
      <table>
        <thead>
          <tr>
            <th>Class</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {EVIDENCE_CLASSES.map((e) => (
            <tr key={e}>
              <td className="mono">{EVIDENCE_LABELS[e]}</td>
              <td>{EVIDENCE_DESCRIPTIONS[e]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Roles</h3>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => (
            <tr key={r}>
              <td>{ROLE_LABELS[r]}</td>
              <td>{ROLE_DESCRIPTIONS[r]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Sourcing rules</h2>
      <ul>
        <li>Every incident has at least one source with an https URL. The source must say what the entry says.</li>
        <li>
          Summaries use attributive language: "according to", "reported", "the system card states". The bench reports what
          others documented. It does not allege.
        </li>
        <li>
          Primary sources are preferred: the provider's own system card or report, a court filing, a regulator's press
          release, a police statement. Reputable secondary sources are acceptable when a primary is unavailable.
        </li>
        <li>Each source URL may be cited by only one incident. A single story is one entry, not several.</li>
        <li>Anything that cannot be sourced is dropped, not estimated.</li>
      </ul>

      <h2>How the docket is refreshed</h2>
      <p>
        A GitHub Actions workflow runs once a day. It asks a Claude model with web search to look for new, sourced incidents,
        then runs the candidates through deterministic checks: schema validation, duplicate detection against the existing
        docket, a live fetch of every source URL, and a check that every provider and model is on the roster. At most ten
        incidents are added per run. The job is append-only: it never edits or removes an existing entry. What passes is
        committed to <code>main</code> and the site redeploys.
      </p>
      <p>
        Anyone can trigger a refresh by hand from the{' '}
        <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
          Actions page
        </a>{' '}
        with "Run workflow", or with the GitHub CLI:
      </p>
      <pre>
        <code>gh workflow run refresh.yml -f max=10</code>
      </pre>
      <p>
        To preview locally without writing anything, set <code>ANTHROPIC_API_KEY</code> and run <code>pnpm refresh --dry-run</code>.
      </p>

      <h2 id="submit">Submit a felony</h2>
      <ol>
        <li>
          Fork <a href={REPO_URL} target="_blank" rel="noreferrer">the repository</a>.
        </li>
        <li>
          Add an entry to <code>src/data/incidents.json</code>. If the model is not on the roster, add it to <code>src/data/models.json</code> too.
        </li>
        <li>
          Run <code>pnpm check</code>. It validates the schema, the roster references, and the source URLs.
        </li>
        <li>Open a pull request. Link the source in the description.</li>
      </ol>
      <p>
        Corrections to existing entries follow the same path, or <a href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer">open an issue</a>.
      </p>

      <h2>What this is not</h2>
      <p>
        This is not a safety evaluation, a risk index, or legal advice. A high score means a model has been written about
        more, is used more, or is tested more honestly by its maker. Labs that publish detailed system cards accrue
        evaluation-class incidents that quieter labs never report. Read the <Link to="/docket">docket</Link>, not the number.
      </p>
    </div>
  )
}
