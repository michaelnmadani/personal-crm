import { useState } from 'react'
import { format } from 'date-fns'
import { api, useContacts, useMut } from '../lib/hooks'
import { fullName } from '../lib/utils'
import { Modal } from './Modal'
import { btnGhost, btnPrimary, input, label } from './ui'

export function ReminderForm({ contactId, onClose }: { contactId?: string; onClose: () => void }) {
  const { data: contacts } = useContacts()
  const add = useMut(api.addReminder)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [dueTime, setDueTime] = useState('09:00')
  const [contact, setContact] = useState(contactId ?? '')
  const [recurrence, setRecurrence] = useState('')
  const [notes, setNotes] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await add.mutateAsync({
      title: title.trim(),
      due_at: new Date(`${dueDate}T${dueTime}`).toISOString(),
      contact_id: contact || null,
      notes: notes.trim() || null,
      recurrence_days: recurrence ? Number(recurrence) : null,
    })
    onClose()
  }

  return (
    <Modal title="New reminder" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <span className={label}>What?</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up on the proposal" required autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>Date</span>
            <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
          <div>
            <span className={label}>Time</span>
            <input type="time" className={input} value={dueTime} onChange={(e) => setDueTime(e.target.value)} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>Contact</span>
            <select className={input} value={contact} onChange={(e) => setContact(e.target.value)}>
              <option value="">— none —</option>
              {(contacts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>Repeat</span>
            <select className={input} value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="">Never</option>
              <option value="7">Weekly</option>
              <option value="30">Monthly</option>
              <option value="90">Every 3 months</option>
              <option value="180">Every 6 months</option>
              <option value="365">Yearly</option>
            </select>
          </div>
        </div>
        <div>
          <span className={label}>Notes</span>
          <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {add.isError && <p className="text-sm text-red-400">{(add.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={add.isPending}>
            Add reminder
          </button>
        </div>
      </form>
    </Modal>
  )
}
