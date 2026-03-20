import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { companyName } = await request.json()
  if (!companyName?.trim()) {
    return NextResponse.json({ error: 'Company name required' }, { status: 400 })
  }

  // Verify the user is authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // Check they don't already have a users row
  const { data: existing } = await supabase.from('users').select('id').eq('id', user.id).single()
  if (existing) {
    return NextResponse.json({ error: 'Already onboarded' }, { status: 409 })
  }

  // Use admin client to bypass RLS for the initial setup
  const admin = createAdminClient()

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({ name: companyName.trim() })
    .select()
    .single()

  if (companyErr || !company) {
    return NextResponse.json({ error: companyErr?.message ?? 'Failed to create company' }, { status: 500 })
  }

  const { error: userErr } = await admin
    .from('users')
    .insert({ id: user.id, company_id: company.id, email: user.email ?? '', role: 'admin' })

  if (userErr) {
    // Roll back company if user insert fails
    await admin.from('companies').delete().eq('id', company.id)
    return NextResponse.json({ error: userErr.message }, { status: 500 })
  }

  return NextResponse.json({ companyId: company.id })
}
