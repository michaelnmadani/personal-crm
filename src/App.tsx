import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { AuthPage } from './pages/Auth'
import { Layout } from './components/Layout'
import { Today } from './pages/Today'
import { Contacts } from './pages/Contacts'
import { ContactProfile } from './pages/ContactProfile'
import { Reminders } from './pages/Reminders'
import { Settings } from './pages/Settings'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>
  }
  if (!session) return <AuthPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactProfile />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
