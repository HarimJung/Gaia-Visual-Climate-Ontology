# Design canon (R17)

## Provenance

The tokens are Visual Climate's own. Every value in
`engine/seed/platform/design/tokens_record.csv` was read from the running
product at `visual-climate.visualclimate.workers.dev`: the colours, the type
faces, the type and space scales, the radius, the gutter, the durations, the
easings and the shadows. Nothing in the seed was chosen here. The textures and
the axis→channel map in the same directory were read from the same product's
rendered patterns and its existing use of colour.

On 2026-10-17 the app's stylesheets were **ported wholesale** from that
product's own source (`app/globals.css` and `app/styles/{chrome,story,stage,
record,world,figure}.css`, owner authorisation for a direct visual port on the
record, 2026-10-16). Their rule bodies, gradients, shadows, radii, spacing and
type rules were carried across as written; what changed is only which selector
a body hangs on, where our markup differs from theirs.

The seed is the canon and it must MATCH that stylesheet. Where their CSS
carried a value the seed did not — the sheen over the sheet and its
transparent stop, the paper's grain (blend and opacity), the selection wash,
the coverage map's own sheet, the bevel a raised part is turned with, and the
inner shadow a socket is cut with — that value entered the seed **at their
number**, not approximated:

| Token | Value | What it is for |
|---|---|---|
| `colour.sheen` / `colour.sheen-fade` | `#fffefa` / `#f4f2ec00` | the loupe lamp over the sheet, and the stop it fades to |
| `colour.wash` | `#e9ecf7` | selection and the quietest pale ground |
| `colour.map-ground` | `#f4f9fc` | the coverage map's own sheet |
| `dial.bevel-hi` / `dial.bevel-lo` | `#fdfdfb` / `#a8b0b4` | the lit and turned-away edges of a raised part |
| `grain.blend` / `grain.opacity` | `multiply` / `.1` | the printed sheet's tooth |
| `shadow.well` | `inset 1px 1px 2px #0e1a1f80` | the well a sunken socket sits in |

`dur` was corrected from `.3s` to the product's own `200ms` by the same rule.
If the two ever disagree again, their stylesheet wins and the seed is
corrected — never the other way round.

Translucency is written as `color-mix(in srgb, var(--token) N%, transparent)`,
which is how their own sheet writes it. It is never a four-channel literal, so
depth costs the gate nothing.

The seed is the canon, the same way `engine/seed/platform/` is the canon for
the vocabulary. The app reads only what codegen emits:

| Generated file | Carries |
|---|---|
| `engine/generated/design-tokens.css` | a `:root` block, one custom property per token |
| `engine/generated/design-tokens.json` | the same tokens plus the channel map and the bindings |
| `engine/generated/textures.svg` | the six `<pattern>` definitions, as an inlinable `<defs>` fragment |

Custom property names are derived from the token id, never chosen:
`colour.paper` → `--paper`, `meaning.un` → `--un`, `neutral.src-a` → `--src-a`,
`quant.q1` → `--q1`, `size.t4` → `--t4`, `space.s5` → `--s5`,
`ease.out` → `--out` — those groups spend their prefix on the id's meaning
only, so the prefix is dropped. Every other prefix is kept with the dot turned
into a dash: `dial.face` → `--dial-face`, `dur.quick` → `--dur-quick`,
`type.sans` → `--type-sans`, `shadow.1` → `--shadow-1`.

## One axis, one channel

Each axis of the record is read through exactly one visual channel, and no
channel serves two axes. A reader who learns that hue means meaning never has
to unlearn it on the next screen.

A mark that carries an established reading is **filled** in the colour of what
it means; the same mark **outlined** in the same colour is that meaning on
file and not yet established. That is the shipped product's own filings grid —
solid for read, dashed for on-file-but-unread — and it is why a fill is never
swapped for an outline to make a screen quieter: the two say different things.
A legend names the state in plain English and its count. The token behind a
swatch is never shown in the interface.

| Axis | Channel | Tokens |
|---|---|---|
| epistemic-state | material | `dial.*` |
| meaning | colour | `meaning.*` |
| source-family | neutral-ramp | `neutral.*` |
| reason-family | texture | `texture.*` (`textures_record.csv`) |
| quantity | sequential | `quant.*` |
| doc-type | glyph | `glyph.*` (no token carries it yet) |
| anchor-kind | receipt-structure | — the receipt's own layout |
| authoring-verdict | border-stamp | — a stamped border |
| staleness | desaturation | — applied to the colour the row already has |

Each texture is one 5×5 tile. Direction is the line's own angle from the
horizontal (0 horizontal, 45 rising, 90 vertical, 135 falling), so each pattern
is drawn at its angle and never rotated at use time. For a dot field the
`stroke` column carries the dot radius, because that is the one numeric
dimension the kind has. Every tile is filled `colour.paper-sunken` and inked
`colour.ink-4`.

## The maths validates and never chooses

`engine/gates/r17-design-canon.mjs` computes WCAG 2.1 relative luminance and
contrast ratios and refuses what falls below a floor. It never picks a value,
nudges one, or suggests a replacement: a token that fails is a decision for
the owner, not an adjustment for the gate. The gate prints every number it
computed on every run, pass or fail.

What it checks: that the committed generated files are exactly what the seed
produces now (`codegen-fresh`); that every source family and every epistemic
state the published record actually carries has a binding
(`encoding-complete`); that every binding names a token the seed carries
(`encoding-orphan`); that no two axes claim one channel and no token means two
things on one axis (`channel-exclusive`); the three contrast rules below; and
that the app spends colour only through the generated custom properties
(`no-literal-colour`).

### The three contrast rules

1. **`label-on-fill`** — every `meaning.*` and `neutral.*` fill must take a
   label at 4.5:1 or better, counting the better of `colour.ink` and
   `colour.paper`.
2. **`greyscale-separation`** — adjacent steps of a ramp whose steps carry
   distinct meaning must stay 1.3:1 apart once hue is gone. Relative luminance
   is the greyscale reduction, so the ordinary contrast ratio measures it.
3. **`bounded-light-fill`** — WCAG 1.4.11's 3:1 covers a graphical object you
   must see to understand the content, not every fill against the page. A
   brand colour is allowed to sit quietly on paper; what it may not do is sit
   there unbounded. So a fill under 3.0:1 against `colour.paper` must name a
   `border_token` in `tokens_record.csv`, and that border must itself clear
   3.0:1 against paper. A light fill with no border token fails the build.

Four canon fills are light and bounded: `meaning.un` (2.93:1) by
`meaning.un-ink` (5.85:1), `meaning.fin` (2.92:1) by `meaning.fin-ink`
(5.29:1), and `neutral.src-b` (2.52:1) and `neutral.src-c` (1.55:1) both by
`neutral.src-a` (5.96:1). `#009edb` is the UN's own blue and `#bf8b2e` the
product's gold; they are brand canon and do not move.

### no-literal-colour, live

`no-literal-colour` is **on**, and the app is at zero. It scans every `.css`
and `.astro` file under `app/src` — stylesheet, style block, SVG presentation
attribute and frontmatter alike — and refuses a hex or an `rgb`/`hsl`
function anywhere, comments included. The only things that are not a colour
choice are `currentColor`, `transparent` and `none`; the only exempt region is
an SVG `<defs>`/`<pattern>` block, which carries a generated texture tile's
own literals.

Nothing else is exempt, and no file is. A value the seed does not carry is a
row to add to the seed. That rule is what forced the surface tokens above into
existence: the first re-skin reached zero by deleting the product's depth,
which was the wrong answer to the right rule. The rule was right; the token
set was incomplete.

## Adding a source family

1. Add the token to `tokens_record.csv` if the family needs its own step. If
   the new step is lighter than 3.0:1 against `colour.paper`, name its
   `border_token` in the same row.
2. Add the binding to `encodings_record.csv`: `source-family,<id>,<token>,<note>`.
3. Run `npm run codegen`.
4. Run `node engine/gates/run.mjs`. The gate checks the rest: the generated
   files are fresh, the token exists, the binding is unique on its axis, the
   label contrast, the greyscale separation and the border bound hold, and —
   once the family appears in the published rows — that nothing is left
   unbound.

Nothing else needs editing. The entity list is never written down twice: it
comes from the published rows through the single-door reader.
