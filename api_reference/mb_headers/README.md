# Mother Brain Headers

Place a CSV file in this folder containing the Mother Brain headers available for app development.

Recommended filename:

```text
available_headers.csv
```

Recommended format:

```csv
column
Name
Albi Project ID
Albi Project Identifier
Customer
Estimated Revenue
Status
```

This file is a developer reference only. The live API key still determines which columns a consumer app can actually access. To confirm access for a specific app, call `/api/query` with `{ "limit": 1 }` and read the returned `columns` array.

The active dataset is sourced from Albi, but these are Mother Brain's stable consumer-facing column names. `Name` is the Albi project name/job number, `Albi Project ID` and `Albi Project Identifier` both carry Albi's project `id` as text.
