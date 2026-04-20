import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { getCanonicalAppUrl, getPostAuthRedirectUrl } from '@/lib/appAuth'
import type { Database } from '@/lib/supabase/types'

type SupportedOtpType = 'email' | 'invite' | 'magiclink' | 'recovery'

export async function completeAuthRedirect(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type') as SupportedOtpType | null
  const appUrl = getCanonicalAppUrl(requestUrl.origin)
  const redirectUrl = getPostAuthRedirectUrl({
    fallbackOrigin: requestUrl.origin,
    next: requestUrl.searchParams.get('next'),
    redirectTo: requestUrl.searchParams.get('redirect_to'),
  })

  const redirectResponse = NextResponse.redirect(redirectUrl)

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${appUrl}/login`)
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error) {
      return NextResponse.redirect(`${appUrl}/login`)
    }
  }

  return redirectResponse
}
