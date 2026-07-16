import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import type { ContactOverview } from '../lib/types'
import { useAllFamily, useContacts, useInteractions, useOpenReminders } from '../lib/hooks'
import { ago, daysUntil, effectiveDue, fullName, isDueNow, kitDueInDays, nextOccurrence } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { Icon, KIND_ICON } from '../components/Icon'
import { ReminderItem } from '../components/ReminderItem'
import { card, chip } from '../components/ui'

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className={`${card} p-4`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
        <Icon name={icon} className="w-4 h-4 text-indigo-400" />
        {title}
      </h2>
      {children}
    </section>
  )
}

const empty = <p className="text-sm text-slate-500 py-1">Nothing here — you're all caught up.</p>

export function Today() {
  const { data: reminders } = useOpenReminders()
  const { data: contacts } = useContacts()
  const { data: family } = useAllFamily()
  const { data: recent } = useInteractions()

  const due = (reminders ?? []).filter(isDueNow)
  const upcoming = (reminders ?? []).filter((r) => {
    if (isDueNow(r)) return false
    const d = daysUntil(effectiveDue(r))
    return d >= 0 && d <= 7
  })

  type Bday = { key: string; name: string; note: string; inDays: number; contactId: string }
  const birthdays: Bday[] = []
  for (const c of contacts ?? []) {
    if (!c.birthday) continue
    const next = nextOccurrence(c.birthday)
    const d = daysUntil(next)
    if (d <= 14) birthdays.push({ key: `c-${c.id}`, name: fullName(c), note: 'birthday', inDays: d, contactId: c.id })
  }
  for (const f of family ?? []) {
    if (!f.birthdate || !f.contacts) continue
    const d = daysUntil(nextOccurrence(f.birthdate))
    if (d <= 14)
      birthdays.push({
        key: `f-${f.id}`,
        name: f.name,
        note: `${f.relation} of ${fullName(f.contacts)}`,
        inDays: d,
        contactId: f.contacts.id,
      })
  }
  birthdays.sort((a, b) => a.inDays - b.inDays)

  const overdueKit = (contacts ?? [])
    .map((c) => ({ c, days: kitDueInDays(c) }))
    .filter((x): x is { c: ContactOverview; days: number } => x.days !== null && x.days <= 0)
    .sort((a, b) => a.days - b.days)

  // Dormant ties: contacts with no cadence, quiet for 6+ months. Research (Levin,
  // Walter & Murnighan) finds these give the most novel, valuable help when revived.
  const SIX_MONTHS = 180 * 86_400_000
  const dormant = (contacts ?? [])
    .filter((c) => !c.keep_in_touch_days)
    .map((c) => ({ c, last: new Date(c.last_contacted ?? c.created_at).getTime() }))
    .filter((x) => Date.now() - x.last > SIX_MONTHS)
    .sort((a, b) => a.last - b.last)
    .slice(0, 5)

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="text-sm text-slate-500">{format(new Date(), 'EEEE, MMMM d')}</p>
      </header>

      <Section title={due.length > 0 ? `Needs attention (${due.length})` : 'Needs attention'} icon="bell">
        {due.length === 0 ? empty : <div className="divide-y divide-slate-800">{due.map((r) => <ReminderItem key={r.id} reminder={r} />)}</div>}
      </Section>

      {upcoming.length > 0 && (
        <Section title="Coming up this week" icon="clock">
          <div className="divide-y divide-slate-800">
            {upcoming.map((r) => (
              <ReminderItem key={r.id} reminder={r} />
            ))}
          </div>
        </Section>
      )}

      {birthdays.length > 0 && (
        <Section title="Birthdays" icon="gift">
          <ul className="space-y-1.5">
            {birthdays.map((b) => (
              <li key={b.key} className="flex items-center justify-between text-sm">
                <span>
                  <Link to={`/contacts/${b.contactId}`} className="text-slate-100 hover:text-indigo-300 font-medium">
                    {b.name}
                  </Link>{' '}
                  <span className="text-slate-500">· {b.note}</span>
                </span>
                <span className={`${chip} ${b.inDays === 0 ? 'bg-pink-500/20 text-pink-300' : 'bg-slate-800 text-slate-400'}`}>
                  {b.inDays === 0 ? 'today 🎂' : b.inDays === 1 ? 'tomorrow' : `in ${b.inDays} days`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Keep in touch" icon="heart">
        {overdueKit.length === 0 ? (
          empty
        ) : (
          <ul className="space-y-2">
            {overdueKit.map(({ c, days }) => (
              <li key={c.id}>
                <Link to={`/contacts/${c.id}`} className="flex items-center gap-3 group">
                  <Avatar contact={c} size="sm" />
                  <span className="text-sm font-medium text-slate-100 group-hover:text-indigo-300">{fullName(c)}</span>
                  <span className="text-xs text-red-400 ml-auto">
                    {c.last_contacted ? `last contact ${ago(c.last_contacted)}` : 'never contacted'}
                    {days < 0 ? ` · ${-days}d overdue` : ' · due now'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {dormant.length > 0 && (
        <Section title="Worth reconnecting" icon="users">
          <p className="text-xs text-slate-500 mb-2">
            Dormant ties — research shows people you've lost touch with give the most valuable, novel help when you reconnect.
          </p>
          <ul className="space-y-2">
            {dormant.map(({ c, last }) => (
              <li key={c.id}>
                <Link to={`/contacts/${c.id}`} className="flex items-center gap-3 group">
                  <Avatar contact={c} size="sm" />
                  <span className="text-sm font-medium text-slate-100 group-hover:text-indigo-300">{fullName(c)}</span>
                  <span className="text-xs text-slate-500 ml-auto">
                    quiet for {Math.floor((Date.now() - last) / (30 * 86_400_000))} months
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recent notes" icon="note">
        {(recent ?? []).length === 0 ? (
          empty
        ) : (
          <ul className="space-y-3">
            {(recent ?? []).map((i) => (
              <li key={i.id} className="text-sm">
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-0.5">
                  <Icon name={KIND_ICON[i.kind]} className="w-3.5 h-3.5" />
                  <span>{ago(i.happened_at)}</span>
                  <span className="text-slate-600">·</span>
                  {(i.participants ?? []).map(
                    (p, idx) =>
                      p.contacts && (
                        <Link key={p.contact_id} to={`/contacts/${p.contacts.id}`} className="text-indigo-400 hover:underline">
                          {idx > 0 ? ', ' : ''}
                          {fullName(p.contacts)}
                        </Link>
                      ),
                  )}
                </div>
                {i.title && <p className="font-medium text-slate-200">{i.title}</p>}
                {i.notes && <p className="text-slate-400 line-clamp-2 whitespace-pre-wrap">{i.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
