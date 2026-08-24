import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '../lib/client'
import { invoke } from '@tauri-apps/api/core'

const isTauri = '__TAURI_INTERNALS__' in window

const DEFAULT_PAYMENT_NOTES = `Payment details (USD / Wise):

Name: Kristian McFarlin
Account type: Checking

US transfers (ACH/Wire):
Routing number: 026073150
Account number: 8310357051
Bank: Community Federal Savings Bank, 89-16 Jamaica Ave, Woodhaven, NY 11421, US

International (Swift):
Swift/BIC: CMFGUS33`

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD']
const CURRENCY_SYMBOLS = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', AUD: 'A$', NZD: 'NZ$' }
const DUE_OPTIONS = [
  { value: 'upon_receipt', label: 'Upon receipt' },
  { value: 'net_15',       label: 'Net 15' },
  { value: 'net_30',       label: 'Net 30' },
  { value: 'net_45',       label: 'Net 45' },
  { value: 'net_60',       label: 'Net 60' },
]

function todayStr() { return new Date().toISOString().split('T')[0] }
function fmtMoney(n) { return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function parseSourceEntryIds(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let _tid = 0
function tid() { return `t${++_tid}` }

export default function InvoiceEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id

  // Form fields
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [clientId, setClientId]           = useState('')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState(todayStr())
  const [issueDate, setIssueDate]         = useState(todayStr())
  const [dueDate, setDueDate]             = useState('upon_receipt')
  const [poNumber, setPoNumber]           = useState('')
  const [subject, setSubject]             = useState('')
  const [notes, setNotes]                 = useState(DEFAULT_PAYMENT_NOTES)
  const [discount, setDiscount]           = useState('')
  const [currency, setCurrency]           = useState('USD')
  const [lineItems, setLineItems]         = useState([])
  const [saving, setSaving]               = useState(false)
  const [importing, setImporting]         = useState(false)
  const [importMsg, setImportMsg]         = useState('')

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => client.records('clients').list({
      filters: [{ column: 'archived', op: 'equal', value: '0' }],
      order: ['name'],
      pagination: { limit: 200 }
    }).then(r => r.records)
  })

  // Fetch last invoice number (for auto-increment on new)
  const { data: lastInvoices = [] } = useQuery({
    queryKey: ['last_invoice'],
    queryFn: () => client.records('invoices').list({
      order: ['-created'],
      pagination: { limit: 1 }
    }).then(r => r.records),
    enabled: isNew
  })

  // Auto-set invoice number
  useEffect(() => {
    if (!isNew) return
    if (lastInvoices.length > 0) {
      const n = parseInt(lastInvoices[0].invoice_number) || 100
      setInvoiceNumber(String(n + 1))
    } else {
      setInvoiceNumber('101')
    }
  }, [lastInvoices, isNew])

  // Fetch existing invoice for edit
  const { data: existing } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => client.records('invoices').read(id),
    enabled: !!id
  })

  const { data: existingItems = [] } = useQuery({
    queryKey: ['invoice_items', id],
    queryFn: () => client.records('invoice_line_items').list({
      filters: [{ column: 'invoice', op: 'equal', value: id }],
      pagination: { limit: 500 }
    }).then(r => r.records),
    enabled: !!id
  })

  useEffect(() => {
    if (!existing) return
    setInvoiceNumber(existing.invoice_number)
    setClientId(existing.client)
    setDateFrom(existing.date_from || '')
    setDateTo(existing.date_to || todayStr())
    setIssueDate(existing.issue_date || todayStr())
    setDueDate(existing.due_date || 'upon_receipt')
    setPoNumber(existing.po_number || '')
    setSubject(existing.subject || '')
    setNotes(existing.notes || '')
    setDiscount(existing.discount ? String(existing.discount) : '')
    setCurrency(existing.currency || 'USD')
  }, [existing])

  useEffect(() => {
    if (!existingItems.length) return
    setLineItems(existingItems.map(li => ({
      _id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unit_price,
      itemType: li.item_type,
      sourceEntryIds: parseSourceEntryIds(li.source_entry_ids),
    })))
  }, [existingItems])

  // Load uninvoiced time entries for selected client + date range
  async function loadUninvoicedTime() {
    if (!clientId || !dateFrom || !dateTo) return
    setImporting(true)
    setImportMsg('')
    try {
      const resp = await client.records('time_entries_full').list({
        filters: [
          { column: 'date', op: 'greaterThanEqual', value: dateFrom },
          { column: 'date', op: 'lessThanEqual', value: dateTo },
        ],
        pagination: { limit: 1000 }
      })

      console.log('[Invoice] all entries in range:', resp.records.length, resp.records[0])
      console.log('[Invoice] clientId looking for:', clientId)

      console.log('[Invoice] params id:', id)
      console.log('[Invoice] sample invoice_id from entry:', resp.records.find(e => e.invoice_id)?.invoice_id)
      console.log('[Invoice] match test:', resp.records.find(e => e.invoice_id)?.invoice_id === id)

      // Include uninvoiced + entries already on THIS invoice (re-loading edit)
      const uninvoiced = resp.records.filter(e =>
        e.client_id === clientId && (!e.invoice_id || e.invoice_id === id)
      )
      console.log('[Invoice] matched:', uninvoiced.length, 'hrs:', uninvoiced.reduce((s,e) => s + (e.hours||0), 0).toFixed(2))

      if (uninvoiced.length === 0) {
        setImportMsg(`No uninvoiced time entries found. (${resp.records.length} total in range, clientId=${clientId})`)
        return
      }

      // Group by project, sum hours
      const byProject = {}
      uninvoiced.forEach(e => {
        if (!byProject[e.project_id]) {
          byProject[e.project_id] = { name: e.project_name, hours: 0, ids: [] }
        }
        byProject[e.project_id].hours += e.hours || 0
        byProject[e.project_id].ids.push(e.id)
      })

      const newItems = Object.entries(byProject).map(([, data]) => ({
        _id: tid(),
        description: data.name,
        quantity: parseFloat(data.hours.toFixed(2)),
        unitPrice: 0,
        itemType: 'time',
        sourceEntryIds: data.ids,
      }))

      setLineItems(newItems)
      setImportMsg(`Imported ${uninvoiced.length} entries across ${newItems.length} project(s). Set unit price per row.`)
    } catch (err) {
      console.error('[Invoice] loadUninvoicedTime error:', err)
      setImportMsg(`Error: ${err?.message || String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  function addItem() {
    setLineItems(prev => [...prev, { _id: tid(), description: '', quantity: 1, unitPrice: 0, itemType: 'service', sourceEntryIds: [] }])
  }

  function removeItem(_id) {
    setLineItems(prev => prev.filter(li => li._id !== _id))
  }

  function updateItem(_id, field, value) {
    setLineItems(prev => prev.map(li => li._id === _id ? { ...li, [field]: value } : li))
  }

  const subtotal = lineItems.reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0)
  const discountAmt = subtotal * (parseFloat(discount) || 0) / 100
  const total = subtotal - discountAmt
  const sym = CURRENCY_SYMBOLS[currency] || '$'

  const selectedClient = clients.find(c => c.id === clientId)

  async function save() {
    if (!clientId || !invoiceNumber) return
    setSaving(true)
    try {
      let invoiceId = id

      const invoiceData = {
        invoice_number: invoiceNumber,
        client: clientId,
        date_from: dateFrom,
        date_to: dateTo,
        issue_date: issueDate,
        due_date: dueDate,
        po_number: poNumber,
        subject,
        notes,
        discount: parseFloat(discount) || 0,
        currency,
      }

      if (isNew) {
        invoiceId = await client.records('invoices').create({ ...invoiceData, status: 'draft' })
      } else {
        const previousSourceEntryIds = new Set(
          existingItems.flatMap(li => parseSourceEntryIds(li.source_entry_ids))
        )
        const nextSourceEntryIds = new Set(
          lineItems.flatMap(li => li.sourceEntryIds || [])
        )

        await client.records('invoices').update(id, invoiceData)
        // Delete old line items to recreate
        for (const li of existingItems) {
          await client.records('invoice_line_items').delete(li.id)
        }

        for (const entryId of previousSourceEntryIds) {
          if (!nextSourceEntryIds.has(entryId)) {
            await client.records('time_entries').update(entryId, { invoice_id: null })
          }
        }
      }

      // Create line items
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i]
        await client.records('invoice_line_items').create({
          invoice: invoiceId,
          description: li.description,
          quantity: parseFloat(li.quantity) || 0,
          unit_price: parseFloat(li.unitPrice) || 0,
          item_type: li.itemType,
          source_entry_ids: JSON.stringify(li.sourceEntryIds || []),
          sort_order: i,
        })
        // Mark time entries as invoiced
        for (const entryId of (li.sourceEntryIds || [])) {
          await client.records('time_entries').update(entryId, { invoice_id: invoiceId })
        }
      }

      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['all_line_items'] })
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      qc.invalidateQueries({ queryKey: ['invoice_items', invoiceId] })
      navigate(`/invoices/${invoiceId}`)
    } finally {
      setSaving(false)
    }
  }

  function printPDF() {
    const DUE_LABELS = Object.fromEntries(DUE_OPTIONS.map(o => [o.value, o.label]))
    const rows = lineItems.map(li => {
      const amt = (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)
      return `<tr>
        <td>${li.description}</td>
        <td class="right">${parseFloat(li.quantity || 0).toFixed(2)}</td>
        <td class="right">${sym}${fmtMoney(parseFloat(li.unitPrice) || 0)}</td>
        <td class="right">${sym}${fmtMoney(amt)}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${invoiceNumber}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:760px;margin:0 auto;padding:52px;font-size:14px;line-height:1.5}
  h1{font-size:30px;font-weight:700;margin:0 0 4px}
  .subtitle{color:#666;margin:0 0 36px;font-size:15px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:36px}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-bottom:3px}
  .field p{margin:0;font-weight:500}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{text-align:left;padding:8px 12px;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
  td{padding:11px 12px;border-bottom:1px solid #eee}
  .right{text-align:right}
  th.right{text-align:right}
  .totals{display:flex;flex-direction:column;align-items:flex-end;margin-top:18px;gap:6px}
  .row{display:flex;gap:40px;font-size:14px}
  .row .lbl{width:130px;text-align:right;color:#666}
  .row .amt{width:90px;text-align:right;font-weight:500}
  .row.final{font-size:17px;font-weight:700;border-top:2px solid #111;padding-top:10px;margin-top:4px}
  .notes{margin-top:44px;border-top:1px solid #eee;padding-top:18px;font-size:13px;color:#444}
  .notes strong{display:block;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#999}
  @media print{body{padding:28px}}
</style>
</head>
<body>
<h1>Invoice #${invoiceNumber}</h1>
${subject ? `<p class="subtitle">${subject}</p>` : '<div style="margin-bottom:36px"></div>'}
<div class="grid">
  <div>
    <div class="field"><label>Invoice For</label><p>${selectedClient?.name || ''}</p></div>
    ${issueDate ? `<div class="field"><label>Issue Date</label><p>${issueDate}</p></div>` : ''}
    ${dueDate ? `<div class="field"><label>Due</label><p>${DUE_LABELS[dueDate] || dueDate}</p></div>` : ''}
  </div>
  <div>
    ${poNumber ? `<div class="field"><label>PO Number</label><p>${poNumber}</p></div>` : ''}
    ${dateFrom ? `<div class="field"><label>Period</label><p>${dateFrom} – ${dateTo}</p></div>` : ''}
    <div class="field"><label>Currency</label><p>${currency}</p></div>
  </div>
</div>
<table>
  <thead><tr>
    <th>Description</th>
    <th class="right">Qty</th>
    <th class="right">Unit Price</th>
    <th class="right">Amount</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="row"><span class="lbl">Subtotal</span><span class="amt">${sym}${fmtMoney(subtotal)}</span></div>
  ${discount ? `<div class="row"><span class="lbl">Discount (${discount}%)</span><span class="amt">–${sym}${fmtMoney(discountAmt)}</span></div>` : ''}
  <div class="row final"><span class="lbl">Amount Due</span><span class="amt">${sym}${fmtMoney(total)}</span></div>
</div>
${(notes || DEFAULT_PAYMENT_NOTES).replace(/\n/g, '<br>') ? `<div class="notes"><strong>Notes</strong><br>${(notes || DEFAULT_PAYMENT_NOTES).replace(/\n/g, '<br>')}</div>` : ''}
</body>
</html>`

    if (isTauri) {
      invoke('open_print_preview', { html }).catch(console.error)
    } else {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;left:-9999px'
      document.body.appendChild(iframe)
      iframe.contentDocument.open()
      iframe.contentDocument.write(html)
      iframe.contentDocument.close()
      iframe.contentWindow.onafterprint = () => document.body.removeChild(iframe)
      setTimeout(() => iframe.contentWindow.print(), 400)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isNew
            ? `New invoice${selectedClient ? ` for ${selectedClient.name}` : ''}`
            : `Invoice #${invoiceNumber}`}
        </h1>
        <div className="flex gap-2">
          <button onClick={() => navigate('/invoices')}
            className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={printPDF}
            className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50 transition">
            Print / PDF
          </button>
          <button onClick={save} disabled={saving || !clientId || !invoiceNumber}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition">
            {saving ? 'Saving…' : 'Save invoice'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">

        {/* Meta fields — 2-column grid */}
        <div className="grid grid-cols-2 gap-x-12 gap-y-3">
          {/* Left */}
          <div className="space-y-3">
            <Row label="Invoice ID">
              <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                className="w-32 border border-blue-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Row>
            <Row label="PO Number">
              <input value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="Optional"
                className="w-48 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Row>
            <Row label="Issue Date">
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Row>
            <Row label="Due Date">
              <select value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {DUE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Row>
          </div>
          {/* Right */}
          <div className="space-y-3">
            <Row label="Invoice For">
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[200px]">
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Row>
            <Row label="Discount">
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" max="100" step="0.5" value={discount}
                  onChange={e => setDiscount(e.target.value)} placeholder="0"
                  className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </Row>
            <Row label="Currency">
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Row>
          </div>
        </div>

        {/* Subject */}
        <div className="flex items-center gap-4">
          <label className="w-28 text-sm text-gray-500 flex-shrink-0">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Invoice subject (optional)"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {/* Import uninvoiced time */}
        <div className="border border-dashed border-gray-300 rounded-xl p-4 bg-gray-50">
          <p className="text-sm font-medium text-gray-700 mb-3">Import uninvoiced time entries</p>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-sm text-gray-400">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={loadUninvoicedTime}
              disabled={!clientId || !dateFrom || !dateTo || importing}
              className="bg-gray-800 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-gray-900 disabled:opacity-40 transition">
              {importing ? 'Loading…' : 'Load time entries'}
            </button>
          </div>
          {importMsg && (
            <p className="mt-2 text-xs text-gray-500">{importMsg}</p>
          )}
        </div>

        {/* Line items */}
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="w-6 pb-2"></th>
                <th className="pb-2 text-left text-xs uppercase tracking-wide text-gray-400 font-medium w-28">Type</th>
                <th className="pb-2 text-left text-xs uppercase tracking-wide text-gray-400 font-medium">Description</th>
                <th className="pb-2 text-right text-xs uppercase tracking-wide text-gray-400 font-medium w-24">Qty</th>
                <th className="pb-2 text-right text-xs uppercase tracking-wide text-gray-400 font-medium w-28">Unit Price</th>
                <th className="pb-2 text-right text-xs uppercase tracking-wide text-gray-400 font-medium w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                    No line items. Import time entries or add items manually.
                  </td>
                </tr>
              )}
              {lineItems.map(li => {
                const amt = (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)
                return (
                  <tr key={li._id} className="border-b border-gray-50 group hover:bg-gray-50">
                    <td className="py-2 pr-1">
                      <button onClick={() => removeItem(li._id)}
                        className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 text-sm rounded opacity-0 group-hover:opacity-100 transition">
                        ×
                      </button>
                    </td>
                    <td className="py-2 pr-2">
                      <select value={li.itemType} onChange={e => updateItem(li._id, 'itemType', e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="service">Service</option>
                        <option value="time">Time</option>
                        <option value="expense">Expense</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input value={li.description} onChange={e => updateItem(li._id, 'description', e.target.value)}
                        placeholder="Description"
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-2 pr-2">
                      <input type="number" step="0.01" min="0" value={li.quantity}
                        onChange={e => updateItem(li._id, 'quantity', e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-2 pr-2">
                      <input type="number" step="0.01" min="0" value={li.unitPrice}
                        onChange={e => updateItem(li._id, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-gray-800">
                      {sym}{fmtMoney(amt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="mt-4 flex items-start justify-between">
            <button onClick={addItem}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
              + Add item
            </button>
            <div className="space-y-1.5 min-w-[220px]">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{sym}{fmtMoney(subtotal)}</span>
              </div>
              {parseFloat(discount) > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Discount ({discount}%)</span>
                  <span className="tabular-nums">−{sym}{fmtMoney(discountAmt)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-2 text-base">
                <span>Amount Due</span>
                <span className="tabular-nums">{sym}{fmtMoney(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes <span className="text-gray-400 font-normal">(optional, displayed on invoice)</span>
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
            placeholder="Payment terms, bank details, thank you note…"
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <p className="text-xs text-gray-400 mt-1">Formatting tips: **bold** _italics_</p>
        </div>

        {/* Bottom actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={printPDF}
            className="border border-gray-300 text-gray-700 rounded-lg px-5 py-2 text-sm font-medium hover:bg-gray-50 transition">
            Print / PDF
          </button>
          <button onClick={save} disabled={saving || !clientId || !invoiceNumber}
            className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition">
            {saving ? 'Saving…' : 'Save invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 text-sm text-gray-500 flex-shrink-0">{label}</span>
      {children}
    </div>
  )
}
