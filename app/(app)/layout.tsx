import { createClient } from '@/lib/supabase/server'
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

  return (
    <div className="min-h-screen bg-white">
      <Sidebar userEmail={userEmail} />
      <main className="md:ml-64 min-h-screen bg-white pb-16 md:pb-0">
        <div className="p-4 md:p-6">{children}</div>
      </main>
      <MobileNav />
    </div>
  )
}
