// The world stage: one SVG stays mounted while the story scrolls. Two pools of
// keyed marks — a bead per country and a column cell per country — are given a
// place by each step's layout and the browser interpolates between places.
// Ported pattern from the frozen predecessor (components/story/world-stage.tsx
// + stage.css; owner decision 2026-10-16), vanilla-ized and switched from SVG
// geometry-attribute transitions to TRANSFORM-based motion: WebKit before 16.4
// does not animate cx/cy/r/width/height as CSS, while transforms animate
// everywhere, so position is translate() and a column's height is scale().
// Every place is computed from the data island the page serialized out of its
// view JSON (R11); this module holds no country identity and no figures (R1).
//
// data = { w, h, mapTY, base, countries: [{ i: iso3, x, y (centroid, map px,
//          null if the base map holds no shape), p: party-on-record flag,
//          b: documents_with_bytes, o: documents_without_bytes,
//          u: states_unknown }] }
const GRID = { cols: 20, pitch: 21 };

export function layoutOf(step, data) {
  const { w, mapTY, base, countries } = data;
  const n = countries.length;
  const unit = 26; // px per document column step
  const x0 = 60, x1 = w - 60, pitch = (x1 - x0) / Math.max(1, n);
  // Column order is fixed across the byte/void steps so a bead keeps its lane:
  // sorted by documents-with-bytes, ties by roster order (stable, derived).
  const lanes = countries
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.b - a.c.b || a.i - b.i);
  const lane = new Map(lanes.map((e, k) => [e.c.i, k]));
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
      // Parties with a treaty event on record form the roster block; records
      // with no treaty event stand apart in the margin — never painted in.
      let on = 0, off = 0;
      return {
        bead: (c) => {
          if (c.p) {
            const k = on++;
            return {
              x: 150 + (k % GRID.cols) * GRID.pitch,
              y: 150 + Math.floor(k / GRID.cols) * GRID.pitch,
              s: 1.15, cls: 'on', d: Math.min(460, k * 2.2),
            };
          }
          const k = off++;
          return { x: 840 + (k % 3) * 18, y: 170 + Math.floor(k / 3) * 18, s: 1.15, cls: 'ctx', d: 200 + k * 30 };
        },
        cell: () => null,
        map: false,
      };
    }
    case 'bytes':
      // One lane per country: the hashed-document column rises, its bead
      // perched on top. Height is the real count, nothing else.
      return {
        bead: (c) => {
          const k = lane.get(c.i);
          return { x: x0 + k * pitch + pitch / 2, y: base - c.b * unit - 7, s: 1, cls: c.b > 0 ? 'on' : 'ctx', d: Math.min(500, k * 2.4) };
        },
        cell: (c) => {
          const k = lane.get(c.i);
          return { x: x0 + k * pitch + pitch / 2, y: base, h: Math.max(.001, c.b * unit), cls: 'metal', d: Math.min(500, k * 2.4) };
        },
        map: false,
      };
    case 'voids':
      // The same lanes, remeasured by what is NOT held: listing-only rows
      // with no bytes behind them. A record with unknowns ghosts its bead.
      return {
        bead: (c) => {
          const k = lane.get(c.i);
          return { x: x0 + k * pitch + pitch / 2, y: base - c.o * unit - 7, s: 1, cls: c.u > 0 ? 'ghost' : 'on', d: Math.min(500, k * 2.4) };
        },
        cell: (c) => {
          const k = lane.get(c.i);
          return { x: x0 + k * pitch + pitch / 2, y: base, h: Math.max(.001, c.o * unit), cls: 'gap', d: Math.min(500, k * 2.4) };
        },
        map: false,
      };
    default:
      return layoutOf('map', data);
  }
}

export function applyStep(stage, data, step) {
  const L = layoutOf(step, data);
  const mapG = stage.querySelector('.stage-map');
  if (mapG) mapG.classList.toggle('hide', !L.map);
  // The apart-group caption shows only on the parties step, and only when
  // some record actually stands apart (no treaty event on record).
  const apart = stage.querySelector('.stage-apart');
  if (apart) apart.classList.toggle('show', step === 'parties' && data.countries.some((c) => !c.p));
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
        cell.style.transform = `translate(${l.x}px,${l.y}px) scale(1,${l.h})`;
        cell.setAttribute('class', `stage-cell ${l.cls || ''}`.trim());
      } else {
        cell.setAttribute('class', 'stage-cell off');
        cell.style.transform = cell.style.transform.replace(/scale\([^)]*\)/, 'scale(1,0.001)');
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
