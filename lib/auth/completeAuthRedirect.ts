import { NextRequest, NextResponse } from 'next/server'
import { getCanonicalAppUrl } from '@/lib/appAuth'

function getSafeNextPath(value: string | null) {
  if (!value?.startsWith('/')) return null
  if (value.startsWith('//')) return null
  return value
}

function redirectToLoginWithAuthError(options: {
  appUrl: string
  code?: string | null
  description?: string | null
  next?: string | null
}) {
  const loginUrl = new URL('/login', options.appUrl)
  const next = getSafeNextPath(options.next ?? null)

  loginUrl.searchParams.set('auth_error', options.code ?? 'auth_callback_failed')
  if (options.description) {
    loginUrl.searchParams.set('auth_error_description', options.description)
  }
  if (next) {
    loginUrl.searchParams.set('next', next)
  }

  return NextResponse.redirect(loginUrl)
}

function redirectToAuthAction(requestUrl: URL, appUrl: string) {
  const authActionUrl = new URL('/auth/sign-in', appUrl)
  const paramsToForward = ['code', 'token_hash', 'type', 'next', 'redirect_to']

  for (const name of paramsToForward) {
    const value = requestUrl.searchParams.get(name)
    if (value) authActionUrl.searchParams.set(name, value)
  }

  return NextResponse.redirect(authActionUrl)
}

export async function completeAuthRedirect(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = requestUrl.searchParams.get('next')
  const providerError = requestUrl.searchParams.get('error')
  const providerErrorCode = requestUrl.searchParams.get('error_code')
  const providerErrorDescription = requestUrl.searchParams.get('error_description')
  const appUrl = getCanonicalAppUrl(requestUrl.origin)

  if (providerError || providerErrorCode || providerErrorDescription) {
    return redirectToLoginWithAuthError({
      appUrl,
      code: providerErrorCode ?? providerError,
      description: providerErrorDescription,
      next,
    })
  }

  if (code || (tokenHash && type)) {
    return redirectToAuthAction(requestUrl, appUrl)
  }

  return redirectToLoginWithAuthError({
    appUrl,
    code: 'missing_auth_token',
    description: 'Login link is missing its verification token.',
    next,
  })
}
