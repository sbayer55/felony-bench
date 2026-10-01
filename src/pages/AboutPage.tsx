import { Link } from 'react-router-dom'
import { REPO_URL } from '../data'

export function AboutPage() {
  return (
    <div className="container prose">
      <h1>About Felony Bench</h1>
      <p>
        Every week a new benchmark arrives, a model tops it, and the benchmark is declared saturated. Felony Bench is the
        benchmark that cannot saturate. There is no ceiling on the number of documented incidents in which a language model
        broke into something, leaked something, lied to someone, deleted something, or helped a human do one of those things.
        The number only goes up.
      </p>
      <p>
        The site tracks a single metric, the Felony Score, by model and by provider. It is built like a real leaderboard,
        with sortable columns, evidence badges, and a methodology page, because the format is funnier when the content is
        real. And the content is real: every entry on the <Link to="/docket">docket</Link> links to a primary or reputable
        secondary source, uses attributive language, and is tagged with how we know about it.
      </p>

      <h2>Is this serious?</h2>
      <p>
        The tone is not. The data is. No model or provider listed here has been charged with or convicted of anything, and
        the <Link to="/methodology">methodology</Link> says so in the first paragraph. The incidents are documented by the
        providers themselves, by courts, by regulators, by police, and by the press. We collected them and gave them a score.
      </p>
      <p>
        If a lab publishes a candid system card describing how its model tried to blackmail an engineer in a test, that lab
        earns points on this board. That is a perverse incentive and we are aware of it. Treat a high evaluation-class score
        as evidence of a lab that tests and tells, and use the "Outside the lab" filter when you want to know what has
        actually happened in the world.
      </p>

      <h2>Open data</h2>
      <p>
        The docket is three JSON files in a public repository. Pull requests that add a sourced incident or correct an
        existing one are welcome. A daily job searches for new incidents and appends what it can verify.
      </p>
      <p>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>

      <h2>Contact</h2>
      <p>
        Corrections, additions, and complaints go through{' '}
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
          GitHub issues
        </a>
        . If you represent a provider on this list and believe an entry misstates its source, open an issue and quote the
        source. Entries that do not survive contact with their own citation are removed.
      </p>
    </div>
  )
}
