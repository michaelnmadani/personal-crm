export type LabeledValue = { label: string; value: string }

export type ContactKind = 'business' | 'personal' | 'both'

export type Contact = {
  id: string
  user_id: string
  first_name: string
  last_name: string | null
  nickname: string | null
  kind: ContactKind
  company: string | null
  title: string | null
  emails: LabeledValue[]
  phones: LabeledValue[]
  location: string | null
  birthday: string | null
  how_we_met: string | null
  met_on: string | null
  keep_in_touch_days: number | null
  summary: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export type ContactOverview = Contact & { last_contacted: string | null }

export type Relation = 'spouse' | 'partner' | 'child' | 'parent' | 'sibling' | 'pet' | 'other'

export type FamilyMember = {
  id: string
  contact_id: string
  relation: Relation
  name: string
  birthdate: string | null
  approx_birth_year: number | null
  notes: string | null
}

export type Fact = {
  id: string
  contact_id: string
  label: string
  value: string
}

export type InteractionKind = 'meeting' | 'call' | 'email' | 'message' | 'event' | 'note'

export type ParticipantRef = {
  contact_id: string
  contacts: { id: string; first_name: string; last_name: string | null } | null
}

export type Interaction = {
  id: string
  kind: InteractionKind
  happened_at: string
  location: string | null
  title: string | null
  notes: string | null
  participants?: ParticipantRef[]
}

export type ReminderSource = 'manual' | 'keep_in_touch' | 'birthday'

export type Reminder = {
  id: string
  contact_id: string | null
  due_at: string
  title: string
  notes: string | null
  recurrence_days: number | null
  status: 'open' | 'done'
  snoozed_until: string | null
  source: ReminderSource
  completed_at: string | null
  contacts?: { id: string; first_name: string; last_name: string | null } | null
}

export type Tag = { id: string; name: string; color: string }

export type ContactTag = { contact_id: string; tag_id: string; tags: Tag | null }
