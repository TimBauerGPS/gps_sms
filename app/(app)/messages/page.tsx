import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SentMessage, Job } from '@/lib/supabase/types'
import MessagesClient from './MessagesClient'

export type MessageRow = SentMessage & {
  job_name: string | null
}

export default async function MessagesPage() {
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve company_id
  const { data: userRow } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!userRow) redirect('/onboarding')

  const company_id = userRow.company_id

  // Fetch last 200 sent_messages with job data
  const { data: messages, error } = await supabase
    .from('sent_messages')
    .select('*, jobs(albi_job_id)')
    .eq('company_id', company_id)
    .order('sent_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[MessagesPage] fetch error:', error.message)
  }

  // Shape data for the client component
  const rows: MessageRow[] = (messages ?? []).map((m) => {
    // Supabase returns joined rows as an object or array — handle both
    const jobData = m.jobs as { albi_job_id: string } | { albi_job_id: string }[] | null
    let job_name: string | null = null
    if (Array.isArray(jobData)) {
      job_name = jobData[0]?.albi_job_id ?? null
    } else if (jobData) {
      job_name = jobData.albi_job_id ?? null
    }

    // Strip the joined jobs field and add job_name
    const { jobs: _jobs, ...rest } = m as typeof m & { jobs: unknown }
    return { ...rest, job_name } as MessageRow
  })

  return <MessagesClient initialMessages={rows} />
}
