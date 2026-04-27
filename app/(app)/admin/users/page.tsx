import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianAdminContext } from '@/lib/adminAccess'
import { getAppSlug } from '@/lib/appAuth'
import UsersClient from './UsersClient'

interface AppUser {
  id: string
  company_id: string | null
  email: string
  role: 'admin' | 'member'
  has_app_access: boolean
  companies?: { name: string } | null
}

async function listAllAuthUsers(admin: ReturnType<typeof createAdminClient>) {
  const users = []
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    users.push(...data.users)
    if (!data.nextPage) return users
    page = data.nextPage
  }
}

export default async function AdminUsersPage() {
  const context = await getGuardianAdminContext()
  if (!context) redirect('/login')
  if (!context.isSuperAdmin) redirect('/upload')

  const admin = createAdminClient()

  const [{ data: appUsers }, { data: companies }, { data: accessRows }, authUsers] = await Promise.all([
    admin
      .from('users')
      .select('id, company_id, email, role, companies(name)')
      .order('email'),
    admin
      .from('companies')
      .select('id, name')
      .order('name'),
    admin
      .from('user_app_access')
      .select('user_id, role')
      .eq('app_name', getAppSlug()),
    listAllAuthUsers(admin),
  ])

  const appUserById = new Map((appUsers ?? []).map((user) => [user.id, user]))
  const accessByUserId = new Map((accessRows ?? []).map((row) => [row.user_id, row]))
  const mergedUsers: AppUser[] = authUsers
    .filter((user) => Boolean(user.email))
    .map((authUser) => {
      const appUser = appUserById.get(authUser.id)
      const access = accessByUserId.get(authUser.id)
      return {
        id: authUser.id,
        email: appUser?.email ?? authUser.email ?? '',
        company_id: appUser?.company_id ?? null,
        role: appUser?.role ?? (access?.role === 'admin' ? 'admin' : 'member'),
        has_app_access: Boolean(access || appUser),
        companies: appUser?.companies ?? null,
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))

  return (
    <UsersClient
      users={mergedUsers}
      companies={companies ?? []}
    />
  )
}
