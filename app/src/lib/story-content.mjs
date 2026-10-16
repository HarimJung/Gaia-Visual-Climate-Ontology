// Every sentence of story copy, in one place (chapter copy as data). English,
// product voice. Rules carried by the gates: no percentages, no invented
// figures — a number never appears here; the pages inject counts from the
// view door and link each one to its census key (R6). No country identity
// (R1); the walked country is derived from the data by the page.

// The eight report components: vocabulary for the socket ring. The runtime
// holds no per-component reading yet, so every socket renders as an empty
// bore ("Not read yet") until a view supplies a state.
export const SOCKETS = [
  { key: 'nir', label: 'National inventory' },
  { key: 'crt', label: 'Common reporting tables' },
  { key: 'ctf', label: 'Common tabular formats' },
  { key: 'ndc_track', label: 'Pledge progress tracking' },
  { key: 'adaptation', label: 'Adaptation' },
  { key: 'finance', label: 'Finance and support' },
  { key: 'redd_plus', label: 'Forests' },
  { key: 'article6', label: 'Cooperation outcomes' },
];
export const SOCKET_READ = {
  observed: 'Reported',
  pledged: 'Pledged',
  absent: 'Confirmed absent',
  unknown: 'Not read yet',
};

// Engraved on the machine: the four-state vocabulary and the product line.
export const SLABS = ['observed', 'pledged', 'unknown', 'absent'];
export const RIM_ENGRAVING = 'every figure · its receipt';

export const SCENE_COPY = {
  plateTitle: '01 / Treaty plate',
  plateChip: 'treaty',
  pledgeTitle: '02 / Pledge ring',
  pledgeChip: 'pledge',
  pledgeGhost: 'Ghosted: no pledge figure read from any filing',
  pledgeEtch: 'no pledge figure read',
  inventoryTitle: '03 / Documents held',
  inventoryChip: 'docs',
  evidenceTitle: '04 / Report sockets',
  evidenceChip: 'report',
  evidenceUnread: 'Eight parts, none read yet — every socket an empty bore',
  financeTitle: '05 / Support',
  financeChip: 'support',
  financeUnknown: 'No support figure read — the gold cog never meshes',
  fallbackNote: 'The rich layer is off in this browser. Every figure is still on this page, each linked to its receipt.',
  // aria: "<name>: " is prefixed by the page from view data.
  aria:
    'a model of one record. The ring is its pledge, ghosted because no figure was read; the gears are its documents, sized by what is counted; the eight sockets are its report, empty bores where nothing has been read. Drag to turn, tap a part to jump to its rows.',
};

// The world-stage steps (scrolly block). figs name census keys the page
// resolves and links; scope "world" reads the world census, "graph" the
// graph-level counters (both from census.json through the door).
export const WORLD_STEPS = [
  {
    step: 'map',
    title: 'The world, as far as this runtime has read it',
    body:
      'One bead per country on record. Nothing on this page is an estimate: every figure is a count over ledger rows, and every count links to the receipt it rests on.',
    figs: [{ label: 'documents on record', key: 'documents_on_record' }],
  },
  {
    step: 'parties',
    title: 'The parties take their places',
    body:
      'Beads leave the map and form the roster of records that carry a treaty event — signature, ratification, accession — each date read from the depositary’s own status list. The few without one stand apart in the margin; they are not painted in.',
    figs: [
      { label: 'paris agreement parties counted', key: 'untc_paris_agreement_parties', scope: 'graph' },
      { label: 'framework convention parties counted', key: 'untc_unfccc_parties', scope: 'graph' },
    ],
  },
  {
    step: 'bytes',
    title: 'What the runtime actually holds',
    body:
      'Each record’s column rises to the number of documents whose bytes are held and hashed — files this runtime fetched and can prove, not titles it has merely seen. The bead sits exactly as high as the evidence under it.',
    figs: [
      { label: 'documents with bytes', key: 'documents_with_bytes' },
      { label: 'of documents on record', key: 'documents_on_record' },
    ],
  },
  {
    step: 'voids',
    title: 'The margin it refuses to fill',
    body:
      'The same lanes, remeasured by what is missing: registry rows with no bytes behind them. A record with unknown states turns to an outline. The voids are not failure — they are the product: a blank stated is a blank you can check.',
    figs: [
      { label: 'documents without bytes', key: 'documents_without_bytes' },
      { label: 'states unknown', key: 'states_unknown' },
    ],
  },
];

// Cards riding the pinned 3D chapter. phase maps to the machine's chapters
// (explosion-motion cyclePhase). Figure slots are filled by the page.
export const MACHINE_CARDS = [
  {
    phase: 0,
    eyebrow: 'one country, chapter by chapter',
    title: 'Open the machine',
    body:
      'Scroll, and the connected record rises one layer at a time. The movement explains structure; it never stands for progress.',
  },
  {
    phase: 1,
    eyebrow: 'the plate',
    title: 'The treaty plate under every promise',
    body:
      'Pledges, documents, reporting and support all seat on one shared design. The dates engraved here are read from the depositary’s status list — the receipt is one tap away.',
  },
  {
    phase: 2,
    eyebrow: 'the pledge',
    title: 'A ring with no figure stays ghost',
    body:
      'Where a pledge figure was read from a filing, the blue arc is exactly its size. No figure read — the whole ring stands ghosted. It is never guessed full.',
  },
  {
    phase: 3,
    eyebrow: 'the documents',
    title: 'Gears sized by what is counted',
    body:
      'The train turns on documents actually held: each tooth count is a census figure, each marker a hashed file. A gear with nothing behind it is ghosted and stands still.',
  },
  {
    phase: 4,
    eyebrow: 'the report',
    title: 'Eight sockets, read one at a time',
    body:
      'The reporting bridge rises with a seat for each component. A part that was read seats a jewel; a part never read stays an empty bore. Nothing is screwed in on faith.',
  },
  {
    phase: 5,
    eyebrow: 'support',
    title: 'The cog that never meshes on its own',
    body:
      'Support needed and support received are separate facts. With no figure read, the gold cog is ghosted — receiving finance is not fulfilling a condition.',
  },
  {
    phase: 6,
    eyebrow: 'laid flat',
    title: 'Every part on the desk',
    body:
      'Parts that have finished their explanation spread out like a drawing on a desk — one look at everything the record is made of, and everything it is not.',
  },
  {
    phase: 7,
    eyebrow: 'reassembly',
    title: 'One by one, back into one machine',
    body:
      'Ring, gears, bridge and cog return to the plate in dependency order. What was ghost goes home ghost; the machine closes honestly.',
  },
];

export const STORY = {
  eyebrow: 'national climate record',
  title: 'Every figure, on its receipt',
  lede:
    'A runtime that reads national climate records and refuses to say more than it can prove. One action everywhere: click a figure, get the receipt it rests on — document, verbatim quote, SHA-256.',
  machineHeading: 'the instrument',
  docEyebrow: 'one document opens',
  docTitle: 'Down to the sentence, down to the byte',
  docBody:
    'Behind each figure is a document; behind the document, a page-one quote; behind the quote, the hash of the fetched file. This is the case-back of every number on these screens.',
  voidsEyebrow: 'what it will not say',
  voidsTitle: 'The voids are the thesis',
  voidsBody:
    'Where this runtime could not read a figure, nothing spins and nothing fills. The pledge ring stays ghost, the sockets stay bores — and one refusal is kept verbatim on the record:',
  voidsNote: 'Unknown and absent describe this runtime’s reading, not the country.',
  closeEyebrow: 'one action',
  closeTitle: 'Click a figure, get its receipt',
  closeBody:
    'The whole product is that one move. Open the world ledger, follow any number to its country, its document, its quote, its hash.',
  ctaLedger: 'Open the world ledger',
  ctaCountry: 'Walk one record',
};
