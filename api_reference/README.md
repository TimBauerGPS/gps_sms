# Mother Brain Consumer API Reference

Use this folder as the handoff packet for apps that need to read data from Mother Brain.

Mother Brain is the source-of-truth data service. Consumer apps should call Mother Brain from server-side code, using an API key created in Mother Brain. Do not call Mother Brain directly from browser JavaScript because that would expose the API key.

## Current Albi-Backed Dataset

Mother Brain now builds its active project dataset from the Albi API. This is an internal source change: consumer apps still use the same Mother Brain URL, `/api/query` endpoint, and app-specific Mother Brain API key. Consumer apps do not need an Albi API key and should not call Albi directly.

The consumer-facing shape intentionally remains the Mother Brain schema documented in `mb_headers/available_headers.csv`:

- `Name` comes from Albi `project.name` and remains the human-facing job name/job number used by existing apps.
- `Albi Project ID` exposes Albi's numeric `project.id`, and `Albi Project Identifier` exposes Albi's separate string `project.identifier`. Both are returned as strings and remain distinct from `Name`.
- Existing fields such as `Customer`, `Estimator`, `Project Manager`, `Status`, and `Contract Signed` retain their exact Mother Brain column names.
- Values returned by `/api/query` remain strings, with `""` used for missing values.
- Albi refreshes create a new immutable dataset version. A consumer reading multiple pages should pin every page to the version returned by its first request.

See [`../docs/albi/field-mapping.md`](../docs/albi/field-mapping.md) for the source mapping. If the receiving app needs that source-level detail, copy that file along with this folder. The live `columns` response remains authoritative for what a particular API key may access.

For the current columns grouped by Albi source, and how to request a field that isn't listed, see [Albi source and available fields](../docs/api-reference.md#albi-source-and-available-fields).

## Copy/Paste Instructions For Another Web App

Paste the following into the other app's development task, then provide that app with its own Mother Brain API key:

```text
Integrate this app with the Albi-backed Mother Brain project dataset.

Use server-side code only. Configure:
MOTHER_BRAIN_BASE_URL=https://motherbrain.netlify.app
MOTHER_BRAIN_API_KEY=<this app's dedicated Mother Brain API key>

POST JSON queries to ${MOTHER_BRAIN_BASE_URL}/api/query with:
Authorization: Bearer ${MOTHER_BRAIN_API_KEY}
Content-Type: application/json

Do not call Albi directly and do not expose either variable through VITE_,
NEXT_PUBLIC_, browser JavaScript, or client bundles.

First send { "limit": 1 } without select and treat the returned columns array as
the authoritative permissions for this key. Use the exact Title Case Mother Brain
column names from api_reference/mb_headers/available_headers.csv.

For a complete import, request pages of 1,000 rows using offset. Capture the
X-Motherbrain-Dataset-Version header from page one and send it as datasetVersionId
on every later page. Stop when a page returns fewer than 1,000 rows. Reject the
import if the header is missing or changes so two snapshots are never combined.

Treat Name as the human-facing Albi project name/job number. Do not treat Name as
the Albi database ID. Use Albi Project ID for project.id and Albi Project
Identifier for project.identifier. Ask the Mother Brain administrator to add
either column to this app's API-key permissions before selecting it.

Create docs/mother-brain-columns-needed.md in this app listing every column used
by select, filters, or sort. If the API returns COLUMN_ACCESS_DENIED, request that
the missing columns be added to this app's dedicated Mother Brain key.
```

## Files To Bring Into A Consumer App

Copy this `api_reference` folder into the consumer app.

Include an `mb_headers` folder next to this document when available. That folder should contain a CSV file with the Mother Brain column headers that may be useful while coding.

Example layout:

```text
api_reference/
  README.md
  mb_headers/
    available_headers.csv
```

The `mb_headers` CSV is a development aid. It helps the app developer see possible column names, but the API key still controls which columns the app can actually access.

## Environment Variables

Add these server-side environment variables to the consumer app:

```text
MOTHER_BRAIN_BASE_URL=https://motherbrain.netlify.app
MOTHER_BRAIN_API_KEY=mb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

In Netlify, put these in the site environment variables. Never prefix the key with `VITE_`, `NEXT_PUBLIC_`, or anything else that exposes it to browser code.

## Endpoint

```http
POST /api/query
Content-Type: application/json
Authorization: Bearer <MOTHER_BRAIN_API_KEY>
```

`x-api-key: <MOTHER_BRAIN_API_KEY>` is also accepted, but `Authorization: Bearer ...` is preferred.

## Column Access Rules

Each API key is scoped to a saved set of columns.

The app can request:

- all columns allowed by its API key
- only some of the columns allowed by its API key

The app cannot request, filter by, or sort by a column outside its allowed set. Mother Brain will return `COLUMN_ACCESS_DENIED`.

### How To Request All Allowed Columns

Omit `select`.

```json
{
  "limit": 100
}
```

Mother Brain returns only the columns allowed for that API key:

```json
{
  "columns": ["Customer", "Estimated Revenue", "Status"],
  "rows": [
    {
      "Customer": "Ada Lovelace",
      "Estimated Revenue": "125.50",
      "Status": "Active"
    }
  ]
}
```

### How To Determine Which Columns Are Available To The App

Send a tiny request with no `select`, such as:

```json
{
  "limit": 1
}
```

Then read the `columns` array in the response. That array is the authoritative list of columns this API key can read.

Use `api_reference/mb_headers/*.csv` as a coding reference for possible Mother Brain headers, but use the live `columns` response to confirm what this specific app key can access.

### How To Request Some Allowed Columns

Use `select`.

```json
{
  "select": ["Customer", "Estimated Revenue"],
  "limit": 100
}
```

The response rows will include only those selected columns.

## Required Column Request Document For Each Consumer App

Each consumer app should include a small markdown file listing the Mother Brain columns it needs. This gives the Mother Brain admin a clean list to copy into the API key generator when creating or updating that app's API key.

Recommended filename inside the consumer app:

```text
docs/mother-brain-columns-needed.md
```

Recommended format:

````md
# Mother Brain Columns Needed

App name: Example Consumer App
Purpose: Shows active customer invoices.

## Required Columns

Copy this list into the Mother Brain API key generator:

```text
Customer,
Estimated Revenue,
Inspection Date,
Status
```

## Why These Columns Are Needed

- `Customer`: customer label in the project list
- `Estimated Revenue`: project value shown to the user
- `Inspection Date`: inspection-date sorting and display
- `Status`: filters the list to active projects
````

Keep this file updated whenever the app adds or removes Mother Brain fields. Before asking for a new API key or a permissions update, compare the requested column names against `api_reference/mb_headers/available_headers.csv` and the live `columns` response from `/api/query`.

## Query Body

```ts
type MotherBrainQuery = {
  select?: string[];
  filters?: Array<{
    column: string;
    op: string;
    value?: string | number | null;
    values?: Array<string | number | null>;
  }>;
  sort?: Array<{
    column: string;
    direction: 'asc' | 'desc';
  }>;
  limit?: number;
  offset?: number;
  datasetVersionId?: string;
};
```

If `limit` is omitted, Mother Brain returns up to `1000` rows.

## Complete Retrieval And Snapshot Pinning

For imports that need every matching project, request pages with `limit: 1000` and increasing `offset` values. The first response includes `X-Motherbrain-Dataset-Version`; pass that value as `datasetVersionId` on every later request. This prevents a refresh published during pagination from mixing rows from two datasets.

```ts
async function queryAllMotherBrain(query: MotherBrainQuery) {
  const rows: Record<string, string>[] = [];
  let offset = 0;
  let datasetVersionId: string | undefined;

  while (true) {
    const response = await queryMotherBrainResponse({
      ...query,
      limit: 1000,
      offset,
      ...(datasetVersionId ? { datasetVersionId } : {})
    });

    const responseVersion = response.headers.get('X-Motherbrain-Dataset-Version');
    if (!responseVersion || (datasetVersionId && responseVersion !== datasetVersionId)) {
      throw new Error('Mother Brain dataset snapshot changed during pagination.');
    }
    datasetVersionId ??= responseVersion;

    const body = await response.json();
    if (!response.ok) {
      throw new Error(`${body.error?.code}: ${body.error?.message}`);
    }

    rows.push(...body.rows);
    if (body.rows.length < 1000) return rows;
    offset += body.rows.length;
  }
}
```

`queryMotherBrainResponse` should perform the same authenticated server-side fetch shown below, but return the `Response` so the caller can read both its headers and JSON body.

## Filters

Filters are case-insensitive for text columns. Number and date filters depend on the column type inferred by Mother Brain.

### Text Filters

```json
{ "column": "Customer", "op": "contains", "value": "smith" }
```

Supported operations:

```text
equals
not equals
contains
not contains
starts with
ends with
is blank
is not blank
```

### Number Filters

```json
{ "column": "Estimated Revenue", "op": "greater than", "value": 100 }
```

```json
{ "column": "Estimated Revenue", "op": "between", "values": [100, 500] }
```

Supported operations:

```text
equals
not equals
greater than
greater than or equal
less than
less than or equal
between
is blank
is not blank
```

### Date Filters

Dates must use `YYYY-MM-DD`.

```json
{ "column": "Inspection Date", "op": "on or after", "value": "2026-05-01" }
```

```json
{ "column": "Inspection Date", "op": "between", "values": ["2026-05-01", "2026-05-31"] }
```

Supported operations:

```text
on
not on
before
on or before
after
on or after
between
is blank
is not blank
```

## Sorting

```json
{
  "select": ["Customer", "Estimated Revenue"],
  "sort": [{ "column": "Estimated Revenue", "direction": "desc" }],
  "limit": 50
}
```

The sort column must be allowed for the API key.

## Error Handling

Every expected API error returns JSON in this shape:

```json
{
  "error": {
    "code": "COLUMN_ACCESS_DENIED",
    "message": "API key does not allow access to requested columns.",
    "details": {
      "columns": ["private_note"]
    }
  }
}
```

Consumer apps should always:

1. Check the response `content-type`.
2. Parse JSON only when the response is JSON.
3. Check `response.ok`.
4. If not OK, log `error.code`, `error.message`, and `error.details`.
5. Show a friendly app-specific message to users.

Possible error codes:

```text
INVALID_API_KEY
COLUMN_ACCESS_DENIED
UNKNOWN_COLUMN
UNSUPPORTED_FILTER_OPERATION
INVALID_FILTER_VALUE
LIMIT_TOO_LARGE
NO_ACTIVE_DATASET
RATE_LIMITED
VALIDATION_ERROR
```

If the response is not JSON, treat it as an unexpected server or network failure. Log the HTTP status and the first part of the text body, but do not show raw stack traces to end users.

### What Common Errors Mean

`INVALID_API_KEY`
: The key is missing, mistyped, revoked, or stored in the wrong environment variable.

`COLUMN_ACCESS_DENIED`
: The request referenced a column not allowed for this API key. Check `error.details.columns`.

`UNKNOWN_COLUMN`
: The request referenced a column that is not in the active Mother Brain dataset. Compare against `mb_headers` and the live `columns` response.

`UNSUPPORTED_FILTER_OPERATION`
: The filter operation does not match the column type. For example, `before` only works on date columns.

`INVALID_FILTER_VALUE`
: The value could not be used for the filter. Dates should be `YYYY-MM-DD`; numbers should be plain decimal values.

`LIMIT_TOO_LARGE`
: The request asked for too many rows. Lower `limit`.

`NO_ACTIVE_DATASET`
: Mother Brain does not currently have an active dataset.

`RATE_LIMITED`
: The app is calling Mother Brain too often. Cache responses or reduce polling.

`VALIDATION_ERROR`
: The request body is missing required structure or contains malformed JSON.

## Netlify Function Example

Use this pattern for a consumer app endpoint. The browser calls this local function, and this function calls Mother Brain server-side.

```ts
import type { Handler } from '@netlify/functions';

export const handler: Handler = async () => {
  const rows = await queryMotherBrain({
    select: ['Customer', 'Estimated Revenue', 'Status'],
    filters: [{ column: 'Status', op: 'equals', value: 'Active' }],
    sort: [{ column: 'Estimated Revenue', direction: 'desc' }],
    limit: 100
  });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows })
  };
};

async function queryMotherBrain(query: Record<string, unknown>) {
  const baseUrl = requiredEnv('MOTHER_BRAIN_BASE_URL').replace(/\/+$/, '');
  const apiKey = requiredEnv('MOTHER_BRAIN_API_KEY');

  const response = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(query)
  });

  const body = await readMotherBrainBody(response);

  if (!response.ok) {
    const error = body.error ?? {};
    throw new Error(
      `Mother Brain ${response.status} ${error.code ?? 'UNKNOWN_ERROR'}: ${error.message ?? 'Request failed'}`
    );
  }

  return body.rows;
}

async function readMotherBrainBody(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return await response.json().catch(() => ({}));
  }

  const text = await response.text().catch(() => '');
  return {
    error: {
      code: 'NON_JSON_RESPONSE',
      message: text.slice(0, 300) || `Mother Brain returned HTTP ${response.status}.`
    }
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
```

## Discover Columns Example

Use this while developing or during startup diagnostics.

```ts
async function listAllowedMotherBrainColumns() {
  const baseUrl = process.env.MOTHER_BRAIN_BASE_URL!.replace(/\/+$/, '');

  const response = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.MOTHER_BRAIN_API_KEY}`
    },
    body: JSON.stringify({ limit: 1 })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${body.error?.code}: ${body.error?.message}`);
  }

  return body.columns as string[];
}
```

## Recommended Consumer App Pattern

Create a small Mother Brain client module in each consumer app:

```text
src/server/motherBrainClient.ts
```

That module should own:

- reading `MOTHER_BRAIN_BASE_URL`
- reading `MOTHER_BRAIN_API_KEY`
- calling `/api/query`
- parsing success responses
- parsing API errors
- mapping Mother Brain rows into the app's local shape
- keeping the app's `docs/mother-brain-columns-needed.md` file in sync with its query code

Then the rest of the app imports that module instead of calling Mother Brain directly.

## Practical Tips

- Column names are exact strings. Copy them from `mb_headers` or from the `columns` response.
- Store returned values as strings unless your app deliberately converts them.
- Use small `select` arrays when the app only needs a few fields.
- Omit `select` when you intentionally want every column the key can access.
- Cache data in the consumer app when possible instead of querying Mother Brain on every page load.
- Give every app its own API key. Do not reuse one broad key across multiple apps.
- If an app needs a new column, create or update its Mother Brain API key permissions first.
- When an app changes its `select`, `filters`, or `sort` columns, update its Mother Brain columns-needed markdown file in the same change.
