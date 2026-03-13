import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pb'

const LS_KEY = 'timekeeper_active_timer'

function fmtDate(d) {
  return d.toISOString().split('T')[0]
}

function todayStr() {
  return fmtDate(new Date())
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  const offset = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - offset)
  return fmtDate(d)
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}

function formatHours(h) {
  if (!h) return '0:00'
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return `${hrs}:${String(mins).padStart(2, '0')}`
}

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short' })
}

function saveTimerState(state) {
  if (state) localStorage.setItem(LS_KEY, JSON.stringify(state))
  else localStorage.removeItem(LS_KEY)
}

function loadTimerState() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) } catch { return null }
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Timer() {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(todayStr())

  // Timer state
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [activeEntryId, setActiveEntryId] = useState(null)
  const [timerProjectId, setTimerProjectId] = useState('')
  const intervalRef = useRef(null)

  // Add form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addProject, setAddProject] = useState('')
  const [addTask, setAddTask] = useState('')
  const [addHours, setAddHours] = useState('')
  const [addNotes, setAddNotes] = useState('')

  // Edit state
  const [editingId, setEditingId] = useState(null)
  const [editHours, setEditHours] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const today = todayStr()
  const weekStart = getWeekStart(selectedDate)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = weekDays[6]

  // Restore timer from localStorage on mount
  useEffect(() => {
    const saved = loadTimerState()
    if (saved) {
      const elapsedSecs = Math.floor((Date.now() - new Date(saved.startedAt).getTime()) / 1000)
      setActiveEntryId(saved.entryId)
      setTimerProjectId(saved.projectId || '')
      setElapsed(Math.max(0, elapsedSecs))
      setRunning(true)
    }
  }, [])

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [running])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => pb.collection('projects').getFullList({ expand: 'client', filter: 'active=true', sort: 'name' })
  })

  const { data: addTasks = [] } = useQuery({
    queryKey: ['tasks', addProject],
    queryFn: () => addProject
      ? pb.collection('tasks').getFullList({ filter: `project.id = "${addProject}"`, sort: 'name' })
      : Promise.resolve([]),
    enabled: !!addProject
  })

  const { data: weekEntries = [], refetch: refetchWeek } = useQuery({
    queryKey: ['week_entries', weekStart, weekEnd],
    queryFn: () => pb.collection('time_entries').getFullList({
      filter: `date >= "${weekStart}" && date <= "${weekEnd}" && hours > 0.001`,
      expand: 'project,project.client,task',
      sort: '-created'
    })
  })

  const dayEntries = useMemo(() =>
    weekEntries.filter(e => e.date === selectedDate),
    [weekEntries, selectedDate]
  )

  const dayTotals = useMemo(() => {
    const totals = {}
    weekDays.forEach(d => { totals[d] = 0 })
    weekEntries.forEach(e => { if (totals[e.date] !== undefined) totals[e.date] += e.hours || 0 })
    return totals
  }, [weekEntries, weekDays])

  const weekTotal = Object.values(dayTotals).reduce((s, h) => s + h, 0)
  const dayTotal = dayEntries.reduce((s, e) => s + (e.hours || 0), 0)

  const timerProject = projects.find(p => p.id === timerProjectId)

  const createEntry = useMutation({
    mutationFn: (data) => pb.collection('time_entries').create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['week_entries'] })
  })

  const updateEntry = useMutation({
    mutationFn: ({ id, ...data }) => pb.collection('time_entries').update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['week_entries'] })
  })

  const deleteEntry = useMutation({
    mutationFn: (id) => pb.collection('time_entries').delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['week_entries'] })
  })

  async function startTimer(projectId, taskId, notes) {
    if (running) return
    const now = new Date().toISOString()
    setTimerProjectId(projectId)
    setElapsed(0)
    setRunning(true)
    const created = await createEntry.mutateAsync({
      project: projectId,
      task: taskId || null,
      date: todayStr(),
      hours: 0.001,
      notes: notes || '',
      started_at: now,
      ended_at: ''
    })
    setActiveEntryId(created.id)
    saveTimerState({ entryId: created.id, startedAt: now, projectId, taskId, notes: notes || '' })
  }

  function stopTimer() {
    setRunning(false)
    clearInterval(intervalRef.current)
    const hours = parseFloat((elapsed / 3600).toFixed(4))
    if (activeEntryId) {
      updateEntry.mutate({
        id: activeEntryId,
        hours: hours > 0.001 ? hours : 0.01,
        ended_at: new Date().toISOString()
      })
    }
    saveTimerState(null)
    setActiveEntryId(null)
    setElapsed(0)
    setTimerProjectId('')
  }

  function submitAdd(e) {
    e.preventDefault()
    createEntry.mutate({
      project: addProject,
      task: addTask || null,
      date: selectedDate,
      hours: parseFloat(addHours),
      notes: addNotes,
      started_at: '',
      ended_at: 'manual'
    })
    setAddProject(''); setAddTask(''); setAddHours(''); setAddNotes('')
    setShowAddForm(false)
  }

  function submitEdit(e) {
    e.preventDefault()
    updateEntry.mutate({ id: editingId, hours: parseFloat(editHours), notes: editNotes })
    setEditingId(null)
  }

  return (
    <div>
      {/* Running timer banner */}
      {running && (
        <div className="bg-orange-500 text-white px-6 py-3 flex items-center justify-between -mx-6 -mt-8 mb-6 rounded-b-2xl">
          <div className="flex items-center gap-4">
            <span className="font-mono text-2xl font-bold tracking-tight">{formatElapsed(elapsed)}</span>
            {timerProject && (
              <span className="text-sm opacity-90">
                {timerProject.expand?.client?.[0]?.name} — {timerProject.name}
              </span>
            )}
          </div>
          <button onClick={stopTimer}
            className="bg-white text-orange-600 rounded-lg px-4 py-1.5 text-sm font-semibold hover:bg-orange-50 transition">
            Stop
          </button>
        </div>
      )}

      {/* Date navigation */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="flex border border-gray-200 rounded overflow-hidden">
            <button onClick={() => setSelectedDate(d => addDays(d, -1))}
              className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition text-sm">←</button>
            <button onClick={() => setSelectedDate(d => addDays(d, 1))}
              className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 border-l border-gray-200 transition text-sm">→</button>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">{formatDisplayDate(selectedDate)}</h2>
          {selectedDate !== today && (
            <button onClick={() => setSelectedDate(today)}
              className="text-sm text-orange-500 hover:text-orange-600 font-medium underline-offset-2 hover:underline">
              Return to today
            </button>
          )}
        </div>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

        {/* Week bar */}
        <div className="flex border-b border-gray-100">
          {/* + Track time */}
          <div className="w-28 flex-shrink-0 flex flex-col items-center justify-center gap-1.5 py-4 border-r border-gray-100">
            <button
              onClick={() => { setShowAddForm(v => !v); setAddProject(''); setAddTask(''); setAddHours(''); setAddNotes('') }}
              className="w-11 h-11 bg-green-600 hover:bg-green-700 text-white rounded-xl flex items-center justify-center text-2xl font-light transition shadow-sm">
              +
            </button>
            <span className="text-xs text-gray-400 font-medium">Track time</span>
          </div>

          {/* Day columns */}
          <div className="flex-1 grid grid-cols-7 divide-x divide-gray-100">
            {weekDays.map((d, i) => {
              const isToday = d === today
              const isSelected = d === selectedDate
              const hrs = dayTotals[d] || 0
              return (
                <button key={d} onClick={() => setSelectedDate(d)}
                  className={`py-3 px-2 text-center hover:bg-gray-50 transition ${isSelected ? 'bg-orange-50' : ''}`}>
                  <div className={`text-xs font-medium mb-1 ${isToday ? 'text-orange-500' : 'text-gray-400'}`}>
                    {DAY_LABELS[i]}
                  </div>
                  <div className={`text-sm font-semibold ${isToday && hrs > 0 ? 'text-orange-500' : isSelected ? 'text-gray-800' : hrs > 0 ? 'text-gray-600' : 'text-gray-300'}`}>
                    {formatHours(hrs)}
                  </div>
                  {isSelected && <div className="mt-1 h-0.5 bg-orange-400 rounded-full mx-2" />}
                </button>
              )
            })}
          </div>

          {/* Week total */}
          <div className="w-24 flex-shrink-0 flex flex-col items-end justify-center px-4 border-l border-gray-100">
            <div className="text-xs text-gray-400 mb-1">Week total</div>
            <div className="text-sm font-bold text-gray-800">{formatHours(weekTotal)}</div>
          </div>
        </div>

        {/* Add entry form */}
        {showAddForm && (
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
            <form onSubmit={submitAdd} className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-gray-500 mb-1">Project *</label>
                <select value={addProject} onChange={e => { setAddProject(e.target.value); setAddTask('') }} required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white">
                  <option value="">Select project...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.expand?.client?.[0]?.name} — {p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Task</label>
                <select value={addTask} onChange={e => setAddTask(e.target.value)} disabled={!addProject}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white disabled:opacity-50">
                  <option value="">No task</option>
                  {addTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hours *</label>
                <input type="number" step="0.25" min="0.25" value={addHours}
                  onChange={e => setAddHours(e.target.value)} placeholder="1.5" required
                  className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <input value={addNotes} onChange={e => setAddNotes(e.target.value)}
                  placeholder="What did you work on?"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div className="flex gap-2 items-end">
                <button type="submit"
                  className="bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition">
                  Save
                </button>
                {addProject && !running && (
                  <button type="button"
                    onClick={() => { startTimer(addProject, addTask, addNotes); setShowAddForm(false) }}
                    className="border border-orange-400 text-orange-500 rounded-lg px-4 py-2 text-sm font-medium hover:bg-orange-50 transition flex items-center gap-1">
                    ⏱ Start timer
                  </button>
                )}
                <button type="button" onClick={() => setShowAddForm(false)}
                  className="text-sm text-gray-400 hover:text-gray-600 px-2 py-2">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Entry rows */}
        <div className="divide-y divide-gray-50">
          {dayEntries.length === 0 && !showAddForm && (
            <div className="py-14 text-center">
              <p className="text-sm text-gray-400">No time tracked for this day</p>
              <button onClick={() => setShowAddForm(true)}
                className="mt-2 text-sm text-orange-500 hover:text-orange-600 font-medium">
                + Add an entry
              </button>
            </div>
          )}

          {dayEntries.map(entry => {
            const project = entry.expand?.project?.[0]
            const client = project?.expand?.client?.[0]
            const task = entry.expand?.task?.[0]

            if (editingId === entry.id) {
              return (
                <div key={entry.id} className="px-6 py-4 bg-orange-50 border-l-2 border-orange-400">
                  <form onSubmit={submitEdit} className="flex gap-3 items-end flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-2">
                        {project?.name}{client && <span className="font-normal text-gray-500"> ({client.name})</span>}
                      </p>
                    </div>
                    <div className="flex-1" />
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Hours</label>
                      <input type="number" step="0.01" value={editHours} onChange={e => setEditHours(e.target.value)}
                        className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-xs text-gray-500 mb-1">Notes</label>
                      <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes"
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className="bg-orange-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-orange-600">Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-sm text-gray-400 hover:text-gray-600 px-2">Cancel</button>
                    </div>
                  </form>
                </div>
              )
            }

            return (
              <div key={entry.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {project?.name}
                    {client && <span className="font-normal text-gray-500"> ({client.name})</span>}
                  </p>
                  {task && <p className="text-sm text-gray-500">{task.name}</p>}
                  {entry.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{entry.notes}</p>}
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <span className="text-base font-semibold text-gray-800 w-14 text-right tabular-nums">
                    {formatHours(entry.hours)}
                  </span>
                  <button
                    onClick={() => {
                      const pId = Array.isArray(entry.project) ? entry.project[0] : entry.project
                      const tId = Array.isArray(entry.task) ? (entry.task[0] || '') : (entry.task || '')
                      startTimer(pId, tId, entry.notes)
                    }}
                    disabled={running}
                    className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:border-orange-400 hover:text-orange-500 disabled:opacity-30 disabled:cursor-not-allowed transition">
                    <span className="text-xs">⏱</span> Start
                  </button>
                  <button
                    onClick={() => { setEditingId(entry.id); setEditHours(entry.hours.toFixed(2)); setEditNotes(entry.notes || '') }}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition">
                    Edit
                  </button>
                  <button
                    onClick={() => deleteEntry.mutate(entry.id)}
                    className="text-gray-200 hover:text-red-400 text-sm transition opacity-0 group-hover:opacity-100 ml-1">
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Day total footer */}
        {dayEntries.length > 0 && (
          <div className="px-6 py-4 flex justify-end items-center gap-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">Total:</span>
            <span className="text-base font-bold text-gray-900 tabular-nums">{formatHours(dayTotal)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
