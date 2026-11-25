import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { btnPrimary, input, label } from './ui'

/**
 * Choose a new password for the signed-in account — after following a reset
 * email, or from Settings. Typed twice, so a slip of the finger can't lock
 * the account.
 */
export function NewPasswordForm({
  onDone,
  submitLabel = 'Save new password',
  autoFocus = false,
}: {
  onDone: () => void
  submitLabel?: string
  autoFocus?: boolean
}) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== again) return setError('The two passwords don’t match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    setPassword('')
    setAgain('')
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <span className={label}>New password</span>
        <input type="password" autoComplete="new-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={autoFocus} />
      </div>
      <div>
        <span className={label}>Type it again</span>
        <input type="password" autoComplete="new-password" className={input} value={again} onChange={(e) => setAgain(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

/** The whole screen shown on returning from a reset email, before anything else. */
export function ResetPasswordPage({ onDone }: { onDone: () => void }) {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-center">Choose a new password</h1>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <NewPasswordForm onDone={onDone} autoFocus />
        </div>
      </div>
    </div>
  )
}
