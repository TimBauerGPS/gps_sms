export function resolvePlaceholders(
  template: string,
  rawCsvRow: Record<string, string>,
  reviewLinks: Array<{ match_string: string; url: string }>,
  jobName: string,
  companyName?: string | null
): string {
  // Replace {{REVIEW_LINK}}
  let result = template.replace(/\{\{REVIEW_LINK\}\}/gi, () => {
    const match = reviewLinks.find(
      (r) =>
        r.match_string === '' ||
        jobName.toLowerCase().includes(r.match_string.toLowerCase())
    )
    return match?.url ?? ''
  })

  // Replace {{Guardian Office Name}} → company name
  result = result.replace(/\{\{Guardian Office Name\}\}/gi, () => companyName ?? '')

  // Replace {{Job Number}} → the "Name" column value (the Albi job ID like 24-00123-WTR-SNA)
  result = result.replace(/\{\{Job Number\}\}/gi, () => {
    const found = Object.entries(rawCsvRow).find(
      ([k]) => k.toLowerCase() === 'name'
    )
    return found ? String(found[1]) : jobName
  })

  // Replace other {{placeholders}} from raw_csv_row (case-insensitive key match)
  result = result.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const normalized = key.trim().toLowerCase()
    const found = Object.entries(rawCsvRow).find(
      ([k]) => k.toLowerCase() === normalized
    )
    return found ? String(found[1]) : ''
  })

  return result
}
