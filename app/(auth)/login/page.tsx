'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Tab = 'login' | 'request'

export default function LoginPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('login')

  // ── Forgot password state ─────────────────────────────────────────────────
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotError, setForgotError] = useState<string | null>(null)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setForgotError(null)
    setForgotLoading(true)
    const supabase = createClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${appUrl}/auth/callback?next=/auth/set-password`,
    })
    if (error) { setForgotError(error.message); setForgotLoading(false); return }
    setForgotSent(true)
    setForgotLoading(false)
  }

  // ── Login state ───────────────────────────────────────────────────────────
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoginError(null)
    setLoginLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setLoginError(error.message); setLoginLoading(false); return }
    router.push('/upload')
  }

  // ── Request access state ──────────────────────────────────────────────────
  const [reqName, setReqName] = useState('')
  const [reqEmail, setReqEmail] = useState('')
  const [reqCompany, setReqCompany] = useState('')
  const [reqError, setReqError] = useState<string | null>(null)
  const [reqLoading, setReqLoading] = useState(false)
  const [reqSuccess, setReqSuccess] = useState(false)

  async function handleRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setReqError(null)
    setReqLoading(true)
    try {
      const res = await fetch('/api/signup-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: reqName, email: reqEmail, company: reqCompany }),
      })
      const json = await res.json()
      if (!res.ok) { setReqError(json.error ?? 'Something went wrong.'); return }
      setReqSuccess(true)
    } catch {
      setReqError('Network error. Please try again.')
    } finally {
      setReqLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Heading */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">Guardian SMS</h1>
          <p className="mt-1 text-sm text-slate-400">
            {tab === 'login' ? 'Sign in to your account' : 'Request access'}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-slate-700 overflow-hidden mb-6 text-sm font-medium">
          <button
            onClick={() => setTab('login')}
            className={`flex-1 py-2 transition-colors ${tab === 'login' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            Sign In
          </button>
          <button
            onClick={() => setTab('request')}
            className={`flex-1 py-2 transition-colors ${tab === 'request' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            Request Access
          </button>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
          {tab === 'login' && showForgot ? (
            forgotSent ? (
              <div className="text-center space-y-3 py-4">
                <div className="text-3xl">✉️</div>
                <p className="text-sm font-medium text-white">Check your email</p>
                <p className="text-xs text-slate-400">We sent a password reset link to <strong>{forgotEmail}</strong>.</p>
                <button onClick={() => { setShowForgot(false); setForgotSent(false) }} className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline">Back to sign in</button>
              </div>
            ) : (
              <form onSubmit={handleForgot} noValidate className="space-y-5">
                <p className="text-sm text-slate-300">Enter your email and we&apos;ll send a reset link.</p>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                    placeholder="you@example.com"
                  />
                </div>
                {forgotError && (
                  <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-3.5 py-2.5">
                    <p className="text-sm text-red-400">{forgotError}</p>
                  </div>
                )}
                <button type="submit" disabled={forgotLoading} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {forgotLoading ? 'Sending…' : 'Send reset link'}
                </button>
                <button type="button" onClick={() => setShowForgot(false)} className="w-full text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
              </form>
            )
          ) : tab === 'login' ? (
            <form onSubmit={handleLogin} noValidate className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="••••••••"
                />
              </div>
              {loginError && (
                <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-3.5 py-2.5">
                  <p className="text-sm text-red-400">{loginError}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loginLoading ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setForgotEmail(email) }}
                  className="text-xs text-slate-400 hover:text-blue-400 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          ) : reqSuccess ? (
            <div className="text-center space-y-3 py-4">
              <div className="text-3xl">✓</div>
              <p className="text-sm font-medium text-white">Request submitted!</p>
              <p className="text-xs text-slate-400">
                You&apos;ll receive an invite email once your account has been approved.
              </p>
              <button
                onClick={() => { setTab('login'); setReqSuccess(false) }}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleRequest} noValidate className="space-y-5">
              <div>
                <label htmlFor="req-name" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Full name
                </label>
                <input
                  id="req-name"
                  type="text"
                  required
                  value={reqName}
                  onChange={(e) => setReqName(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label htmlFor="req-email" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Work email
                </label>
                <input
                  id="req-email"
                  type="email"
                  required
                  value={reqEmail}
                  onChange={(e) => setReqEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="jane@yourcompany.com"
                />
              </div>
              <div>
                <label htmlFor="req-company" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Company name
                </label>
                <input
                  id="req-company"
                  type="text"
                  required
                  value={reqCompany}
                  onChange={(e) => setReqCompany(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="Acme Restoration"
                />
              </div>
              {reqError && (
                <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-3.5 py-2.5">
                  <p className="text-sm text-red-400">{reqError}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={reqLoading}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {reqLoading ? 'Submitting…' : 'Request Access'}
              </button>
              <p className="text-xs text-center text-slate-500">
                Your request will be reviewed and you&apos;ll receive an invite email once approved.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
