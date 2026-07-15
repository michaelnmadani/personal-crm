import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { btnPrimary, input, label } from '../components/ui'
import { Icon } from '../components/Icon'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    else if (mode === 'signup') setInfo('Account created. If email confirmation is on, check your inbox — otherwise sign in.')
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
            <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-400">{info}</p>}
          <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            className="w-full text-center text-xs text-slate-400 hover:text-slate-200"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'First time? Create your account' : 'Already set up? Sign in'}
          </button>
        </form>
        <p className="text-center text-xs text-slate-600 mt-4">Your private relationship database — only you can see it.</p>
      </div>
    </div>
  )
}
