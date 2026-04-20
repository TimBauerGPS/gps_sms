const DEFAULT_APP_NAME = 'Guardian SMS'
const DEFAULT_APP_SLUG = 'guardian-sms'
const DEFAULT_POST_AUTH_PATH = '/upload'
const LOCALHOST_APP_URL = 'http://localhost:3000'

function normalizeUrl(value?: string | null): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function resolveAppBaseUrl(fallbackOrigin?: string): string {
  return (
    normalizeUrl(process.env.APP_URL) ??
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeUrl(fallbackOrigin) ??
    LOCALHOST_APP_URL
  )
}

function toAppUrl(appUrl: string, candidate?: string | null): string | null {
  if (!candidate) return null

  if (candidate.startsWith('/')) {
    return `${appUrl}${candidate}`
  }

  try {
    const requestedUrl = new URL(candidate)
    const canonicalUrl = new URL(appUrl)

    if (requestedUrl.origin !== canonicalUrl.origin) {
      return null
    }

    return requestedUrl.toString()
  } catch {
    return null
  }
}

export function getAppName() {
  return process.env.APP_NAME?.trim() || DEFAULT_APP_NAME
}

export function getAppSlug() {
  return DEFAULT_APP_SLUG
}

export function getCanonicalAppUrl(fallbackOrigin?: string) {
  return resolveAppBaseUrl(fallbackOrigin)
}

export function getDefaultPostAuthPath() {
  return DEFAULT_POST_AUTH_PATH
}

export function getInviteConfirmUrl(fallbackOrigin?: string) {
  const appUrl = getCanonicalAppUrl(fallbackOrigin)
  return `${appUrl}/auth/confirm?redirect_to=${encodeURIComponent(appUrl)}`
}

export function getPostAuthRedirectUrl(options: {
  fallbackOrigin?: string
  next?: string | null
  redirectTo?: string | null
}) {
  const appUrl = getCanonicalAppUrl(options.fallbackOrigin)

  return (
    toAppUrl(appUrl, options.redirectTo) ??
    toAppUrl(appUrl, options.next) ??
    `${appUrl}${DEFAULT_POST_AUTH_PATH}`
  )
}
