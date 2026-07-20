import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays } from 'date-fns'
import { supabase } from './supabase'
import { resizeImage } from './image'
import type {
  Contact,
  ContactOverview,
  ContactTag,
  Fact,
  FamilyMember,
  Group,
  GroupMember,
  GroupType,
  Interaction,
  InteractionKind,
  Relationship,
  Reminder,
  Tag,
  WorkHistory,
} from './types'

/** Unwrap a supabase response, throwing on error. */
async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

const INTERACTION_SELECT =
  '*, participants:interaction_participants(contact_id, contacts(id, first_name, last_name))'

// ------------------------------------------------------------------ queries

export const useContacts = () =>
  useQuery({
    queryKey: ['contacts'],
    queryFn: () =>
      q<ContactOverview[]>(
        supabase.from('contacts_overview').select('*').eq('archived', false).order('first_name'),
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
      q<(FamilyMember & { contacts: { id: string; first_name: string; last_name: string | null } | null })[]>(
        supabase.from('family_members').select('*, contacts(id, first_name, last_name)'),
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
    queryFn: () => q<WorkHistory[]>(supabase.from('work_history').select('*')),
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
      q<ContactTag[]>(supabase.from('contact_tags').select('contact_id, tag_id, tags(id, name, color)')),
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
          .limit(15),
      ),
  })

// ------------------------------------------------------- groups & relations

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
    queryFn: () => q<GroupMember[]>(supabase.from('group_members').select('group_id, contact_id, role')),
  })

export const useRelationships = () =>
  useQuery({
    queryKey: ['relationships'],
    queryFn: () => q<Relationship[]>(supabase.from('relationships').select('*')),
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

  deleteContact: (id: string) => q<null>(supabase.from('contacts').delete().eq('id', id)),

  addFamily: (f: Omit<FamilyMember, 'id'>) => q<FamilyMember>(supabase.from('family_members').insert(f).select().single()),
  deleteFamily: (id: string) => q<null>(supabase.from('family_members').delete().eq('id', id)),

  addFact: (f: Omit<Fact, 'id'>) => q<Fact>(supabase.from('facts').insert(f).select().single()),
  deleteFact: (id: string) => q<null>(supabase.from('facts').delete().eq('id', id)),

  addWork: (w: Omit<WorkHistory, 'id'>) => q<WorkHistory>(supabase.from('work_history').insert(w).select().single()),
  deleteWork: (id: string) => q<null>(supabase.from('work_history').delete().eq('id', id)),

  createGroup: (g: { name: string; type: GroupType }) =>
    q<Group>(supabase.from('groups').insert(g).select().single()),
  deleteGroup: (id: string) => q<null>(supabase.from('groups').delete().eq('id', id)),

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
    q<null>(supabase.from('group_members').delete().eq('group_id', groupId).eq('contact_id', contactId)),

  addRelationship: (r: { from_contact: string; to_contact: string; relation: string; strength: number }) =>
    q<Relationship>(supabase.from('relationships').insert(r).select().single()),
  deleteRelationship: (id: string) => q<null>(supabase.from('relationships').delete().eq('id', id)),

  async uploadPhoto({ contact, file }: { contact: Contact; file: File }) {
    const blob = await resizeImage(file, 512)
    const path = `${contact.user_id}/${contact.id}.jpg`
    const { error } = await supabase.storage
      .from('contact-photos')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
    if (error) throw new Error(error.message)
    return q(supabase.from('contacts').update({ photo_url: path }).eq('id', contact.id))
  },

  async removePhoto(contact: Contact) {
    if (contact.photo_url) await supabase.storage.from('contact-photos').remove([contact.photo_url])
    return q(supabase.from('contacts').update({ photo_url: null }).eq('id', contact.id))
  },

  async addTag({ contactId, name }: { contactId: string; name: string }) {
    const trimmed = name.trim()
    const existing = await q<Tag[]>(supabase.from('tags').select('*').ilike('name', trimmed))
    const tag = existing[0] ?? (await q<Tag>(supabase.from('tags').insert({ name: trimmed }).select().single()))
    return q(supabase.from('contact_tags').insert({ contact_id: contactId, tag_id: tag.id }))
  },

  removeTag: ({ contactId, tagId }: { contactId: string; tagId: string }) =>
    q<null>(supabase.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', tagId)),

  async logInteraction({
    participantIds,
    ...fields
  }: {
    kind: InteractionKind
    happened_at: string
    title: string | null
    location: string | null
    notes: string | null
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

  deleteInteraction: (id: string) => q<null>(supabase.from('interactions').delete().eq('id', id)),

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
  }) => q<null>(supabase.from('interactions').update(fields).eq('id', id)),

  addReminder: (r: {
    title: string
    due_at: string
    contact_id: string | null
    notes: string | null
    recurrence_days: number | null
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

  deleteReminder: (id: string) => q<null>(supabase.from('reminders').delete().eq('id', id)),

  async exportAll() {
    const tables = [
      'contacts',
      'family_members',
      'facts',
      'work_history',
      'interactions',
      'interaction_participants',
      'reminders',
      'relationships',
      'groups',
      'group_members',
      'tags',
      'contact_tags',
    ] as const
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() }
    for (const t of tables) out[t] = await q<unknown[]>(supabase.from(t).select('*'))
    return out
  },
}
