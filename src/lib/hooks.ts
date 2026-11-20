import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays } from 'date-fns'
import { supabase } from './supabase'
import { resizeImage } from './image'
import type { ImportRow } from './importCsv'
import type {
  Contact,
  ContactOverview,
  ContactTag,
  Fact,
  FamilyMember,
  Group,
  GroupCompany,
  GroupMember,
  GroupType,
  Interaction,
  InteractionKind,
  Relationship,
  Reminder,
  Tag,
  WorkHistory,
  CaptureAlias,
  CaptureDraft,
  CaptureSource,
  ApiToken,
  AssistantLogEntry,
} from './types'

/**
 * Unwrap a supabase response, throwing on error. A row-level-security
 * rejection means the signed-in account isn't allowed to write at all (the
 * public demo login, currently) — surface that plainly rather than the raw
 * Postgres policy-violation text.
 */
async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) {
    if (error.message.includes('row-level security policy')) {
      throw new Error("This is a read-only demo — feel free to click around, but nothing saves.")
    }
    throw new Error(error.message)
  }
  return data as T
}

/**
 * Same as q(), but for deletes. A blocked delete doesn't come back as a
 * Postgres error at all — a delete policy's `using` clause just filters which
 * rows match, so a delete the RLS policy denies quietly affects zero rows
 * instead of throwing. Detecting that means the query must `.select()` the
 * deleted rows so an empty result here can be told apart from a normal
 * one-row delete.
 */
async function qDelete(p: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<null> {
  const { data, error } = await p
  if (error) {
    if (error.message.includes('row-level security policy')) {
      throw new Error("This is a read-only demo — feel free to click around, but nothing saves.")
    }
    throw new Error(error.message)
  }
  if (!data || data.length === 0) {
    throw new Error("This is a read-only demo — feel free to click around, but nothing saves.")
  }
  return null
}

const INTERACTION_SELECT =
  '*, participants:interaction_participants(contact_id, contacts(id, first_name, last_name))'

// ------------------------------------------------------------------ queries

/**
 * Every row a query matches. PostgREST caps each response at its max-rows
 * setting (1000 on Supabase), so a plain select silently stops there — tags
 * vanish from the list, links from the network graph, contacts from the
 * backup, with nothing on screen to say so. This asks a page at a time until a
 * page comes back short. `page` must order by something unique, or rows can
 * repeat or go missing between pages.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const SIZE = 1000
  const MAX_PAGES = 100 // safety net: never spin forever
  const all: T[] = []
  for (let n = 0; n < MAX_PAGES; n++) {
    const batch = await q<T[]>(page(n * SIZE, n * SIZE + SIZE - 1))
    all.push(...batch)
    if (batch.length < SIZE) return all
  }
  throw new Error(`Stopped after ${MAX_PAGES * SIZE} rows — more than this app expects to load at once.`)
}

export const useContacts = () =>
  useQuery({
    queryKey: ['contacts'],
    queryFn: () =>
      fetchAll<ContactOverview>((from, to) =>
        supabase
          .from('contacts_overview')
          .select('*')
          .eq('archived', false)
          .order('first_name')
          .order('id')
          .range(from, to),
      ),
  })

export const useContact = (id: string) =>
  useQuery({
    queryKey: ['contact', id],
    queryFn: () => q<ContactOverview>(supabase.from('contacts_overview').select('*').eq('id', id).single()),
  })

export const useFamily = (contactId: string) =>
  useQuery({
    queryKey: ['family', contactId],
    queryFn: () =>
      q<FamilyMember[]>(
        supabase.from('family_members').select('*').eq('contact_id', contactId).order('created_at'),
      ),
  })

export const useAllFamily = () =>
  useQuery({
    queryKey: ['family', 'all'],
    queryFn: () =>
      fetchAll<FamilyMember & { contacts: { id: string; first_name: string; last_name: string | null } | null }>((from, to) =>
        supabase.from('family_members').select('*, contacts(id, first_name, last_name)').order('id').range(from, to),
      ),
  })

export const useFacts = (contactId: string) =>
  useQuery({
    queryKey: ['facts', contactId],
    queryFn: () =>
      q<Fact[]>(supabase.from('facts').select('*').eq('contact_id', contactId).order('created_at')),
  })

export const useWorkHistory = (contactId: string) =>
  useQuery({
    queryKey: ['work', contactId],
    queryFn: () =>
      q<WorkHistory[]>(
        supabase
          .from('work_history')
          .select('*')
          .eq('contact_id', contactId)
          .order('is_current', { ascending: false })
          .order('start_year', { ascending: false, nullsFirst: false }),
      ),
  })

export const useAllWorkHistory = () =>
  useQuery({
    queryKey: ['work', 'all'],
    queryFn: () => fetchAll<WorkHistory>((from, to) => supabase.from('work_history').select('*').order('id').range(from, to)),
  })

export const useTags = () =>
  useQuery({
    queryKey: ['tags'],
    queryFn: () => q<Tag[]>(supabase.from('tags').select('*').order('name')),
  })

export const useContactTags = (contactId: string) =>
  useQuery({
    queryKey: ['contactTags', contactId],
    queryFn: () =>
      q<ContactTag[]>(
        supabase.from('contact_tags').select('contact_id, tag_id, tags(id, name, color)').eq('contact_id', contactId),
      ),
  })

export const useAllContactTags = () =>
  useQuery({
    queryKey: ['contactTags', 'all'],
    queryFn: () =>
      fetchAll<ContactTag>((from, to) =>
        supabase
          .from('contact_tags')
          .select('contact_id, tag_id, tags(id, name, color)')
          .order('contact_id')
          .order('tag_id')
          .range(from, to),
      ),
  })

/**
 * Every interaction, for the calendar — any month can be paged back to. (The
 * `useInteractions()` overview is capped at the latest 8.)
 */
export const useCalendarInteractions = () =>
  useQuery({
    queryKey: ['interactions', 'calendar'],
    queryFn: () =>
      fetchAll<Interaction>((from, to) =>
        supabase
          .from('interactions')
          .select(INTERACTION_SELECT)
          .order('happened_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
  })

/** Interactions for one contact (via participation) or the most recent overall. */
export const useInteractions = (contactId?: string) =>
  useQuery({
    queryKey: ['interactions', contactId ?? 'recent'],
    queryFn: async (): Promise<Interaction[]> => {
      if (contactId) {
        const rows = await q<{ interaction_id: string }[]>(
          supabase.from('interaction_participants').select('interaction_id').eq('contact_id', contactId),
        )
        if (rows.length === 0) return []
        return q<Interaction[]>(
          supabase
            .from('interactions')
            .select(INTERACTION_SELECT)
            .in('id', rows.map((r) => r.interaction_id))
            .order('happened_at', { ascending: false }),
        )
      }
      return q<Interaction[]>(
        supabase.from('interactions').select(INTERACTION_SELECT).order('happened_at', { ascending: false }).limit(8),
      )
    },
  })

export const useOpenReminders = () =>
  useQuery({
    queryKey: ['reminders', 'open'],
    queryFn: () =>
      q<Reminder[]>(
        supabase
          .from('reminders')
          .select('*, contacts(id, first_name, last_name)')
          .eq('status', 'open')
          .order('due_at'),
      ),
  })

export const useDoneReminders = () =>
  useQuery({
    queryKey: ['reminders', 'done'],
    queryFn: () =>
      q<Reminder[]>(
        supabase
          .from('reminders')
          .select('*, contacts(id, first_name, last_name)')
          .eq('status', 'done')
          .order('completed_at', { ascending: false })
          // Deep enough to fill the archive, not just the recent handful.
          .limit(500),
      ),
  })

/**
 * The follow-ups one person's timeline entries carry, done ones included — an
 * entry should still show that it was followed up, not just that it is owed.
 */
export const useFollowUps = (contactId: string) =>
  useQuery({
    queryKey: ['reminders', 'follow-ups', contactId],
    queryFn: () =>
      q<Reminder[]>(
        supabase.from('reminders').select('*').eq('contact_id', contactId).not('interaction_id', 'is', null),
      ),
  })

// ------------------------------------------------------- groups & relations

/** Captures waiting to be confirmed, newest first. */
export const useCaptureDrafts = () =>
  useQuery({
    queryKey: ['captureDrafts', 'pending'],
    queryFn: () =>
      q<CaptureDraft[]>(
        supabase.from('capture_drafts').select('*').eq('status', 'pending').order('captured_at', { ascending: false }),
      ),
  })

/** The last few captures dealt with, so a mistaken discard can be found again. */
export const useResolvedCaptures = () =>
  useQuery({
    queryKey: ['captureDrafts', 'resolved'],
    queryFn: () =>
      q<CaptureDraft[]>(
        supabase
          .from('capture_drafts')
          .select('*')
          .neq('status', 'pending')
          .order('resolved_at', { ascending: false })
          .limit(15),
      ),
  })

export const useCaptureAliases = () =>
  useQuery({
    queryKey: ['captureAliases'],
    queryFn: () => q<CaptureAlias[]>(supabase.from('capture_aliases').select('*')),
  })

export const useGroups = () =>
  useQuery({
    queryKey: ['groups'],
    queryFn: () =>
      q<(Group & { group_members: { count: number }[] })[]>(
        supabase.from('groups').select('*, group_members(count)').order('name'),
      ),
  })

export const useGroup = (id: string) =>
  useQuery({
    queryKey: ['group', id],
    queryFn: () => q<Group>(supabase.from('groups').select('*').eq('id', id).single()),
  })

export const useGroupMembers = (groupId: string) =>
  useQuery({
    queryKey: ['groupMembers', groupId],
    queryFn: () =>
      q<GroupMember[]>(
        supabase
          .from('group_members')
          .select('group_id, contact_id, role, contacts(id, first_name, last_name, photo_url)')
          .eq('group_id', groupId),
      ),
  })

export const useContactGroups = (contactId: string) =>
  useQuery({
    queryKey: ['contactGroups', contactId],
    queryFn: () =>
      q<GroupMember[]>(
        supabase.from('group_members').select('group_id, contact_id, role, groups(*)').eq('contact_id', contactId),
      ),
  })

export const useAllGroupMembers = () =>
  useQuery({
    queryKey: ['groupMembers', 'all'],
    queryFn: () =>
      fetchAll<GroupMember>((from, to) =>
        supabase.from('group_members').select('group_id, contact_id, role').order('group_id').order('contact_id').range(from, to),
      ),
  })

/** Company names mapped onto groups — every row, for the network chart. */
export const useGroupCompanies = () =>
  useQuery({
    queryKey: ['groupCompanies'],
    queryFn: () =>
      fetchAll<GroupCompany>((from, to) =>
        supabase.from('group_companies').select('id, group_id, company').order('company').order('id').range(from, to),
      ),
  })

export const useRelationships = () =>
  useQuery({
    queryKey: ['relationships'],
    queryFn: () => fetchAll<Relationship>((from, to) => supabase.from('relationships').select('*').order('id').range(from, to)),
  })

/** Signed URLs for contact photos (private bucket). Keyed by storage path. */
export const usePhotoUrls = (paths: (string | null | undefined)[]) => {
  const valid = [...new Set(paths.filter((p): p is string => !!p))].sort()
  return useQuery({
    queryKey: ['photoUrls', valid],
    enabled: valid.length > 0,
    staleTime: 45 * 60_000, // URLs are valid for 60 min
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('contact-photos').createSignedUrls(valid, 3600)
      if (error) throw new Error(error.message)
      const map: Record<string, string> = {}
      for (const d of data) if (d.signedUrl && d.path) map[d.path] = d.signedUrl
      return map
    },
  })
}

/** Assistant access keys, newest first. The key itself is never stored, so never fetched. */
export const useApiTokens = () =>
  useQuery({
    queryKey: ['apiTokens'],
    queryFn: () =>
      q<ApiToken[]>(
        supabase
          .from('api_tokens')
          .select('id, label, timezone, created_at, last_used_at, revoked_at')
          .order('created_at', { ascending: false }),
      ),
  })

/** What assistants have done lately — so anything they got wrong can be found and put right. */
export const useAssistantLog = () =>
  useQuery({
    queryKey: ['assistantLog'],
    queryFn: () =>
      q<AssistantLogEntry[]>(
        supabase
          .from('assistant_log')
          .select('id, tool, ok, summary, contact_ids, created_at')
          .order('created_at', { ascending: false })
          .limit(25),
      ),
  })

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- mutations

/** All mutations invalidate everything — the dataset is small and it keeps every view fresh. */
export function useMut<A, R = unknown>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries() })
}

export const api = {
  quickAddContact(name: string): Promise<Contact> {
    const [first, ...rest] = name.trim().split(/\s+/)
    return q(
      supabase
        .from('contacts')
        .insert({ first_name: first, last_name: rest.join(' ') || null })
        .select()
        .single(),
    )
  },

  saveContact(c: Partial<Contact>): Promise<Contact> {
    const { id, ...fields } = c
    if (id) return q(supabase.from('contacts').update(fields).eq('id', id).select().single())
    return q(supabase.from('contacts').insert(fields).select().single())
  },

  deleteContact: (id: string) => qDelete(supabase.from('contacts').delete().eq('id', id).select('id')),

  setFavorite: ({ id, favorite }: { id: string; favorite: boolean }) =>
    q<null>(supabase.from('contacts').update({ favorite }).eq('id', id)),

  addFamily: (f: Omit<FamilyMember, 'id'>) => q<FamilyMember>(supabase.from('family_members').insert(f).select().single()),
  deleteFamily: (id: string) => qDelete(supabase.from('family_members').delete().eq('id', id).select('id')),

  addFact: (f: Omit<Fact, 'id'>) => q<Fact>(supabase.from('facts').insert(f).select().single()),
  deleteFact: (id: string) => qDelete(supabase.from('facts').delete().eq('id', id).select('id')),

  addWork: (w: Omit<WorkHistory, 'id'>) => q<WorkHistory>(supabase.from('work_history').insert(w).select().single()),
  /** Save a whole pasted work history in one round trip. */
  addWorkBatch: (rows: Omit<WorkHistory, 'id'>[]) =>
    q<WorkHistory[]>(supabase.from('work_history').insert(rows).select()),
  updateWork: ({ id, ...patch }: Omit<WorkHistory, 'contact_id'>) =>
    q<WorkHistory>(supabase.from('work_history').update(patch).eq('id', id).select().single()),
  deleteWork: (id: string) => qDelete(supabase.from('work_history').delete().eq('id', id).select('id')),

  addGroupCompany: (c: { group_id: string; company: string }) =>
    q<GroupCompany>(supabase.from('group_companies').insert(c).select().single()),
  removeGroupCompany: (id: string) => qDelete(supabase.from('group_companies').delete().eq('id', id).select('id')),

  createGroup: (g: { name: string; type: GroupType }) =>
    q<Group>(supabase.from('groups').insert(g).select().single()),
  updateGroup: ({ id, ...patch }: { id: string; name?: string; type?: GroupType }) =>
    q<Group>(supabase.from('groups').update(patch).eq('id', id).select().single()),
  deleteGroup: (id: string) => qDelete(supabase.from('groups').delete().eq('id', id).select('id')),

  /** Add a contact to a group by group name — creates the group if it doesn't exist. */
  async addToGroup({
    contactId,
    groupName,
    type,
    role,
  }: {
    contactId: string
    groupName: string
    type: GroupType
    role: string | null
  }) {
    const name = groupName.trim()
    const existing = await q<Group[]>(supabase.from('groups').select('*').ilike('name', name))
    const group = existing[0] ?? (await q<Group>(supabase.from('groups').insert({ name, type }).select().single()))
    return q(supabase.from('group_members').insert({ group_id: group.id, contact_id: contactId, role }))
  },

  addGroupMember: (m: { group_id: string; contact_id: string; role: string | null }) =>
    q<null>(supabase.from('group_members').insert(m)),
  removeGroupMember: ({ groupId, contactId }: { groupId: string; contactId: string }) =>
    qDelete(supabase.from('group_members').delete().eq('group_id', groupId).eq('contact_id', contactId).select('group_id')),

  /**
   * Connections are mutual: one row per pair, read from either side, so adding
   * one to a person automatically gives the other person the same connection.
   * If the pair is already linked (in either direction) update that row rather
   * than inserting a second one — a duplicate would draw two lines on the
   * network graph, and the unique index would reject it anyway.
   */
  async addRelationship(r: { from_contact: string; to_contact: string; notes?: string | null }) {
    const notes = r.notes?.trim() || null
    const existing = await q<Relationship[]>(
      supabase
        .from('relationships')
        .select('*')
        .or(
          `and(from_contact.eq.${r.from_contact},to_contact.eq.${r.to_contact}),` +
            `and(from_contact.eq.${r.to_contact},to_contact.eq.${r.from_contact})`,
        ),
    )
    if (existing[0]) {
      // Already linked, and the link itself carries nothing to change. Only
      // touch the comment when a new one was actually typed, so reconnecting a
      // pair doesn't wipe what's already written there.
      if (!notes) return existing[0]
      return q<Relationship>(
        supabase.from('relationships').update({ notes }).eq('id', existing[0].id).select().single(),
      )
    }
    return q<Relationship>(
      supabase
        .from('relationships')
        .insert({ from_contact: r.from_contact, to_contact: r.to_contact, notes })
        .select()
        .single(),
    )
  },
  /** Edit the comment on an existing connection; empty clears it. */
  setRelationshipNote: ({ id, notes }: { id: string; notes: string }) =>
    q<Relationship>(
      supabase
        .from('relationships')
        .update({ notes: notes.trim() || null })
        .eq('id', id)
        .select()
        .single(),
    ),
  deleteRelationship: (id: string) => qDelete(supabase.from('relationships').delete().eq('id', id).select('id')),

  async uploadPhoto({ contact, file }: { contact: Contact; file: File }) {
    const blob = await resizeImage(file, 512)
    const path = `${contact.user_id}/${contact.id}.jpg`
    await q(supabase.storage.from('contact-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }))
    return q(supabase.from('contacts').update({ photo_url: path }).eq('id', contact.id))
  },

  async removePhoto(contact: Contact) {
    if (contact.photo_url) await supabase.storage.from('contact-photos').remove([contact.photo_url])
    return q(supabase.from('contacts').update({ photo_url: null }).eq('id', contact.id))
  },

  mergeContacts: ({ winner, loser }: { winner: string; loser: string }) =>
    q<null>(supabase.rpc('merge_contacts', { winner, loser })),

  /**
   * Bulk-import parsed CSV rows. Dedupes against existing contacts by LinkedIn
   * URL and by name+company, tags everything with `tagName`, and reports counts.
   * onProgress fires after each chunk so the UI can show a live count.
   */
  async importContacts({
    rows,
    tagName = 'LinkedIn',
    onProgress,
  }: {
    rows: ImportRow[]
    tagName?: string
    onProgress?: (done: number, total: number) => void
  }) {
    const existing = await fetchAll<{ linkedin_url: string | null; first_name: string; last_name: string | null; company: string | null }>(
      (from, to) => supabase.from('contacts').select('linkedin_url, first_name, last_name, company').order('id').range(from, to),
    )
    const urlSet = new Set(existing.filter((c) => c.linkedin_url).map((c) => c.linkedin_url!.toLowerCase()))
    const nameKey = (c: { first_name: string; last_name: string | null; company: string | null }) =>
      `${c.first_name}|${c.last_name ?? ''}|${c.company ?? ''}`.toLowerCase()
    const nameSet = new Set(existing.map(nameKey))

    const seen = new Set<string>()
    const fresh = rows.filter((r) => {
      const url = r.linkedin_url?.toLowerCase()
      if (url && urlSet.has(url)) return false
      const nk = nameKey(r)
      if (nameSet.has(nk) || seen.has(url ?? nk)) return false
      seen.add(url ?? nk)
      return true
    })

    let inserted = 0
    const CHUNK = 200
    const tag = await this._ensureTag(tagName)
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const batch = fresh.slice(i, i + CHUNK).map((r) => ({ ...r, kind: 'business' as const }))
      const created = await q<{ id: string }[]>(supabase.from('contacts').insert(batch).select('id'))
      if (tag && created.length) {
        await q(supabase.from('contact_tags').insert(created.map((c) => ({ contact_id: c.id, tag_id: tag.id }))))
      }
      inserted += created.length
      onProgress?.(Math.min(i + CHUNK, fresh.length), fresh.length)
    }
    return { inserted, skipped: rows.length - fresh.length }
  },

  async _ensureTag(name: string): Promise<Tag | null> {
    const existing = await q<Tag[]>(supabase.from('tags').select('*').ilike('name', name))
    if (existing[0]) return existing[0]
    return q<Tag>(supabase.from('tags').insert({ name, color: '#0a66c2' }).select().single())
  },

  async addTag({ contactId, name }: { contactId: string; name: string }) {
    const trimmed = name.trim()
    const existing = await q<Tag[]>(supabase.from('tags').select('*').ilike('name', trimmed))
    const tag = existing[0] ?? (await q<Tag>(supabase.from('tags').insert({ name: trimmed }).select().single()))
    return q(supabase.from('contact_tags').insert({ contact_id: contactId, tag_id: tag.id }))
  },

  removeTag: ({ contactId, tagId }: { contactId: string; tagId: string }) =>
    qDelete(supabase.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', tagId).select('contact_id')),

  async logInteraction({
    participantIds,
    ...fields
  }: {
    kind: InteractionKind
    happened_at: string
    title: string | null
    location: string | null
    notes: string | null
    remember?: string | null
    participantIds: string[]
  }) {
    const inter = await q<Interaction>(supabase.from('interactions').insert(fields).select().single())
    if (participantIds.length > 0) {
      await q(
        supabase
          .from('interaction_participants')
          .insert(participantIds.map((cid) => ({ interaction_id: inter.id, contact_id: cid }))),
      )
    }
    return inter
  },

  deleteInteraction: (id: string) => qDelete(supabase.from('interactions').delete().eq('id', id).select('id')),

  // Backfill/correct an existing timeline entry (notes, date, title, location, kind).
  updateInteraction: ({
    id,
    ...fields
  }: {
    id: string
    kind?: InteractionKind
    happened_at?: string
    title?: string | null
    location?: string | null
    notes?: string | null
    remember?: string | null
  }) => q<null>(supabase.from('interactions').update(fields).eq('id', id)),

  /**
   * Store captures. Each carries an id made on the phone, so one that is
   * retried after a dropped connection is ignored rather than doubled.
   */
  addCaptureDrafts: (rows: { raw_text: string; source: CaptureSource; client_id: string; captured_at: string }[]) =>
    q<null>(
      supabase.from('capture_drafts').upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: true }),
    ),

  resolveCaptureDraft: ({
    id,
    status,
    interaction_id = null,
    reminder_id = null,
  }: {
    id: string
    status: 'pending' | 'confirmed' | 'discarded'
    interaction_id?: string | null
    reminder_id?: string | null
  }) =>
    q<null>(
      supabase
        .from('capture_drafts')
        .update({ status, interaction_id, reminder_id, resolved_at: status === 'pending' ? null : new Date().toISOString() })
        .eq('id', id),
    ),

  /** Remember that these words, as heard, meant this person. */
  rememberCaptureAlias: ({ heard, contact_id }: { heard: string; contact_id: string }) =>
    q<null>(
      supabase
        .from('capture_aliases')
        .upsert({ heard, contact_id, last_used_at: new Date().toISOString() }, { onConflict: 'user_id,heard,contact_id' }),
    ),

  forgetCaptureAlias: (id: string) => qDelete(supabase.from('capture_aliases').delete().eq('id', id).select('id')),

  addReminder: (r: {
    title: string
    due_at: string
    contact_id: string | null
    notes: string | null
    recurrence_days: number | null
    /** Set when the reminder is a follow-up on a particular timeline entry. */
    interaction_id?: string | null
  }) => q<Reminder>(supabase.from('reminders').insert(r).select().single()),

  async completeReminder(r: Reminder) {
    await q(
      supabase
        .from('reminders')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', r.id),
    )
    if (r.recurrence_days) {
      await q(
        supabase.from('reminders').insert({
          contact_id: r.contact_id,
          due_at: addDays(new Date(), r.recurrence_days).toISOString(),
          title: r.title,
          notes: r.notes,
          recurrence_days: r.recurrence_days,
          source: r.source,
        }),
      )
    }
  },

  snoozeReminder: ({ id, until }: { id: string; until: Date }) =>
    q<null>(supabase.from('reminders').update({ snoozed_until: until.toISOString() }).eq('id', id)),

  reopenReminder: (id: string) =>
    q<null>(supabase.from('reminders').update({ status: 'open', completed_at: null, snoozed_until: null }).eq('id', id)),

  deleteReminder: (id: string) => qDelete(supabase.from('reminders').delete().eq('id', id).select('id')),

  /**
   * Make an access key for an assistant. The key is returned once, to be shown
   * once; only its fingerprint is saved, so it can't be read back later.
   */
  async createApiToken(label: string): Promise<{ key: string }> {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const key = `pcrm_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    await q(
      supabase.from('api_tokens').insert({
        label: label.trim() || 'Assistant',
        token_hash: await sha256Hex(key),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney',
      }),
    )
    return { key }
  },

  revokeApiToken: (id: string) =>
    q<null>(supabase.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)),

  /**
   * Everything, every row — read a page at a time, so nothing past the first
   * thousand is quietly left out. Photos are files rather than rows and aren't
   * included; the contacts' photo paths are.
   */
  async exportAll() {
    // Each table with the columns that order it uniquely, so pages don't overlap.
    const tables: [string, string[]][] = [
      ['contacts', ['id']],
      ['family_members', ['id']],
      ['facts', ['id']],
      ['work_history', ['id']],
      ['interactions', ['id']],
      ['interaction_participants', ['interaction_id', 'contact_id']],
      ['reminders', ['id']],
      ['relationships', ['id']],
      ['groups', ['id']],
      ['group_members', ['group_id', 'contact_id']],
      ['group_companies', ['id']],
      ['tags', ['id']],
      ['contact_tags', ['contact_id', 'tag_id']],
      ['capture_drafts', ['id']],
      ['capture_aliases', ['id']],
    ]
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() }
    const counts: Record<string, number> = {}
    for (const [t, keys] of tables) {
      const rows = await fetchAll<unknown>((from, to) => {
        let query = supabase.from(t).select('*')
        for (const k of keys) query = query.order(k)
        return query.range(from, to)
      })
      out[t] = rows
      counts[t] = rows.length
    }
    out.counts = counts
    return out as Record<string, unknown> & { counts: Record<string, number> }
  },
}
