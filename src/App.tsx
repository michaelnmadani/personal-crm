import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { arrivedFromReset, supabase } from './lib/supabase'
import { ResetPasswordPage } from './components/NewPassword'
import { AuthPage } from './pages/Auth'
import { Layout } from './components/Layout'
import { CatchUp } from './pages/CatchUp'
import { Contacts } from './pages/Contacts'
import { ContactProfile } from './pages/ContactProfile'
import { Network } from './pages/Network'
import { GroupDetail, Groups } from './pages/Groups'
import { Import } from './pages/Import'
import { Reminders } from './pages/Reminders'
import { Settings } from './pages/Settings'
import { Capture } from './pages/Capture'
import { Inbox } from './pages/Inbox'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  // Back from a password-reset email: signed in by the link, but a new
  // password has to be chosen before anything else.
  const [resetting, setResetting] = useState(arrivedFromReset)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setResetting(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>
  }
  if (!session) return <AuthPage />
  if (resetting) return <ResetPasswordPage onDone={() => setResetting(false)} />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatchUp />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactProfile />} />
        <Route path="network" element={<Network />} />
        <Route path="groups" element={<Groups />} />
        <Route path="groups/:id" element={<GroupDetail />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="capture" element={<Capture />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="import" element={<Import />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
