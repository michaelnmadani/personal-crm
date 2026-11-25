import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example')
}

/**
 * What a link from a password-reset email brought with it, read before the
 * client below tidies the address bar: whether this is a return from one, and
 * if the link was refused (used already, or expired), what Supabase said.
 */
const landing = `${window.location.hash} ${window.location.search}`
export const arrivedFromReset = /type=recovery/.test(landing)
export const resetLinkError = (() => {
  const m = landing.match(/error_description=([^&\s]+)/)
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null
})()

export const supabase = createClient(url, key)

/** The public demo login: shared by anyone who opens the sign-in page. */
export const DEMO_EMAIL = 'demo@ducktales-crm.com'
