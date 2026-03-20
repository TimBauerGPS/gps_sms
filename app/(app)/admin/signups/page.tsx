import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import SignupsClient from './SignupsClient'

export default async function AdminSignupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userRow?.role !== 'admin') redirect('/upload')

  const admin = createAdminClient()

  const { data: requests } = await admin
    .from('signup_requests')
    .select('*')
    .order('created_at', { ascending: false })

  const { data: companies } = await admin
    .from('companies')
    .select('id, name')
    .order('name')

  return (
    <SignupsClient
      requests={requests ?? []}
      companies={companies ?? []}
    />
  )
}
