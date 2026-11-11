# Changelog

Releases of OMP Antigravity (`omp-antigravity`), the `antigravity-acp` provider for
[Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi), are tags on GitHub. The package is not on a registry:
install it from GitHub, pinned to a commit; see [Quick start](README.md#quick-start) and
[Upgrade and uninstall](docs/OPERATIONS.md#upgrade-and-uninstall).

## Unreleased

### Added

- The brand identity and its artwork: the mark (`assets/logo.svg`, `assets/logo-light.svg`,
  `assets/favicon.svg`), the social preview (`assets/og.png`), and the how-it-works figure
  (`assets/how-it-works.png`), specified in [`docs/BRAND.md`](docs/BRAND.md).
- The website at <https://alphastorm.github.io/omp-antigravity/>, deployed from `site/` by
  `.github/workflows/pages.yml`.
- Reader-specific documentation: [Operations](docs/OPERATIONS.md), [Architecture](docs/ARCHITECTURE.md),
  [Compatibility](docs/COMPATIBILITY.md), and [Security model](docs/SECURITY.md).
- [Contributing](CONTRIBUTING.md), the [Security policy](SECURITY.md), the
  [Code of conduct](CODE_OF_CONDUCT.md), and issue and pull request templates.
- `bun run test:docs` (`bun test test/docs`), run in CI. It checks links and anchors, that the site deploys
  as written and loads nothing from another host, that the statements and release facts repeated across
  surfaces agree, and that `docs/OPERATIONS.md` matches the `OMP_ANTIGRAVITY_*` variables and error strings
  in `src/`.
- `bun run render:assets` (`bun scripts/render-assets.ts`), which renders the artwork with headless Chrome.

### Changed

- `README.md` is now a short overview with a five-step quick start; everything else moved to the page that
  owns it. Google's terms are quoted before the first install command. No runtime behavior changed.
- The package now ships `docs/`, `CHANGELOG.md`, and `SECURITY.md` beside the README, so the README's
  documentation links resolve in an installed copy.
- The documentation was corrected where it said more than the code does:
  - The 1 MiB inline budget for a tool-returned image counts base64 characters (`inlineResult` in
    `src/convert.ts`).
  - Message text and tool results are never truncated, but tool-call arguments shown in replayed history and
    in result headers are cut to 400 characters (`argsSummary` in `src/convert.ts`).
  - A name listed in `OMP_ANTIGRAVITY_ENV_PASSTHROUGH` reaches `agy` even when it is one the allowlist strips
    (`childEnv` in `src/acp.ts`).
  - A rebuild follows a branch, a rewind, or a compaction, not an edit that rewrites a message in place
    (`messageKey` in `src/convert.ts`).
  - `agy` titles only a conversation that receives a prompt, so the doctor and model discovery cost no
    title call.

## 0.1.0 — 2026-11-10

First release: [v0.1.0](https://github.com/alphastorm/omp-antigravity/releases/tag/v0.1.0). Install in Oh My
Pi pinned to the `v0.1.0` release commit:

```bash
omp plugin install github:alphastorm/omp-antigravity#f0a8720f838e135148211aa7b3aa8a4d4daa1aab
```

- **Provider and model discovery**: registers the `antigravity-acp` provider in Oh My Pi and queries the
  signed-in account's model catalog and `thought_level` efforts through `agy acp`, assigning fixed token
  limits by model family (`limitsFor` in `src/index.ts`).
- **Isolated `agy acp` process and restricted profile**: runs one `agy acp --process-per-session` process
  group per Oh My Pi session under `~/.omp/antigravity-acp` (`OMP_ANTIGRAVITY_HOME`) with the restricted
  `omp-host` profile (`excludeDefaultComponents: true`), a child environment allowlist, and the default-agent
  command guard.
- **Loopback MCP tool bridge and continuation**: exposes Oh My Pi's tools on `127.0.0.1` (`/mcp`) behind a
  32-byte per-session bearer token, settling fast results inline (up to 9,000 text bytes and 1 MiB of
  base64-encoded image data within `OMP_ANTIGRAVITY_DEFER_MS`) and deferring larger or slower results to the
  next ACP prompt while Oh My Pi keeps tool execution and approval policy.
- **Transcript authority, prompt packing, and rate limits**: rebuilds the `agy` session and replays
  `[OMP history]` when context or configuration changes, splits prompts above 180,000 bytes
  (`PROMPT_TEXT_BUDGET`) with tilde fencing (`~~~`), rewords the `RFC 2119` system-prompt line that Gemini 4
  rejects (`AGY_REWRITES`), and cancels `agy`'s internal `429 RESOURCE_EXHAUSTED` retries so Oh My Pi's
  `retry.*` policy controls backoff.
- **Diagnostics and pre-release audit**: adds `bun run doctor` (`bun src/doctor.ts`, `--json`),
  `/antigravity-doctor`, `OMP_ANTIGRAVITY_DEBUG` trace dumps, and fixes from a pre-release security and
  performance audit in pull request #2.
- **Verification**: checked with 41 offline unit and state-machine tests in CI on the release commit (Linux)
  and locally on macOS, plus a live smoke test (`bun run test:live`) through Oh My Pi `18.18.7` and `agy`
  `1.5.5` on macOS `arm64`, on `gemini-3.8-flash` at `low` effort (`text`, `tool round trip`,
  `tool-returned image`, and `prompt image`). Tool results delivered as a prompt, multi-part context delivery,
  aborts, and rate limits were not exercised live and are covered by the offline tests against the scripted
  fake `agy` in `test/fixtures/`.
