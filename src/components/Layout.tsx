import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOpenReminders } from '../lib/hooks'
import { isDueNow } from '../lib/utils'
import { Icon } from './Icon'

const TABS = [
  { to: '/', label: 'Today', icon: 'home' },
  { to: '/contacts', label: 'Contacts', icon: 'users' },
  { to: '/reminders', label: 'Reminders', icon: 'bell' },
  { to: '/settings', label: 'Settings', icon: 'sliders' },
]

function Badge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function Layout() {
  const { data: reminders } = useOpenReminders()
  const dueCount = (reminders ?? []).filter(isDueNow).length
  const location = useLocation()
  const queryClient = useQueryClient()

  // In-app alerting: badge the installed app icon (PWA badging API) with due count.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => void; clearAppBadge?: () => void }
    if (dueCount > 0) nav.setAppBadge?.(dueCount)
    else nav.clearAppBadge?.()
  }, [dueCount])

  // Realtime: any change made on another device invalidates local caches.
  useEffect(() => {
    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => queryClient.invalidateQueries())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  const showBanner = dueCount > 0 && location.pathname !== '/' && location.pathname !== '/reminders'

  return (
    <div className="min-h-screen md:pl-56">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center gap-2 px-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 grid place-items-center">
            <Icon name="users" className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold">Personal CRM</span>
        </div>
        <nav className="space-y-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              <span className="relative">
                <Icon name={t.icon} className="w-5 h-5" />
                {t.label === 'Reminders' && <Badge count={dueCount} />}
              </span>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Overdue banner — persistent in-app alert, shown on every screen except Today/Reminders */}
      {showBanner && (
        <NavLink to="/" className="block bg-red-600/90 text-white text-sm font-medium text-center py-2 px-4">
          {dueCount} reminder{dueCount === 1 ? '' : 's'} need{dueCount === 1 ? 's' : ''} your attention →
        </NavLink>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6 pb-24 md:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-slate-800 bg-slate-900/95 backdrop-blur flex pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                isActive ? 'text-indigo-400' : 'text-slate-500'
              }`
            }
          >
            <span className="relative">
              <Icon name={t.icon} className="w-5 h-5" />
              {t.label === 'Reminders' && <Badge count={dueCount} />}
            </span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
