'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const InboxIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

const items = [
  { label: 'Inbox',      href: '/inbox',    icon: <InboxIcon /> },
  { label: 'Send SMS',   href: '/send-sms', icon: <SendIcon /> },
]

export default function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 flex md:hidden">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium transition-colors',
              isActive ? 'text-white' : 'text-slate-400 hover:text-white',
            ].join(' ')}
          >
            <span className={isActive ? 'text-blue-400' : ''}>{item.icon}</span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
