import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pb'

export default function Projects() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', client: '', active: true })
  const [showTaskForm, setShowTaskForm] = useState(null) // project id
  const [taskName, setTaskName] = useState('')

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => pb.collection('clients').getFullList({ filter: 'archived=false', sort: 'name' })
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => pb.collection('projects').getFullList({ expand: 'client', sort: 'name' })
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['all_tasks'],
    queryFn: () => pb.collection('tasks').getFullList({ sort: 'name' })
  })

  const save = useMutation({
    mutationFn: (data) => editing
      ? pb.collection('projects').update(editing.id, data)
      : pb.collection('projects').create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); reset() }
  })

  const toggleActive = useMutation({
    mutationFn: (p) => pb.collection('projects').update(p.id, { active: !p.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] })
  })

  const addTask = useMutation({
    mutationFn: ({ project, name }) => pb.collection('tasks').create({ name, project }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all_tasks'] }); setTaskName(''); setShowTaskForm(null) }
  })

  const deleteTask = useMutation({
    mutationFn: (id) => pb.collection('tasks').delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all_tasks'] })
  })

  function reset() { setShowForm(false); setEditing(null); setForm({ name: '', client: '', active: true }) }
  function edit(p) { setEditing(p); setForm({ name: p.name, client: p.client, active: p.active }); setShowForm(true) }
  function handleSubmit(e) { e.preventDefault(); save.mutate(form) }

  const active = projects.filter(p => p.active)
  const inactive = projects.filter(p => !p.active)

  function ProjectCard({ project }) {
    const projectTasks = tasks.filter(t => t.project === project.id)
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-sm font-medium text-gray-900">{project.name}</p>
            <p className="text-xs text-gray-400">{project.expand?.client?.name}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => edit(project)} className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
            <button onClick={() => toggleActive.mutate(project)} className="text-xs text-gray-400 hover:text-gray-600">
              {project.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
        <div className="space-y-1 mt-3">
          {projectTasks.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-600">{t.name}</span>
              <button onClick={() => deleteTask.mutate(t.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
            </div>
          ))}
          {showTaskForm === project.id ? (
            <form onSubmit={(e) => { e.preventDefault(); addTask.mutate({ project: project.id, name: taskName }) }}
              className="flex gap-2 mt-1">
              <input value={taskName} onChange={e => setTaskName(e.target.value)} placeholder="Task name" required autoFocus
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="submit" className="text-xs bg-blue-600 text-white rounded-lg px-2 py-1">Add</button>
              <button type="button" onClick={() => setShowTaskForm(null)} className="text-xs text-gray-400">✕</button>
            </form>
          ) : (
            <button onClick={() => setShowTaskForm(project.id)} className="text-xs text-blue-500 hover:text-blue-700 mt-1">+ Add task</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <button onClick={() => { reset(); setShowForm(true) }}
          className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition">
          + New project
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editing ? 'Edit project' : 'New project'}</h2>
          <form onSubmit={handleSubmit} className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Client *</label>
              <select value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={reset} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button type="submit" className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition">
                {editing ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {active.map(p => <ProjectCard key={p.id} project={p} />)}
      </div>
      {active.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No active projects</p>}

      {inactive.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Inactive</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 opacity-50">
            {inactive.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
