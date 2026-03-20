'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { MessagePlan } from '@/lib/supabase/types'
import PlaceholderPicker from '@/components/PlaceholderPicker'

// ─── Constants ────────────────────────────────────────────────────────────────

const DATE_FIELDS = [
  { label: 'Created At', value: 'created_at_albi' },
  { label: 'Inspection Date', value: 'inspection_date' },
  { label: 'Estimated Work Start Date', value: 'estimated_work_start_date' },
  { label: 'File Closed', value: 'file_closed' },
  { label: 'Estimate Sent', value: 'estimate_sent' },
  { label: 'Contract Signed', value: 'contract_signed' },
  { label: 'COC/COS Signed', value: 'coc_cos_signed' },
  { label: 'Invoiced', value: 'invoiced' },
  { label: 'Work Start', value: 'work_start' },
  { label: 'Paid', value: 'paid' },
  { label: 'Estimated Completion Date', value: 'estimated_completion_date' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTrigger(plan: MessagePlan): string {
  if (plan.trigger_type === 'date_offset') {
    const fieldLabel =
      DATE_FIELDS.find((f) => f.value === plan.trigger_date_field)?.label ??
      plan.trigger_date_field ??
      'Unknown Date'
    const days = plan.trigger_offset_days ?? 0
    return `${days} day${days !== 1 ? 's' : ''} after ${fieldLabel}`
  }
  return `When status = ${plan.trigger_status_value ?? '?'}`
}

function formatJobTypeFilter(plan: MessagePlan): string {
  if (!plan.trigger_job_type_strings?.length) return ''
  return ' + ' + plan.trigger_job_type_strings.join(', ')
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

// ─── Form state type ──────────────────────────────────────────────────────────

interface FormState {
  trigger_type: 'date_offset' | 'status_change'
  trigger_date_field: string
  trigger_offset_days: number
  trigger_status_value: string
  trigger_job_type_strings: string[]
  message_template: string
}

const DEFAULT_FORM: FormState = {
  trigger_type: 'date_offset',
  trigger_date_field: 'inspection_date',
  trigger_offset_days: 1,
  trigger_status_value: '',
  trigger_job_type_strings: [],
  message_template: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  initialPlans: MessagePlan[]
  companyId: string
}

export default function PlanClient({ initialPlans, companyId }: Props) {
  const supabase = createClient()

  const [plans, setPlans] = useState<MessagePlan[]>(initialPlans)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [jobTypeInput, setJobTypeInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const messageTemplateRef = useRef<HTMLTextAreaElement>(null)

  function insertPlaceholder(text: string) {
    const el = messageTemplateRef.current
    if (!el) {
      setForm((f) => ({ ...f, message_template: f.message_template + text }))
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const current = form.message_template
    const newVal = current.slice(0, start) + text + current.slice(end)
    setForm((f) => ({ ...f, message_template: newVal }))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // ── Open edit form ────────────────────────────────────────────────────────

  function handleEdit(plan: MessagePlan) {
    setEditingId(plan.id)
    setForm({
      trigger_type: plan.trigger_type as 'date_offset' | 'status_change',
      trigger_date_field: plan.trigger_date_field ?? 'inspection_date',
      trigger_offset_days: plan.trigger_offset_days ?? 1,
      trigger_status_value: plan.trigger_status_value ?? '',
      trigger_job_type_strings: plan.trigger_job_type_strings ?? [],
      message_template: plan.message_template,
    })
    setJobTypeInput('')
    setError(null)
    setShowForm(true)
  }

  // ── Fetch helper ──────────────────────────────────────────────────────────

  async function refetch() {
    const { data } = await supabase
      .from('message_plans')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
    setPlans((data ?? []) as MessagePlan[])
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  async function handleToggle(plan: MessagePlan) {
    await supabase
      .from('message_plans')
      .update({ is_active: !plan.is_active })
      .eq('id', plan.id)
    await refetch()
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeletingId(id)
    await supabase.from('message_plans').delete().eq('id', id)
    setConfirmDeleteId(null)
    setDeletingId(null)
    await refetch()
  }

  // ── Add job type tag ──────────────────────────────────────────────────────

  function handleAddTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const tag = jobTypeInput.trim().toUpperCase()
    if (!tag) return
    if (form.trigger_job_type_strings.includes(tag)) {
      setJobTypeInput('')
      return
    }
    setForm((f) => ({
      ...f,
      trigger_job_type_strings: [...f.trigger_job_type_strings, tag],
    }))
    setJobTypeInput('')
  }

  function handleRemoveTag(tag: string) {
    setForm((f) => ({
      ...f,
      trigger_job_type_strings: f.trigger_job_type_strings.filter((t) => t !== tag),
    }))
  }

  // ── Save plan ─────────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.message_template.trim()) {
      setError('Message template is required.')
      return
    }
    if (
      form.trigger_type === 'date_offset' &&
      !form.trigger_date_field
    ) {
      setError('Please select a date field.')
      return
    }
    if (
      form.trigger_type === 'status_change' &&
      !form.trigger_status_value.trim()
    ) {
      setError('Please enter a status value.')
      return
    }

    const payload = {
      trigger_type: form.trigger_type,
      trigger_date_field:
        form.trigger_type === 'date_offset' ? form.trigger_date_field : null,
      trigger_offset_days:
        form.trigger_type === 'date_offset' ? form.trigger_offset_days : null,
      trigger_status_value:
        form.trigger_type === 'status_change'
          ? form.trigger_status_value.trim()
          : null,
      trigger_job_type_strings:
        form.trigger_job_type_strings.length > 0
          ? form.trigger_job_type_strings
          : null,
      message_template: form.message_template.trim(),
    }

    setSaving(true)
    let saveError: string | null = null

    if (editingId) {
      const { error: updateError } = await supabase
        .from('message_plans')
        .update(payload)
        .eq('id', editingId)
      saveError = updateError?.message ?? null
    } else {
      const { error: insertError } = await supabase
        .from('message_plans')
        .insert({ ...payload, company_id: companyId, is_active: true })
      saveError = insertError?.message ?? null
    }

    setSaving(false)

    if (saveError) {
      setError(saveError)
      return
    }

    setEditingId(null)
    setForm(DEFAULT_FORM)
    setJobTypeInput('')
    setShowForm(false)
    await refetch()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Message Plans</h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure automated SMS triggers for your jobs.
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm) {
              setShowForm(false)
              setEditingId(null)
              setForm(DEFAULT_FORM)
              setError(null)
            } else {
              setEditingId(null)
              setForm(DEFAULT_FORM)
              setError(null)
              setShowForm(true)
            }
          }}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {showForm ? 'Cancel' : '+ Add Plan'}
        </button>
      </div>

      {/* Add Plan Form */}
      {showForm && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">
            {editingId ? 'Edit Message Plan' : 'New Message Plan'}
          </h2>
          <form onSubmit={handleSave} className="space-y-5">

            {/* Trigger Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trigger Type
              </label>
              <div className="flex gap-6">
                {(['date_offset', 'status_change'] as const).map((val) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="trigger_type"
                      value={val}
                      checked={form.trigger_type === val}
                      onChange={() => setForm((f) => ({ ...f, trigger_type: val }))}
                      className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">
                      {val === 'date_offset' ? 'Date offset' : 'Status change'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Date offset fields */}
            {form.trigger_type === 'date_offset' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date Field
                  </label>
                  <select
                    value={form.trigger_date_field}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, trigger_date_field: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {DATE_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Days After
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.trigger_offset_days}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        trigger_offset_days: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {/* Status change fields */}
            {form.trigger_type === 'status_change' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status Value
                </label>
                <input
                  type="text"
                  value={form.trigger_status_value}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, trigger_status_value: e.target.value }))
                  }
                  placeholder="e.g. Work In Progress"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Must match exactly, e.g. &quot;Work In Progress&quot;
                </p>
              </div>
            )}

            {/* Job Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job Type Filter{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.trigger_job_type_strings.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-0.5 rounded-full text-blue-500 hover:text-blue-700 focus:outline-none"
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={jobTypeInput}
                onChange={(e) => setJobTypeInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="e.g. WTR, RBL — leave empty to apply to all jobs"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Press Enter to add a tag. Leave empty to apply to all jobs.
              </p>
            </div>

            {/* Message Template */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message Template
              </label>
              <textarea
                ref={messageTemplateRef}
                rows={4}
                value={form.message_template}
                onChange={(e) =>
                  setForm((f) => ({ ...f, message_template: e.target.value }))
                }
                placeholder="Hi {{Customer Name}}, your job {{Name}} is ready. {{REVIEW_LINK}}"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="mt-1.5">
                <PlaceholderPicker onInsert={insertPlaceholder} />
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
                {error}
              </p>
            )}

            {/* Submit */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {saving ? 'Saving…' : editingId ? 'Update Plan' : 'Save Plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {plans.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-400">
            No message plans yet. Click &quot;+ Add Plan&quot; to create one.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Trigger
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Message
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Active
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Date Added
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                    <span>{formatTrigger(plan)}</span>
                    {formatJobTypeFilter(plan) && (
                      <span className="ml-1 text-xs text-blue-600 font-medium">
                        {formatJobTypeFilter(plan)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-sm">
                    <span title={plan.message_template}>
                      {truncate(plan.message_template, 60)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={plan.is_active}
                      onClick={() => handleToggle(plan)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                        plan.is_active ? 'bg-blue-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          plan.is_active ? 'translate-x-4' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {new Date(plan.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmDeleteId === plan.id ? (
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs text-gray-500">Are you sure?</span>
                        <button
                          onClick={() => handleDelete(plan.id)}
                          disabled={deletingId === plan.id}
                          className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {deletingId === plan.id ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(plan)}
                          className="rounded bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(plan.id)}
                          className="rounded bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 border border-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
