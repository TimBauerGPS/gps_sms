import { createClient } from '@supabase/supabase-js'

const VALID_APPS = ['call-analyzer', 'guardian-sms', 'albi-hubspot-import']

function makeSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { userId, appName } = body

  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'userId is required' }) }
  }

  if (!appName || !VALID_APPS.includes(appName)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `appName must be one of: ${VALID_APPS.join(', ')}` }),
    }
  }

  try {
    const supabase = makeSupabase()

    const { error } = await supabase
      .from('user_app_access')
      .upsert({ user_id: userId, app_name: appName, role: 'member' }, { onConflict: 'user_id,app_name' })

    if (error) {
      console.error('[grant-app-access] upsert error:', error)
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, userId, appName }),
    }
  } catch (err) {
    console.error('[grant-app-access] unexpected error:', err)
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
