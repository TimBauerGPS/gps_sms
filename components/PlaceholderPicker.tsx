'use client'

import { useRef, useState } from 'react'

// Known Albi CSV column headers available as {{placeholders}}
const ALBI_HEADERS = [
  'Job Number',
  'Customer Name',
  'Customer Phone Number',
  'Status',
  'Created At',
  'Inspection Date',
  'Estimated Work Start Date',
  'File Closed',
  'Estimate Sent',
  'Contract Signed',
  'COC/COS Signed',
  'Invoiced',
  'Work Start',
  'Paid',
  'Estimated Completion Date',
]

const SPECIAL_PLACEHOLDERS = [
  { label: '{{REVIEW_LINK}}', value: '{{REVIEW_LINK}}', description: 'Office-specific review URL' },
  { label: '{{Guardian Office Name}}', value: '{{Guardian Office Name}}', description: 'Your company name' },
]

interface PlaceholderPickerProps {
  /** Called with the placeholder string to insert (e.g. "{{Customer Name}}") */
  onInsert: (placeholder: string) => void
}

export default function PlaceholderPicker({ onInsert }: PlaceholderPickerProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  function handleSelect(value: string) {
    onInsert(value)
    setOpen(false)
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium
                   text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200
                   transition-colors select-none"
        title="Insert a placeholder"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Insert placeholder
      </button>

      {open && (
        <>
          {/* Backdrop to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-xl border border-slate-200
                          bg-white shadow-lg overflow-hidden">
            {/* Special placeholders */}
            <div className="px-3 pt-2.5 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Special
              </p>
            </div>
            {SPECIAL_PLACEHOLDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => handleSelect(p.value)}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 transition-colors"
              >
                <span className="block text-xs font-mono text-blue-700">{p.label}</span>
                <span className="block text-[10px] text-slate-400">{p.description}</span>
              </button>
            ))}

            {/* CSV column headers */}
            <div className="px-3 pt-2.5 pb-1 border-t border-slate-100 mt-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                CSV columns
              </p>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {ALBI_HEADERS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleSelect(`{{${h}}}`)}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 transition-colors"
                >
                  <span className="block text-xs font-mono text-slate-700">{`{{${h}}}`}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
