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
  const [activeEntryId, setActiveEntryId] = useState(null)
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedTask, setSelectedTask] = useState('')
  const [notes, setNotes] = useState('')
  const intervalRef = useRef(null)

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

  // Restore in-progress timer on page load
  const { data: inProgress = [] } = useQuery({
    queryKey: ['in_progress'],
    queryFn: () => pb.collection('time_entries').getFullList({
      filter: 'started_at!="" && ended_at=""',
      expand: 'project,task',
    }),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (inProgress.length > 0 && !running && !activeEntryId) {
      const entry = inProgress[0]
      const elapsedSecs = Math.floor((Date.now() - new Date(entry.started_at).getTime()) / 1000)
      const projectId = Array.isArray(entry.project) ? entry.project[0] : entry.project
      const taskId = Array.isArray(entry.task) ? (entry.task[0] || '') : (entry.task || '')
      setActiveEntryId(entry.id)
      setSelectedProject(projectId || '')
      setSelectedTask(taskId)
      setNotes(entry.notes || '')
      setElapsed(Math.max(0, elapsedSecs))
      setRunning(true)
    }
  }, [inProgress])

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
      filter: `date="${today()}" && ended_at!=""`,
      expand: 'project,project.client,task',
      sort: '-created'
    })
  })

  const createEntry = useMutation({
    mutationFn: (data) => pb.collection('time_entries').create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time_entries'] })
  })

  const updateEntry = useMutation({
    mutationFn: ({ id, ...data }) => pb.collection('time_entries').update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_entries'] })
      qc.invalidateQueries({ queryKey: ['in_progress'] })
    }
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

  async function startTimer() {
    if (!selectedProject) return
    const now = new Date().toISOString()
    setElapsed(0)
    setRunning(true)
    const entry = await createEntry.mutateAsync({
      project: selectedProject,
      task: selectedTask || null,
      date: today(),
      hours: 0.001,
      notes,
      started_at: now,
      ended_at: ''
    })
    setActiveEntryId(entry.id)
  }

  function stopTimer() {
    setRunning(false)
    clearInterval(intervalRef.current)
    const hours = parseFloat((elapsed / 3600).toFixed(4))
    if (activeEntryId) {
      updateEntry.mutate({
        id: activeEntryId,
        hours: hours > 0 ? hours : 0.01,
        ended_at: new Date().toISOString()
      })
    }
    setActiveEntryId(null)
    setElapsed(0)
    setNotes('')
  }

  function submitManual(e) {
    e.preventDefault()
    createEntry.mutate({
      project: manualProject,
      task: manualTask || null,
      date: manualDate,
      hours: parseFloat(manualHours),
      notes: manualNotes,
      started_at: '',
      ended_at: 'manual'
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
            disabled={running}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            <option value="">Select project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.expand?.client?.[0]?.name} — {p.name}
              </option>
            ))}
          </select>
          <select
            value={selectedTask}
            onChange={e => setSelectedTask(e.target.value)}
            disabled={running || !selectedProject}
            className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
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
          <span className={`font-mono text-4xl font-bold transition-colors ${running ? 'text-blue-600' : 'text-gray-900'}`}>
            {formatDuration(elapsed)}
          </span>
          <button
            onClick={running ? stopTimer : startTimer}
            disabled={!selectedProject && !running}
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
                  <option key={p.id} value={p.id}>{p.expand?.client?.[0]?.name} — {p.name}</option>
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
                    {entry.expand?.project?.[0]?.expand?.client?.[0]?.name} — {entry.expand?.project?.[0]?.name}
                  </span>
                  {entry.expand?.task?.[0] && <span className="text-xs text-gray-500 ml-2">· {entry.expand.task[0].name}</span>}
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
