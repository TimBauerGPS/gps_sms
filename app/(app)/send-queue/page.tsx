import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { SendQueue, Job, MessagePlan } from '@/lib/supabase/types'
import SendQueueClient from './SendQueueClient'

export type SendQueueRow = SendQueue & {
  job: Pick<Job, 'customer_name' | 'status' | 'customer_phone'> | null
  plan: Pick<MessagePlan, 'trigger_type' | 'trigger_date_field' | 'trigger_offset_days' | 'trigger_status_value' | 'trigger_job_type_strings'> | null
}

export default async function SendQueuePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!userRow) redirect('/onboarding')

  const { data: rows } = await supabase
    .from('send_queue')
    .select(`
      *,
      job:jobs ( customer_name, status, customer_phone ),
      plan:message_plans ( trigger_type, trigger_date_field, trigger_offset_days, trigger_status_value, trigger_job_type_strings )
    `)
    .eq('company_id', userRow.company_id)
    .eq('status', 'pending')
    .order('queued_at', { ascending: true })

  return (
    <SendQueueClient
      initialRows={(rows ?? []) as SendQueueRow[]}
      companyId={userRow.company_id}
    />
  )
}
