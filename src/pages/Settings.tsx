import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { api } from '../lib/hooks'
import { download } from '../lib/utils'
import { applyTheme, currentTheme, THEME_SWATCH, THEMES, type Theme } from '../lib/theme'
import { Icon } from '../components/Icon'
import { btnGhost, btnPrimary, card } from '../components/ui'

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  business: 'Business',
  christmas: 'Christmas',
  anime: 'Anime',
  forest: 'Forest',
  ocean: 'Ocean',
}

export function Settings() {
  const [exporting, setExporting] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, [])

  const pickTheme = (t: Theme) => {
    setTheme(t)
    applyTheme(t)
  }

  /**
   * Force the newest build. The app is a PWA, so a plain reload can be served
   * entirely from the service worker's precache — which is why a normal refresh
   * sometimes still shows the old version. Tear the worker and its caches down
   * first, then reload so everything is fetched from the network again.
   */
  const hardRefresh = async () => {
    setRefreshing(true)
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      // Even if clearing fails, still reload — worst case it's a normal refresh.
    }
    window.location.reload()
  }

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
        <h2 className="text-sm font-semibold text-slate-300">Theme</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {THEMES.map((t) => {
            const [bg, accent] = THEME_SWATCH[t]
            const active = theme === t
            return (
              <button
                key={t}
                onClick={() => pickTheme(t)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  active ? 'border-indigo-500 bg-indigo-600/15 text-slate-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span
                  className="w-5 h-5 rounded-full border border-black/20 shrink-0"
                  style={{ background: `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)` }}
                />
                {THEME_LABELS[t]}
                {t === 'dark' && <span className="text-[10px] text-slate-500">default</span>}
              </button>
            )
          })}
        </div>
      </section>

      <section className={`${card} p-4 space-y-3`}>
        <h2 className="text-sm font-semibold text-slate-300">Account</h2>
        <p className="text-sm text-slate-400">{userEmail || '…'}</p>
        <button className={btnGhost} onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>

      <section className={`${card} p-4 space-y-3`}>
        <h2 className="text-sm font-semibold text-slate-300">Import & export</h2>
        <p className="text-sm text-slate-400">
          Bring in your LinkedIn connections or any contacts CSV, or download everything as JSON. Your data is never locked in.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/import" className={btnPrimary}>
            <Icon name="upload" className="w-4 h-4" /> Import contacts (CSV)
          </Link>
          <button className={btnGhost} onClick={exportAll} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export all data'}
          </button>
        </div>
      </section>

      <section className={`${card} p-4 space-y-3`}>
        <h2 className="text-sm font-semibold text-slate-300">App version</h2>
        <p className="text-sm text-slate-400">
          Improvements are published automatically, but this device can hold on to a cached copy.
          Use this to clear the cache and load the newest version — nothing you've saved is affected.
        </p>
        <button className={btnGhost} onClick={hardRefresh} disabled={refreshing}>
          <Icon name="refresh" className="w-4 h-4" />
          {refreshing ? 'Refreshing…' : 'Force refresh to latest'}
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
