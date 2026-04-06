import { createSign } from 'crypto'

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

interface ServiceAccountCredentials {
  client_email: string
  private_key: string
  token_uri?: string
}

interface SpreadsheetMetadata {
  properties?: {
    title?: string
  }
  sheets?: Array<{
    properties?: {
      sheetId?: number
      title?: string
    }
  }>
}

interface GoogleSheetData {
  spreadsheetId: string
  spreadsheetTitle: string
  worksheetTitle: string
  rows: Record<string, string>[]
  headers: string[]
  totalRows: number
  sampleRows: Record<string, string>[]
}

export function parseGoogleSheetUrl(sheetUrl: string) {
  const trimmed = sheetUrl.trim()
  const spreadsheetIdMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)

  if (!spreadsheetIdMatch) {
    throw new Error('Enter a valid Google Sheets URL.')
  }

  const url = new URL(trimmed)
  const gidValue = url.searchParams.get('gid')
  const gid = gidValue ? Number(gidValue) : null

  return {
    spreadsheetId: spreadsheetIdMatch[1],
    gid: Number.isFinite(gid) ? gid : null,
  }
}

export async function readGoogleSheet(sheetUrl: string): Promise<GoogleSheetData> {
  const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl)
  const accessToken = await getGoogleAccessToken()
  const metadata = await fetchSpreadsheetMetadata(spreadsheetId, accessToken)

  const spreadsheetTitle = metadata.properties?.title?.trim() || 'Untitled spreadsheet'
  const availableSheets = metadata.sheets ?? []
  const targetSheet = gid == null
    ? availableSheets[0]
    : availableSheets.find((sheet) => sheet.properties?.sheetId === gid) ?? availableSheets[0]

  const worksheetTitle = targetSheet?.properties?.title?.trim()
  if (!worksheetTitle) {
    throw new Error('The spreadsheet does not contain any tabs.')
  }

  const values = await fetchSheetValues(spreadsheetId, worksheetTitle, accessToken)
  const matrix = values.map((row) => row.map((value) => value?.trim() ?? ''))
  await hydrateHyperlinkColumn(spreadsheetId, worksheetTitle, matrix, accessToken)
  const headers = matrix[0]?.filter(Boolean) ?? []

  return {
    spreadsheetId,
    spreadsheetTitle,
    worksheetTitle,
    rows: buildRowObjectsFromMatrix(matrix),
    headers,
    totalRows: Math.max(matrix.length - 1, 0),
    sampleRows: buildRowObjectsFromMatrix(matrix.slice(0, 4)),
  }
}

async function hydrateHyperlinkColumn(
  spreadsheetId: string,
  worksheetTitle: string,
  matrix: string[][],
  accessToken: string
) {
  const headers = matrix[0] ?? []
  const linkColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'link to project')
  if (linkColumnIndex < 0) return

  const columnLetter = toColumnLetter(linkColumnIndex)
  const rows = await fetchHyperlinkColumn(spreadsheetId, worksheetTitle, columnLetter, accessToken)

  rows.forEach((cell, rowIndex) => {
    if (!matrix[rowIndex]) {
      matrix[rowIndex] = []
    }

    const currentValue = matrix[rowIndex][linkColumnIndex]?.trim() ?? ''
    const nextValue = cell.hyperlink || cell.formattedValue || currentValue
    matrix[rowIndex][linkColumnIndex] = nextValue
  })
}

function buildRowObjectsFromMatrix(matrix: string[][]): Record<string, string>[] {
  if (matrix.length === 0) return []

  const headers = matrix[0].map((value) => value?.trim() ?? '')
  const rows: Record<string, string>[] = []

  for (const sourceRow of matrix.slice(1)) {
    const row: Record<string, string> = {}
    let hasValues = false

    headers.forEach((header, index) => {
      if (!header) return
      const value = sourceRow[index]?.trim() ?? ''
      if (value) hasValues = true
      row[header] = value
    })

    if (hasValues) rows.push(row)
  }

  return rows
}

async function fetchSpreadsheetMetadata(spreadsheetId: string, accessToken: string) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`)
  url.searchParams.set('fields', 'properties.title,sheets.properties(sheetId,title)')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response, 'Failed to read spreadsheet details.'))
  }

  return response.json() as Promise<SpreadsheetMetadata>
}

async function fetchSheetValues(spreadsheetId: string, worksheetTitle: string, accessToken: string) {
  const encodedRange = encodeURIComponent(`${worksheetTitle}!A:ZZZ`)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    throw new Error(await readGoogleError(response, 'Failed to read spreadsheet rows.'))
  }

  const data = await response.json() as { values?: string[][] }
  return data.values ?? []
}

async function fetchHyperlinkColumn(
  spreadsheetId: string,
  worksheetTitle: string,
  columnLetter: string,
  accessToken: string
) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`)
  url.searchParams.set('ranges', `${worksheetTitle}!${columnLetter}:${columnLetter}`)
  url.searchParams.set('includeGridData', 'true')
  url.searchParams.set(
    'fields',
    'sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue.formulaValue)'
  )

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response, 'Failed to read hyperlink data from the spreadsheet.'))
  }

  const data = await response.json() as {
    sheets?: Array<{
      data?: Array<{
        rowData?: Array<{
          values?: Array<{
            formattedValue?: string
            hyperlink?: string
            userEnteredValue?: {
              formulaValue?: string
            }
          }>
        }>
      }>
    }>
  }

  const rowData = data.sheets?.[0]?.data?.[0]?.rowData ?? []
  return rowData.map((row) => {
    const cell = row.values?.[0]
    return {
      formattedValue: cell?.formattedValue?.trim() ?? '',
      hyperlink: extractHyperlink(cell?.hyperlink, cell?.userEnteredValue?.formulaValue),
    }
  })
}

async function getGoogleAccessToken() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!rawJson) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON.')
  }

  let credentials: ServiceAccountCredentials
  try {
    credentials = JSON.parse(rawJson) as ServiceAccountCredentials
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.')
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing required service account fields.')
  }

  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token'
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_SCOPE,
    aud: tokenUri,
    exp: expiresAt,
    iat: issuedAt,
  }))

  const unsignedToken = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsignedToken)
  signer.end()

  const privateKey = credentials.private_key.replace(/\\n/g, '\n')
  const signature = signer.sign(privateKey, 'base64url')
  const assertion = `${unsignedToken}.${signature}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response, 'Failed to authenticate with Google Sheets.'))
  }

  const data = await response.json() as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Google authentication succeeded but did not return an access token.')
  }

  return data.access_token
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function extractHyperlink(hyperlink?: string, formulaValue?: string) {
  if (hyperlink?.trim()) {
    return hyperlink.trim()
  }

  const formulaMatch = formulaValue?.match(/^=HYPERLINK\("([^"]+)"/i)
  return formulaMatch?.[1]?.trim() ?? ''
}

function toColumnLetter(index: number) {
  let value = index + 1
  let result = ''

  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }

  return result
}

async function readGoogleError(response: Response, fallback: string) {
  try {
    const data = await response.json() as {
      error?: { message?: string } | string
      error_description?: string
    }

    if (typeof data.error === 'string' && data.error_description) {
      return `${fallback} ${data.error_description}`
    }

    if (typeof data.error === 'object' && data.error?.message) {
      return `${fallback} ${data.error.message}`
    }
  } catch {}

  return fallback
}
