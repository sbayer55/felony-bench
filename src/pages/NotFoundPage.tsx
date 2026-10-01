import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="container prose">
      <h1>Case not found</h1>
      <p>There is no record at this address. Charges may have been dropped, or the URL is wrong.</p>
      <p>
        <Link to="/">Back to the leaderboard</Link>
      </p>
    </div>
  )
}
