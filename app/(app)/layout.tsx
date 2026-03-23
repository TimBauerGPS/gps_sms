import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import MobileNav from '@/components/MobileNav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const userEmail = user.email ?? null

  // Fetch user row for role + company
  let companyName: string | null = null
  let isAdmin = false
  let pendingSignups = 0

  const { data: userRow } = await supabase
    .from('users')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (userRow?.company_id) {
    const { data: company } = await supabase
      .from('companies')
      .select('name')
      .eq('id', userRow.company_id)
      .single()
    companyName = company?.name ?? null
  }

  if (userRow?.role === 'admin') {
    isAdmin = true
    const admin = createAdminClient()
    const { count } = await admin
      .from('signup_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    pendingSignups = count ?? 0
  }

  return (
    <div className="min-h-screen bg-white">
      <Sidebar
        userEmail={userEmail}
        companyName={companyName}
        isAdmin={isAdmin}
        pendingSignups={pendingSignups}
      />
      <main className="md:ml-64 min-h-screen bg-white pb-16 md:pb-0">
        <div className="p-4 md:p-6">{children}</div>
      </main>
      <MobileNav />
    </div>
  )
}
