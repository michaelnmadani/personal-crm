import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { btnPrimary, input, label } from '../components/ui'
import { Icon } from '../components/Icon'

// Single-user app: sign-in only. The one account is provisioned on the backend.
export function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 grid place-items-center">
            <Icon name="users" className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold">Personal CRM</h1>
        </div>
        <form onSubmit={submit} className="space-y-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div>
            <span className={label}>Email</span>
            <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <span className={label}>Password</span>
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-xs text-slate-600 mt-4">Your private relationship database — only you can see it.</p>
      </div>
    </div>
  )
}
