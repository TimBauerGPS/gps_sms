import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/lib/supabase/types'
import PulseChecksClient from './PulseChecksClient'

export default async function PulseChecksPage() {
  const supabase = await createClient()

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve company_id
  const { data: userRow } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!userRow) redirect('/onboarding')

  const company_id = userRow.company_id

  // Fetch company row (for review_links)
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', company_id)
    .single()

  // Fetch all distinct statuses from jobs for this company
  const { data: jobRows } = await supabase
    .from('jobs')
    .select('status')
    .eq('company_id', company_id)
    .not('status', 'is', null)

  const distinctStatuses: string[] = Array.from(
    new Set((jobRows ?? []).map((r) => r.status as string).filter(Boolean))
  ).sort()

  return (
    <PulseChecksClient
      companyId={company_id}
      company={company as Company}
      distinctStatuses={distinctStatuses}
    />
  )
}
