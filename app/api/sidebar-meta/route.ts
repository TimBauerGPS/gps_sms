import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianAdminContext } from '@/lib/adminAccess'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const context = await getGuardianAdminContext()
  const isSuperAdmin = Boolean(context?.isSuperAdmin)

  const { data: userRow } = await supabase
    .from('users')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!userRow && !isSuperAdmin) {
    return NextResponse.json({ companyName: null, isAdmin: false, isSuperAdmin: false, pendingSignups: 0 })
  }

  let companyName: string | null = null
  if (userRow?.company_id) {
    const { data: company } = await supabase
      .from('companies')
      .select('name')
      .eq('id', userRow.company_id)
      .single()
    companyName = company?.name ?? null
  }

  const isAdmin = userRow?.role === 'admin' || isSuperAdmin
  let pendingSignups = 0

  if (isSuperAdmin) {
    const admin = createAdminClient()
    const { count } = await admin
      .from('signup_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    pendingSignups = count ?? 0
  }

  return NextResponse.json({ companyName, isAdmin, isSuperAdmin, pendingSignups })
}
