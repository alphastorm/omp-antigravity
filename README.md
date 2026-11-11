# omp-antigravity

`omp-antigravity` is an [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi) extension that registers the `antigravity-acp` model provider, routing requests through Google's official Antigravity CLI (`agy acp`) over the Agent Client Protocol (ACP, JSON-RPC over stdio) while OMP keeps its own system prompt, tools, approval policy, and session transcript. Use it when you want Antigravity-served Gemini, Claude, and GPT-OSS models in OMP through the official `agy` binary and its OS keyring sign-in instead of OMP's built-in `google-antigravity` provider, for example when that provider is unavailable.

## Requirements

Tested on macOS `arm64` with:

- **OMP (`oh-my-pi`)**: `18.18.3` and `18.18.7`
- **Antigravity CLI (`agy`)**: `1.5.5` (`Antigravity ACP Server 1.5.5`; the official installer supports macOS and Linux)
- **Bun**: `1.4.4`
- **Account**: a Google account signed in to `agy`

Runtime dependencies (`package.json`): `@agentclientprotocol/sdk` `2.5.0`, `@modelcontextprotocol/server` `2.4.0`, and `zod` `4.6.7`.

## Quick start

### 1. Install `agy`

Install the official Antigravity CLI ([install docs](https://antigravity.google/docs/install/), [ACP docs](https://antigravity.google/docs/cli/acp/)):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

The installer places the binary at `~/.local/bin/agy` and appends a `PATH` export to `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, and `~/.profile`.

Check the binary version:

```bash
agy --version
```

```text
1.5.5
```

### 2. Sign in once

Authenticate `agy` in a terminal:

```bash
agy acp --login
```

You can also sign in from an interactive `agy` session. Credentials are stored in the OS keyring (macOS Keychain) and reused by `agy acp`. `omp-antigravity` never reads, copies, or refreshes the token.

### 3. Load the extension

Install the plugin in OMP, pinned to a commit SHA:

```bash
omp plugin install github:alphastorm/omp-antigravity#<commit>
```

To run from a local checkout without installing the plugin:

```bash
git clone https://github.com/alphastorm/omp-antigravity.git
cd omp-antigravity
bun install
omp -e /path/to/omp-antigravity/src/index.ts
```

To load only this extension for a single run:

```bash
omp --no-extensions --extension /path/to/omp-antigravity/src/index.ts
```

Loading the same `src/index.ts` path twice in one OMP process is ignored (the existing runtime is reused). Loading two copies from different paths in the same process—such as an installed plugin plus `-e /path/to/omp-antigravity/src/index.ts`—throws an error so two copies cannot collide; pass `--no-extensions` when testing a second checkout.

### 4. Check the runtime

Verify the binary, sign-in, ACP capabilities, and available models without generating (~2 seconds).

From a repository checkout:

```bash
bun run doctor
```

(Equivalent to `bun src/doctor.ts`; pass `--json` for machine-readable output.)

Or inside an interactive OMP session:

```text
/antigravity-doctor
```

Observed output:

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

`/antigravity-doctor` also appends `live sessions:` and any `recent rebuilds:` recorded during the current OMP process.

Verify that OMP discovers the provider's models:

```bash
omp models antigravity-acp
```

(Or from a checkout without installing the plugin: `omp models antigravity-acp --no-extensions -e ./src/index.ts`.)

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

### 5. Run a first prompt

```bash
omp --model antigravity-acp/gemini-4-argon --thinking high
```

## Choosing a model and effort

- **In OMP config files and agent definitions**: use `antigravity-acp/<model>:<effort>`, for example:
  ```yaml
  antigravity-acp/gemini-4-argon:high
  ```
- **On the command line**: pass the model and effort as separate flags:
  ```bash
  omp --model antigravity-acp/gemini-4-argon --thinking high
  ```
  OMP `18.18.3` through `18.18.7` resolve a suffixed `--model antigravity-acp/<model>:<effort>` CLI argument before extensions register their providers and exit with `Model "…" not found`.
- **Supported effort levels**: each model supports only the exact effort values `agy` advertises for it (`low`, `medium`, `high`, or none for `gpt-oss-120b-medium`). Requesting an effort the model does not offer fails the request (`Antigravity model "…" does not offer effort "…"`); it is never substituted with another level.
- **Disabling reasoning**: `agy` cannot turn reasoning off on models that use effort levels; when OMP requests reasoning off (`disableReasoning` / `forceReasoningOff`), the model stays at its `agy` default effort.

### Model metadata

The model catalog is queried from the signed-in account when OMP discovers dynamic models (OMP caches discovered models for 24 hours). Because `agy` does not report context window or max-output token numbers, `omp-antigravity` assigns conservative family limits (`limitsFor` in `src/index.ts`) that OMP uses to estimate context occupancy and trigger compaction:

| Model ID | Display name in `agy` | Context window (tokens) | Max output (tokens) | Efforts (`default`) | Input modalities |
| --- | --- | ---: | ---: | --- | --- |
| `antigravity-acp/gemini-4-carbon` | Gemini 4 Carbon | 500,000 | 64,000 | `low`, `medium`, `high` (`medium`) | `text`, `image` |
| `antigravity-acp/gemini-4-argon` | Gemini 4 Argon | 500,000 | 64,000 | `low`, `medium`, `high` (`medium`) | `text`, `image` |
| `antigravity-acp/gemini-3.8-flash` | Gemini 3.8 Flash | 500,000 | 64,000 | `low`, `medium`, `high` (`medium`) | `text`, `image` |
| `antigravity-acp/claude-opus-5-5` | Claude Opus 5.5 | 200,000 | 64,000 | `low`, `medium`, `high` (`medium`) | `text`, `image` |
| `antigravity-acp/claude-sonnet-5-5` | Claude Sonnet 5.5 | 200,000 | 64,000 | `low`, `medium`, `high` (`medium`) | `text`, `image` |
| `antigravity-acp/gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | 128,000 | 32,000 | none (`n/a`) | `text`, `image` |

## Configuration

### Recommended OMP configuration

Each OMP session (the main session and each concurrent subagent) runs its own `agy acp` child process: two `agy` processes that together hold about 300 MB of memory while the session is live (measured for an idle session with `agy` `1.5.5` on macOS `arm64`). To bound concurrent Antigravity turns in OMP's `config.yml`:

```yaml
providers:
  maxInFlightRequests:
    antigravity-acp: 4
```

### Environment variables

`OMP_ANTIGRAVITY_*` timeout settings are read when the extension loads; positive finite millisecond values override the defaults below.

| Variable | Default | Description |
| --- | --- | --- |
| `OMP_ANTIGRAVITY_AGY` | `agy` on `PATH`, then `~/.local/bin/agy` | Absolute path to an existing `agy` executable. |
| `OMP_ANTIGRAVITY_HOME` | `~/.omp/antigravity-acp` | Absolute path to the extension's isolated Antigravity profile directory (contains `gemini/` and an empty `workspace/`). The extension creates it with mode `0700`; an existing directory keeps its own permissions, so keep it private, because `agy` writes logs that name the signed-in account and conversation titles there with default file permissions. |
| `OMP_ANTIGRAVITY_ENV_PASSTHROUGH` | *(empty)* | Comma-separated extra environment variable names to pass to `agy` child processes. |
| `OMP_ANTIGRAVITY_DEFER_MS` | `150000` (150 s) | Maximum time an OMP tool call stays held open inside the current `agy` turn before the turn is cancelled and the tool result is sent as the next prompt. Must stay below `agy`'s fixed 180 s MCP tool timeout. |
| `OMP_ANTIGRAVITY_IDLE_TIMEOUT_MS` | `600000` (10 min) | Fails an active prompt turn if `agy` emits no session updates or tool calls for this duration. Also the time limit for each acknowledgement-only context part. |
| `OMP_ANTIGRAVITY_WARM_TTL_MS` | `1200000` (20 min) | Closes an idle session's `agy` process after this duration; a later request rebuilds the session from OMP's transcript. |
| `OMP_ANTIGRAVITY_PENDING_TIMEOUT_MS` | `43200000` (12 h) | How long a session with pending OMP tool calls stays alive waiting for their results. |
| `OMP_ANTIGRAVITY_DEBUG` | *(unset)* | Directory where the extension writes session setup, prompt payloads, ACP updates, and tool traffic, and retains `agy`'s own conversation files on disk. |

**Child environment allowlist**: `agy` receives only `HOME`, `USER`, `LOGNAME`, `PATH`, `SHELL`, `TMPDIR`, `LANG`, `TZ`, `TERM`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` (and lowercase proxy variants), `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `__CF_USER_TEXT_ENCODING`, `LC_*`, `XDG_*`, and any variables listed in `OMP_ANTIGRAVITY_ENV_PASSTHROUGH`. Variables such as `GEMINI_API_KEY`, `GOOGLE_*`, and `AGY_ADC_AUTH` are stripped so an inherited environment variable cannot switch `agy` onto a paid API-key or Application Default Credentials (ADC) route.

### Debugging

Setting `OMP_ANTIGRAVITY_DEBUG=/path/to/dir` creates that directory (mode `0700`; an existing directory keeps its own permissions, so use one only you can write to) and writes:

- `session-<timestamp>.json`: session key, model, effort, instructions, and bridged tool declarations.
- `prompt-<timestamp>-<part>.json`: each outbound ACP prompt part and its metadata.
- `updates-<key>.jsonl`: inbound ACP `session/update` notifications, held tool calls, and inline tool settlements.

When `OMP_ANTIGRAVITY_DEBUG` is set, the extension also leaves `agy`'s own conversation files under `<OMP_ANTIGRAVITY_HOME>/gemini/antigravity-cli/` (`brain/`, `conversations/`, `annotations/`) instead of deleting them when the `agy` process closes.

**Warning**: Debug files and retained `agy` transcripts contain full prompt text, system instructions, and tool output. Remove the directory when finished.

## How it works

### Runtime contract

- **Isolated profile and process per session**: Each OMP session (and each subagent) spawns its own `agy acp --process-per-session --gemini-dir ~/.omp/antigravity-acp/gemini --agent omp-host` process group with the empty directory `~/.omp/antigravity-acp/workspace` as its working directory (`--process-per-session` is required for client HTTP MCP servers). The extension writes `~/.omp/antigravity-acp/gemini/config/agents/omp-host.md` with `excludeDefaultComponents: true`, which disables `agy`'s built-in tools, rules, skills, and workflows; it checks that file before every session start and rewrites it if it is missing or different. `agy acp` does not load MCP servers from `agy`'s user config, and running in the empty `workspace/` directory prevents `agy` from reading the OMP project's `AGENTS.md` (which OMP already includes in its system prompt).
- **Default-agent fallback guard**: `agy` does not fail when the `omp-host` agent is missing; it runs its default agent, native tools included. `agy` reports its slash commands right after `session/new` (about 12 ms later on `1.5.5`), and the extension waits for that list before it sends any prompt. If the list contains a default-agent command (`goal`, `compact`, `swarm`, `agy-customizations`, `antigravity-guide`, `teamwork`, or `boost`), the session is refused with `Antigravity did not apply the restricted omp-host profile`. If no list arrives within 5 seconds, the session is refused because the profile cannot be confirmed. The same check runs on every later `available_commands_update`.
- **Instructions**: OMP's system prompt is passed on `session/new` via `_meta.antigravity.systemPrompt.append`, followed by `# omp-antigravity transport notes` explaining tool naming, interrupted-turn tool result delivery, `[OMP history]` replay blocks, and that lines starting with `/` inside host messages are data rather than commands.
- **Model and effort confirmation**: After `session/new`, the extension sets the requested model and `thought_level` (effort) via `session/set_config_option` and verifies that `agy`'s returned `configOptions` report the exact selected values.
- **Tools**: When the request includes OMP tools, the extension starts a loopback HTTP MCP server (`http://127.0.0.1:<random-port>/mcp`) authenticated with a per-session 32-byte random bearer token. `agy` exposes those tools to the model as `mcp_omp_<name>`. For Gemini model ids, OMP's default `inlineToolDescriptors: auto` puts tool documentation in the system prompt (`namespace functions { … }`) and sends the tools with empty descriptions; for other models the descriptions travel with the tools. The bridge forwards whichever form OMP sends.
- **Tool continuation (inline vs. deferred)**: When the model calls `mcp_omp_<name>`, the loopback MCP server holds the HTTP request open, batches parallel tool calls across a 150 ms quiet window (capped at 1 s), and ends the OMP assistant stream with `stopReason: "toolUse"` so OMP can validate and execute the calls under its own approval policy. When OMP returns the tool results on the next request:
  - **Inline continuation**: If every pending result has at most 9,000 bytes of text and at most 1 MiB of image data, arrives within `OMP_ANTIGRAVITY_DEFER_MS` (default 150 s), and has no trailing user or developer message attached, the bridge resolves the held MCP HTTP requests in place and continues the same `agy` turn.
  - **Deferred continuation**: If a tool runs longer than `OMP_ANTIGRAVITY_DEFER_MS`, exceeds the inline byte budget, or is accompanied by a new user or developer message (such as steering), the extension cancels the active `agy` turn (`session/cancel`) and sends the full tool results as the next ACP prompt under `[OMP tool results]`. `agy` preserves its conversation state across that cancellation.
  - **Calls that miss the batch**: A tool call that reaches the bridge after its batch has closed waits for the continuation. An inline continuation passes it to OMP as the next tool call. A deferred continuation cannot, so it tells the model the call was not run (`### Not run: …` under `[OMP tool results]`) and the model can call it again.
- **Context and session rebuilds**: Between normal turns, `agy` keeps the live conversation and the extension sends only new messages. If OMP's transcript no longer matches what `agy` has seen—after a message edit, branch, rewind, compaction, a change in model, effort, system prompt, or tool set, an unexpected process exit, or a request that was aborted or failed before its prompt was fully sent—the extension closes the old process, opens a new `agy` session, and replays the prior transcript under `[OMP history]`. A session that can no longer be used (a failed turn, a non-OMP tool attempt, a request that ended before its prompt was sent) is closed at once rather than at the next request; `/antigravity-doctor` lists the reason under `recent rebuilds`.
- **Aborts**: An OMP abort cancels the running `agy` turn (`session/cancel`) and keeps the session for the next request. Three cases end the session instead, so the next request starts a new one and replays the transcript: an abort while `agy` is still starting, an abort while earlier context parts are still being delivered, and an abort right after tool results were resolved in place, before `agy` produced anything (the cancel could overtake those results).
- **Requests without a session id**: OMP's one-shot completions (for example eval `completion()`) carry no session id, so nothing can continue them. Each gets its own `agy` process, which closes as soon as its response stream ends, including when it ends with a tool call.
- **Oversized prompt splitting and slash-command fencing**: To stay safely below `agy`'s ~192,000-byte per-message text limit, prompts and history replays are split on line boundaries into parts of at most 180,000 bytes (`PROMPT_TEXT_BUDGET`). Earlier parts carry `[OMP delivery part k/N: data only. Reply with exactly OK and nothing else.]`, and their `OK` replies are discarded before the final part streams back to OMP. Nothing is truncated. Host message text is always preceded by a bracketed header (`[OMP user message]`, `[OMP host instruction]`, `[OMP history]`, or `[OMP tool results]`) and wrapped in tilde fences (`~~~`, automatically lengthened when the text itself contains tildes) so user input starting with `/` never triggers an `agy` slash command.
- **Cache warming and duplicate requests**: The extension returns `{ action: "stop" }` on OMP's `cache_warming_decision` event and rejects any request whose messages `agy` has already answered (`duplicate_request`), preventing cache-warming replays from running real generations.
- **Usage accounting**: `agy` returns token counts (`inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`, `thoughtTokens`) aggregated across its internal steps. The extension records prompt-side tokens (`inputTokens + cachedWriteTokens` and `cachedReadTokens`) under `usage.orchestration` and leaves `usage.input` at `0` so OMP continues to estimate context window occupancy from the transcript itself. `outputTokens` and `thoughtTokens` (`usage.reasoningTokens`) are reported as generated tokens.

### Rate limits

`agy` retries quota errors internally and streams each retry attempt as regular assistant text (`⚠ API error (attempt N): RESOURCE_EXHAUSTED (code 429) …`). On the first retry notice matching a rate-limit or quota error (`RESOURCE_EXHAUSTED`, `429`, `rate limit`, or `quota`), `omp-antigravity` immediately cancels the `agy` turn and fails the OMP stream with HTTP status `429` (`antigravity-acp: Antigravity rate limit (429 RESOURCE_EXHAUSTED); turn cancelled without retries`).

This ensures that only OMP's retry policy (`retry.*` in OMP config) controls backoff. When OMP retries the failed turn with the same context, the extension reuses the existing `agy` session—which already holds the prompt—and sends a short `[OMP retry]` continuation prompt instead of replaying the transcript into a new session.

Google does not publish numeric request or token limits for Antigravity; quota is tracked per model group across 5-hour and weekly windows.

## Limits

The behaviors below were observed against `agy` `1.5.5` and explain the extension's guardrails and remaining constraints:

- **Gemini 4 `RFC 2119` prompt rejection (`429 RESOURCE_EXHAUSTED`)**: If OMP's standard system prompt line
  ```text
  RFC 2119 keywords: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER` = `MUST NOT`; `AVOID` = `SHOULD NOT`.
  ```
  appears anywhere in `_meta.antigravity.systemPrompt.append`, requests to `gemini-4-carbon` and `gemini-4-argon` fail on the first attempt with `429 RESOURCE_EXHAUSTED` regardless of remaining account quota (reproduced with the account at 9% of its 5-hour quota, and reproduced by that single line alone while every other part of OMP's prompt succeeded). `omp-antigravity` rewords that exact line in transit to:
  ```text
  Requirement words: MUST and NEVER are absolute rules; SHOULD and AVOID are strong defaults that need a stated reason to break; MAY marks something optional.
  ```
  (`AGY_REWRITES` in `src/convert.ts`). If a future OMP release changes the wording of that line or introduces another phrase that triggers the same upstream filter, Gemini 4 requests will fail with `429 RESOURCE_EXHAUSTED` again; inspect the sent instructions with `OMP_ANTIGRAVITY_DEBUG=<dir>`.
- **Per-message text limit (~192,000 bytes)**: A single `session/prompt` message in `agy` keeps only about the first 192,000 bytes of text. `omp-antigravity` splits larger prompts into 180,000-byte parts with `OK` acknowledgements, which costs one extra round trip per additional part.
- **MCP tool result truncation (~10,000 bytes)**: `agy` cuts MCP tool results in the middle at about 10,000 bytes of text. `omp-antigravity` answers tool calls inline only when the result is at most 9,000 text bytes (and 1 MiB of images) and otherwise cancels the turn and delivers the full result as the next prompt.
- **MCP tool call timeout (3 minutes)**: `agy` times out an open MCP tool call after 3 minutes regardless of progress notifications. `omp-antigravity` defers still-running tool calls after 150 seconds (`OMP_ANTIGRAVITY_DEFER_MS`) and delivers their results as the next prompt once they finish.
- **Timestamps prepended to inline MCP tool results**: `agy` prepends `Created At:` and `Completed At:` lines to every inline MCP tool result before the model sees it. A prompt that asks the model for "the first line" of a tool output can receive the `Created At:` timestamp line unless the prompt names the file content specifically.
- **Extra conversation-title call**: `agy` makes one extra model call on every new ACP session to generate a conversation title.
- **Residual non-OMP tools declared by `agy`**: `agy` does not honor `_meta` tool filtering; `excludeDefaultComponents: true` is the only exclusion mechanism that takes effect. Even with `excludeDefaultComponents: true`, `agy` still declares its internal `manage_task` tool, plus `list_resources` and `read_resource` whenever an MCP server is attached. If the model calls any tool other than `mcp_omp_*`, `omp-antigravity` fails the turn with `Antigravity attempted a non-OMP tool (…)` and rebuilds the session on the next request.
- **Steering messages wait for the next turn**: A second `session/prompt` sent while a turn is already running is queued by `agy` rather than merged into the active turn, so OMP steering messages take effect on the next turn (or after tool results are delivered).
- **Local transcripts written by `agy`**: While a session is open, `agy` writes full conversation transcripts (prompts and tool outputs) under `~/.omp/antigravity-acp/gemini/antigravity-cli/` (`brain/`, `conversations/`, `annotations/`) and offers no RPC to disable or delete them. `omp-antigravity` deletes a session's files when its `agy` process closes (unless `OMP_ANTIGRAVITY_DEBUG` is set). If the OMP process is terminated with `SIGKILL`, those files remain under `~/.omp/antigravity-acp/gemini/antigravity-cli/` until deleted manually.
- **Titles and logs kept by `agy`**: `agy` also records each conversation's title and status in its own databases (`conversation_summaries.db` and `jetbox_summaries_proto.pb`) and writes one log file per session under `log/`, all in `~/.omp/antigravity-acp/gemini/antigravity-cli/`. The extension does not edit `agy`'s databases; the logs grow by about 25 KB per session. Deleting `~/.omp/antigravity-acp` while no `agy` process is running removes all of it, and the extension recreates the profile on next use.

## Terms and data

- `omp-antigravity` launches Google's official `agy` CLI over ACP, which Google documents for editors and other ACP clients at <https://antigravity.google/docs/cli/acp/>. Google's Antigravity terms of service (<https://antigravity.google/terms>) state that using "third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth)" is a breach. Review those terms and judge whether your use is permitted; this README does not provide legal advice.
- The same terms allow human review of interactions and their use for model improvement, subject to your account settings. Do not send material through this provider that you are not permitted to share with Google.

## Upgrade and uninstall

### Upgrade

- **Extension**: install a newer commit with `omp plugin install github:alphastorm/omp-antigravity#<commit>` (or `git pull && bun install` in a local checkout).
- **Antigravity CLI**: re-run `curl -fsSL https://antigravity.google/cli/install.sh | bash` and verify with `bun run doctor` or `/antigravity-doctor`.
- **Model catalog**: OMP caches discovered models for 24 hours; after an `agy` or account change, run `omp models antigravity-acp` or `/antigravity-doctor` to check the live catalog.

### Uninstall

Remove the OMP plugin and delete the extension's isolated profile directory:

```bash
omp plugin uninstall omp-antigravity
rm -rf ~/.omp/antigravity-acp
```

To also remove the Antigravity CLI binary, delete `~/.local/bin/agy` and remove the `PATH` line the installer added to your shell profile (`~/.zshrc`, `~/.zprofile`, `~/.bashrc`, or `~/.profile`).

## Development and tests

Install dependencies and run the offline checks:

```bash
bun install
bun run check   # tsc --noEmit
bun test        # 38 offline unit and state-machine tests (uses test/fixtures/fake-agy)
```

`bun test` runs completely offline: `test/unit/convert.test.ts` checks prompt packing, tilde fencing, `RFC 2119` instruction rewording, inline result budgets, usage mapping, and stream events, while `test/unit/session.test.ts` drives the session state machine against the scripted fake `agy` executable in `test/fixtures/`.

To run the live end-to-end smoke test against a signed-in `agy` and a real `omp` binary (spends Antigravity quota; runs `text`, `tool round trip`, `tool-returned image`, and `prompt image` on `gemini-3.8-flash` at `low` effort by default):

```bash
bun run test:live
SMOKE_MODEL=gemini-4-carbon SMOKE_EFFORT=medium OMP_BIN=/path/to/omp bun run test:live
```

Observed `bun run test:live` output:

```text
PASS text (10.2s)
PASS tool round trip (9.5s)
PASS tool-returned image (14.6s)
PASS prompt image (9.2s)
```

## Attribution and license

`omp-antigravity` is original code released under the MIT License in [`LICENSE`](LICENSE). Its design was informed by two MIT-licensed projects—[zacbemis/pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider) and [SenCha930511/omp-antigravity-acp-provider](https://github.com/SenCha930511/omp-antigravity-acp-provider); see [`NOTICE.md`](NOTICE.md) for detailed attribution and third-party license notices.
