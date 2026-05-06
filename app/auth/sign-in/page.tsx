'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createAuthActionClient } from '@/lib/supabase/client'

const SUPPORTED_OTP_TYPES = new Set<EmailOtpType>(['email', 'invite', 'magiclink', 'recovery'])

function getAuthErrorMessage(params: URLSearchParams) {
  const code = params.get('auth_error') ?? params.get('error_code')
  const description = params.get('auth_error_description') ?? params.get('error_description')
  const error = params.get('error')

  if (!code && !description && !error) return null

  if (code === 'otp_expired') {
    return 'That sign-in link has expired or was already used. Return to login and send yourself a fresh link.'
  }

  return description?.replace(/\+/g, ' ') ?? 'We could not complete that sign-in. Return to login and send yourself a fresh link.'
}

function getSafeRedirectPath(params: URLSearchParams) {
  const next = params.get('next')
  if (next?.startsWith('/') && !next.startsWith('//')) return next

  const redirectTo = params.get('redirect_to')
  if (!redirectTo || typeof window === 'undefined') return '/upload'

  try {
    const url = new URL(redirectTo, window.location.origin)
    if (url.origin !== window.location.origin) return '/upload'
    return `${url.pathname}${url.search}${url.hash}` || '/upload'
  } catch {
    return '/upload'
  }
}

function isSupportedOtpType(type: string | null): type is EmailOtpType {
  return Boolean(type && SUPPORTED_OTP_TYPES.has(type as EmailOtpType))
}

function AuthSignInInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(() => getAuthErrorMessage(params))

  const code = params.get('code')
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  const hasCodeToken = Boolean(code)
  const hasHashToken = Boolean(tokenHash && isSupportedOtpType(type))
  const canConfirm = !error && (hasCodeToken || hasHashToken)

  async function confirmSignIn() {
    if (!canConfirm) return

    setLoading(true)
    setError(null)

    const supabase = createAuthActionClient()
    const result = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: type as EmailOtpType,
        })

    if (result.error) {
      setError(result.error.message || 'That sign-in link could not be used. Return to login and send yourself a fresh link.')
      setLoading(false)
      return
    }

    router.replace(getSafeRedirectPath(params))
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">Guardian SMS</h1>
          <p className="mt-1 text-sm text-slate-400">Confirm sign-in</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
          <div className="space-y-5">
            <p className="text-sm text-slate-400">
              Click the button below to finish signing in.
            </p>

            {error ? (
              <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-3.5 py-2.5">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            ) : !canConfirm ? (
              <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-3.5 py-2.5">
                <p className="text-sm text-red-300">
                  This sign-in link is missing its verification token. Return to login and send yourself a fresh link.
                </p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={confirmSignIn}
              disabled={!canConfirm || loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="w-full text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AuthSignInPage() {
  return (
    <Suspense fallback={null}>
      <AuthSignInInner />
    </Suspense>
  )
}
