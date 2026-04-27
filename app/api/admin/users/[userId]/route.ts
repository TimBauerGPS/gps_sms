import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianAdminContext } from '@/lib/adminAccess'
import { getAppSlug } from '@/lib/appAuth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const context = await getGuardianAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!context.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await params
  const { companyId, role } = await req.json()
  const updates: { company_id?: string; role?: 'admin' | 'member' } = {}

  if (typeof companyId === 'string' && companyId.trim()) updates.company_id = companyId.trim()
  if (role === 'admin' || role === 'member') updates.role = role

  if (!updates.company_id && !updates.role) {
    return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (updates.company_id) {
    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('id', updates.company_id)
      .single()

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }

  const { data: existingUser } = await admin
    .from('users')
    .select('id, email, role')
    .eq('id', userId)
    .maybeSingle()

  let updateError

  if (existingUser) {
    const result = await admin
      .from('users')
      .update(updates)
      .eq('id', userId)
    updateError = result.error
  } else {
    if (!updates.company_id) {
      return NextResponse.json({ error: 'Choose a company before assigning this user' }, { status: 400 })
    }

    const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId)
    if (authError || !authUser.user?.email) {
      return NextResponse.json({ error: 'Shared auth user not found' }, { status: 404 })
    }

    const result = await admin
      .from('users')
      .insert({
        id: userId,
        company_id: updates.company_id,
        email: authUser.user.email.toLowerCase(),
        role: updates.role ?? 'member',
      })
    updateError = result.error
  }

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await admin
    .from('user_app_access')
    .upsert(
      { user_id: userId, app_name: getAppSlug(), role: updates.role ?? existingUser?.role ?? 'member' },
      { onConflict: 'user_id,app_name' }
    )

  return NextResponse.json({ ok: true })
}
