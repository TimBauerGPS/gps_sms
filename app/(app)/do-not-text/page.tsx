import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DoNotTextClient from './DoNotTextClient'

export const metadata = { title: 'Do Not Text' }

export default async function DoNotTextPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Get the user's company
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('company_id, email')
    .eq('id', user.id)
    .single()

  if (userError || !userRow) {
    return (
      <div className="p-6 text-red-600 text-sm">
        Could not load user record. Please refresh or contact support.
      </div>
    )
  }

  // Fetch all do_not_text rows for this company, newest first
  const { data: rows, error: dntError } = await supabase
    .from('do_not_text')
    .select('*')
    .eq('company_id', userRow.company_id)
    .order('added_at', { ascending: false })

  if (dntError) {
    return (
      <div className="p-6 text-red-600 text-sm">
        Could not load Do Not Text list. Please refresh or contact support.
      </div>
    )
  }

  return (
    <DoNotTextClient
      initialRows={rows ?? []}
      companyId={userRow.company_id}
      currentUserId={user.id}
      currentUserEmail={userRow.email}
    />
  )
}
