import { Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { ScrollToTop } from './components/ScrollToTop'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { IncidentsPage } from './pages/IncidentsPage'
import { IncidentPage } from './pages/IncidentPage'
import { MethodologyPage } from './pages/MethodologyPage'
import { AboutPage } from './pages/AboutPage'
import { NotFoundPage } from './pages/NotFoundPage'
import styles from './App.module.css'

export default function App() {
  return (
    <div className={styles.shell}>
      <ScrollToTop />
      <Header />
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/docket" element={<IncidentsPage />} />
          <Route path="/docket/:id" element={<IncidentPage />} />
          <Route path="/methodology" element={<MethodologyPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
