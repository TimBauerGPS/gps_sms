export type VCardPreview = {
  name: string | null
  phones: string[]
}

function unfoldLines(vcardText: string): string[] {
  const rawLines = vcardText.replace(/\r\n/g, '\n').split('\n')
  const unfolded: string[] = []

  for (const rawLine of rawLines) {
    if ((rawLine.startsWith(' ') || rawLine.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += rawLine.slice(1)
      continue
    }

    unfolded.push(rawLine)
  }

  return unfolded
}

function decodeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

function parseStructuredName(value: string): string | null {
  const [last = '', first = '', middle = '', prefix = '', suffix = ''] = value
    .split(';')
    .map((part) => decodeVCardValue(part))

  const name = [prefix, first, middle, last, suffix].filter(Boolean).join(' ').trim()
  return name || null
}

export function parseVCardPreview(vcardText: string): VCardPreview {
  const lines = unfoldLines(vcardText)
  let formattedName: string | null = null
  let structuredName: string | null = null
  const phones: string[] = []

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const rawKey = line.slice(0, colonIndex)
    const rawValue = line.slice(colonIndex + 1)
    const key = rawKey.split(';')[0].toUpperCase()

    if (key === 'FN') {
      formattedName = decodeVCardValue(rawValue) || null
      continue
    }

    if (key === 'N') {
      structuredName = parseStructuredName(rawValue)
      continue
    }

    if (key === 'TEL') {
      const phone = decodeVCardValue(rawValue)
      if (phone && !phones.includes(phone)) {
        phones.push(phone)
      }
    }
  }

  return {
    name: formattedName || structuredName,
    phones,
  }
}
