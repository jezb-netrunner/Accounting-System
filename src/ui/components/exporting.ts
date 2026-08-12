/** Client-side report exports: CSV always, XLSX via a lazy-loaded SheetJS. */

const downloadBlob = (filename: string, blob: Blob) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly string[])[]) {
  const content = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n')
  downloadBlob(filename, new Blob([content], { type: 'text/csv;charset=utf-8' }))
}

export async function downloadXlsx(
  filename: string,
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([[...headers], ...rows.map((r) => [...r])])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  downloadBlob(filename, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}
