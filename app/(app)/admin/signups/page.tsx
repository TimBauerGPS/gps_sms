import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianAdminContext } from '@/lib/adminAccess'
import { redirect } from 'next/navigation'
import SignupsClient from './SignupsClient'

export default async function AdminSignupsPage() {
  const context = await getGuardianAdminContext()
  if (!context) redirect('/login')
  if (!context.isSuperAdmin) redirect('/upload')

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
