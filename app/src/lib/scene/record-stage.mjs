// The record stage: one country's documents, morphed stage by stage inside a
// single mounted SVG. The choreography is ported from the frozen predecessor's
// country story (components/story/stage.tsx + app/styles/stage.css; owner
// decision 2026-10-16): keyed pools, one layout function per step, staggered
// --d, marks keeping their identity while the browser interpolates between
// layouts. Switched from SVG geometry attributes to TRANSFORM-based motion
// (WebKit before 16.4 does not animate x/y/width/height/cx/cy/r as CSS).
//
// What the predecessor's stages measured and what ours measure instead — the
// anchoring is deliberate and the substitutions are the honest half of the
// port. Emissions series, reduction percentages and USD are NOT held by this
// runtime, so the devices that ate them are re-driven by what is held:
//
//   predecessor                        ours
//   filings stamps                  →  the document rows on record, with the
//                                      four-state word and the X cross over a
//                                      confirmed-absent filing (carries over)
//   10x10 pledge waffle (percent)   →  one cell per document, re-sorted by
//                                      recorded state, unknowns hatched by
//                                      their verbatim reason family
//   year x source heat strip        →  document date x document type, which is
//                                      exactly what the rows carry
//   8 report tiles                  →  the same eight, every one an empty bore
//   finance area squares (USD)      →  area from the recorded size in bytes;
//                                      a document with no size on record is a
//                                      hairline square that says so
//   beads into a ring + instrument  →  one bead per document into the ring,
//                                      the engraved dial seated in the middle
//
// Nothing here invents a figure: every place is computed from the island the
// page serialized out of its view JSON (R11), and this module holds no country
// identity and prints no numbers (R1 / R6 — in-stage words only; the figures
// live in the step cards and the readout, each inside its link).
//
// data = { w, h, docs: [{ i, t: doc_type, s: state, h: bytes held, b: size in
//          bytes or null, y: year or '', f: unknown-reason family index or
//          -1 }], types: [doc_type], years: [year label], socks: n }

const M = 56; // stage margin

/** Grid that fills the frame instead of a hardcoded pitch: columns derived
 *  from the frame's aspect, pitch from whichever axis runs out first. */
export function fitGrid(n, w, h, margin = M, max = Infinity) {
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(Math.max(1, n) * (w - 2 * margin) / (h - 2 * margin)))));
  const rows = Math.ceil(n / cols);
  const pitch = Math.min((w - 2 * margin) / cols, (h - 2 * margin) / rows, max);
  return {
    cols, rows, pitch,
    x0: (w - cols * pitch) / 2 + pitch / 2,
    y0: (h - rows * pitch) / 2 + pitch / 2,
  };
}

const stagger = (k, step = 18, cap = 460) => Math.min(cap, k * step);

/** The filing stamps are drawn at their real size and only translated: a
 *  non-uniform scale would squash the type, and a stamp whose words do not
 *  fit is a stamp you cannot read. The page uses this box to lay out each
 *  stamp's text, so the drawing and the layout can never disagree. */
export function stampBox(data) {
  const n = Math.max(1, data.docs.length);
  const cols = Math.min(5, n), rows = Math.ceil(n / cols);
  const sw = Math.min(188, (data.w - 2 * M - (cols - 1) * 14) / cols);
  const sh = Math.min(216, (data.h - 2 * M - (rows - 1) * 16) / rows);
  return {
    cols, rows, sw, sh,
    gx: (data.w - (cols * sw + (cols - 1) * 14)) / 2,
    gy: (data.h - (rows * sh + (rows - 1) * 16)) / 2,
  };
}

/** Geometry shared by the heat-strip layout and the row/column labels the page
 *  server-renders for it, so the labels can never drift from the cells. */
export function typesGeom(data) {
  const rows = Math.max(1, data.types.length), cols = Math.max(1, data.years.length);
  const rowH = Math.min(78, (data.h - 2 * M - 34) / rows);
  const colW = Math.min(110, (data.w - M - 190) / cols);
  return { rowH, colW, top: (data.h - rows * rowH) / 2 - 10, x0: 190 };
}

/** The same for the eight-component tiles and their engraved names. */
export function tilesGeom(data) {
  const cols = 4, rows = Math.ceil(data.socks / cols);
  const side = Math.min(190, (data.w - 2 * M - (cols - 1) * 18) / cols, (data.h - 2 * M - (rows - 1) * 18) / rows);
  return {
    cols, rows, side,
    gx: (data.w - (cols * side + (cols - 1) * 18)) / 2,
    gy: (data.h - (rows * side + (rows - 1) * 18)) / 2 + 12,
  };
}

export function recordLayout(step, data) {
  const { w, h, docs } = data;
  const n = docs.length;

  switch (step) {
    // ── The filings arrive: one stamp per document on record ─────────────
    case 'filings': {
      const b = stampBox(data);
      return {
        stamp: (d, i) => ({
          x: b.gx + (i % b.cols) * (b.sw + 14), y: b.gy + Math.floor(i / b.cols) * (b.sh + 16),
          d: stagger(i, 60),
        }),
        cell: () => null,
        bead: () => null,
        show: 'filings',
      };
    }

    // ── The same documents re-sorted by the state on record ──────────────
    // The predecessor's pledge waffle, re-driven: the cells are documents,
    // not hundredths of a percentage this runtime never read.
    case 'states': {
      const order = ['observed', 'pledged', 'unknown', 'absent'];
      const sorted = [...docs].map((d, i) => ({ d, i }))
        .sort((a, b) => order.indexOf(a.d.s) - order.indexOf(b.d.s) || a.i - b.i);
      const slot = new Map(sorted.map((e, k) => [e.d.i, k]));
      // a record of 14 documents at the old 152-unit cap drew flags, not a
      // waffle: the cap keeps the mark a countable cell at any record size
      const g = fitGrid(n, w, h, M, 104);
      return {
        stamp: () => null,
        cell: (d) => {
          const k = slot.get(d.i);
          return {
            x: g.x0 + (k % g.cols) * g.pitch, y: g.y0 + Math.floor(k / g.cols) * g.pitch,
            sx: g.pitch - 10, sy: g.pitch - 10,
            cls: d.s === 'unknown' ? `unv u${Math.max(0, d.f) % 4}` : d.s,
            d: stagger(k, 22),
          };
        },
        bead: () => null,
        show: 'states',
      };
    }

    // ── Split by what the runtime can prove: bytes held and hashed, or not ─
    case 'split': {
      const held = docs.filter((d) => d.h), rest = docs.filter((d) => !d.h);
      const place = (list, x0, x1) => {
        const span = x1 - x0;
        const g = fitGrid(list.length, span, h - 180, 20, 96);
        // both blocks sit on the same line and are centred in the room under
        // the labels: anchoring them to the top left the frame half empty
        const y0 = 186 + Math.max(0, (h - 236 - g.rows * g.pitch) / 2);
        return new Map(list.map((d, k) => [d.i, {
          x: x0 + (span - g.cols * g.pitch) / 2 + g.pitch / 2 + (k % g.cols) * g.pitch,
          y: y0 + g.pitch / 2 + Math.floor(k / g.cols) * g.pitch,
          sx: g.pitch - 10, sy: g.pitch - 10, d: stagger(k, 26),
        }]));
      };
      const L = place(held, 46, w / 2 - 24), R = place(rest, w / 2 + 24, w - 46);
      return {
        stamp: () => null,
        cell: (d) => {
          const p = (d.h ? L : R).get(d.i);
          return p && { ...p, cls: d.h ? 'metal' : 'hair' };
        },
        bead: () => null,
        show: 'split',
      };
    }

    // ── Date x type: the heat strip, re-read as what the rows carry ───────
    case 'types': {
      const { types, years } = data;
      const { rowH, colW, top, x0 } = typesGeom(data);
      const side = Math.min(rowH - 10, colW - 8);
      // two passes: count what shares a date×type cell first, then lay those
      // out on their own small grid, so several documents in one cell read as
      // several documents and not as one square with a shadow
      const at = (d) => `${types.indexOf(d.t)}:${years.indexOf(d.y || '')}`;
      const total = new Map();
      for (const d of docs) total.set(at(d), (total.get(at(d)) ?? 0) + 1);
      // ONE mark size across the whole strip, set by the busiest cell: a cell
      // with one document would otherwise draw a square four times the area
      // of a cell with three, and size would read as magnitude
      const m = Math.ceil(Math.sqrt(Math.max(1, ...total.values())));
      const s = (side - (m - 1) * 3) / m;
      const seen = new Map();
      return {
        stamp: () => null,
        cell: (d) => {
          const r = types.indexOf(d.t), c = years.indexOf(d.y || '');
          if (r < 0 || c < 0) return null;
          const key = at(d);
          const k = seen.get(key) ?? 0;
          seen.set(key, k + 1);
          const cols = Math.min(m, total.get(key));
          const rows = Math.ceil(total.get(key) / cols);
          const cx = x0 + c * colW + colW / 2, cy = top + r * rowH + rowH / 2;
          return {
            x: cx + ((k % cols) - (cols - 1) / 2) * (s + 3),
            y: cy + (Math.floor(k / cols) - (rows - 1) / 2) * (s + 3),
            sx: s, sy: s,
            cls: d.h ? 'metal' : d.s === 'unknown' ? `unv u${Math.max(0, d.f) % 4}` : 'hair',
            d: stagger(c * 3 + r, 30),
          };
        },
        bead: () => null,
        show: 'types',
      };
    }

    // ── The eight report components: every one an empty bore ─────────────
    case 'tiles': {
      const { cols, side, gx, gy } = tilesGeom(data);
      return {
        stamp: () => null,
        cell: (d, i) => (i >= data.socks ? null : {
          x: gx + (i % cols) * (side + 18) + side / 2,
          y: gy + Math.floor(i / cols) * (side + 18) + side / 2,
          sx: side, sy: side, cls: 'bore', d: stagger(i, 44),
        }),
        bead: () => null,
        show: 'tiles',
        pool: data.socks,
      };
    }

    // ── Area to scale, from the size recorded in bytes ───────────────────
    case 'sizes': {
      const max = Math.max(0, ...docs.map((d) => d.b || 0));
      const MAXS = 250, BLANK = 52, GAP = 9;
      const side = (d) => (d.b == null || !max ? BLANK : Math.max(30, Math.sqrt(d.b / max) * MAXS));
      const order = [...docs].sort((a, b) => (b.b || -1) - (a.b || -1) || a.i - b.i);
      const total = order.reduce((s, d) => s + side(d), 0) + GAP * (order.length - 1);
      const k = Math.min(1, (w - 2 * M) / total);
      const base = h - 182;
      let x = (w - total * k) / 2;
      const place = new Map();
      order.forEach((d, j) => {
        const s = side(d) * k;
        place.set(d.i, { x: x + s / 2, y: base - s / 2, sx: s, sy: s, cls: d.b == null ? 'hair' : 'metal', d: stagger(j, 36) });
        x += s + GAP * k;
      });
      return { stamp: () => null, cell: (d) => place.get(d.i), bead: () => null, show: 'sizes' };
    }

    // ── The beads gather into a ring and the instrument is seated ────────
    case 'dial':
    default: {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 34;
      return {
        stamp: () => null,
        cell: () => null,
        bead: (d, i) => {
          const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
          return {
            x: cx + R * Math.cos(a), y: cy + R * Math.sin(a),
            s: d.h ? 1.5 : 1, cls: d.h ? 'on' : d.s === 'unknown' ? 'ghost' : 'ctx',
            d: stagger(i, 24),
          };
        },
        show: 'dial',
      };
    }
  }
}

const STEPS = ['filings', 'states', 'split', 'types', 'tiles', 'sizes', 'dial'];

export function applyRecordStep(stage, data, step) {
  const L = recordLayout(step, data);
  for (const s of STEPS) stage.classList.toggle(`is-${s}`, s === step);
  data.docs.forEach((doc, i) => {
    const st = stage.querySelector(`[data-stamp="${doc.i}"]`);
    if (st) {
      const p = L.stamp(doc, i);
      if (p) {
        st.style.setProperty('--d', `${p.d || 0}ms`);
        st.style.transform = `translate(${p.x}px,${p.y}px)`;
        st.setAttribute('class', 'r-stamp');
      } else {
        st.setAttribute('class', 'r-stamp off');
      }
    }
    const cell = stage.querySelector(`[data-rcell="${doc.i}"]`);
    if (cell) {
      const p = L.cell(doc, i);
      if (p) {
        cell.style.setProperty('--d', `${p.d || 0}ms`);
        cell.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.sx},${p.sy})`;
        cell.setAttribute('class', `r-cell ${p.cls || ''}`.trim());
      } else {
        cell.setAttribute('class', 'r-cell off');
      }
    }
    const bead = stage.querySelector(`[data-rbead="${doc.i}"]`);
    if (bead) {
      const p = L.bead(doc, i);
      if (p) {
        bead.style.setProperty('--d', `${p.d || 0}ms`);
        bead.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.s})`;
        bead.setAttribute('class', `r-bead ${p.cls || ''}`.trim());
      } else {
        bead.setAttribute('class', 'r-bead off');
      }
    }
  });
  // spare cells beyond the document pool serve the eight-component step
  stage.querySelectorAll('[data-rspare]').forEach((cell, k) => {
    const p = L.pool ? L.cell(null, data.docs.length + k) : null;
    if (p) {
      cell.style.setProperty('--d', `${p.d || 0}ms`);
      cell.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.sx},${p.sy})`;
      cell.setAttribute('class', `r-cell ${p.cls || ''}`.trim());
    } else {
      cell.setAttribute('class', 'r-cell off');
    }
  });
}

/** Middle-line stepper over the pinned record stage (predecessor N1 pattern:
 *  one IntersectionObserver). The tracks tile the chapter, so exactly one of
 *  them crosses the viewport's middle line at any scroll position — there is
 *  never a screen of travel with no step on the stage. The active step's card
 *  is the only one shown, and a step is never cleared back to nothing.
 *  Returns a disconnect function. */
export function mountRecordStage(section) {
  const stage = section.querySelector('[data-rstage]');
  const island = section.querySelector('script[type="application/json"]');
  if (!stage || !island) return () => {};
  const data = JSON.parse(island.textContent);
  const cards = [...section.querySelectorAll('[data-rcard]')];
  let active = null;
  const go = (step) => {
    if (step === active) return;
    active = step;
    applyRecordStep(stage, data, step);
    for (const c of cards) c.classList.toggle('is-on', c.dataset.rcard === step);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) go(e.target.dataset.rstep);
    },
    { rootMargin: '-50% 0px -50% 0px' },
  );
  section.querySelectorAll('[data-rstep]').forEach((el) => io.observe(el));
  return () => io.disconnect();
}
