import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { client } from '../lib/client'

const isTauri = '__TAURI_INTERNALS__' in window

const LS_TOKEN = 'google_access_token'
const LS_OLLAMA_MODEL = 'ollama_model'
const OLLAMA_URL = 'http://localhost:11434/api/generate'

function fmtDate(d) {
  return new Date(d).toISOString().split('T')[0]
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}

function todayStr() {
  return fmtDate(new Date())
}

function eventDurationHours(event) {
  const start = event.start?.dateTime
  const end = event.end?.dateTime
  if (!start || !end) return null
  return Math.round(((new Date(end) - new Date(start)) / 3600000) * 100) / 100
}

function formatEventTime(event) {
  if (event.start?.date) return 'All day'
  const start = new Date(event.start?.dateTime)
  const end = new Date(event.end?.dateTime)
  return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function getAttendeeEmails(event) {
  return (event.attendees || []).map(a => a.email).filter(Boolean)
}

async function suggestClientForEvent(event, clientNames, model) {
  const emails = getAttendeeEmails(event)
  if (emails.length === 0 && !event.summary) return null

  const prompt = `You are a billing assistant. Given a meeting, identify which client it should be billed to.

Clients: ${clientNames.join(', ')}

Meeting title: "${event.summary || '(no title)'}"
Attendee emails: ${emails.length > 0 ? emails.join(', ') : '(none)'}

Reply with ONLY the exact client name from the list above, or "unknown" if you cannot determine it. No explanation, just the name.`

  try {
    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const suggestion = data.response?.trim()
    // Only return if it matches a real client name (case-insensitive)
    const match = clientNames.find(n => n.toLowerCase() === suggestion?.toLowerCase())
    return match || null
  } catch {
    return null
  }
}

export default function CalendarImport() {
  const qc = useQueryClient()
  const [token, setToken] = useState(() => localStorage.getItem(LS_TOKEN))
  const [connecting, setConnecting] = useState(false)
  const [dateFrom, setDateFrom] = useState(addDays(todayStr(), -28))
  const [dateTo, setDateTo] = useState(todayStr())
  const [events, setEvents] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestProgress, setSuggestProgress] = useState(0)
  const [mappings, setMappings] = useState({}) // eventId -> { projectId, taskId, include, aiSuggested }
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(0)
  const [ollamaModel, setOllamaModel] = useState(() => localStorage.getItem(LS_OLLAMA_MODEL) || 'llama3.2')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => client.records('projects_with_client').list({
      filters: [{ column: 'active', op: 'equal', value: '1' }],
      order: ['name'],
      pagination: { limit: 500 }
    }).then(r => r.records)
  })

  const { data: dbClients = [] } = useQuery({
    queryKey: ['clients_all'],
    queryFn: () => client.records('clients').list({
      order: ['name'],
      pagination: { limit: 500 }
    }).then(r => r.records)
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks_all'],
    queryFn: () => client.records('tasks').list({
      order: ['name'],
      pagination: { limit: 500 }
    }).then(r => r.records)
  })

  const createEntry = useMutation({
    mutationFn: (data) => client.records('time_entries').create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['week_entries'] })
  })

  async function connect() {
    if (!isTauri) { alert('Calendar import requires the desktop app.'); return }
    setConnecting(true)
    try {
      const t = await tauriInvoke('google_auth_start')
      localStorage.setItem(LS_TOKEN, t)
      setToken(t)
    } catch (e) {
      alert('Google auth failed: ' + e)
    } finally {
      setConnecting(false)
    }
  }

  function disconnect() {
    localStorage.removeItem(LS_TOKEN)
    setToken(null)
    setEvents(null)
    setMappings({})
  }

  async function fetchEvents() {
    if (!isTauri) return
    setFetching(true)
    try {
      const timeMin = new Date(dateFrom + 'T00:00:00').toISOString()
      const timeMax = new Date(dateTo + 'T23:59:59').toISOString()
      const data = await tauriInvoke('google_fetch_events', { accessToken: token, timeMin, timeMax })

      if (data.error?.code === 401) {
        disconnect()
        alert('Google session expired. Please reconnect.')
        return
      }

      const items = (data.items || []).filter(e => eventDurationHours(e) !== null)
      setEvents(items)

      // Default mappings with no project
      const m = {}
      items.forEach(e => { m[e.id] = { include: true, projectId: '', taskId: '', aiSuggested: false } })
      setMappings(m)

      // Fire AI suggestions after events load
      if (items.length > 0 && dbClients.length > 0) {
        runSuggestions(items, m)
      }
    } catch (e) {
      alert('Failed to fetch events: ' + e)
    } finally {
      setFetching(false)
    }
  }

  async function runSuggestions(items, baseMappings) {
    setSuggesting(true)
    setSuggestProgress(0)
    const clientNames = dbClients.map(c => c.name)
    const updated = { ...baseMappings }
    let done = 0

    // Run in parallel batches of 4
    const batchSize = 4
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      await Promise.all(batch.map(async event => {
        const suggestedClient = await suggestClientForEvent(event, clientNames, ollamaModel)
        if (suggestedClient) {
          // Find the first active project for this client
          const matchedClient = dbClients.find(c => c.name === suggestedClient)
          if (matchedClient) {
            const proj = projects.find(p => p.client === matchedClient.id || p.client_name === suggestedClient)
            if (proj) {
              updated[event.id] = { ...updated[event.id], projectId: proj.id, aiSuggested: true }
            }
          }
        }
        done++
        setSuggestProgress(Math.round((done / items.length) * 100))
      }))
      // Flush state after each batch so UI updates progressively
      setMappings({ ...updated })
    }

    setSuggesting(false)
  }

  async function importSelected() {
    setImporting(true)
    let count = 0
    const selected = events.filter(e => mappings[e.id]?.include && mappings[e.id]?.projectId)
    const [rangeStart, rangeEnd] = selected.reduce((acc, event) => {
      const start = event.start.dateTime
      const end = event.end.dateTime
      if (!acc[0] || start < acc[0]) acc[0] = start
      if (!acc[1] || end > acc[1]) acc[1] = end
      return acc
    }, [null, null])

    const existingEntries = selected.length === 0
      ? []
      : await client.records('time_entries').list({
          filters: [
            { column: 'started_at', op: 'greaterThanEqual', value: rangeStart },
            { column: 'ended_at', op: 'lessThanEqual', value: rangeEnd },
          ],
          pagination: { limit: 2000 }
        }).then(r => r.records)

    const importedEventIds = new Set(
      existingEntries.map(entry => entry.source_event_id).filter(Boolean)
    )

    for (const event of selected) {
      if (importedEventIds.has(event.id)) continue
      const { projectId, taskId } = mappings[event.id]
      const hours = eventDurationHours(event)
      const date = fmtDate(event.start.dateTime)
      try {
        await createEntry.mutateAsync({
          project: projectId,
          task: taskId || null,
          date,
          hours,
          notes: event.summary || '',
          started_at: event.start.dateTime,
          ended_at: event.end.dateTime,
          source_event_id: event.id,
        })
        importedEventIds.add(event.id)
        count++
      } catch (e) {
        console.error('Failed to import event', event.summary, e)
      }
    }
    setImported(count)
    setImporting(false)
  }

  function saveOllamaModel(val) {
    setOllamaModel(val)
    localStorage.setItem(LS_OLLAMA_MODEL, val)
  }

  const selectedCount = events?.filter(e => mappings[e.id]?.include && mappings[e.id]?.projectId).length ?? 0
  const aiFilledCount = events?.filter(e => mappings[e.id]?.aiSuggested && mappings[e.id]?.projectId).length ?? 0

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Import from Google Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Backfill time entries from your calendar meetings</p>
        </div>
        {token && (
          <button onClick={disconnect} className="text-sm text-gray-400 hover:text-red-500 transition">
            Disconnect Google
          </button>
        )}
      </div>

      {!token ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <div className="text-4xl mb-4">📅</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Connect Google Calendar</h2>
          <p className="text-sm text-gray-500 mb-6">
            Authorize read-only access to pull your meetings and convert them to time entries.
          </p>
          <button
            onClick={connect}
            disabled={connecting}
            className="bg-blue-600 text-white rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {connecting ? 'Opening browser…' : 'Connect Google Calendar'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Date range + Ollama settings */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button
                onClick={fetchEvents}
                disabled={fetching || suggesting}
                className="bg-gray-900 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
              >
                {fetching ? 'Fetching…' : 'Fetch events'}
              </button>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <span className="text-xs text-gray-400">AI model (Ollama):</span>
              <input
                value={ollamaModel}
                onChange={e => saveOllamaModel(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-300">auto-suggests billing client from attendee emails</span>
            </div>
          </div>

          {/* AI suggestion progress */}
          {suggesting && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-3 flex items-center gap-3">
              <div className="w-full bg-blue-100 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${suggestProgress}%` }} />
              </div>
              <span className="text-xs text-blue-600 whitespace-nowrap">AI suggesting… {suggestProgress}%</span>
            </div>
          )}

          {/* Event list */}
          {events !== null && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {events.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">No meetings found in this date range</div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-700">{events.length} meetings found</span>
                      {aiFilledCount > 0 && (
                        <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">
                          ✦ {aiFilledCount} AI suggested
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 text-sm">
                      <button onClick={() => setMappings(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, include: true }])))}
                        className="text-blue-600 hover:text-blue-800">Select all</button>
                      <button onClick={() => setMappings(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, include: false }])))}
                        className="text-gray-400 hover:text-gray-600">Deselect all</button>
                    </div>
                  </div>

                  <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                    {events.map(event => {
                      const m = mappings[event.id] || {}
                      const hours = eventDurationHours(event)
                      const projectTasks = tasks.filter(t => t.project === m.projectId)
                      const attendeeEmails = getAttendeeEmails(event)
                      return (
                        <div key={event.id} className={`px-5 py-3.5 flex items-start gap-4 ${!m.include ? 'opacity-40' : ''}`}>
                          <input type="checkbox" checked={m.include ?? true}
                            onChange={e => setMappings(prev => ({ ...prev, [event.id]: { ...prev[event.id], include: e.target.checked } }))}
                            className="mt-1 accent-blue-600" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-gray-900 truncate">{event.summary || '(No title)'}</span>
                              <span className="text-xs text-gray-400 whitespace-nowrap">{formatEventTime(event)}</span>
                              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono whitespace-nowrap">{hours}h</span>
                            </div>
                            {attendeeEmails.length > 0 && (
                              <div className="text-xs text-gray-400 mb-2 truncate">
                                {attendeeEmails.slice(0, 4).join(', ')}{attendeeEmails.length > 4 ? ` +${attendeeEmails.length - 4}` : ''}
                              </div>
                            )}
                            <div className="flex gap-2 items-center">
                              {m.aiSuggested && m.projectId && (
                                <span className="text-purple-500 text-xs" title="AI suggested">✦</span>
                              )}
                              <select
                                value={m.projectId || ''}
                                onChange={e => setMappings(prev => ({ ...prev, [event.id]: { ...prev[event.id], projectId: e.target.value, taskId: '', aiSuggested: false } }))}
                                className={`flex-1 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${m.aiSuggested && m.projectId ? 'border-purple-200' : 'border-gray-200'}`}
                              >
                                <option value="">Select project…</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.client_name} — {p.name}</option>
                                ))}
                              </select>
                              {projectTasks.length > 0 && (
                                <select
                                  value={m.taskId || ''}
                                  onChange={e => setMappings(prev => ({ ...prev, [event.id]: { ...prev[event.id], taskId: e.target.value } }))}
                                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                  <option value="">No task</option>
                                  {projectTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-gray-400 whitespace-nowrap mt-1">
                            {new Date(event.start.dateTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                      {selectedCount} event{selectedCount !== 1 ? 's' : ''} ready to import
                      {selectedCount < events.filter(e => mappings[e.id]?.include).length && (
                        <span className="text-orange-500"> (assign a project to include)</span>
                      )}
                    </span>
                    <div className="flex items-center gap-3">
                      {imported > 0 && (
                        <span className="text-sm text-green-600 font-medium">✓ {imported} imported</span>
                      )}
                      <button
                        onClick={importSelected}
                        disabled={importing || selectedCount === 0}
                        className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
                      >
                        {importing ? 'Importing…' : `Import ${selectedCount}`}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
