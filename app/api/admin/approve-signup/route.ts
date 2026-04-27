import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppName, getAppSlug, getCanonicalAppUrl, getInviteConfirmUrl } from '@/lib/appAuth'
import { findAuthUserByEmail, getGuardianAdminContext } from '@/lib/adminAccess'

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  const from = process.env.RESEND_FROM_EMAIL ?? 'Allied SMS <onboarding@resend.dev>'
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
}

export async function POST(req: NextRequest) {
  const context = await getGuardianAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!context.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { requestId, companyId, companyName } = await req.json()
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  const admin = createAdminClient()
  const appName = getAppName()
  const appSlug = getAppSlug()
  const appUrl = getCanonicalAppUrl(new URL(req.url).origin)
  const inviteRedirectTo = getInviteConfirmUrl(new URL(req.url).origin)

  // Fetch the request
  const { data: request, error: reqErr } = await admin
    .from('signup_requests')
    .select('*')
    .eq('id', requestId)
    .single()

  if (reqErr || !request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // Resolve or create company
  let resolvedCompanyId: string = companyId ?? ''
  let resolvedCompanyName = ''

  if (!resolvedCompanyId) {
    const name = (companyName ?? request.requested_company_name).trim()
    const { data: newCompany, error: companyErr } = await admin
      .from('companies')
      .insert({ name })
      .select('id, name')
      .single()

    if (companyErr || !newCompany) {
      console.error('[approve-signup] company insert error:', companyErr)
      return NextResponse.json({ error: 'Failed to create company' }, { status: 500 })
    }

    resolvedCompanyId = newCompany.id
    resolvedCompanyName = newCompany.name
  } else if (companyName) {
    // Update existing company name if provided
    const trimmedCompanyName = companyName.trim()
    await admin
      .from('companies')
      .update({ name: trimmedCompanyName })
      .eq('id', resolvedCompanyId)
    resolvedCompanyName = trimmedCompanyName
  }

  if (!resolvedCompanyName) {
    const { data: company } = await admin
      .from('companies')
      .select('name')
      .eq('id', resolvedCompanyId)
      .single()

    resolvedCompanyName = company?.name ?? request.requested_company_name
  }

  // Check if this email already exists in Supabase auth (e.g. from another app)
  let authUserId: string | null = null
  const email = request.email.toLowerCase()
  const existingUser = await findAuthUserByEmail(admin, email)

  if (existingUser) {
    // User already has a shared Supabase auth account — just grant access.
    authUserId = existingUser.id
  } else {
    const inviteMetadata = {
      app_name: appName,
      app_url: appUrl,
      signup_app: appSlug,
      company_id: resolvedCompanyId,
      company_name: resolvedCompanyName,
      invited_role: 'member',
    }

    // New user — send an app-specific Supabase invite so the shared email template
    // can route them back into the correct app after verification.
    const { data: inviteResult, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: inviteMetadata,
      redirectTo: inviteRedirectTo,
    })

    if (inviteErr || !inviteResult.user) {
      console.error('[approve-signup] inviteUserByEmail error:', inviteErr)
      return NextResponse.json({ error: inviteErr?.message ?? 'Failed to invite user' }, { status: 500 })
    }

    authUserId = inviteResult.user.id
  }

  // Grant app access explicitly (don't rely on trigger)
  const { error: accessErr } = await admin
    .from('user_app_access')
    .upsert({ user_id: authUserId, app_name: appSlug, role: 'member' }, { onConflict: 'user_id,app_name' })

  if (accessErr) {
    console.error('[approve-signup] app access upsert error:', accessErr)
    return NextResponse.json({ error: 'Failed to grant app access' }, { status: 500 })
  }

  // Create public.users row (upsert so re-approving the same user doesn't fail)
  const { error: usersErr } = await admin.from('users').upsert({
    id: authUserId,
    company_id: resolvedCompanyId,
    email,
    role: 'member',
  }, { onConflict: 'id' })

  if (usersErr) {
    console.error('[approve-signup] users upsert error:', usersErr)
    return NextResponse.json({ error: 'Failed to create Guardian SMS user record' }, { status: 500 })
  }

  // Mark request as approved
  const { error: requestUpdateErr } = await admin
    .from('signup_requests')
    .update({ status: 'approved', company_id: resolvedCompanyId })
    .eq('id', requestId)

  if (requestUpdateErr) {
    console.error('[approve-signup] request update error:', requestUpdateErr)
    return NextResponse.json({ error: 'User was created, but request status could not be updated' }, { status: 500 })
  }

  if (existingUser) {
    await sendEmail(
      email,
      `Your ${appName} access is ready`,
      `<p>Hi ${request.name || 'there'},</p>
       <p>Your access to ${appName} has been approved.</p>
       <p>You already have an account in our shared login system, so no separate invite was needed.</p>
       <p><a href="${appUrl}/login" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Sign in to ${appName}</a></p>
       <p style="color:#666;font-size:12px;">Use the same email address you requested access with: ${email}</p>`
    )
  }

  return NextResponse.json({ ok: true })
}
