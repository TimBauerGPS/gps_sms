'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Company, Json } from '@/lib/supabase/types'

// ─── Local shape types ───────────────────────────────────────────────────────

interface ReviewLink {
  match_string: string
  url: string
}

interface JobType {
  label: string
  substring: string
}

// ─── Toast helper ────────────────────────────────────────────────────────────

type ToastState = 'idle' | 'saving' | 'success' | 'error'

function useToast() {
  const [state, setState] = useState<ToastState>('idle')
  const [message, setMessage] = useState('')

  const show = useCallback((s: ToastState, msg = '') => {
    setState(s)
    setMessage(msg)
    if (s === 'success' || s === 'error') {
      setTimeout(() => setState('idle'), 3000)
    }
  }, [])

  return { state, message, show }
}

function Toast({ state, message }: { state: ToastState; message: string }) {
  if (state === 'idle') return null
  if (state === 'saving') return <span className="text-sm text-slate-500">Saving…</span>
  if (state === 'success') return <span className="text-sm text-green-600 font-medium">Saved</span>
  return <span className="text-sm text-red-600 font-medium">{message || 'Error saving'}</span>
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  )
}

function HelperText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500 leading-relaxed">{children}</p>
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 mb-1">
      {children}
    </label>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
        'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
        (props.className ?? '')
      }
    />
  )
}

function SaveRow({
  onSave,
  toast,
}: {
  onSave: () => void
  toast: { state: ToastState; message: string }
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        onClick={onSave}
        disabled={toast.state === 'saving'}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        Save
      </button>
      <Toast state={toast.state} message={toast.message} />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseReviewLinks(raw: unknown): ReviewLink[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).map((item) => {
    if (typeof item === 'object' && item !== null) {
      const r = item as Record<string, unknown>
      return {
        match_string: typeof r.match_string === 'string' ? r.match_string : '',
        url: typeof r.url === 'string' ? r.url : '',
      }
    }
    return { match_string: '', url: '' }
  })
}

function parseJobTypes(raw: unknown): JobType[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).map((item) => {
    if (typeof item === 'object' && item !== null) {
      const r = item as Record<string, unknown>
      return {
        label: typeof r.label === 'string' ? r.label : '',
        substring: typeof r.substring === 'string' ? r.substring : '',
      }
    }
    return { label: '', substring: '' }
  })
}

function resolveReviewLink(links: ReviewLink[], jobName: string): string {
  const lower = jobName.toLowerCase()
  for (const link of links) {
    if (link.match_string && lower.includes(link.match_string.toLowerCase())) {
      return link.url || '(no URL set)'
    }
  }
  const fallback = links.find((l) => !l.match_string)
  return fallback?.url || '(no match found)'
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  company: Company
}

export default function SettingsClient({ company }: Props) {
  const supabase = createClient()

  // ── Company profile ──────────────────────────────────────────────────────
  const [companyName, setCompanyName] = useState(company.name)
  const profileToast = useToast()

  async function saveProfile() {
    profileToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({ name: companyName })
      .eq('id', company.id)
    profileToast.show(error ? 'error' : 'success', error?.message)
  }

  // ── Twilio credentials ───────────────────────────────────────────────────
  const [twilioSid, setTwilioSid] = useState(company.twilio_account_sid ?? '')
  const [twilioToken, setTwilioToken] = useState(company.twilio_auth_token ?? '')
  const [twilioPhone, setTwilioPhone] = useState(company.twilio_phone_number ?? '')
  const [showToken, setShowToken] = useState(false)
  const twilioToast = useToast()

  type CheckResult = {
    credentials: { ok: boolean; message: string }
    phoneNumber: { ok: boolean; message: string }
    webhook: { ok: boolean; message: string; current: string; expected: string }
  }
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [showWebhookInstructions, setShowWebhookInstructions] = useState(false)

  async function checkTwilio() {
    setChecking(true)
    setCheckResult(null)
    try {
      const res = await fetch('/api/settings/check-twilio', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setCheckResult(null)
        alert(data.error)
      } else {
        setCheckResult(data)
        if (data.webhook && !data.webhook.ok) setShowWebhookInstructions(true)
      }
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  async function saveTwilio() {
    twilioToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({
        twilio_account_sid: twilioSid || null,
        twilio_auth_token: twilioToken || null,
        twilio_phone_number: twilioPhone || null,
      })
      .eq('id', company.id)
    twilioToast.show(error ? 'error' : 'success', error?.message)
  }

  // ── Albi email ────────────────────────────────────────────────────────────
  const [albiEmail, setAlbiEmail] = useState(company.albi_email ?? '')
  const albiToast = useToast()

  async function saveAlbi() {
    albiToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({ albi_email: albiEmail || null })
      .eq('id', company.id)
    albiToast.show(error ? 'error' : 'success', error?.message)
  }

  // ── Staff notifications ───────────────────────────────────────────────────
  const [staffEmails, setStaffEmails] = useState<string[]>(company.staff_notification_emails ?? [])
  const [newStaffEmail, setNewStaffEmail] = useState('')
  const staffToast = useToast()

  function addStaffEmail() {
    const trimmed = newStaffEmail.trim()
    if (!trimmed || staffEmails.includes(trimmed)) return
    setStaffEmails((prev) => [...prev, trimmed])
    setNewStaffEmail('')
  }

  function removeStaffEmail(email: string) {
    setStaffEmails((prev) => prev.filter((e) => e !== email))
  }

  async function saveStaff() {
    staffToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({ staff_notification_emails: staffEmails })
      .eq('id', company.id)
    staffToast.show(error ? 'error' : 'success', error?.message)
  }

  // ── Review links ──────────────────────────────────────────────────────────
  const [reviewLinks, setReviewLinks] = useState<ReviewLink[]>(
    parseReviewLinks(company.review_links)
  )
  const reviewToast = useToast()

  function addReviewLink() {
    setReviewLinks((prev) => [...prev, { match_string: '', url: '' }])
  }

  function updateReviewLink(index: number, field: keyof ReviewLink, value: string) {
    setReviewLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, [field]: value } : link))
    )
  }

  function removeReviewLink(index: number) {
    setReviewLinks((prev) => prev.filter((_, i) => i !== index))
  }

  function moveReviewLink(index: number, direction: 'up' | 'down') {
    const newLinks = [...reviewLinks]
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= newLinks.length) return
    ;[newLinks[index], newLinks[target]] = [newLinks[target], newLinks[index]]
    setReviewLinks(newLinks)
  }

  async function saveReviewLinks() {
    reviewToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({ review_links: reviewLinks as unknown as Json })
      .eq('id', company.id)
    reviewToast.show(error ? 'error' : 'success', error?.message)
  }

  // ── Sending mode ──────────────────────────────────────────────────────────
  const [autoSend, setAutoSend] = useState(company.auto_send_enabled ?? false)
  const sendModeToast = useToast()

  async function saveSendMode(value: boolean) {
    setAutoSend(value)
    sendModeToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({ auto_send_enabled: value })
      .eq('id', company.id)
    sendModeToast.show(error ? 'error' : 'success', error?.message)
  }

  // ── Job types ─────────────────────────────────────────────────────────────
  const [jobTypes, setJobTypes] = useState<JobType[]>(parseJobTypes(company.job_types))
  const [jobTypesOpen, setJobTypesOpen] = useState(false)
  const [newJobCode, setNewJobCode] = useState('')
  const jobTypesToast = useToast()

  async function saveJobTypes(updated: JobType[]) {
    jobTypesToast.show('saving')
    const { error } = await supabase
      .from('companies')
      .update({ job_types: updated as unknown as Json })
      .eq('id', company.id)
    jobTypesToast.show(error ? 'error' : 'success', error?.message)
  }

  function addJobType() {
    const code = newJobCode.trim().toUpperCase()
    if (!code || jobTypes.some((jt) => jt.substring.toUpperCase() === code)) return
    const updated = [...jobTypes, { label: code, substring: code }]
    setJobTypes(updated)
    setNewJobCode('')
    saveJobTypes(updated)
  }

  function removeJobType(index: number) {
    const updated = jobTypes.filter((_, i) => i !== index)
    setJobTypes(updated)
    saveJobTypes(updated)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl space-y-6">
      {/* Company Profile */}
      <Section title="Company Profile">
        <div>
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Restoration"
          />
        </div>
        <SaveRow onSave={saveProfile} toast={profileToast} />
      </Section>

      {/* Twilio Credentials */}
      <Section title="Twilio Credentials">
        <div>
          <Label htmlFor="twilio-sid">Account SID</Label>
          <Input
            id="twilio-sid"
            value={twilioSid}
            onChange={(e) => setTwilioSid(e.target.value)}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
        </div>
        <div>
          <Label htmlFor="twilio-token">Auth Token</Label>
          <div className="relative">
            <Input
              id="twilio-token"
              type={showToken ? 'text' : 'password'}
              value={twilioToken}
              onChange={(e) => setTwilioToken(e.target.value)}
              placeholder="••••••••••••••••••••••••••••••••"
              className="pr-20"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-800"
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="twilio-phone">Phone Number</Label>
          <Input
            id="twilio-phone"
            value={twilioPhone}
            onChange={(e) => setTwilioPhone(e.target.value)}
            placeholder="+17325875238"
          />
        </div>
        <SaveRow onSave={saveTwilio} toast={twilioToast} />
        <HelperText>
          Credentials are stored securely. All SMS calls are server-side only.
        </HelperText>

        {/* Check Configuration */}
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <button
            onClick={checkTwilio}
            disabled={checking}
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking…' : 'Check Configuration'}
          </button>

          {checkResult && (
            <div className="space-y-2 text-sm">
              {(['credentials', 'phoneNumber', 'webhook'] as const).map((key) => {
                const item = checkResult[key]
                return (
                  <div key={key} className="flex items-start gap-2">
                    <span className={item.ok ? 'text-green-500' : 'text-red-500'}>
                      {item.ok ? '✓' : '✗'}
                    </span>
                    <div>
                      <span className={item.ok ? 'text-green-700' : 'text-red-700'}>
                        {item.message}
                      </span>
                      {key === 'webhook' && !item.ok && item.current && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          Currently set to: <code className="font-mono bg-slate-100 px-1 rounded">{item.current}</code>
                          <br />
                          Should be: <code className="font-mono bg-slate-100 px-1 rounded">{item.expected}</code>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Webhook setup instructions */}
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <button
            type="button"
            onClick={() => setShowWebhookInstructions((v) => !v)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
          >
            <span>{showWebhookInstructions ? '▼' : '▶'}</span>
            How to configure your Twilio webhook
          </button>

          {showWebhookInstructions && (
            <div className="space-y-3 pl-3">
              <ol className="text-xs text-slate-500 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  Go to{' '}
                  <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    console.twilio.com
                  </a>{' '}
                  and sign in
                </li>
                <li>Navigate to <strong className="text-slate-600">Phone Numbers → Manage → Active Numbers</strong></li>
                <li>Click on your SMS number</li>
                <li>Scroll to the <strong className="text-slate-600">Messaging</strong> section</li>
                <li>Under <strong className="text-slate-600">&ldquo;A message comes in&rdquo;</strong>, set the dropdown to <strong className="text-slate-600">Webhook</strong></li>
                <li>
                  Paste this URL into the field:{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 select-all">
                    {process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-site.netlify.app'}/api/twilio-inbound
                  </code>
                </li>
                <li>Set the method to <strong className="text-slate-600">HTTP POST</strong></li>
                <li>Click <strong className="text-slate-600">Save configuration</strong></li>
              </ol>
              <p className="text-xs text-slate-400">
                After saving, click &ldquo;Check Configuration&rdquo; above to verify.
              </p>
            </div>
          )}

          <div className="pt-1 space-y-1">
            <p className="text-xs font-medium text-slate-600">How to find your Twilio credentials:</p>
            <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside leading-relaxed">
              <li>
                Go to{' '}
                <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  console.twilio.com
                </a>{' '}
                and sign in
              </li>
              <li>Your <strong className="text-slate-600">Account SID</strong> and <strong className="text-slate-600">Auth Token</strong> are on the dashboard homepage</li>
              <li>
                For the <strong className="text-slate-600">Phone Number</strong>, go to Phone Numbers → Manage → Active Numbers — copy in E.164 format (e.g. +17325875238)
              </li>
              <li>Make sure your Twilio number has SMS capability enabled</li>
            </ol>
          </div>
        </div>
      </Section>

      {/* Albi Email */}
      <Section title="Albi Email">
        <div>
          <Label htmlFor="albi-email">Email address</Label>
          <Input
            id="albi-email"
            type="email"
            value={albiEmail}
            onChange={(e) => setAlbiEmail(e.target.value)}
            placeholder="albi@yourcompany.com"
          />
        </div>
        <SaveRow onSave={saveAlbi} toast={albiToast} />
        <HelperText>
          This email receives a copy of every outbound text. Connect it to Albi to automatically
          attach messages to job notes.
        </HelperText>
      </Section>

      {/* Staff Notifications */}
      <Section title="Staff Notifications">
        {staffEmails.length > 0 && (
          <ul className="space-y-2">
            {staffEmails.map((email) => (
              <li
                key={email}
                className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"
              >
                <span className="text-sm text-slate-800">{email}</span>
                <button
                  onClick={() => removeStaffEmail(email)}
                  className="text-slate-400 hover:text-red-500 text-lg leading-none transition-colors"
                  aria-label={`Remove ${email}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            type="email"
            value={newStaffEmail}
            onChange={(e) => setNewStaffEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStaffEmail()}
            placeholder="team@yourcompany.com"
          />
          <button
            onClick={addStaffEmail}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            Add
          </button>
        </div>
        <SaveRow onSave={saveStaff} toast={staffToast} />
        <HelperText>
          These team members are emailed when a customer replies. They&apos;ll also receive browser
          push notifications if enabled.
        </HelperText>
      </Section>

      {/* Review Links */}
      <Section title="Review Links">
        {reviewLinks.length > 0 && (
          <ol className="space-y-2">
            {reviewLinks.map((link, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-slate-400 cursor-grab select-none text-lg leading-none">
                  ⠿
                </span>
                <Input
                  value={link.match_string}
                  onChange={(e) => updateReviewLink(i, 'match_string', e.target.value)}
                  placeholder="Office Suffix e.g. SNA — leave blank for default"
                  className="flex-1"
                />
                <Input
                  value={link.url}
                  onChange={(e) => updateReviewLink(i, 'url', e.target.value)}
                  placeholder="https://g.page/r/…"
                  className="flex-1"
                />
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveReviewLink(i, 'up')}
                    disabled={i === 0}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs leading-none px-1"
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveReviewLink(i, 'down')}
                    disabled={i === reviewLinks.length - 1}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs leading-none px-1"
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>
                <button
                  onClick={() => removeReviewLink(i)}
                  className="text-slate-400 hover:text-red-500 text-lg leading-none transition-colors"
                  aria-label="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        <button
          onClick={addReviewLink}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          + Add link
        </button>
        <SaveRow onSave={saveReviewLinks} toast={reviewToast} />
        <HelperText>
          First matching substring wins. Leave match string blank for a catch-all default. Used for{' '}
          <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
            {'{{REVIEW_LINK}}'}
          </code>{' '}
          in message templates.
        </HelperText>

      </Section>

      {/* Sending Mode */}
      <Section title="Sending Mode">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">
              {autoSend ? 'Auto-send enabled' : 'Manual review only'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {autoSend
                ? 'Date-based messages send automatically each morning. Status-change messages still require review.'
                : 'All messages go to the Send Queue for your review before anything is sent.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoSend}
            onClick={() => saveSendMode(!autoSend)}
            disabled={sendModeToast.state === 'saving'}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              autoSend ? 'bg-blue-600' : 'bg-slate-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                autoSend ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        <Toast state={sendModeToast.state} message={sendModeToast.message} />
        <HelperText>
          Recommended: keep manual review on until you&apos;ve verified your message templates are correct.
        </HelperText>
      </Section>

      {/* Job Types */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setJobTypesOpen((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-800">Job Types</h2>
            <span className="text-xs font-medium bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
              {jobTypes.length}
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${jobTypesOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {jobTypesOpen && (
          <div className="px-6 pb-6 space-y-4 border-t border-slate-100">
            {/* Chips */}
            {jobTypes.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-4">
                {jobTypes.map((jt, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-sm font-medium rounded-full px-3 py-1"
                  >
                    {jt.substring || jt.label}
                    <button
                      onClick={() => removeJobType(i)}
                      className="text-slate-400 hover:text-red-500 leading-none ml-0.5 transition-colors"
                      aria-label={`Remove ${jt.substring}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add input */}
            <div className="flex gap-2">
              <Input
                value={newJobCode}
                onChange={(e) => setNewJobCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addJobType()}
                placeholder="e.g. WTR"
                className="w-36"
              />
              <button
                onClick={addJobType}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                Add
              </button>
              <Toast state={jobTypesToast.state} message={jobTypesToast.message} />
            </div>

            <HelperText>
              Job type codes from job names (e.g. &ldquo;WTR&rdquo;, &ldquo;RBL&rdquo;). Auto-filled
              on CSV import. Used to filter which jobs receive certain messages.
            </HelperText>
          </div>
        )}
      </section>
    </div>
  )
}
