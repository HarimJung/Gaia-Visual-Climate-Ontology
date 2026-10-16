// The world stage: one SVG stays mounted while the story scrolls. Two pools of
// keyed marks — a bead per country and a unit rect per country — are given a
// place by each step's layout and the browser interpolates between places.
// Ported pattern from the frozen predecessor (components/story/world-stage.tsx
// + stage.css; owner decision 2026-10-16), vanilla-ized and switched from SVG
// geometry-attribute transitions to TRANSFORM-based motion: WebKit before 16.4
// does not animate cx/cy/r/width/height as CSS, while transforms animate
// everywhere, so position is translate() and a column's height is scale().
// Every place is computed from the data island the page serialized out of its
// view JSON (R11); this module holds no country identity and no figures (R1).
//
// Three devices come across from the predecessor's own world steps and are
// re-driven by counts this runtime holds:
//   · the 1%-bin DOT HISTOGRAM (emissions step) → bins over documents whose
//     bytes are held and hashed, one mark per country stacked in its bin. The
//     200-lane picket fence it replaces was a 1.7px bar with a 0.6px gap.
//   · the labelled BLOCKS and MARGIN CLUSTER (pledges / finance steps) → one
//     block per verbatim recorded reason for an unknown, in the log's order,
//     with a block label on a tick line. A record is never drawn as zero and
//     never vanishes: it stands in a labelled place.
//   · the vulnerability × share SCATTER (finance step) → documents on record
//     against documents hashed, one mark per country on the integer lattice,
//     with the records holding no bytes in their own labelled lane below the
//     break rule rather than collapsed onto the axis.
//
// data = { w, h, mapTY, base, fams: n, countries: [{ i: iso3, x, y (centroid,
//          map px, null if the base map holds no shape), p: party-on-record
//          flag, b: documents_with_bytes, o: documents_without_bytes,
//          u: states_unknown, f: reason-family index or -1 }] }

/** Grid that fills the frame instead of a hardcoded pitch: columns derived
 *  from the frame's aspect, pitch from whichever axis runs out first. */
export function fitGrid(n, w, h, margin, max = Infinity) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, n) * (w - 2 * margin) / (h - 2 * margin))));
  const rows = Math.ceil(n / cols);
  const pitch = Math.min((w - 2 * margin) / cols, (h - 2 * margin) / rows, max);
  return { cols, rows, pitch, x0: (w - cols * pitch) / 2 + pitch / 2, y0: (h - rows * pitch) / 2 + pitch / 2 };
}

export function layoutOf(step, data) {
  const { w, h, mapTY, countries } = data;
  const n = countries.length;
  // Below-stage row for records the base map has no shape for (never hidden).
  const noShape = (i) => ({ x: 40 + (i % 60) * 6, y: data.h - 14 });

  switch (step) {
    case 'map':
      return {
        bead: (c, i) => (c.x == null
          ? { ...noShape(i), s: 1, cls: '', d: 0 }
          : { x: c.x, y: mapTY + c.y, s: 1, cls: '', d: Math.min(420, Math.round(c.x / w * 420)) }),
        cell: () => null,
        map: true,
      };

    case 'parties': {
      // Parties with a treaty event on record form the roster block, derived
      // from the frame so it fills it; records with no treaty event stand in
      // a labelled satellite one pitch off the block, never painted in.
      const on = countries.filter((c) => c.p).length;
      const g = fitGrid(on, w - 190, h, 70, 54);
      let k = 0, j = 0;
      // the satellite sits one pitch clear of the block's right edge and
      // inside the frame, so its caption is never clipped off the stage
      const right = g.x0 + (g.cols - 1) * g.pitch + (w - 190 - g.cols * g.pitch) / 2;
      const sat = { x: Math.min(w - 104, right + g.pitch + 36), y: g.y0 + 40 };
      return {
        bead: (c) => {
          if (c.p) {
            const i = k++;
            return {
              x: g.x0 + (i % g.cols) * g.pitch, y: g.y0 + Math.floor(i / g.cols) * g.pitch,
              s: 2.3, cls: 'on', d: Math.min(460, i * 2.2),
            };
          }
          const i = j++;
          return { x: sat.x + ((i % 3) - 1) * 26, y: sat.y + Math.floor(i / 3) * 26, s: 2.3, cls: 'ctx', d: 200 + i * 30 };
        },
        cell: () => null,
        map: false,
        satellite: sat,
      };
    }

    case 'bytes': {
      // One bin per value of documents-with-bytes, one square per country
      // stacked in its bin: a shape you can read, instead of 200 hairlines
      // overlapping each other at a 4.4-unit pitch. The bead shrinks into its
      // own square, so the mark is never lost — it becomes the evidence.
      const g = binGeom(data);
      const stack = new Map();
      const at = (c) => {
        const k = stack.get(c.b) ?? 0;
        stack.set(c.b, k + 1);
        return {
          x: g.x0 + c.b * g.pitch + ((k % g.cols) - (g.cols - 1) / 2) * g.step,
          y: g.base - Math.floor(k / g.cols) * g.step,
          k,
        };
      };
      const places = new Map(countries.map((c) => [c.i, at(c)]));
      return {
        bead: (c) => ({ ...places.get(c.i), s: .001, cls: 'off', d: Math.min(500, c.b * 26) }),
        cell: (c) => {
          const p = places.get(c.i);
          return {
            x: p.x, y: p.y, sx: g.side, sy: g.side,
            cls: c.b > 0 ? 'metal' : 'gap', d: Math.min(500, c.b * 26 + p.k * 2),
          };
        },
        map: false,
        bins: g,
      };
    }

    case 'voids': {
      // One block per verbatim recorded reason for an unknown, in the log's
      // order, plus a block for records with nothing unknown. Absence is
      // countable and placed, never a mark that quietly disappears.
      const g = blockGeom(data);
      const seen = new Map();
      return {
        bead: (c) => {
          const b = c.u > 0 ? Math.min(data.fams - 1, Math.max(0, c.f)) : data.fams;
          const k = seen.get(b) ?? 0;
          seen.set(b, k + 1);
          return {
            x: g.x0 + b * g.colW + (k % g.per) * g.step,
            y: g.top + Math.floor(k / g.per) * g.step,
            s: 1.35, cls: c.u > 0 ? 'ghost' : 'on', d: Math.min(500, b * 55 + k * 3),
          };
        },
        cell: () => null,
        map: false,
        blocks: g,
      };
    }

    case 'scatter': {
      // Documents on record against documents hashed: one mark per country on
      // the integer lattice, spiralled where several records share a pair. The
      // records holding no bytes at all sit in their own labelled lane under
      // the break rule — a lane you can count, not a collapse onto the axis.
      const g = plotGeom(data);
      // Two passes: count what lands on each integer pair, then spread those
      // records over a small grid inside the lattice cell. Jittering blind
      // piles records on top of each other, and a pile is not a count.
      const at = (c) => `${c.b + c.o}:${c.b}`;
      const total = new Map();
      for (const c of countries) if (c.b > 0) total.set(at(c), (total.get(at(c)) ?? 0) + 1);
      const seen = new Map();
      let m = 0;
      return {
        bead: (c) => {
          if (c.b === 0) {
            const k = m++;
            return { x: g.l + (k % 8) * 19, y: g.lane + Math.floor(k / 8) * 19, s: 1.45, cls: 'ghost', d: 300 + k * 24 };
          }
          const key = at(c);
          const k = seen.get(key) ?? 0;
          seen.set(key, k + 1);
          const n2 = total.get(key);
          const cols = Math.ceil(Math.sqrt(n2));
          const rows = Math.ceil(n2 / cols);
          const step = Math.min(g.cellW / (cols + .6), g.cellH / (rows + .6), 15);
          return {
            x: g.sx(c.b + c.o) + ((k % cols) - (cols - 1) / 2) * step,
            y: g.sy(c.b) + (Math.floor(k / cols) - (rows - 1) / 2) * step,
            s: 1.4, cls: c.u > 0 ? 'ctx' : 'on', d: Math.min(500, (c.b + c.o) * 22 + k * 2),
          };
        },
        cell: () => null,
        map: false,
        plot: g,
      };
    }

    default:
      return layoutOf('map', data);
  }
}

/** Bin geometry for the histogram step, shared with the axis labels the page
 *  server-renders, so a label can never drift from its column. */
export function binGeom(data) {
  const { w, h, countries } = data;
  const bins = Math.max(0, ...countries.map((c) => c.b)) + 1;
  const sizes = new Array(bins).fill(0);
  for (const c of countries) sizes[c.b] += 1;
  const pitch = (w - 120) / bins;
  const base = h - 104, room = base - 112, biggest = Math.max(1, ...sizes);
  // The marks fill the frame: the number of columns inside a bin is chosen to
  // make each mark as large as both the bin's width and the frame's height
  // allow — a hardcoded pitch is what turned 200 records into a 1.7px picket
  // fence in the first place.
  let cols = 3, step = 0;
  for (let c = 2; c <= 8; c++) {
    const s = Math.min((pitch - 10) / c, room / Math.ceil(biggest / c));
    if (s > step) { step = s; cols = c; }
  }
  step = Math.min(step, 34);
  const tall = Math.ceil(biggest / cols);
  return { bins, sizes, pitch, cols, step, side: step - Math.max(2, step * .16), base, top: base - tall * step, x0: (w - bins * pitch) / 2 + pitch / 2 };
}

/** Block geometry for the reason-family step, shared with its block labels. */
export function blockGeom(data) {
  const groups = data.fams + 1; // + the block for records with nothing unknown
  const colW = (data.w - 110) / groups;
  const top = 196, room = data.h - top - 70;
  // the biggest block decides the pitch, so the blocks fill the frame instead
  // of huddling in a corner of it
  const sizes = new Array(groups).fill(0);
  for (const c of data.countries) sizes[c.u > 0 ? Math.min(data.fams - 1, Math.max(0, c.f)) : data.fams] += 1;
  const biggest = Math.max(1, ...sizes);
  let per = 4, step = 0;
  for (let p = 3; p <= 9; p++) {
    const s = Math.min((colW - 18) / p, room / Math.ceil(biggest / p));
    if (s > step) { step = s; per = p; }
  }
  return { groups, colW, step: Math.min(step, 26), per, sizes, x0: 62, top };
}

/** Plot geometry for the scatter step, shared with its axes and lane rule. */
export function plotGeom(data) {
  const { w, h, countries } = data;
  const maxX = Math.max(1, ...countries.map((c) => c.b + c.o));
  const maxY = Math.max(1, ...countries.map((c) => c.b));
  const l = 88, r = w - 54, t = 128, b = h - 236;
  return {
    l, r, t, b, maxX, maxY, lane: h - 120, cellW: (r - l) / maxX, cellH: (b - t) / maxY,
    sx: (v) => l + (v / maxX) * (r - l),
    sy: (v) => b - (v / maxY) * (b - t),
  };
}

const STEPS = ['map', 'parties', 'bytes', 'voids', 'scatter'];

export function applyStep(stage, data, step) {
  const L = layoutOf(step, data);
  const mapG = stage.querySelector('.stage-map');
  if (mapG) mapG.classList.toggle('hide', !L.map);
  for (const s of STEPS) stage.classList.toggle(`is-${s}`, s === step);
  // The satellite caption travels with the parties step's apart group, and
  // shows only when some record actually stands apart.
  const apart = stage.querySelector('.stage-apart');
  if (apart) {
    const show = step === 'parties' && data.countries.some((c) => !c.p);
    apart.classList.toggle('show', show);
    if (show && L.satellite) apart.setAttribute('transform', `translate(${(L.satellite.x - 858).toFixed(1)},${(L.satellite.y - 176).toFixed(1)})`);
  }
  data.countries.forEach((c, i) => {
    const bead = stage.querySelector(`[data-bead="${c.i}"]`);
    if (bead) {
      const b = L.bead(c, i);
      bead.style.setProperty('--d', `${b.d || 0}ms`);
      bead.style.transform = `translate(${b.x}px,${b.y}px) scale(${b.s})`;
      bead.setAttribute('class', `stage-bead ${b.cls || ''}`.trim());
    }
    const cell = stage.querySelector(`[data-cell="${c.i}"]`);
    if (cell) {
      const l = L.cell(c, i);
      if (l) {
        cell.style.setProperty('--d', `${l.d || 0}ms`);
        cell.style.transform = `translate(${l.x}px,${l.y}px) scale(${l.sx},${l.sy})`;
        cell.setAttribute('class', `stage-cell ${l.cls || ''}`.trim());
      } else {
        cell.setAttribute('class', 'stage-cell off');
        cell.style.transform = cell.style.transform.replace(/scale\([^)]*\)/, 'scale(.001,.001)');
      }
    }
  });
}

/** Wire the middle-band stepper: the .wstep in the middle of the screen is the
 *  one the stage draws (predecessor N1 pattern: one IntersectionObserver,
 *  rootMargin -45%/-45%). Returns a disconnect function. */
export function mountWorldStage(section) {
  const stage = section.querySelector('.stage');
  const island = section.querySelector('script[type="application/json"]');
  if (!stage || !island) return () => {};
  const data = JSON.parse(island.textContent);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) applyStep(stage, data, e.target.dataset.step);
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  section.querySelectorAll('.wstep').forEach((el) => io.observe(el));
  return () => io.disconnect();
}
