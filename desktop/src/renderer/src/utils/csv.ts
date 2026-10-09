/** Preserve numeric precision and prevent text cells from becoming spreadsheet formulas. */
export function csvText(
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            if (value == null) return ''
            if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
            const text = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
            return `"${text.replaceAll('"', '""')}"`
          })
          .join(','),
      )
      .join('\r\n')
  )
}
export function downloadCsv(
  filename: string,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): void {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
