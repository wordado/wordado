/**
 * RFC 4180 CSV for the review queues (Decision 4). What we write opens
 * correctly in Excel (a UTF-8 BOM, CRLF); what we read is whatever a
 * spreadsheet writes back: with or without the BOM, CRLF or LF, a missing
 * final newline, and trailing empty cells dropped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    cell = ''
  }
  while (i < src.length) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      } else cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && src[i + 1] === '\n') {
      endRow()
      i += 1
    } else if (ch === '\n' || ch === '\r') endRow()
    else cell += ch
    i += 1
  }
  if (quoted) throw new Error('CSV has an unterminated quoted cell')
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

const needsQuotes = /[",\r\n]/

export function formatCsv(rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) =>
    cells.map((c) => (needsQuotes.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')
  return `﻿${rows.map(line).join('\r\n')}\r\n`
}

export function csvRecords(text: string): { header: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text)
  const header = (head ?? []).map((h) => h.trim())
  const rows = body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
  return { header, rows }
}
