// WP-08 (AD-2): .docx in -> verdicts out as a Word comment layer. The
// practitioner never leaves Word.
//
// A .docx is a zip of XML parts. The zip reader/writer here is hand-rolled on
// node:zlib (R15: zero new dependencies; store + deflate entries, central
// directory, no zip64 — a draft report is nowhere near 4 GiB). Text is
// extracted deterministically from word/document.xml: the contents of w:t
// runs, in document order, formatting ignored. Annotation returns the same
// document with word/comments.xml added, commentRangeStart/End plus a
// commentReference wrapping each flagged sentence's runs, and the content-type
// override and relationship added if absent. Untouched parts keep their
// original compressed bytes; nothing here reads a clock (output is
// byte-deterministic — zip timestamps and w:date come from the build's as_of).
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------- crc32
// Eight lines beat a version probe: zlib.crc32 only exists from Node 22.2.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- zip
// Entry: { name, method (0 store | 8 deflate), time, date, crc, csize, usize,
// raw (compressed bytes) }.
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt zip: bad central directory signature');
    const method = buf.readUInt16LE(off + 10);
    const time = buf.readUInt16LE(off + 12);
    const date = buf.readUInt16LE(off + 14);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`corrupt zip: bad local header for ${name}`);
    // Lengths in the LOCAL header can differ from the central ones.
    const localNameLen = buf.readUInt16LE(lho + 26);
    const localExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + localNameLen + localExtraLen;
    entries.push({ name, method, time, date, crc, csize, usize, raw: buf.subarray(dataStart, dataStart + csize) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function inflateEntry(entry) {
  if (entry.method === 0) return Buffer.from(entry.raw);
  if (entry.method === 8) return inflateRawSync(entry.raw);
  throw new Error(`unsupported zip compression method ${entry.method} on ${entry.name}`);
}

// Build a fresh deflate entry from plain bytes (used for parts we replace or
// add). time/date are DOS-format fields the caller fixes from the build.
export function makeEntry(name, data, { time = 0, date = 0x21 } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const raw = deflateRawSync(bytes, { level: 9 });
  return { name, method: 8, time, date, crc: crc32(bytes), csize: raw.length, usize: bytes.length, raw };
}

export function zip(entries) {
  const locals = [];
  const centrals = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags: none; sizes and crc are right here
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(e.time, 10);
    lh.writeUInt16LE(e.date, 12);
    lh.writeUInt32LE(e.crc, 14);
    lh.writeUInt32LE(e.csize, 18);
    lh.writeUInt32LE(e.usize, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, Buffer.from(e.raw));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt16LE(e.time, 12);
    ch.writeUInt16LE(e.date, 14);
    ch.writeUInt32LE(e.crc, 16);
    ch.writeUInt32LE(e.csize, 20);
    ch.writeUInt32LE(e.usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42); // comment/disk/attr fields stay zero from alloc
    centrals.push(ch, name);
    off += 30 + name.length + e.csize;
  }
  const body = Buffer.concat(locals);
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, eocd]);
}

// ---------------------------------------------------------------- xml text
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#[xX]?[0-9A-Fa-f]+);/g, (whole, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENT[e];
  });
}
export const encodeXml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

const P_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const R_RE = /<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const T_RE = /<w:t\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;

// Paragraphs of document.xml with run spans: for each paragraph its decoded
// text, and for each run its [textStart,textEnd) range in that text plus its
// [xmlStart,xmlEnd) range in the document.xml string. Only w:t content counts
// as text (w:tab and w:br read as nothing — a documented limit).
export function extractParagraphs(xml) {
  const paras = [];
  for (const pm of xml.matchAll(P_RE)) {
    if (pm[0].endsWith('/>')) {
      paras.push({ xmlStart: pm.index, xmlEnd: pm.index + pm[0].length, text: '', runs: [] });
      continue;
    }
    const base = pm.index;
    const runs = [];
    let text = '';
    for (const rm of pm[0].matchAll(R_RE)) {
      let runText = '';
      if (!rm[0].endsWith('/>')) {
        for (const tm of rm[0].matchAll(T_RE)) {
          if (tm[1] !== undefined) runText += decodeXml(tm[1]);
        }
      }
      runs.push({
        xmlStart: base + rm.index,
        xmlEnd: base + rm.index + rm[0].length,
        textStart: text.length,
        textEnd: text.length + runText.length,
      });
      text += runText;
    }
    paras.push({ xmlStart: base, xmlEnd: base + pm[0].length, text, runs });
  }
  return paras;
}

export function readDocx(buf) {
  const entries = unzip(buf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('not a .docx: word/document.xml is missing');
  const xml = inflateEntry(doc).toString('utf8');
  return { entries, xml, paragraphs: extractParagraphs(xml) };
}

// ---------------------------------------------------------------- annotate
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function dosDate(asOf) {
  const [y, m, d] = asOf.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`as_of "${asOf}" is not a YYYY-MM-DD date`);
  return ((y - 1980) << 9) | (m << 5) | d;
}

// comments: [{ paragraph, start, end, text }] with start/end offsets into the
// paragraph's decoded text. Ranges anchor at run granularity: the range opens
// before the first run the span touches and closes after the last one, so the
// document's own runs — and therefore its extracted text — are byte-unchanged.
export function annotate(buf, comments, { asOf }) {
  const { entries, xml, paragraphs } = readDocx(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const stamp = { time: 0, date: dosDate(asOf) };

  let commentsXml = byName.has('word/comments.xml')
    ? inflateEntry(byName.get('word/comments.xml')).toString('utf8')
    : null;
  let nextId = 0;
  if (commentsXml !== null) {
    for (const m of commentsXml.matchAll(/w:id="(\d+)"/g)) nextId = Math.max(nextId, Number(m[1]) + 1);
  }

  const inserts = [];
  const defs = [];
  for (const c of comments) {
    const p = paragraphs[c.paragraph];
    if (!p) throw new Error(`comment targets paragraph ${c.paragraph} but the document has ${paragraphs.length}`);
    const hit = p.runs.filter((r) => r.textEnd > r.textStart && r.textEnd > c.start && r.textStart < c.end);
    if (hit.length === 0) continue; // nothing to wrap: an empty span
    const id = nextId++;
    inserts.push({ pos: hit[0].xmlStart, str: `<w:commentRangeStart w:id="${id}"/>` });
    inserts.push({
      pos: hit[hit.length - 1].xmlEnd,
      str: `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`,
    });
    defs.push(
      `<w:comment w:id="${id}" w:author="Record Runtime" w:initials="RR" w:date="${asOf}T00:00:00Z">` +
        `<w:p><w:r><w:t xml:space="preserve">${encodeXml(c.text)}</w:t></w:r></w:p></w:comment>`,
    );
  }

  // Splice without index shifting: stable sort, then concatenate segments.
  inserts.sort((a, b) => a.pos - b.pos);
  let outXml = '';
  let last = 0;
  for (const ins of inserts) {
    outXml += xml.slice(last, ins.pos) + ins.str;
    last = ins.pos;
  }
  outXml += xml.slice(last);

  commentsXml =
    commentsXml === null
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W_NS}">${defs.join('')}</w:comments>`
      : commentsXml.replace(/<\/w:comments>\s*$/, `${defs.join('')}</w:comments>`);

  const ctEntry = byName.get('[Content_Types].xml');
  if (!ctEntry) throw new Error('not a .docx: [Content_Types].xml is missing');
  let ctXml = inflateEntry(ctEntry).toString('utf8');
  if (!ctXml.includes('PartName="/word/comments.xml"')) {
    ctXml = ctXml.replace('</Types>', `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/></Types>`);
  }

  const relName = 'word/_rels/document.xml.rels';
  let relXml = byName.has(relName)
    ? inflateEntry(byName.get(relName)).toString('utf8')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
  if (!relXml.includes(COMMENTS_REL)) {
    relXml = relXml.replace(
      '</Relationships>',
      `<Relationship Id="rIdRecordRuntimeComments" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`,
    );
  }

  const replaced = new Map([
    ['word/document.xml', makeEntry('word/document.xml', outXml, stamp)],
    ['[Content_Types].xml', makeEntry('[Content_Types].xml', ctXml, stamp)],
    ['word/comments.xml', makeEntry('word/comments.xml', commentsXml, stamp)],
    [relName, makeEntry(relName, relXml, stamp)],
  ]);
  const outEntries = entries.map((e) => {
    const r = replaced.get(e.name);
    replaced.delete(e.name);
    return r ?? e;
  });
  for (const e of replaced.values()) outEntries.push(e); // parts the input lacked
  return zip(outEntries);
}
