function pacificHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    hour12: false,
  }).format(now))
}

function resolveAppUrl() {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.NEXT_PUBLIC_APP_URL
}

export const handler = async () => {
  const now = new Date()
  const hour = pacificHour(now)

  if (hour !== 20) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'Outside 8pm Pacific window.' }),
    }
  }

  const appUrl = resolveAppUrl()
  const secret = process.env.INTERNAL_CRON_SECRET

  if (!appUrl || !secret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing app URL or INTERNAL_CRON_SECRET.' }),
    }
  }

  // Background function: Netlify answers 202 at once and the import runs for up to
  // 15 minutes. It skips itself if a job import already ran today.
  const response = await fetch(`${appUrl}/.netlify/functions/mother-brain-import-background`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-cron-secret': secret,
    },
    body: JSON.stringify({}),
  })

  const text = await response.text()

  return {
    statusCode: response.status,
    body: text,
    headers: { 'Content-Type': 'application/json' },
  }
}

// Schedule removed 2026-11: texting moved to arOS (SMS dashboard). Do not re-enable.
