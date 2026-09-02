import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { btnPrimary, btnGhost, input, label } from '../components/ui'
import { Icon } from '../components/Icon'

// The public, read-only DuckTales account. Its credentials are deliberately in
// the client bundle: it exists so anyone with the link can look around, and it
// cannot write anything (see the demo policies in the migrations).
const DEMO_EMAIL = 'demo@ducktales-crm.com'
const DEMO_PASSWORD = 'Duckburg2026!'

// Sign-in only — accounts are provisioned on the backend, not from here.
export function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signIn = async (addr: string, pass: string) => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: addr, password: pass })
    // Supabase returns the same opaque error for a wrong password and an unknown
    // address; say so plainly rather than showing "Invalid login credentials".
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? "That email and password don't match an account."
          : error.message,
      )
    }
    setBusy(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void signIn(email.trim(), password)
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
            <input
              type="email"
              className={input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div>
            <span className={label}>Password</span>
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="flex items-center gap-3 pt-1">
            <span className="h-px flex-1 bg-slate-800" />
            <span className="text-xs text-slate-600">or</span>
            <span className="h-px flex-1 bg-slate-800" />
          </div>

          <button
            type="button"
            className={`${btnGhost} w-full border border-slate-700`}
            disabled={busy}
            onClick={() => void signIn(DEMO_EMAIL, DEMO_PASSWORD)}
          >
            Try the DuckTales demo
          </button>
        </form>
        <p className="text-center text-xs text-slate-600 mt-4">Your private relationship database — only you can see it.</p>
        <p className="text-center text-xs text-slate-700 mt-1">
          The demo is Scrooge McDuck's network, and it's read-only.
        </p>
      </div>
    </div>
  )
}
