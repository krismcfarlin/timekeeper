import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pb'

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function Timer() {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [startedAt, setStartedAt] = useState(null)
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedTask, setSelectedTask] = useState('')
  const [notes, setNotes] = useState('')
  const intervalRef = useRef(null)

  // Manual entry state
  const [manualDate, setManualDate] = useState(today())
  const [manualHours, setManualHours] = useState('')
  const [manualProject, setManualProject] = useState('')
  const [manualTask, setManualTask] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [showManual, setShowManual] = useState(false)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => pb.collection('projects').getFullList({ expand: 'client', filter: 'active=true', sort: 'name' })
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', selectedProject],
    queryFn: () => selectedProject
      ? pb.collection('tasks').getFullList({ filter: `project="${selectedProject}"`, sort: 'name' })
      : Promise.resolve([]),
    enabled: !!selectedProject
  })

  const { data: manualTasks = [] } = useQuery({
    queryKey: ['tasks', manualProject],
    queryFn: () => manualProject
      ? pb.collection('tasks').getFullList({ filter: `project="${manualProject}"`, sort: 'name' })
      : Promise.resolve([]),
    enabled: !!manualProject
  })

  const { data: entries = [] } = useQuery({
    queryKey: ['time_entries', today()],
    queryFn: () => pb.collection('time_entries').getFullList({
      filter: `date="${today()}"`,
      expand: 'project,project.client,task',
      sort: '-created'
    })
  })

  const addEntry = useMutation({
    mutationFn: (data) => pb.collection('time_entries').create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time_entries'] })
  })

  const deleteEntry = useMutation({
    mutationFn: (id) => pb.collection('time_entries').delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time_entries'] })
  })

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [running])

  function startTimer() {
    if (!selectedProject) return
    setStartedAt(new Date().toISOString())
    setElapsed(0)
    setRunning(true)
  }

  function stopTimer() {
    setRunning(false)
    const hours = parseFloat((elapsed / 3600).toFixed(2))
    if (hours > 0) {
      addEntry.mutate({
        project: selectedProject,
        task: selectedTask || null,
        date: today(),
        hours,
        notes,
        started_at: startedAt,
        ended_at: new Date().toISOString()
      })
    }
    setElapsed(0)
    setNotes('')
  }

  function submitManual(e) {
    e.preventDefault()
    addEntry.mutate({
      project: manualProject,
      task: manualTask || null,
      date: manualDate,
      hours: parseFloat(manualHours),
      notes: manualNotes
    })
    setManualHours('')
    setManualNotes('')
    setShowManual(false)
  }

  const totalToday = entries.reduce((sum, e) => sum + (e.hours || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Timer</h1>
        <button
          onClick={() => setShowManual(!showManual)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          + Add manually
        </button>
      </div>

      {/* Live Timer */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="flex gap-3 flex-wrap">
          <select
            value={selectedProject}
            onChange={e => { setSelectedProject(e.target.value); setSelectedTask('') }}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.expand?.client?.name} — {p.name}
              </option>
            ))}
          </select>
          <select
            value={selectedTask}
            onChange={e => setSelectedTask(e.target.value)}
            className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!selectedProject}
          >
            <option value="">No task</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What are you working on?"
            className="flex-[2] min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-4xl font-bold text-gray-900">{formatDuration(elapsed)}</span>
          <button
            onClick={running ? stopTimer : startTimer}
            disabled={!selectedProject}
            className={`px-6 py-2 rounded-lg font-medium text-sm transition ${
              running
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {/* Manual Entry Form */}
      {showManual && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Manual Entry</h2>
          <form onSubmit={submitManual} className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Project</label>
              <select value={manualProject} onChange={e => { setManualProject(e.target.value); setManualTask('') }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                <option value="">Select...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.expand?.client?.name} — {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Task</label>
              <select value={manualTask} onChange={e => setManualTask(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" disabled={!manualProject}>
                <option value="">No task</option>
                {manualTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hours</label>
              <input type="number" step="0.25" min="0.25" value={manualHours} onChange={e => setManualHours(e.target.value)}
                placeholder="1.5"
                className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <input value={manualNotes} onChange={e => setManualNotes(e.target.value)} placeholder="Optional notes"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button type="submit"
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition">
              Add
            </button>
          </form>
        </div>
      )}

      {/* Today's Entries */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Today</h2>
          <span className="text-sm font-mono text-gray-600">{totalToday.toFixed(2)}h total</span>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No time tracked today</p>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
              <div key={entry.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {entry.expand?.project?.expand?.client?.name} — {entry.expand?.project?.name}
                  </span>
                  {entry.expand?.task && <span className="text-xs text-gray-500 ml-2">· {entry.expand.task.name}</span>}
                  {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium text-gray-900">{entry.hours.toFixed(2)}h</span>
                  <button onClick={() => deleteEntry.mutate(entry.id)} className="text-gray-300 hover:text-red-400 text-xs transition">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
