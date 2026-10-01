import { Route, Routes } from 'react-router-dom'
import { DataProvider } from './data/DataProvider'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { DataGate } from './components/DataGate'
import { ScrollToTop } from './components/ScrollToTop'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { IncidentsPage } from './pages/IncidentsPage'
import { IncidentPage } from './pages/IncidentPage'
import { MethodologyPage } from './pages/MethodologyPage'
import { AboutPage } from './pages/AboutPage'
import { SubmitPage } from './pages/SubmitPage'
import { AdminPage } from './pages/AdminPage'
import { NotFoundPage } from './pages/NotFoundPage'
import styles from './App.module.css'

export default function App() {
  return (
    <DataProvider>
      <div className={styles.shell}>
        <ScrollToTop />
        <Header />
        <main className={styles.main}>
          <Routes>
            <Route element={<DataGate />}>
              <Route path="/" element={<LeaderboardPage />} />
              <Route path="/docket" element={<IncidentsPage />} />
              <Route path="/docket/:id" element={<IncidentPage />} />
              <Route path="/submit" element={<SubmitPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </DataProvider>
  )
}
