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
  website: string | null
  linkedin_url: string | null
  photo_url: string | null
  birthday: string | null
  how_we_met: string | null
  met_on: string | null
  keep_in_touch_days: number | null
  summary: string | null
  favorite: boolean
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

export type WorkHistory = {
  id: string
  contact_id: string
  company: string
  title: string | null
  start_year: number | null
  end_year: number | null
  is_current: boolean
  notes: string | null
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

export type GroupType = 'company' | 'church' | 'sports' | 'school' | 'club' | 'nonprofit' | 'family' | 'other'

export type Group = {
  id: string
  name: string
  type: GroupType
  notes: string | null
}

export type GroupMember = {
  group_id: string
  contact_id: string
  role: string | null
  groups?: Group | null
  contacts?: { id: string; first_name: string; last_name: string | null; photo_url: string | null } | null
}

export type Relationship = {
  id: string
  from_contact: string
  to_contact: string
  relation: string
  strength: number
  notes: string | null
}
