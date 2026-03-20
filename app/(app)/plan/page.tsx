import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { MessagePlan } from '@/lib/supabase/types'
import PlanClient from './PlanClient'

export default async function PlanPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Get company_id for this user
  const { data: userRow } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!userRow) redirect('/onboarding')

  const { data: plans } = await supabase
    .from('message_plans')
    .select('*')
    .eq('company_id', userRow.company_id)
    .order('created_at', { ascending: false })

  return (
    <PlanClient
      initialPlans={(plans ?? []) as MessagePlan[]}
      companyId={userRow.company_id}
    />
  )
}
