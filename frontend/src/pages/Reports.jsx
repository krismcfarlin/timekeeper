import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { client } from '../lib/client'

function startOf(type, date = new Date()) {
  if (type === 'week') {
    const d = new Date(date)
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (type === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
  if (type === 'year') return new Date(date.getFullYear(), 0, 1)
}

function endOf(type, date = new Date()) {
  if (type === 'week') {
    const d = startOf('week', date)
    d.setDate(d.getDate() + 6)
    return d
  }
  if (type === 'month') return new Date(date.getFullYear(), date.getMonth() + 1, 0)
  if (type === 'year') return new Date(date.getFullYear(), 11, 31)
}

function fmtDate(d) { return d.toISOString().split('T')[0] }

function periodLabel(type, ref) {
  if (type === 'week') {
    const s = startOf('week', ref)
    const e = endOf('week', ref)
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (type === 'month') return ref.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (type === 'year') return String(ref.getFullYear())
}

function shiftRef(type, ref, dir) {
  const d = new Date(ref)
  if (type === 'week') d.setDate(d.getDate() + dir * 7)
  if (type === 'month') d.setMonth(d.getMonth() + dir)
  if (type === 'year') d.setFullYear(d.getFullYear() + dir)
  return d
}

function downloadCsv(entries, filename) {
  const headers = ['Date', 'Client', 'Project', 'Task', 'Notes', 'Hours']
  const rows = entries.map(e => [
    e.date,
    e.client_name || '',
    e.project_name || '',
    e.task_name || '',
    (e.notes || '').replace(/"/g, '""'),
    e.hours?.toFixed(2) || '0',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams()
  const clientFilter = searchParams.get('clientId')

  const [period, setPeriod] = useState('week')
  const [ref, setRef] = useState(new Date())
  const [expandedClient, setExpandedClient] = useState(null)

  const start = fmtDate(startOf(period, ref))
  const end = fmtDate(endOf(period, ref))

  const { data: entries = [] } = useQuery({
    queryKey: ['report_entries', start, end],
    queryFn: () => client.records('time_entries_full').list({
      filters: [
        { column: 'date', op: 'greaterThanEqual', value: start },
        { column: 'date', op: 'lessThanEqual', value: end },
        { column: 'hours', op: 'greaterThan', value: '0.001' }
      ],
      order: ['date'],
      pagination: { limit: 1000 }
    }).then(r => r.records)
  })

  const filteredEntries = useMemo(() => {
    if (!clientFilter) return entries
    return entries.filter(e => e.client_id === clientFilter)
  }, [entries, clientFilter])

  const totalHours = filteredEntries.reduce((s, e) => s + (e.hours || 0), 0)

  const byClient = useMemo(() => {
    const map = {}
    for (const entry of filteredEntries) {
      const clientName = entry.client_name || 'Unknown'
      const projectName = entry.project_name || 'Unknown'
      if (!map[clientName]) map[clientName] = { hours: 0, projects: {}, entries: [] }
      map[clientName].hours += entry.hours || 0
      map[clientName].entries.push(entry)
      if (!map[clientName].projects[projectName]) map[clientName].projects[projectName] = 0
      map[clientName].projects[projectName] += entry.hours || 0
    }
    return Object.entries(map).sort((a, b) => b[1].hours - a[1].hours)
  }, [filteredEntries])

  const dailyTotals = useMemo(() => {
    if (period !== 'week') return null
    const days = {}
    const s = startOf('week', ref)
    for (let i = 0; i < 7; i++) {
      const d = new Date(s)
      d.setDate(s.getDate() + i)
      days[fmtDate(d)] = 0
    }
    for (const e of filteredEntries) days[e.date] = (days[e.date] || 0) + (e.hours || 0)
    return days
  }, [filteredEntries, period, ref])

  const csvFilename = `timekeeper-${period}-${start}.csv`

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          {clientFilter && (
            <button
              onClick={() => setSearchParams({})}
              className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-blue-200 transition"
            >
              Filtered by client <span className="opacity-70">✕</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCsv(filteredEntries, csvFilename)}
            disabled={filteredEntries.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {['week', 'month', 'year'].map(p => (
              <button key={p} onClick={() => { setPeriod(p); setRef(new Date()); setExpandedClient(null) }}
                className={`px-3 py-1.5 capitalize transition ${period === p ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setRef(r => shiftRef(period, r, -1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">‹</button>
            <span className="text-sm text-gray-700 min-w-[180px] text-center">{periodLabel(period, ref)}</span>
            <button onClick={() => setRef(r => shiftRef(period, r, 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">›</button>
          </div>
        </div>
      </div>

      {/* Total */}
      <div className="bg-blue-600 text-white rounded-2xl p-6">
        <p className="text-sm opacity-80">Total hours</p>
        <p className="text-4xl font-bold font-mono mt-1">{totalHours.toFixed(2)}h</p>
      </div>

      {/* Daily bars (week only) */}
      {dailyTotals && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">Daily breakdown</p>
          <div className="flex gap-2 items-end h-24">
            {Object.entries(dailyTotals).map(([date, hours]) => {
              const maxH = Math.max(...Object.values(dailyTotals), 1)
              const pct = (hours / maxH) * 100
              const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{hours > 0 ? hours.toFixed(1) : ''}</span>
                  <div className="w-full bg-gray-100 rounded-t-sm" style={{ height: '64px', display: 'flex', alignItems: 'flex-end' }}>
                    <div className="w-full bg-blue-500 rounded-t-sm transition-all" style={{ height: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* By client */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-700">By client</p>
        {byClient.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No time entries in this period</p>
        ) : (
          byClient.map(([clientName, data]) => {
            const isExpanded = expandedClient === clientName
            return (
              <div key={clientName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Client row — clickable */}
                <button
                  className="w-full text-left px-4 py-4 hover:bg-gray-50 transition"
                  onClick={() => setExpandedClient(isExpanded ? null : clientName)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{clientName}</span>
                      <span className="text-xs text-gray-400">{data.entries.length} {data.entries.length === 1 ? 'entry' : 'entries'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-medium text-gray-900">{data.hours.toFixed(2)}h</span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {!isExpanded && (
                    <div className="mt-1.5 space-y-0.5">
                      {Object.entries(data.projects).map(([proj, hrs]) => (
                        <div key={proj} className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">{proj}</span>
                          <span className="text-xs font-mono text-gray-500">{hrs.toFixed(2)}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>

                {/* Expanded entries table */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Entries</span>
                      <button
                        onClick={() => downloadCsv(data.entries, `${clientName.toLowerCase().replace(/\s+/g, '-')}-${start}.csv`)}
                        className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1 transition"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Export CSV
                      </button>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 text-gray-400">
                          <th className="text-left px-4 py-2 font-medium">Date</th>
                          <th className="text-left px-4 py-2 font-medium">Project</th>
                          <th className="text-left px-4 py-2 font-medium">Task</th>
                          <th className="text-left px-4 py-2 font-medium">Notes</th>
                          <th className="text-right px-4 py-2 font-medium">Hours</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.entries.map(entry => (
                          <tr key={entry.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                              {new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="px-4 py-2 text-gray-700">{entry.project_name || '—'}</td>
                            <td className="px-4 py-2 text-gray-500">{entry.task_name || '—'}</td>
                            <td className="px-4 py-2 text-gray-400 max-w-[200px] truncate">{entry.notes || '—'}</td>
                            <td className="px-4 py-2 font-mono text-gray-700 text-right">{entry.hours?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200 bg-gray-50">
                          <td colSpan={4} className="px-4 py-2 text-gray-500 font-medium">Total</td>
                          <td className="px-4 py-2 font-mono font-semibold text-gray-900 text-right">{data.hours.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
