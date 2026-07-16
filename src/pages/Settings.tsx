import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { api } from '../lib/hooks'
import { download } from '../lib/utils'
import { btnGhost, btnPrimary, card } from '../components/ui'

export function Settings() {
  const [exporting, setExporting] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, [])

  const exportAll = async () => {
    setExporting(true)
    try {
      const data = await api.exportAll()
      download(`personal-crm-export-${format(new Date(), 'yyyy-MM-dd')}.json`, JSON.stringify(data, null, 2))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className={`${card} p-4 space-y-3`}>
        <h2 className="text-sm font-semibold text-slate-300">Account</h2>
        <p className="text-sm text-slate-400">{userEmail || '…'}</p>
        <button className={btnGhost} onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>

      <section className={`${card} p-4 space-y-3`}>
        <h2 className="text-sm font-semibold text-slate-300">Your data</h2>
        <p className="text-sm text-slate-400">
          Download everything — contacts, notes, reminders, relationships — as a single JSON file. Your data is never locked in.
        </p>
        <button className={btnPrimary} onClick={exportAll} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export all data'}
        </button>
      </section>

      <section className={`${card} p-4 space-y-2`}>
        <h2 className="text-sm font-semibold text-slate-300">This device</h2>
        {window.desktop?.isDesktop ? (
          <p className="text-sm text-slate-400">
            Running as the desktop app (Electron {window.desktop.electron}). It updates itself
            automatically — you’ll be prompted to restart when a new version is ready.
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            <strong>Phone:</strong> open this site in Safari/Chrome → Share → “Add to Home Screen”.
            <br />
            <strong>Mac / PC:</strong> install the desktop app from the latest release, or use your
            browser’s “Install app” option.
          </p>
        )}
      </section>
    </div>
  )
}
