# OMP Antigravity — brand spec

Identity for `alphastorm/omp-antigravity`: the extension that adds the `antigravity-acp` model provider to
[Oh My Pi](https://github.com/can1357/oh-my-pi), so Antigravity serves the model through Google's official
`agy` CLI while Oh My Pi keeps its own system prompt, tools, approval policy, and session transcript.

**Brand sibling of [OMP Session Gateway](https://github.com/carrythroughsystems/omp-session-gateway),
[OMP NInfer](https://github.com/alphastorm/omp-ninfer), [OMP Oracle](https://github.com/alphastorm/omp-oracle),
and [OMP Strata](https://github.com/alphastorm/omp-strata).** OMP Antigravity shares the family ground,
neutrals, type, kinship rule, and voice register defined by the gateway; this file is the complete authority
for the OMP Antigravity identity. Live emerald `#31C48D` belongs to the gateway, Local violet `#8E7BE8` to
NInfer, Answer rose `#DE82B7` to Oracle, and Seam teal `#37C4CB` to Strata; the retired signal blue `#3FA9DC`
and exec amber `#E0A33E` stay retired.

## Naming and message

- Repository and package: `alphastorm/omp-antigravity`, `omp-antigravity`. Display name: **OMP Antigravity**.
  Provider id: `antigravity-acp`.
- Category: **Antigravity-served models for Oh My Pi**. Not "Antigravity models": the models are Gemini,
  Claude, and GPT-OSS, and Antigravity is the service that serves them.
- Headline: **Antigravity serves the model. Oh My Pi keeps control.** The sentence after it always scopes
  "control" to what it means here: Oh My Pi's own system prompt, tools, approval policy, and session
  transcript.
- Entity grammar: *Oh My Pi (the coding agent) → OMP Antigravity (the extension) → `agy`, Google's official
  Antigravity CLI (a restricted child process) → Antigravity (Google's service, on the user's own account).*
  Spell out "Oh My Pi" before using "OMP" on any surface that can be read standalone.
- Proof comes from what the extension does, stated as the README states it: tools run under Oh My Pi's
  approval policy; a tool of `agy`'s own fails the turn; the sign-in token is never read; the tool bridge is
  on loopback behind a per-session token.
- Status grammar: say what was tested and on what. One platform is "tested on macOS `arm64`", never
  "supports macOS". What a release did not exercise live is stated beside what it did.
- Primary action: **Get started**, linked to the quick start. Google's terms are stated before the first
  install command on every surface, and are never the second call to action.

## The mark: "The Lift"

The family's Gate turned over. A cradle on the ground is what Oh My Pi keeps; the dot lifted clear of it is
the model, served from somewhere else. Nothing connects them, because the extension is the only thing that
does. Geometry (96×96 viewBox, all radii 2); the base is laid over the foot of both posts, so the corners
stay whole:

- left post `x18 y44 w10 h40`; right post `x68 y44 w10 h40`
- base `x18 y74 w60 h10`
- dot `cx48 cy20 r8` in Lift lime

The dot floats one dot diameter (16 units) above the rim; the mark is 60 wide and 72 tall.

Rules, the family's numbers:

- Never use upstream Oh My Pi's π-with-plug mark or derivatives of it.
- Clearspace: one dot diameter (16 units) on all sides. Minimum size 16px.
- The cradle is Ink on dark surfaces (`logo.svg`) and Ink-dark on light surfaces (`logo-light.svg`). The dot
  is `lift` on dark surfaces and `lift-on-light` on light ones. Never recolor, never give the dot a
  sibling's accent, never connect the dot to the cradle, and never close the cradle: an arch reads as the
  gateway's mark and as other products' marks.

## Color

The family ground and neutral ramp: `ground #060809`, `ink-dark #0B0E11`, `surface #0E1319`,
`border-subtle #161C22`, `border #1C232B`, `ink #E8ECEF`, `body #B6BEC7`, `muted #8A939D`.
OMP Antigravity owns:

| Token | Hex | oklch | Use |
|---|---|---|---|
| lift | `#C4E05C` | oklch(0.86 0.16 120) | the dot, links, eyebrows, the primary action, focus rings |
| lift-hover | `#DAF194` | oklch(0.92 0.12 120) | link and action hover |
| lift-on-light | `#799A1B` | oklch(0.64 0.15 124) | the dot in `logo-light.svg`, and nothing else |
| kinship | `#F97316` | — (upstream orange) | citation micro-dot only; see the rule below |

Lift lime sits in the widest open gap of the family wheel, between the retired amber (76°) and the gateway's
emerald (163°). It is also clear of Google's four brand colors (blue 260°, red 29°, yellow 84°, green 149°),
so it implies no partnership. Yellow-greens only read clean at a higher lightness than the family's other
accents, which is why it is lighter than they are. It measures 13.5:1 against `ground`, and `ink-dark` text on
it measures 13.1:1. On white it measures 1.5:1, too faint for a mark, so the light-surface mark uses
`lift-on-light`, which measures 3.3:1 on white.

Danger red `#C85045` stays the family error color. Lime is never a pass state and red is never decoration:
a result is a word, not a color. That is why the CI badge is set to the neutral `border`.

**Kinship rule (the gateway's):** upstream orange appears at most once per surface, only as a micro-dot
beside an Oh My Pi mention — never in the mark, never on interactive elements, never as a fill.

## Type

- **Public site:** self-hosted latin subsets in `site/fonts/` are first-party assets: Space Grotesk
  (variable weight 300–700) for the wordmark and headings; JetBrains Mono (variable weight 100–800) for
  eyebrows, labels, and code. Body text stays on the system sans stack. Their OFL-1.1 license texts sit
  beside them. No remote fonts, scripts, stylesheets, or CDNs. The only script on the site is the inline
  copy-button enhancement; it makes no network, storage, or analytics calls.
- **Exported artwork:** `assets/og.html` and `assets/how-it-works.html` use Space Grotesk 500/600 and
  JetBrains Mono 400/500 through `assets/fonts.css`, which loads the same files from `site/fonts/`. A render
  needs no network.
- Wordmark: "OMP Antigravity", weight 600, letter-spacing −0.015em. Mono labels: uppercase, letter-spacing
  0.1–0.14em.
- Artwork is sized for where it is read. The how-it-works figure shows at about two-thirds scale in the
  README column, so nothing meant to be read is set below 18px there; the social preview is read at
  link-card size, so its floor is 26px. Small text is Body, never Muted. No frame, grid, glow, or drawn
  button.

## Voice

Sober and exact, in the gateway's register: sentence case except mono labels, no emoji, no exclamation
marks. Every claim on an owned surface already appears in the README, the site, or `docs/`. Artwork carries
no version, date, model list, or measured number, so a release never re-renders it.

Keep the standing disclaimer: "Community project; not affiliated with or endorsed by the Oh My Pi
maintainers or Google."

## Trademarks and affiliation

The repository is named after a Google product, so the line is drawn here once.

- "Antigravity" appears as plain nominative reference to the service the extension connects to. Never use
  Google's or Antigravity's logos, typefaces, color sets, or visual identity, and never set a Gemini, Claude,
  OpenAI, or Oh My Pi mark on an owned surface.
- "Official" modifies only `agy`, the Antigravity CLI, and its installer. Never describe this project as
  official, approved, supported, or endorsed by Google.
- Google's Antigravity terms of service restrict third-party access. The quotation and its context live in
  [Security model](SECURITY.md#googles-antigravity-terms); every surface a reader can start from carries
  the quotation verbatim, before the first install command, and draws no conclusion from it.
- The trademark line stays on the README, the site footer, and `NOTICE.md`: "Antigravity, Gemini, and Google
  are trademarks of Google LLC. Other model and product names belong to their owners and are used only to
  identify them."
- No `google` repository topic.

## Asset inventory

Paths are relative to the repository root. `assets/` and `site/` are repository-only; the package does not
ship them.

| File | Purpose |
|---|---|
| `assets/logo.svg` | mark for dark backgrounds; site header mark and README dark mode |
| `assets/logo-light.svg` | mark for light backgrounds; README light mode |
| `assets/favicon.svg` | site favicon (96, rx22 tile) |
| `assets/brand.css` | tokens and the editorial-sheet primitives for the artwork sources |
| `assets/fonts.css` | local font faces for the artwork, from `site/fonts/` |
| `assets/og.html` | social preview source (1280×640): wordmark, category, headline, one sub line, the turn figure |
| `assets/og.png` | GitHub social preview and site `og:image` (1280×640) |
| `assets/how-it-works.html` | how-it-works figure source (1240×580): who owns what, and three outcomes |
| `assets/how-it-works.png` | rendered figure @2x (2480×1160), for the README and `docs/ARCHITECTURE.md` |
| `site/` | public site (`alphastorm.github.io/omp-antigravity`). `.github/workflows/pages.yml` stages `logo.svg`, `favicon.svg`, and `og.png` from `assets/` at deploy time, so `site/` never carries copies |

There is no banner image: the README opens with the 72px mark, so a banner would be displayed nowhere. The
site sets the who-owns-what figure natively, so it reflows on a phone; when the figure's copy changes, change
`assets/how-it-works.html` and the `#how-it-works` section of `site/index.html` together.

`bun run test:docs` fails when a site page references an asset the deployment would not serve, when a staged
copy is not ignored by git, when the site or an artwork source loads anything from another host, when
`og:image:width` and `og:image:height` disagree with `og.png`, when the sitemap, `robots.txt`, and canonical
links disagree about the site's pages, when a surface states a release, an install commit, or a version
that the changelog and `docs/COMPATIBILITY.md` do not, or when the site's fit lists differ from the README's.

## Regeneration

After editing an artwork source, run `bun run render:assets`. It renders `og` and `how-it-works` with
headless Chrome (from `--chrome <path>`, `CHROME`, `PATH`, or the default install) and verifies each PNG's
dimensions; name targets to render only some (`bun run render:assets -- og`).
`bun run render:assets -- --check` renders without writing and fails when a committed PNG does not match its
source. Byte equality holds only for the Chrome build that produced the committed PNG, so `--check` is a
same-machine check and stays out of CI.

View every raster at the size it is read before judging it: the figure at 838px wide, the social preview at
about 500px.

## README header

The centered `<div align="center">` header block opens the README in a fixed order, as in the gateway README:
the 72px theme-aware mark, `# OMP Antigravity`, the bold headline, the bold compatibility line, one short
paragraph stating what the extension does, the navigation link row, the flat badges, and the
`<sub><strong>Control by design:</strong> …</sub>` line. Outside the centered block follow the status
blockquote, which carries the quotation from Google's terms, and the standing disclaimer.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
  <img src="assets/logo-light.svg" alt="" width="72" height="72">
</picture>
```

Badges are shields.io flat style, one row, `labelColor 0B0E11`, values in `border` `#1C232B` or Lift lime
`#C4E05C` — never green or red status colors. Sanctioned badges: CI (value color forced to `border`),
release (the one lime badge), the tested Oh My Pi version, the tested `agy` version, license. The two version
badges are static and must name versions listed under
[Tested versions](COMPATIBILITY.md#tested-versions); `bun run test:docs` enforces that.

## GitHub social preview

GitHub has no API for the repository social preview. After changing `assets/og.png`, upload it at
GitHub → Settings → General → Social preview.

## Relationship to upstream

Independent community project; not affiliated with or endorsed by the Oh My Pi maintainers or Google. "OMP"
and "Antigravity" appear in the name as plain nominative reference to the agent the extension runs in and the
service it connects to; do not restyle either project's logo.
