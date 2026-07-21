import { useState } from 'react'
import { Link } from 'react-router-dom'
import { parseContactsCsv, type ParseResult } from '../lib/importCsv'
import { api, useMut } from '../lib/hooks'
import { Icon } from '../components/Icon'
import { btnGhost, btnPrimary, card, chip } from '../components/ui'

export function Import() {
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null)
  const doImport = useMut(api.importContacts)

  const onFile = async (file: File) => {
    setError(null)
    setResult(null)
    setParsed(null)
    setFileName(file.name)
    try {
      const text = await file.text()
      const res = parseContactsCsv(text)
      if (res.rows.length === 0) {
        setError('Couldn’t find contact rows. Expected a CSV with First Name / Last Name / Company columns (like LinkedIn’s Connections.csv).')
        return
      }
      setParsed(res)
    } catch {
      setError('Could not read that file.')
    }
  }

  const runImport = async () => {
    if (!parsed) return
    setProgress({ done: 0, total: parsed.rows.length })
    const r = await doImport.mutateAsync({
      rows: parsed.rows,
      onProgress: (done, total) => setProgress({ done, total }),
    })
    setResult(r)
    setProgress(null)
    setParsed(null)
  }

  const topCompanies = () => {
    if (!parsed) return []
    const counts = new Map<string, number>()
    for (const r of parsed.rows) if (r.company) counts.set(r.company, (counts.get(r.company) ?? 0) + 1)
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }

  return (
    <div className="space-y-4">
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <Icon name="back" className="w-4 h-4" /> Settings
      </Link>
      <h1 className="text-2xl font-bold">Import contacts</h1>

      <section className={`${card} p-4 space-y-3`}>
        <p className="text-sm text-slate-400">
          Import a <strong>LinkedIn</strong> export (Settings → Data Privacy → Get a copy of your data → Connections),
          or any CSV with First/Last Name, Company, Position, and Email columns. Everyone is tagged so you can review or
          undo in one filter. Duplicates (same LinkedIn URL, or same name + company) are skipped automatically.
        </p>
        <label className={btnPrimary + ' cursor-pointer w-fit'}>
          <Icon name="plus" className="w-4 h-4" /> Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
        </label>
        {fileName && <p className="text-xs text-slate-500">{fileName}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {parsed && !result && (
        <section className={`${card} p-4 space-y-3`}>
          <h2 className="text-sm font-semibold text-slate-300">Preview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              ['Contacts', parsed.rows.length],
              ['With company', parsed.stats.withCompany],
              ['With email', parsed.stats.withEmail],
              ['With date', parsed.stats.withDate],
            ].map(([label, n]) => (
              <div key={label} className="rounded-lg bg-slate-800/60 p-3">
                <p className="text-xl font-bold text-slate-100">{n as number}</p>
                <p className="text-xs text-slate-500">{label as string}</p>
              </div>
            ))}
          </div>
          {topCompanies().length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">
                Shared employers (these people will auto-connect in your network):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topCompanies().map(([c, n]) => (
                  <span key={c} className={`${chip} bg-slate-800 text-slate-300`}>
                    {c} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button className={btnPrimary} onClick={runImport} disabled={doImport.isPending}>
              {doImport.isPending ? 'Importing…' : `Import ${parsed.rows.length} contacts`}
            </button>
            <button className={btnGhost} onClick={() => setParsed(null)} disabled={doImport.isPending}>
              Cancel
            </button>
          </div>
          {progress && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {progress.done} / {progress.total} inserted…
              </p>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className={`${card} p-4 space-y-2`}>
          <p className="text-sm text-emerald-400 font-medium">
            Imported {result.inserted} contact{result.inserted === 1 ? '' : 's'}.
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-slate-400">{result.skipped} skipped as duplicates or already present.</p>
          )}
          <div className="flex gap-2 pt-1">
            <Link to="/contacts" className={btnPrimary}>
              View contacts
            </Link>
            <Link to="/network" className={btnGhost}>
              Open network
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
