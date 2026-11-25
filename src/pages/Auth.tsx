import { useState } from 'react'
import { DEMO_EMAIL, resetLinkError, supabase } from '../lib/supabase'
import { btnPrimary, input, label } from '../components/ui'
import { Icon } from '../components/Icon'

// Single-user app: sign-in only. The one account is provisioned on the backend.
export function AuthPage() {
  const [email, setEmail] = useState(DEMO_EMAIL)
  const [password, setPassword] = useState('Duckburg2026!')
  // A reset link that came back refused — used already, or expired.
  const [error, setError] = useState<string | null>(
    resetLinkError ? `That reset link didn’t work (${resetLinkError.toLowerCase()}). Ask for a new one below.` : null,
  )
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(!!resetLinkError)
  const [sent, setSent] = useState(false)

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Back to this app, wherever it's running — not the Supabase project's
    // default address, which belongs to another site.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  if (forgot) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold text-center">Reset your password</h1>
          <form onSubmit={sendReset} className="space-y-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
            {sent ? (
              <p className="text-sm text-slate-300">
                If <strong>{email.trim()}</strong> has an account, a reset email is on its way. Open the link in the{' '}
                <strong>newest</strong> email, once, within the hour — it brings you back here to choose a new password.
              </p>
            ) : (
              <>
                <div>
                  <span className={label}>Email</span>
                  <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
                  {busy ? 'Sending…' : 'Email me a reset link'}
                </button>
              </>
            )}
          </form>
          <button
            className="block mx-auto text-sm text-indigo-400 hover:underline"
            onClick={() => {
              setForgot(false)
              setSent(false)
              setError(null)
            }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

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
          <button
            type="button"
            className="block mx-auto text-sm text-indigo-400 hover:underline"
            onClick={() => {
              if (email === DEMO_EMAIL) setEmail('')
              setError(null)
              setForgot(true)
            }}
          >
            Forgot password?
          </button>
        </form>
        <p className="text-center text-xs text-slate-600 mt-4">Your private relationship database — only you can see it.</p>
        <p className="text-center text-xs text-slate-700 mt-1">
          Demo login prefilled — clear the fields and sign in with your own account instead.
        </p>
      </div>
    </div>
  )
}
