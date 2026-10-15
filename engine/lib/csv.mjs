// Strict RFC 4180 CSV parser (zero dependencies). Quoted fields may contain
// commas, doubled quotes ("") and newlines. Malformed input throws.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte-order mark
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        const next = text[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new Error(`stray text after closing quote at offset ${i}`);
        }
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field !== '') throw new Error(`quote inside unquoted field at offset ${i}`);
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCSVWithHeader(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) throw new Error('empty CSV file');
  const header = rows[0];
  const records = rows.slice(1).map((r, i) => {
    if (r.length !== header.length) {
      throw new Error(`row ${i + 2} has ${r.length} fields, header has ${header.length}`);
    }
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
  return { header, rows: records };
}
