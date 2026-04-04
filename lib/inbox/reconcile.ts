import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

type MatchedJob = Pick<
  Database['public']['Tables']['jobs']['Row'],
  'id' | 'customer_name' | 'customer_phone' | 'albi_job_id' | 'albi_project_url'
>

export async function findBestJobForPhone(
  admin: AdminClient,
  companyId: string,
  phone: string
): Promise<MatchedJob | null> {
  const { data, error } = await admin
    .from('jobs')
    .select('id, customer_name, customer_phone, albi_job_id, albi_project_url')
    .eq('company_id', companyId)
    .eq('customer_phone', phone)
    .order('updated_at', { ascending: false })
    .order('imported_at', { ascending: false })
    .order('created_at_albi', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

export async function reconcileInboxForPhones(
  admin: AdminClient,
  companyId: string,
  phones: string[]
) {
  const uniquePhones = Array.from(
    new Set(
      phones
        .map((phone) => phone.trim())
        .filter(Boolean)
    )
  )

  let updatedConversations = 0
  let updatedMessages = 0

  for (const phone of uniquePhones) {
    const job = await findBestJobForPhone(admin, companyId, phone)
    if (!job) continue

    const { data: convUpdate, error: convError } = await admin
      .from('conversations')
      .update({ job_id: job.id })
      .eq('company_id', companyId)
      .eq('customer_phone', phone)
      .select('id')

    if (convError) {
      throw convError
    }

    updatedConversations += convUpdate?.length ?? 0

    const { data: inboundMessageUpdate, error: inboundMessageError } = await admin
      .from('sent_messages')
      .update({ job_id: job.id })
      .eq('company_id', companyId)
      .is('job_id', null)
      .eq('from_phone', phone)
      .select('id')

    if (inboundMessageError) {
      throw inboundMessageError
    }

    updatedMessages += inboundMessageUpdate?.length ?? 0

    const { data: outboundMessageUpdate, error: outboundMessageError } = await admin
      .from('sent_messages')
      .update({ job_id: job.id })
      .eq('company_id', companyId)
      .is('job_id', null)
      .eq('to_phone', phone)
      .select('id')

    if (outboundMessageError) {
      throw outboundMessageError
    }

    updatedMessages += outboundMessageUpdate?.length ?? 0
  }

  return {
    updatedConversations,
    updatedMessages,
    matchedPhones: uniquePhones.length,
  }
}
