// Export any table as CSV, Excel (.xlsx) or PDF, and read CSV for imports.
// columns: [{ key, label, value?(row) }]. value() gives the exported cell; otherwise row[key].

const cell = (row, c) => {
  const v = c.value ? c.value(row) : row[c.key]
  return v === null || v === undefined ? '' : v
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(cell(r, c))).join(','))].join('\r\n')
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// BOM so Excel opens UTF-8 (₹, names) correctly
export const exportCSV = (name, rows, columns) =>
  download(`${slug(name)}-${stamp()}.csv`, new Blob(['﻿' + toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' }))

// ---------------------------------------------------------------- minimal .xlsx (zip, stored, no compression)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zip(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true)
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, data)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true)
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true)
    cen.setUint16(28, nameBytes.length, true); cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const size = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, size, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }

export function xlsxBlob(sheetName, rows, columns) {
  const line = (cells, r) => `<row r="${r}">${cells.map((v, i) => {
    const ref = `${colName(i)}${r}`
    return typeof v === 'number' && Number.isFinite(v)
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`
  }).join('')}</row>`
  const data = [line(columns.map((c) => c.label), 1), ...rows.map((row, i) => line(columns.map((c) => cell(row, c)), i + 2))].join('')
  const name = xml(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`],
  ])
}

export const exportExcel = (name, rows, columns) => {
  const blob = xlsxBlob(name, rows, columns)
  download(`${slug(name)}-${stamp()}.xlsx`, new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

// ---------------------------------------------------------------- PDF (jsPDF is loaded only when asked for)
export async function exportPDF(name, rows, columns, subtitle = '') {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt' })
  doc.setFontSize(14)
  doc.text(`YOLO Nest · ${name}`, 40, 40)
  doc.setFontSize(9)
  doc.text(`${subtitle ? subtitle + ' · ' : ''}Generated ${new Date().toLocaleString('en-IN')}`, 40, 56)
  autoTable(doc, {
    startY: 70,
    head: [columns.map((c) => c.label)],
    // jsPDF's built-in font has no ₹ glyph
    body: rows.map((r) => columns.map((c) => String(cell(r, c)).replace(/₹/g, 'Rs '))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [28, 31, 74] },
  })
  doc.save(`${slug(name)}-${stamp()}.pdf`)
}

// ---------------------------------------------------------------- CSV import
export function parseCSV(text) {
  const out = []
  let row = []; let field = ''; let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); out.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); out.push(row) }
  const [head, ...body] = out.filter((r) => r.some((v) => v.trim() !== ''))
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}
