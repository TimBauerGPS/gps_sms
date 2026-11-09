import test from 'node:test'
import assert from 'node:assert/strict'

import { MOTHER_BRAIN_REQUIRED_COLUMNS, readMotherBrainJobs, testMotherBrainConnection, toImportRows } from './motherBrain.ts'

const json = (body, { status = 200, version = 'v1' } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(version ? { 'X-Motherbrain-Dataset-Version': version } : {}),
    },
  })

const jobs = (count, start = 0) =>
  Array.from({ length: count }, (_, index) => ({ Name: `26-${start + index}-WTR`, Customer: 'Ada' }))

function mockFetch(t, responses) {
  process.env.MOTHER_BRAIN_BASE_URL = 'https://mb.example.test/'
  process.env.MOTHER_BRAIN_API_KEY = 'test-key'
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return responses.shift()
  })
  return calls
}

test('reads every page pinned to the first dataset version', async (t) => {
  const calls = mockFetch(t, [
    json({ columns: [...MOTHER_BRAIN_REQUIRED_COLUMNS, 'Project Manager'], rows: jobs(1000) }),
    json({ rows: jobs(2, 1000) }),
  ])

  const result = await readMotherBrainJobs()

  assert.equal(result.rows.length, 1002)
  assert.equal(calls[0].url, 'https://mb.example.test/api/query')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(calls[0].body.select, undefined)
  assert.equal(calls[0].body.datasetVersionId, undefined)
  assert.equal(calls[1].body.offset, 1000)
  assert.equal(calls[1].body.datasetVersionId, 'v1')
})

test('rejects an import when the dataset version changes', async (t) => {
  mockFetch(t, [
    json({ columns: MOTHER_BRAIN_REQUIRED_COLUMNS, rows: jobs(1000) }),
    json({ rows: jobs(1) }, { version: 'v2' }),
  ])
  await assert.rejects(readMotherBrainJobs(), /snapshot changed/)
})

test('rejects an import when the version header is missing', async (t) => {
  mockFetch(t, [json({ rows: jobs(1) }, { version: null })])
  await assert.rejects(readMotherBrainJobs(), /snapshot changed/)
})

test('rejects an import when the key lacks a required column', async (t) => {
  const columns = MOTHER_BRAIN_REQUIRED_COLUMNS.filter((column) => column !== 'Paid')
  mockFetch(t, [json({ columns, rows: jobs(1) })])
  await assert.rejects(readMotherBrainJobs(), /missing required columns: Paid$/)
})

test('surfaces Mother Brain API errors', async (t) => {
  mockFetch(t, [
    json(
      {
        error: {
          code: 'COLUMN_ACCESS_DENIED',
          message: 'API key does not allow access to requested columns.',
          details: { columns: ['Paid'] },
        },
      },
      { status: 403, version: null }
    ),
  ])
  await assert.rejects(readMotherBrainJobs(), /403 COLUMN_ACCESS_DENIED.*\(Paid\)/)
})

test('handles a non-JSON failure', async (t) => {
  mockFetch(t, [new Response('<html>Bad gateway</html>', { status: 502 })])
  await assert.rejects(readMotherBrainJobs(), /502 NON_JSON_RESPONSE/)
})

test('connection test reports missing columns without querying them', async (t) => {
  const calls = mockFetch(t, [json({ columns: ['Name'], rows: [] })])

  const result = await testMotherBrainConnection()

  assert.equal(calls.length, 1)
  assert.ok(result.missingColumns.includes('Customer Phone Number'))
  assert.ok(!result.missingColumns.includes('Name'))
})

test('aliases Customer Name so existing placeholders keep resolving', () => {
  const { rows } = toImportRows([{ Name: 'A', Customer: 'Ada Lovelace' }])
  assert.equal(rows[0]['Customer Name'], 'Ada Lovelace')
})

test('keeps the newest row when a job name repeats', () => {
  const { rows, duplicatesDropped } = toImportRows([
    { Name: 'A', Customer: 'Old', 'Created At': '2025-01-01T00:00:00' },
    { Name: 'A', Customer: 'New', 'Created At': '2026-01-01T00:00:00' },
    { Name: '', Customer: 'Unnamed' },
  ])

  assert.deepEqual(rows.map((row) => row.Customer), ['New', 'Unnamed'])
  assert.equal(duplicatesDropped, 1)
})
