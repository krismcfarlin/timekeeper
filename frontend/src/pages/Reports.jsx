import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pb'

function startOf(type, date = new Date()) {
  if (type === 'week') {
    const d = new Date(date)
    const day = d.getDay()
    d.setDate(d.getDate() - day)
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

export default function Reports() {
  const [period, setPeriod] = useState('week')
  const [ref, setRef] = useState(new Date())

  const start = fmtDate(startOf(period, ref))
  const end = fmtDate(endOf(period, ref))

  const { data: entries = [] } = useQuery({
    queryKey: ['report_entries', start, end],
    queryFn: () => pb.collection('time_entries').getFullList({
      filter: `date>="${start}" && date<="${end}"`,
      expand: 'project,project.client,task',
      sort: 'date'
    })
  })

  const totalHours = entries.reduce((s, e) => s + (e.hours || 0), 0)

  // Group by client
  const byClient = useMemo(() => {
    const map = {}
    for (const entry of entries) {
      const clientName = entry.expand?.project?.expand?.client?.name || 'Unknown'
      const projectName = entry.expand?.project?.name || 'Unknown'
      if (!map[clientName]) map[clientName] = { hours: 0, projects: {} }
      map[clientName].hours += entry.hours || 0
      if (!map[clientName].projects[projectName]) map[clientName].projects[projectName] = 0
      map[clientName].projects[projectName] += entry.hours || 0
    }
    return Object.entries(map).sort((a, b) => b[1].hours - a[1].hours)
  }, [entries])

  // For week view: daily breakdown
  const dailyTotals = useMemo(() => {
    if (period !== 'week') return null
    const days = {}
    const s = startOf('week', ref)
    for (let i = 0; i < 7; i++) {
      const d = new Date(s)
      d.setDate(s.getDate() + i)
      days[fmtDate(d)] = 0
    }
    for (const e of entries) days[e.date] = (days[e.date] || 0) + (e.hours || 0)
    return days
  }, [entries, period, ref])

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {['week', 'month', 'year'].map(p => (
              <button key={p} onClick={() => { setPeriod(p); setRef(new Date()) }}
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
          byClient.map(([clientName, data]) => (
            <div key={clientName} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900 text-sm">{clientName}</span>
                <span className="font-mono text-sm font-medium text-gray-900">{data.hours.toFixed(2)}h</span>
              </div>
              <div className="space-y-1">
                {Object.entries(data.projects).map(([proj, hrs]) => (
                  <div key={proj} className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">{proj}</span>
                    <span className="text-xs font-mono text-gray-500">{hrs.toFixed(2)}h</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
