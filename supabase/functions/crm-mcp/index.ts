/**
 * crm-mcp — lets an assistant such as Meta's Muse work with the CRM.
 *
 * Deployed with JWT verification off: callers present a CRM access key (made
 * in Settings → Assistant access), not a Supabase login, and mcp.ts checks it.
 * SUPABASE_DB_URL is provided to every edge function by Supabase.
 */
import postgres from 'npm:postgres@3.4.5'
import { createHandler } from './mcp.ts'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  prepare: false, // safe behind Supabase's transaction-mode pooler
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
})

Deno.serve(createHandler(sql))
