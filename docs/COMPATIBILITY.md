# Compatibility

This page is for anyone evaluating or upgrading OMP Antigravity, the `antigravity-acp` provider for Oh My Pi
(OMP). It lists the versions tested, the platforms, the limits of Google's official Antigravity CLI (`agy`)
that shape the extension's behavior, and a dated record of what release 0.1.0 printed when it was checked.

## Tested versions

| Component | Tested |
|---|---|
| Oh My Pi | `18.18.3`, `18.18.7` |
| Antigravity CLI (`agy`) | `1.5.5` (reports `Antigravity ACP Server 1.5.5`) |
| Bun | `1.4.4` |
| Platform | macOS `arm64` |

Startup refuses an `agy` that speaks another Agent Client Protocol (ACP) protocol version (`AgentProcess.start`
in `src/acp.ts`). The `omp` binary embeds Bun, so Bun `1.4.4` is needed only to work from a repository
checkout (`bun install`, `bun run doctor`, and the test scripts).

## Platforms

- **macOS `arm64`**: tested with live Antigravity turns and the offline tests.
- **Linux**: the official `agy` installer supports it, and the offline unit and state-machine tests run on
  Ubuntu `24.04` in CI (`.github/workflows/ci.yml`). The live path against a signed-in `agy` is not tested
  on Linux.
- **Windows**: unsupported. The extension manages `agy` as a process group, a POSIX mechanism
  (`AgentProcess.start` and `close` in `src/acp.ts`), and the official `agy` installer supports macOS and
  Linux only.

## Known limits

Every limit in this section was observed with `agy` `1.5.5`. Each entry says what `agy` does, what the
extension does about it, and what you can do. The files `agy` writes are covered in
[Local files](SECURITY.md#local-files).

### Gemini 4 rejects the RFC 2119 line

If Oh My Pi's standard system prompt line

```text
RFC 2119 keywords: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER` = `MUST NOT`; `AVOID` = `SHOULD NOT`.
```

appears anywhere in `_meta.antigravity.systemPrompt.append` (the `session/new` field carrying Oh My Pi's
appended instructions), requests to `gemini-4-carbon` and `gemini-4-argon` fail on the first attempt with
`429 RESOURCE_EXHAUSTED` regardless of remaining account quota. This was reproduced with the account at 9%
of its 5-hour quota and reproduced by that single line alone while every other part of Oh My Pi's prompt
succeeded.

`AGY_REWRITES` in `src/convert.ts` rewords that exact line in transit to:

```text
Requirement words: MUST and NEVER are absolute rules; SHOULD and AVOID are strong defaults that need a stated reason to break; MAY marks something optional.
```

If an Oh My Pi release changes the wording of that line, or adds another phrase that trips the same upstream
filter, Gemini 4 requests will fail with `429 RESOURCE_EXHAUSTED` again. Inspect the instructions the
extension sent with `OMP_ANTIGRAVITY_DEBUG=<dir>`; see [Debug traces](OPERATIONS.md#debug-traces).

### Per-message text limit

A single `session/prompt` message keeps only about the first 192,000 bytes of text.

`packPrompts` in `src/convert.ts` splits a larger prompt or history replay on line boundaries into parts of
at most 180,000 bytes (`PROMPT_TEXT_BUDGET`). `agy` answers `OK` to each earlier part before the last part
streams back, which costs one extra round trip per additional part; see
[Prompt splitting and fencing](ARCHITECTURE.md#prompt-splitting-and-fencing).

Keep prompts compact when latency or quota matters.

### MCP tool result truncation

`agy` cuts a Model Context Protocol (MCP) tool result in the middle at about 10,000 bytes of text.

`inlineResult` in `src/convert.ts` answers tool calls in place only when every pending result has at most
9,000 bytes of text and at most 1 MiB of base64-encoded image data. Otherwise the extension cancels the turn
and delivers the full result as the next prompt; see
[Tool continuation](ARCHITECTURE.md#tool-continuation).

There is nothing to configure.

### MCP tool call timeout

`agy` times out an open MCP tool call after 3 minutes, whatever progress notifications it receives.

The extension defers a tool call that is still running after 150 seconds (`OMP_ANTIGRAVITY_DEFER_MS`): it
cancels the active `agy` turn and delivers the result as the next prompt once the tool finishes; see
[Deferred continuation](ARCHITECTURE.md#deferred-continuation).

If you change `OMP_ANTIGRAVITY_DEFER_MS`, keep it below that 180-second timeout. The extension does not check
the value; see [Environment variables](OPERATIONS.md#environment-variables).

### Timestamps in inline tool results

`agy` prepends `Created At:` and `Completed At:` lines to every inline MCP tool result before the model sees
it.

`agy` adds those lines after the bridge has answered, so the extension cannot remove them.

When a prompt asks for part of what a tool returned, ask for the content by what it is, not where it is: a
request for "the first line" of a file can get the `Created At:` line back.

### Conversation-title call

`agy` makes one extra model call to title a conversation. A session that never receives a prompt, such as the
doctor's catalog probe (`bun run doctor` or `/antigravity-doctor`), is not titled. Checked on 2026-11-10 with
`agy` `1.5.5`: that session's record kept an empty title and a step count of 0.

The extension keeps one `agy` session alive across the turns of an Oh My Pi session, so the title call
happens once per session and once more after each rebuild; see
[Session rebuilds](ARCHITECTURE.md#session-rebuilds).

### Residual agy tools

`agy` does not honor `_meta` tool filtering; `excludeDefaultComponents: true` in the `omp-host.md` agent
definition is the only exclusion that takes effect. Even with it, `agy` still declares its internal
`manage_task` tool, plus `list_resources` and `read_resource` whenever an MCP server is attached.

If the model calls any tool other than `mcp_omp_*`, `#onUpdate` in `src/session.ts` fails the turn with
`Antigravity attempted a non-OMP tool (…)`, and the next request rebuilds the session; see
[Restricted agent guard](ARCHITECTURE.md#restricted-agent-guard).

Send the request again: it starts a fresh `agy` session and replays the transcript.

### Steering waits for the next turn

A second `session/prompt` sent while a turn is running is queued by `agy`, not merged into the active turn.

An Oh My Pi steering message therefore takes effect on the next turn, or when the next tool results are
delivered as a prompt.

Abort the running turn in Oh My Pi when an instruction must replace the response in progress.

### No published limits or quotas

Google publishes no numeric request or token limits for Antigravity. The quota display of the account used
for testing tracked each model group over 5-hour and weekly windows.

`agy` reports no context window or maximum output either, so `limitsFor` in `src/index.ts` assigns fixed
limits by model family; see [Model catalog and limits](OPERATIONS.md#model-catalog-and-limits).

On the first rate-limit notice, `#rateLimited` in `src/session.ts` cancels the turn instead of letting `agy`
retry, so only Oh My Pi's retry policy decides the backoff; see [Rate limits](ARCHITECTURE.md#rate-limits).

To bound concurrent turns, set `providers.maxInFlightRequests` in Oh My Pi's `config.yml`; see
[Concurrency and memory](OPERATIONS.md#concurrency-and-memory).

## Release record

Each entry is a dated record of what a release printed and measured when it was checked. An entry is written
once and is not edited afterwards.

### 0.1.0 — 2026-11-10

Checked at commit `f0a8720f838e135148211aa7b3aa8a4d4daa1aab` (`v0.1.0`) on macOS `arm64` with Oh My Pi
`18.18.3` and `18.18.7`, `agy` `1.5.5` (`Antigravity ACP Server 1.5.5`), and Bun `1.4.4`.

- **Offline tests**: 41 unit and state-machine tests passed in CI on Linux (Ubuntu `24.04`) and locally on
  macOS `arm64`.
- **Live smoke test**: `bun run test:live` passed through Oh My Pi `18.18.7` and `agy` `1.5.5` on macOS
  `arm64`, on `gemini-3.8-flash` at `low` effort: `text`, `tool round trip`, `tool-returned image`, and
  `prompt image`.
- **Not exercised live**: tool results delivered as a prompt, multi-part context delivery, aborts, and rate
  limits. The offline tests cover them against a scripted `agy` (`test/fixtures/fake-agy`).
- **Fixes**: those from a pre-release security and performance audit are in pull request #2.
- **Measurements**: `bun run doctor` printed the report below in about 2 seconds and left no `agy acp`
  process. `agy` reported its slash-command list about 12 ms after `session/new`. The two `agy` processes of
  an idle live session held about 300 MB of memory. The session logs under `log/` in
  `~/.omp/antigravity-acp/gemini/antigravity-cli/` grew by about 25 KB per session.

The catalog offered to the test account had six models. Both outputs below list them: the doctor with each
model's name, efforts, and default effort, and Oh My Pi with the limits and image input that the extension
declares. Image input is declared for every model whenever `agy` advertises image prompts; the live smoke
test sent images only to `gemini-3.8-flash`.

`bun run doctor` printed:

```text
omp-antigravity doctor: ok
agy: /Users/<you>/.local/bin/agy (1.5.5)
ACP agent: Antigravity ACP Server 1.5.5
capabilities: {"appendInstructions":true,"httpMcp":true,"image":true,"close":true}
signed in: yes
model antigravity-acp/gemini-4-carbon — Gemini 4 Carbon; efforts: low, medium, high (default medium)
model antigravity-acp/gemini-4-argon — Gemini 4 Argon; efforts: low, medium, high (default medium)
model antigravity-acp/gemini-3.8-flash — Gemini 3.8 Flash; efforts: low, medium, high (default medium)
model antigravity-acp/claude-opus-5-5 — Claude Opus 5.5; efforts: low, medium, high (default medium)
model antigravity-acp/claude-sonnet-5-5 — Claude Sonnet 5.5; efforts: low, medium, high (default medium)
model antigravity-acp/gpt-oss-120b-medium — GPT-OSS 120B (Medium); efforts: none (default n/a)
profile: /Users/<you>/.omp/antigravity-acp
```

`omp models antigravity-acp` printed:

```text
antigravity-acp (6)
┌─────────────────────┬─────────┬─────────┬─────────────────┬────────┐
│ model               │ context │ max-out │ thinking        │ images │
├─────────────────────┼─────────┼─────────┼─────────────────┼────────┤
│ claude-opus-5-5     │    200K │     64K │ low,medium,high │ yes    │
│ claude-sonnet-5-5   │    200K │     64K │ low,medium,high │ yes    │
│ gemini-3.8-flash    │    500K │     64K │ low,medium,high │ yes    │
│ gemini-4-argon      │    500K │     64K │ low,medium,high │ yes    │
│ gemini-4-carbon     │    500K │     64K │ low,medium,high │ yes    │
│ gpt-oss-120b-medium │    128K │     32K │ -               │ yes    │
└─────────────────────┴─────────┴─────────┴─────────────────┴────────┘
```

`bun run test:live` printed:

```text
PASS text (10.2s)
PASS tool round trip (9.5s)
PASS tool-returned image (14.6s)
PASS prompt image (9.2s)
```
