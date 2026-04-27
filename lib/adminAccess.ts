import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface GuardianAdminContext {
  userId: string
  email: string | null
  companyId: string | null
  role: 'admin' | 'member' | null
  isCompanyAdmin: boolean
  isSuperAdmin: boolean
  isAdmin: boolean
}

export async function getGuardianAdminContext(): Promise<GuardianAdminContext | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const admin = createAdminClient()

  const [{ data: userRow }, { data: superAdmin }] = await Promise.all([
    supabase
      .from('users')
      .select('company_id, role')
      .eq('id', user.id)
      .maybeSingle(),
    admin
      .from('super_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const role = userRow?.role ?? null
  const isCompanyAdmin = role === 'admin'
  const isSuperAdmin = Boolean(superAdmin)

  return {
    userId: user.id,
    email: user.email ?? null,
    companyId: userRow?.company_id ?? null,
    role,
    isCompanyAdmin,
    isSuperAdmin,
    isAdmin: isCompanyAdmin || isSuperAdmin,
  }
}

export async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
) {
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error

    const matchingUser = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
    if (matchingUser) return matchingUser

    if (!data.nextPage) return null
    page = data.nextPage
  }
}

export async function listSuperAdminEmails(admin: ReturnType<typeof createAdminClient>) {
  const { data: superAdmins, error } = await admin
    .from('super_admins')
    .select('user_id')

  if (error) throw error

  const emails: string[] = []
  for (const row of superAdmins ?? []) {
    const { data } = await admin.auth.admin.getUserById(row.user_id)
    const email = data.user?.email?.trim().toLowerCase()
    if (email && !emails.includes(email)) emails.push(email)
  }

  const fallbackEmail = process.env.SUPERUSER_NOTIFICATION_EMAIL?.trim().toLowerCase()
  if (emails.length === 0 && fallbackEmail) emails.push(fallbackEmail)

  return emails
}
