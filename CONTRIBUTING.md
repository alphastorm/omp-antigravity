# Contributing

## Before you start

OMP Antigravity (`omp-antigravity`) is an [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) extension that
registers the `antigravity-acp` model provider and routes requests through Google's official Antigravity CLI
(`agy acp`) over the Agent Client Protocol (ACP, JSON-RPC over stdio). Antigravity serves Gemini, Claude, and
GPT-OSS models under your Google account sign-in while Oh My Pi keeps its own system prompt, tools, approval
policy, and session transcript.

Community project; not affiliated with or endorsed by the Oh My Pi maintainers or Google.

Participation in this project is governed by the [Code of conduct](CODE_OF_CONDUCT.md).

## Set up

A checkout needs:

- **Bun** `1.4.4`, for `bun install`, `bun run doctor`, and the tests. People who install the plugin need no
  Bun of their own: `omp plugin install` uses the one `omp` embeds.
- **Oh My Pi (`omp`)** and the official Antigravity CLI (`agy`), signed in with `agy acp --login`, for the
  doctor and the live smoke test; see [Quick start](README.md#quick-start).
- **macOS or Linux.** The offline tests run on both; live runs are tested on macOS only, and Windows is
  unsupported. See [Platforms](docs/COMPATIBILITY.md#platforms).

Clone the repository, install the dependencies, and check your runtime:

```bash
git clone https://github.com/alphastorm/omp-antigravity.git
cd omp-antigravity
bun install
bun run doctor
```

The doctor checks the `agy` binary, the sign-in, the ACP capabilities, and the model catalog without
generating; [Check the runtime](docs/OPERATIONS.md#check-the-runtime) explains its report.

## Run a local checkout in Oh My Pi

Load the extension from the checkout, without installing the plugin:

```bash
omp -e /path/to/omp-antigravity/src/index.ts
```

To load only this extension for one run, with installed plugins and other extensions off:

```bash
omp --no-extensions --extension /path/to/omp-antigravity/src/index.ts
```

To confirm that Oh My Pi discovers the provider's models, run this from the checkout root:

```bash
omp models antigravity-acp --no-extensions -e ./src/index.ts
```

One Oh My Pi process holds one copy of the extension:

- Loading the same `src/index.ts` path twice reuses the existing runtime (`installedRuntime` in
  `src/index.ts`).
- Loading two copies from different paths, such as an installed plugin plus
  `-e /path/to/omp-antigravity/src/index.ts`, throws
  `omp-antigravity is loaded twice (… and …); keep one installation of the antigravity-acp provider`, so two
  copies cannot collide. Pass `--no-extensions` when you test a checkout beside an installed plugin.

## Checks

Run the three offline checks before you open a pull request:

```bash
bun run check
bun run test
bun run test:docs
```

- `bun run check` runs `tsc --noEmit` over the sources, the tests, and `scripts/`.
- `bun run test` runs `bun test test/unit`. `test/unit/convert.test.ts` checks prompt packing, tilde fencing,
  the `RFC 2119` rewording, inline result budgets, usage mapping, and stream events.
  `test/unit/session.test.ts` drives the session state machine against the scripted fake `agy` in
  `test/fixtures/` (`test/fixtures/fake-agy`).
- `bun run test:docs` runs `bun test test/docs`. It checks every link and anchor, that the site deploys as
  written and loads nothing from another host, that the statements and release facts repeated across
  surfaces agree, and that `docs/OPERATIONS.md` matches `src/`.

Use `bun run test` and `bun run test:docs`, not a bare `bun test`, which runs both suites together. CI
(`.github/workflows/ci.yml`, Ubuntu `24.04`) runs `bun run check`, `bun run test`, `bun run test:docs`, and
`bun pm pack --dry-run`.

## Live smoke test

The live smoke test drives a real `omp` and your signed-in `agy`. It spends Antigravity quota, so run it once
the offline checks pass:

```bash
bun run test:live
SMOKE_MODEL=gemini-4-carbon SMOKE_EFFORT=medium OMP_BIN=/path/to/omp bun run test:live
```

`test/live/smoke.ts` runs four cases, `text`, `tool round trip`, `tool-returned image`, and `prompt image`,
one `omp` process at a time, with tiny prompts in a temporary working directory. It stops at the first
failure, a rate-limit notice included, and does not retry. Three environment variables configure it:

- `SMOKE_MODEL`: the model id under `antigravity-acp/` (default `gemini-3.8-flash`).
- `SMOKE_EFFORT`: the effort passed with `--thinking` (default `low`).
- `OMP_BIN`: the `omp` executable (default: the first `omp` on `PATH` outside `node_modules`).

What it covers: a text turn, tool calls answered in place (text and an image), and a prompt image. What it
does not: tool results delivered as a prompt, multi-part context delivery, aborts, and rate limits. The
offline tests in `test/unit/session.test.ts` cover those against the scripted fake `agy`.

The smoke test sets `OMP_ANTIGRAVITY_DEBUG`, so `agy`'s transcript files are kept and the extension's traces
are written under the working directory the test prints. Remove both when you are finished; see
[Local files](docs/SECURITY.md#local-files). The output recorded for release 0.1.0 is in
[Release record](docs/COMPATIBILITY.md#release-record).

## Documentation changes

Each fact has one owning section, so pages cannot drift apart. Another page links to the owner in one
sentence; it does not restate the fact.

| Page | Owns |
| --- | --- |
| `README.md` | What it is, when to use it, the quick start, model selectors |
| `docs/OPERATIONS.md` | Efforts, environment variables, the doctor report, error messages, debug traces, upgrade and uninstall |
| `docs/ARCHITECTURE.md` | How the runtime behaves, and why |
| `docs/COMPATIBILITY.md` | Tested versions, platforms, the known limits of `agy`, the release record |
| `docs/SECURITY.md` | What reaches Google, Google's terms, credentials, the child environment, local files |
| `docs/BRAND.md` | The identity, the artwork, and the rules for every public surface |

Four statements repeat verbatim: the disclaimer, the quotation from <https://antigravity.google/terms>, the
data-use sentence, and the trademark notice. Never paraphrase them. A release fact (the release, the install
commit, a tested version) also appears on the README, the site, and `site/llms.txt`, and the site repeats the
README's two fit lists.

`bun run test:docs` fails when a link or anchor breaks, when those statements, release facts, or fit lists
disagree across surfaces, when the environment-variable table in `docs/OPERATIONS.md` and the
`OMP_ANTIGRAVITY_*` names in `src/` differ, or when an error string in `docs/OPERATIONS.md` is not in `src/`.

Add a line under `### Added` or `### Changed` in `## Unreleased` of [`CHANGELOG.md`](CHANGELOG.md) for every
change to behavior or documentation.

## Brand artwork

The identity, the palette, the type, and the rules for each asset are in [`docs/BRAND.md`](docs/BRAND.md).
The PNGs in `assets/` are rendered from the HTML sources beside them with headless Chrome or Chromium, using
the font files in `site/fonts`:

```bash
bun run render:assets
bun run render:assets -- --check
```

The first command writes `assets/og.png` and `assets/how-it-works.png`. The second renders without writing
and fails when a committed PNG does not match its source.

## Repository layout

- `src/index.ts` — Oh My Pi provider `antigravity-acp` entry point, model discovery, and `/antigravity-doctor`.
- `src/acp.ts` — the official Antigravity CLI (`agy acp`) as a child process speaking ACP over stdio.
- `src/session.ts` — live Antigravity sessions and the turn and tool-continuation state machine.
- `src/bridge.ts` — loopback MCP server exposing the current request's Oh My Pi tools to Antigravity.
- `src/convert.ts` — pure conversions between Oh My Pi's context/events and ACP prompt blocks or MCP results.
- `src/doctor.ts` — no-generation status report: executable, version, sign-in, capabilities, models, profile.
- `test/unit` and `test/fixtures` — offline unit and state-machine tests and the scripted fake `agy` executable.
- `test/docs` and `test/live` — documentation checks (`bun run test:docs`) and the live smoke test (`test/live/smoke.ts`).
- `assets/`, `site/`, `docs/`, `scripts/` — brand sources and PNGs, static site, reader guides, and
  `scripts/render-assets.ts`.

## Commits and pull requests

Write commit messages and pull request titles as Conventional Commits `1.0.0`: `type(scope): description`,
with a lowercase imperative description. Pull requests are squash-merged, and the pull request title becomes
the commit message on `main`.

Never include credentials, transcripts, account or host names, private paths, or raw debug files.

## Security

Do not report security vulnerabilities in public issues or pull requests. Report them privately through GitHub
Security Advisories at <https://github.com/alphastorm/omp-antigravity/security/advisories/new> following
[`SECURITY.md`](SECURITY.md).
