import { useState } from 'react'
import type { Contact, ContactKind, LabeledValue } from '../lib/types'
import { api, useMut } from '../lib/hooks'
import { NO_YEAR } from '../lib/utils'
import { parseLinkedInProfile } from '../lib/parseLinkedIn'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { btnGhost, btnPrimary, input, label } from './ui'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Assemble the birthday columns from the month/day/year inputs. The year is
 * optional: when it's blank we store the NO_YEAR sentinel and flag it, so the
 * column stays a real date while "day and month only" is still expressible.
 */
function birthdayFields(month: string, day: string, year: string) {
  if (!month || !day) return { birthday: null, birthday_has_year: true }
  const hasYear = /^\d{4}$/.test(year.trim())
  const y = hasYear ? Number(year) : NO_YEAR
  const pad = (n: number) => String(n).padStart(2, '0')
  return { birthday: `${y}-${pad(Number(month))}-${pad(Number(day))}`, birthday_has_year: hasYear }
}

const KIT_OPTIONS = [
  { v: '', t: 'No cadence' },
  { v: '14', t: 'Every 2 weeks' },
  { v: '30', t: 'Every month' },
  { v: '90', t: 'Every 3 months' },
  { v: '180', t: 'Every 6 months' },
  { v: '365', t: 'Every year' },
]

function LabeledList({
  items,
  onChange,
  placeholder,
}: {
  items: LabeledValue[]
  onChange: (v: LabeledValue[]) => void
  placeholder: string
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input
            className={`${input} basis-1/3`}
            value={it.label}
            placeholder="label"
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <input
            className={input}
            value={it.value}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button
            type="button"
            className="text-slate-500 hover:text-red-400"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label="Remove"
          >
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-indigo-400 hover:text-indigo-300"
        onClick={() => onChange([...items, { label: items.length === 0 ? 'work' : 'personal', value: '' }])}
      >
        + add
      </button>
    </div>
  )
}

export function ContactForm({ contact, onClose }: { contact?: Contact; onClose: () => void }) {
  const [f, setF] = useState({
    first_name: contact?.first_name ?? '',
    last_name: contact?.last_name ?? '',
    nickname: contact?.nickname ?? '',
    kind: (contact?.kind ?? 'business') as ContactKind,
    company: contact?.company ?? '',
    title: contact?.title ?? '',
    location: contact?.location ?? '',
    website: contact?.website ?? '',
    linkedin_url: contact?.linkedin_url ?? '',
    bMonth: contact?.birthday ? String(Number(contact.birthday.slice(5, 7))) : '',
    bDay: contact?.birthday ? String(Number(contact.birthday.slice(8, 10))) : '',
    bYear: contact?.birthday && contact.birthday_has_year !== false ? contact.birthday.slice(0, 4) : '',
    met_on: contact?.met_on ?? '',
    how_we_met: contact?.how_we_met ?? '',
    keep_in_touch_days: contact?.keep_in_touch_days ? String(contact.keep_in_touch_days) : '',
    summary: contact?.summary ?? '',
  })
  const [emails, setEmails] = useState<LabeledValue[]>(contact?.emails ?? [])
  const [phones, setPhones] = useState<LabeledValue[]>(contact?.phones ?? [])
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState(false)
  const save = useMut(api.saveContact)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value })

  const readPaste = () => {
    const draft = parseLinkedInProfile(pasteText)
    if (!draft) {
      setPasteError(true)
      return
    }
    setF({
      ...f,
      first_name: draft.first_name,
      last_name: draft.last_name ?? '',
      title: draft.title ?? f.title,
      company: draft.company ?? f.company,
      location: draft.location ?? f.location,
    })
    setPasting(false)
    setPasteText('')
    setPasteError(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.first_name.trim()) return
    await save.mutateAsync({
      id: contact?.id,
      first_name: f.first_name.trim(),
      last_name: f.last_name.trim() || null,
      nickname: f.nickname.trim() || null,
      kind: f.kind,
      company: f.company.trim() || null,
      title: f.title.trim() || null,
      location: f.location.trim() || null,
      website: f.website.trim() || null,
      linkedin_url: f.linkedin_url.trim() || null,
      ...birthdayFields(f.bMonth, f.bDay, f.bYear),
      met_on: f.met_on || null,
      how_we_met: f.how_we_met.trim() || null,
      keep_in_touch_days: f.keep_in_touch_days ? Number(f.keep_in_touch_days) : null,
      summary: f.summary.trim() || null,
      emails: emails.filter((x) => x.value.trim()),
      phones: phones.filter((x) => x.value.trim()),
    })
    onClose()
  }

  return (
    <Modal title={contact ? 'Edit contact' : 'New contact'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!contact && (
          <div className="border-b border-slate-800 pb-3">
            {!pasting ? (
              <button
                type="button"
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                onClick={() => setPasting(true)}
              >
                Paste from LinkedIn
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  className={`${input} h-24 font-mono text-xs`}
                  placeholder="Paste the top of their LinkedIn profile — name, headline, location…"
                  value={pasteText}
                  onChange={(e) => {
                    setPasteText(e.target.value)
                    setPasteError(false)
                  }}
                  autoFocus
                />
                {pasteError && (
                  <p className="text-sm text-red-400">Couldn't find a name in that. Paste the profile's name and headline.</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    onClick={readPaste}
                    disabled={!pasteText.trim()}
                  >
                    Read it
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:text-slate-300"
                    onClick={() => {
                      setPasting(false)
                      setPasteText('')
                      setPasteError(false)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>First name *</span>
            <input className={input} value={f.first_name} onChange={set('first_name')} required autoFocus />
          </div>
          <div>
            <span className={label}>Last name</span>
            <input className={input} value={f.last_name} onChange={set('last_name')} />
          </div>
          <div>
            <span className={label}>Nickname</span>
            <input className={input} value={f.nickname} onChange={set('nickname')} />
          </div>
          <div>
            <span className={label}>Type</span>
            <select className={input} value={f.kind} onChange={set('kind')}>
              <option value="business">Business</option>
              <option value="personal">Personal</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <span className={label}>Company</span>
            <input className={input} value={f.company} onChange={set('company')} />
          </div>
          <div>
            <span className={label}>Job title</span>
            <input className={input} value={f.title} onChange={set('title')} />
          </div>
          <div>
            <span className={label}>Location</span>
            <input className={input} value={f.location} onChange={set('location')} placeholder="City" />
          </div>
          <div>
            <span className={label}>Birthday</span>
            <div className="flex gap-1.5">
              <select className={input} value={f.bMonth} onChange={set('bMonth')} aria-label="Birth month">
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select className={`${input} w-24`} value={f.bDay} onChange={set('bDay')} aria-label="Birth day">
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                className={`${input} w-28`}
                value={f.bYear}
                onChange={set('bYear')}
                inputMode="numeric"
                maxLength={4}
                placeholder="Year (opt.)"
                aria-label="Birth year (optional)"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>Website</span>
            <input className={input} value={f.website} onChange={set('website')} placeholder="https://…" />
          </div>
          <div>
            <span className={label}>LinkedIn</span>
            <input className={input} value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://linkedin.com/in/…" />
          </div>
        </div>

        <div>
          <span className={label}>Emails</span>
          <LabeledList items={emails} onChange={setEmails} placeholder="email@example.com" />
        </div>
        <div>
          <span className={label}>Phones</span>
          <LabeledList items={phones} onChange={setPhones} placeholder="+1 …" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>Met on</span>
            <input type="date" className={input} value={f.met_on} onChange={set('met_on')} />
          </div>
          <div>
            <span className={label}>Keep in touch</span>
            <select className={input} value={f.keep_in_touch_days} onChange={set('keep_in_touch_days')}>
              {KIT_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <span className={label}>How we met</span>
          <input className={input} value={f.how_we_met} onChange={set('how_we_met')} placeholder="Intro'd by Sarah at CES 2025" />
        </div>
        <div>
          <span className={label}>Who is this person?</span>
          <textarea className={input} rows={2} value={f.summary} onChange={set('summary')} />
        </div>

        {save.isError && <p className="text-sm text-red-400">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
