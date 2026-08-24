import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '../lib/client'
import { invoke } from '@tauri-apps/api/core'

const isTauri = '__TAURI_INTERNALS__' in window

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  sent:  'bg-blue-100 text-blue-700',
  paid:  'bg-green-100 text-green-700',
}

const CURRENCY_SYMBOLS = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', AUD: 'A$', NZD: 'NZ$' }

const DEFAULT_PAYMENT_NOTES = `Payment details (USD / Wise):

Name: Kristian McFarlin
Account type: Checking

US transfers (ACH/Wire):
Routing number: 026073150
Account number: 8310357051
Bank: Community Federal Savings Bank, 89-16 Jamaica Ave, Woodhaven, NY 11421, US

International (Swift):
Swift/BIC: CMFGUS33`

function fmt(n, currency) {
  const sym = CURRENCY_SYMBOLS[currency] || '$'
  return `${sym}${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Invoices() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => client.records('invoices_with_client').list({
      order: ['-created'],
      pagination: { limit: 500 }
    }).then(r => r.records)
  })

  const { data: allLineItems = [] } = useQuery({
    queryKey: ['all_line_items'],
    queryFn: () => client.records('invoice_line_items').list({
      pagination: { limit: 5000 }
    }).then(r => r.records),
    enabled: invoices.length > 0
  })

  // Compute total per invoice in JS
  function invoiceTotal(inv) {
    const items = allLineItems.filter(li => li.invoice === inv.id)
    const subtotal = items.reduce((s, li) => s + li.quantity * li.unit_price, 0)
    return subtotal * (1 - (inv.discount || 0) / 100)
  }

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => client.records('invoices').update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] })
  })

  const deleteInvoice = useMutation({
    mutationFn: (id) => client.records('invoices').delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] })
  })

  if (isLoading) return <div className="text-sm text-gray-400 py-12 text-center">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <button
          onClick={() => navigate('/invoices/new')}
          className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition"
        >
          + New Invoice
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center">
          <p className="text-gray-400 text-sm mb-3">No invoices yet</p>
          <button
            onClick={() => navigate('/invoices/new')}
            className="text-blue-600 text-sm font-medium hover:text-blue-700"
          >
            Create your first invoice
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs uppercase tracking-wide text-gray-400 font-medium">#</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-gray-400 font-medium">Client</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-gray-400 font-medium">Subject</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-gray-400 font-medium">Issue Date</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-gray-400 font-medium">Status</th>
                <th className="text-right px-6 py-3 text-xs uppercase tracking-wide text-gray-400 font-medium">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50 group">
                  <td className="px-6 py-4 font-semibold text-gray-900">#{inv.invoice_number}</td>
                  <td className="px-4 py-4 text-gray-700">{inv.client_name}</td>
                  <td className="px-4 py-4 text-gray-500 truncate max-w-[200px]">{inv.subject || '—'}</td>
                  <td className="px-4 py-4 text-gray-500">{inv.issue_date || '—'}</td>
                  <td className="px-4 py-4">
                    <select
                      value={inv.status}
                      onChange={e => updateStatus.mutate({ id: inv.id, status: e.target.value })}
                      className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 ${STATUS_STYLES[inv.status] || STATUS_STYLES.draft}`}
                    >
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="paid">Paid</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold tabular-nums text-gray-900">
                    {fmt(invoiceTotal(inv), inv.currency)}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2.5 py-1 hover:bg-gray-100 transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => printInvoice(inv)}
                        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2.5 py-1 hover:bg-gray-100 transition"
                      >
                        PDF
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete invoice #${inv.invoice_number}?`)) {
                            deleteInvoice.mutate(inv.id)
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded px-2.5 py-1 hover:bg-red-50 transition"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

async function printInvoice(inv) {
  const lineItemsResp = await client.records('invoice_line_items').list({
    filters: [{ column: 'invoice', op: 'equal', value: inv.id }],
    pagination: { limit: 500 }
  })
  const items = lineItemsResp.records

  const sym = CURRENCY_SYMBOLS[inv.currency] || '$'
  const fmt2 = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const subtotal = items.reduce((s, li) => s + li.quantity * li.unit_price, 0)
  const discountAmt = subtotal * (inv.discount || 0) / 100
  const total = subtotal - discountAmt

  const DUE_LABELS = { upon_receipt: 'Upon receipt', net_15: 'Net 15', net_30: 'Net 30', net_45: 'Net 45', net_60: 'Net 60' }

  const rows = items.map(li => `
    <tr>
      <td>${li.description}</td>
      <td class="right">${parseFloat(li.quantity).toFixed(2)}</td>
      <td class="right">${sym}${fmt2(li.unit_price)}</td>
      <td class="right">${sym}${fmt2(li.quantity * li.unit_price)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${inv.invoice_number}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:760px;margin:0 auto;padding:52px;font-size:14px;line-height:1.5}
  h1{font-size:30px;font-weight:700;margin:0 0 4px}
  .subtitle{color:#666;margin:0 0 36px;font-size:15px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:36px}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-bottom:3px}
  .field p{margin:0;font-weight:500;font-size:14px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{text-align:left;padding:8px 12px;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;color:#333}
  td{padding:11px 12px;border-bottom:1px solid #eee;vertical-align:top}
  .right{text-align:right}
  th.right{text-align:right}
  .totals{display:flex;flex-direction:column;align-items:flex-end;margin-top:18px;gap:6px}
  .tot-row{display:flex;gap:40px;font-size:14px}
  .tot-row .lbl{width:130px;text-align:right;color:#666}
  .tot-row .amt{width:90px;text-align:right;font-weight:500}
  .tot-row.final{font-size:17px;font-weight:700;border-top:2px solid #111;padding-top:10px;margin-top:4px}
  .notes{margin-top:44px;border-top:1px solid #eee;padding-top:18px;font-size:13px;color:#444}
  .notes strong{display:block;margin-bottom:6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#999}
  @media print{body{padding:28px}button{display:none}}
</style>
</head>
<body>
<h1>Invoice #${inv.invoice_number}</h1>
${inv.subject ? `<p class="subtitle">${inv.subject}</p>` : '<p class="subtitle" style="margin-bottom:36px"></p>'}
<div class="grid">
  <div>
    <div class="field"><label>Invoice For</label><p>${inv.client_name}</p></div>
    ${inv.issue_date ? `<div class="field"><label>Issue Date</label><p>${inv.issue_date}</p></div>` : ''}
    ${inv.due_date ? `<div class="field"><label>Due</label><p>${DUE_LABELS[inv.due_date] || inv.due_date}</p></div>` : ''}
  </div>
  <div>
    ${inv.po_number ? `<div class="field"><label>PO Number</label><p>${inv.po_number}</p></div>` : ''}
    ${inv.date_from ? `<div class="field"><label>Period</label><p>${inv.date_from} – ${inv.date_to}</p></div>` : ''}
    <div class="field"><label>Currency</label><p>${inv.currency}</p></div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="right">Qty</th>
      <th class="right">Unit Price</th>
      <th class="right">Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="tot-row"><span class="lbl">Subtotal</span><span class="amt">${sym}${fmt2(subtotal)}</span></div>
  ${inv.discount ? `<div class="tot-row"><span class="lbl">Discount (${inv.discount}%)</span><span class="amt">–${sym}${fmt2(discountAmt)}</span></div>` : ''}
  <div class="tot-row final"><span class="lbl">Amount Due</span><span class="amt">${sym}${fmt2(total)}</span></div>
</div>
${`<div class="notes"><strong>Notes</strong><br>${(inv.notes || DEFAULT_PAYMENT_NOTES).replace(/\n/g, '<br>')}</div>`}
<script>window.onload=()=>window.print()</script>
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
