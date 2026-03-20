import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsClient from './SettingsClient'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch the user record to get company_id
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (userError || !userRow) {
    return (
      <div className="p-6 text-red-600 text-sm">
        Could not load user record. Please refresh or contact support.
      </div>
    )
  }

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .eq('id', userRow.company_id)
    .single()

  if (companyError || !company) {
    return (
      <div className="p-6 text-red-600 text-sm">
        Could not load company. Please refresh or contact support.
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure your company profile, integrations, and messaging defaults.
        </p>
      </div>
      <SettingsClient company={company} />
    </div>
  )
}
