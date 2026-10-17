// Builds the 3D instrument's data payload from one country's view JSON and its
// index entry — the only sources (R11). The honest mapping is enforced here:
// gears are sized by counted documents, the pledge ratio is null unless a
// pledge figure was read (none is, today), sockets default to unknown (empty
// bores), finance stays ghosted. No country identity in code (R1): names,
// codes and dates all arrive from the view.
import { SOCKETS, SOCKET_READ, SLABS, RIM_ENGRAVING, SCENE_COPY } from './story-content.mjs';

const treatyLine = (view) =>
  view.treaty_status
    .map((t) => `${t.treaty_label.replace(/-/g, ' ')} ${t.events.map((e) => `${e.label} ${e.display}`).join(', ')}`)
    .join(' · ');

export function sceneDataFor(view, entry) {
  const c = entry.counts;
  const t0 = view.treaty_status[0];
  const firstYear = t0?.events[0]?.date?.slice(0, 4);
  return {
    iso3: view.country.iso3,
    aria: `${view.country.name_en}: ${SCENE_COPY.aria}`,
    font: "'Hanken Grotesk', Helvetica, Arial, sans-serif",
    basemapUrl: '/data/basemap.json',
    engravePlate: t0 ? `${t0.treaty_label.replace(/-/g, ' ')}${firstYear ? ` · ${firstYear}` : ''}` : '',
    engraveRim: RIM_ENGRAVING,
    slabs: SLABS,
    pledge: { ratio: null, etch: SCENE_COPY.pledgeEtch }, // no pledge figure read → the ring stays ghost, its reason etched on
    gears: [
      { teeth: c.documents_on_record, live: c.documents_on_record > 0, engrave: `${c.documents_on_record} on record` },
      { teeth: c.documents_with_bytes, live: c.documents_with_bytes > 0, engrave: `${c.documents_with_bytes} hashed` },
      { teeth: c.source_urls_recorded, live: c.source_urls_recorded > 0, engrave: `${c.source_urls_recorded} sources` },
    ],
    pins: c.documents_with_bytes,
    bridge: { engrave: SCENE_COPY.evidenceChip, seated: false },
    sockets: SOCKETS.map((s, i) => ({
      key: s.key,
      label: s.label,
      state: 'unknown',
      read: SOCKET_READ.unknown,
      index: `04.${i + 1}`,
    })),
    finance: { live: false },
    // The payload carries COPY and COUNTS, never colour: each part's hue is
    // the meaning it stands for, and mount-scene reads that off the mounted
    // element where the generated tokens put it (docs/DESIGN.md). A palette
    // carried in the data is a second canon waiting to drift.
    labels: {
      plate: { chip: SCENE_COPY.plateChip, title: SCENE_COPY.plateTitle, value: treatyLine(view) || view.country.name_en },
      pledge: { chip: SCENE_COPY.pledgeChip, title: SCENE_COPY.pledgeTitle, value: SCENE_COPY.pledgeGhost },
      inventory: {
        chip: SCENE_COPY.inventoryChip,
        title: SCENE_COPY.inventoryTitle,
        value: `${c.documents_with_bytes} hashed of ${c.documents_on_record} on record`,
      },
      evidence: { chip: SCENE_COPY.evidenceChip, title: SCENE_COPY.evidenceTitle, value: SCENE_COPY.evidenceUnread },
      finance: { chip: SCENE_COPY.financeChip, title: SCENE_COPY.financeTitle, value: SCENE_COPY.financeUnknown },
    },
  };
}
