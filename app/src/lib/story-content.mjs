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
    title: 'Every blank, filed under its own reason',
    body:
      'The marks re-sort into blocks — one block per reason this runtime recorded for an unknown, in the order the rows carry them, each reason kept verbatim and linked to the receipt it was read on. Unknown is not one shrug; it is a taxonomy you can audit.',
    figs: [
      { label: 'documents without bytes', key: 'documents_without_bytes' },
      { label: 'states unknown', key: 'states_unknown' },
    ],
    families: true,
  },
  {
    step: 'scatter',
    title: 'What is on record against what is proven',
    body:
      'Each record takes a place: how many documents are on record for it, against how many of those this runtime fetched and hashed. The records holding no bytes at all are counted in their own lane under the break rule — a labelled place, not a collapse onto the axis.',
    figs: [
      { label: 'documents on record', key: 'documents_on_record' },
      { label: 'documents with bytes', key: 'documents_with_bytes' },
    ],
  },
];

// The record stage (one country, stage by stage) — the predecessor's country
// morph, re-anchored on what this runtime holds. figs name census keys the
// country page resolves against its own index entry and links (R6).
export const RECORD_STEPS = [
  {
    step: 'filings',
    eyebrow: 'the filings',
    title: 'Every document on record, as a stamp',
    body:
      'One card per document this runtime has on record for this country: its type, its title, and the word for the state it is in. A document confirmed absent is struck through — a void drawn, not a row left out.',
    figs: ['documents_on_record'],
  },
  {
    step: 'states',
    eyebrow: 're-sorted',
    title: 'The same documents, sorted by what is proven',
    body:
      'The cards drop their titles and re-sort into the four states. Each hatch pattern is one recorded reason for an unknown — the reasons are listed under this stage, verbatim, each linked to its receipt.',
    figs: ['states_observed', 'states_unknown'],
  },
  {
    step: 'split',
    eyebrow: 'bytes held',
    title: 'Hashed on the left, on record only on the right',
    body:
      'The single hardest line in the product: documents whose bytes were fetched and hashed, against documents this runtime has only seen listed. The right-hand block is not a failure; it is the part of the record still unproven.',
    figs: ['documents_with_bytes', 'documents_without_bytes'],
  },
  {
    step: 'types',
    eyebrow: 'date by type',
    title: 'When each kind of document lands',
    body:
      'The same marks become a strip: one row per document type, one column per year read from the document itself. Documents with no date on record sit in their own column — never slid into a year to tidy the picture.',
    figs: ['documents_on_record'],
  },
  {
    step: 'tiles',
    eyebrow: 'the report',
    title: 'Eight components, eight empty bores',
    body:
      'The transparency report has eight parts. This runtime has read none of them for any country, so every seat renders as a machined empty bore rather than a blank. The bore is the most precisely cut thing on the stage.',
    figs: ['states_unknown'],
  },
  {
    step: 'sizes',
    eyebrow: 'to scale',
    title: 'Area is the size on record, in bytes',
    body:
      'Each square’s area is the recorded size of the file this runtime holds. A document with no size on record is a hairline square at a fixed size that says so — an absence kept the same size as every other absence.',
    figs: ['documents_with_bytes'],
  },
  {
    step: 'dial',
    eyebrow: 'assembled',
    title: 'The marks gather and the instrument is seated',
    body:
      'Every document takes a place on the ring, and the dial seats in the middle: one barrel per document, the dial face carrying the treaty edge where the bytes are held and hashed, an empty well where they are not. No sweep, no gauge — barrels you can count, each one its own receipt.',
    figs: ['documents_with_bytes', 'documents_on_record'],
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
