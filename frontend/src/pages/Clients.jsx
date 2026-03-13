import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { client } from '../lib/client'

export default function Clients() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => client.records('clients').list({ order: ['name'], pagination: { limit: 500 } }).then(r => r.records)
  })

  const save = useMutation({
    mutationFn: (data) => editing
      ? client.records('clients').update(editing.id, data)
      : client.records('clients').create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); reset() }
  })

  const archive = useMutation({
    mutationFn: (c) => client.records('clients').update(c.id, { archived: c.archived ? 0 : 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })

  function reset() { setShowForm(false); setEditing(null); setForm({ name: '', email: '', phone: '', notes: '' }) }
  function edit(c) { setEditing(c); setForm({ name: c.name, email: c.email || '', phone: c.phone || '', notes: c.notes || '' }); setShowForm(true) }
  function handleSubmit(e) { e.preventDefault(); save.mutate(form) }

  const active = clients.filter(c => !c.archived)
  const archived = clients.filter(c => c.archived)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
        <button onClick={() => { reset(); setShowForm(true) }}
          className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition">
          + New client
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editing ? 'Edit client' : 'New client'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={reset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button type="submit"
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition">
                {editing ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {active.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => navigate(`/reports?clientId=${c.id}`)}
              className="text-left hover:text-blue-600 transition"
            >
              <p className="text-sm font-medium text-gray-900">{c.name}</p>
              {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
            </button>
            <div className="flex gap-2">
              <button onClick={() => edit(c)} className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
              <button onClick={() => archive.mutate(c)} className="text-xs text-gray-400 hover:text-gray-600">Archive</button>
            </div>
          </div>
        ))}
        {active.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No clients yet</p>}
      </div>

      {archived.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Archived</p>
          <div className="space-y-2">
            {archived.map(c => (
              <div key={c.id} className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between opacity-60">
                <p className="text-sm text-gray-600">{c.name}</p>
                <button onClick={() => archive.mutate(c)} className="text-xs text-blue-500 hover:text-blue-700">Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
