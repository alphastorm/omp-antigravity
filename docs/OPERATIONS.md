# Operations

This page is for the person who uses OMP Antigravity (`antigravity-acp`) in
[Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) day to day. It covers choosing an effort, bounding
concurrency, the environment variables, the doctor report, every error message, debug traces, and upgrading
or uninstalling.

## Models and effort

You select a model as `antigravity-acp/<model>`, or as `antigravity-acp/<model>:<effort>` in config files and
agent definitions; [Choose a model and effort](../README.md#choose-a-model-and-effort) shows both forms. In
Oh My Pi's model list, each name carries the suffix ` (Antigravity)`.

### Effort levels

Each model accepts only the exact effort levels that the Antigravity CLI (`agy`) advertises for it. With `agy`
`1.5.5` those were `low`, `medium`, and `high`, or none for `gpt-oss-120b-medium`.

- An effort the model does not offer fails the request with
  `Antigravity model "…" does not offer effort "…"`. Another level is never substituted.
- Of the levels `agy` advertises, Oh My Pi is offered the ones it knows: `minimal`, `low`, `medium`, `high`,
  `xhigh`, and `max` (`OMP_EFFORTS` in `src/index.ts`).

### Disabling reasoning

`agy` cannot turn reasoning off on a model that uses effort levels (observed with `agy` `1.5.5`). When Oh My
Pi requests reasoning off (`disableReasoning` or `forceReasoningOff`), the extension requests no effort, and
the model stays at its `agy` default (`desiredFor` in `src/session.ts`).

### Model catalog and limits

The catalog is queried from your signed-in Google account each time Oh My Pi discovers dynamic models. Oh My
Pi caches discovered models for 24 hours; after an `agy` update or an account change, run
`omp models antigravity-acp` or `/antigravity-doctor` to check the live catalog.

`agy` reports no context window and no max-output token number. `limitsFor` in `src/index.ts` assigns fixed
limits by model family, which Oh My Pi uses to estimate context occupancy and to trigger compaction:

| Model id prefix | Context window (tokens) | Max output (tokens) |
| --- | ---: | ---: |
| `gemini-` | 500,000 | 64,000 |
| `claude-` | 200,000 | 64,000 |
| Any other id | 128,000 | 32,000 |

Every model is declared with `text` and `image` input whenever `agy` advertises image prompts, and with
`text` only otherwise (`discoverModels` in `src/index.ts`). In release 0.1.0, images were exercised live on
`gemini-3.8-flash` only; see [Release record](COMPATIBILITY.md#release-record).

### Tool choice

Antigravity cannot enforce Oh My Pi's tool choice, so the extension passes it to the model as a host note at
the end of the prompt (`choiceNote` in `src/session.ts`):

- `[OMP host note: answer without calling tools for this turn.]` when the choice is no tools.
- `[OMP host note: call the … tool now.]` when the choice names one tool.

### Cost and usage

Cost is reported as zero for every model and every turn. Google tracks Antigravity quota on your account;
the extension tracks neither cost nor remaining quota.

How `agy`'s token counts map to Oh My Pi's usage is in [Usage accounting](ARCHITECTURE.md#usage-accounting).
What is known about quotas is in
[No published limits or quotas](COMPATIBILITY.md#no-published-limits-or-quotas).

## Concurrency and memory

Each Oh My Pi session (the main session and each concurrent subagent) runs its own `agy acp` child process
group: two `agy` processes that together hold about 300 MB of memory while the `agy` session is live
(measured for an idle session with `agy` `1.5.5` on macOS `arm64`). To bound concurrent Antigravity turns in
Oh My Pi's `config.yml`:

```yaml
providers:
  maxInFlightRequests:
    antigravity-acp: 4
```

## Environment variables

The four timeouts are read once, when the extension loads (`ms` in `src/session.ts`). A value that is not a
positive finite number of milliseconds falls back to the default. The other four variables are read each
time they are used.

| Variable | Default | What it does |
| --- | --- | --- |
| `OMP_ANTIGRAVITY_AGY` | `agy` on `PATH`, then `~/.local/bin/agy` | Absolute path to an existing `agy` executable. |
| `OMP_ANTIGRAVITY_HOME` | `~/.omp/antigravity-acp` | Absolute path to the extension's isolated Antigravity profile directory, which holds `gemini/` and an empty `workspace/`. Created with mode `0700`; an existing directory keeps its own permissions, so keep it private (see [Local files](SECURITY.md#local-files)). |
| `OMP_ANTIGRAVITY_ENV_PASSTHROUGH` | *(empty)* | Comma-separated names of extra environment variables to pass to `agy`. |
| `OMP_ANTIGRAVITY_DEFER_MS` | `150000` (150 s) | How long an Oh My Pi tool call is held open inside the current `agy` turn before the turn is cancelled and the result is sent as the next prompt. Keep it below `agy`'s fixed 180 s MCP tool timeout (see [MCP tool call timeout](COMPATIBILITY.md#mcp-tool-call-timeout)). The extension does not check the value. |
| `OMP_ANTIGRAVITY_IDLE_TIMEOUT_MS` | `600000` (10 min) | Fails an active turn when `agy` emits no session update or tool call for this long. Also the time limit for each acknowledgement-only context part. |
| `OMP_ANTIGRAVITY_WARM_TTL_MS` | `1200000` (20 min) | Closes an idle session's `agy` process after this long; a later request rebuilds the session from Oh My Pi's transcript. |
| `OMP_ANTIGRAVITY_PENDING_TIMEOUT_MS` | `43200000` (12 h) | How long a session with pending Oh My Pi tool calls stays alive waiting for their results. |
| `OMP_ANTIGRAVITY_DEBUG` | *(unset)* | Directory where the extension writes session setup, prompt payloads, ACP updates, and tool traffic. While it is set, `agy`'s own conversation files are kept on disk (see [Debug traces](#debug-traces)). |

The allowlist that `agy` receives, and how `OMP_ANTIGRAVITY_ENV_PASSTHROUGH` interacts with the variables it
strips, are in [Child environment](SECURITY.md#child-environment).

## Check the runtime

The doctor verifies the `agy` binary, the sign-in, the ACP capabilities, and the models your account is
offered, without generating.

In an Oh My Pi session, run `/antigravity-doctor`. From a checkout, run:

```bash
bun run doctor
```

`bun run doctor` runs `bun src/doctor.ts`. With `--json` (`bun src/doctor.ts --json`) it prints the report
object, with the fields `ok`, `agy` (`path`, `version`), `agent`, `capabilities`, `signedIn`, `models`,
`profile` (`home`, `geminiDir`, `workspace`), and `problems`. The command exits with code `1` when the
runtime is not usable.

The doctor and model discovery both use a catalog probe (`catalog` in `src/acp.ts`): one bare `agy` session
whose appended instructions are `Model catalog probe; no prompt follows.`, a model selection for each model
to read its efforts, and then `session/close`. No prompt is sent.

### Report lines

The report has one line for each fact it checked (`formatReport` in `src/doctor.ts`):

| Line | Meaning |
| --- | --- |
| `omp-antigravity doctor: ok` or `omp-antigravity doctor: problems found` | Overall status (`ok` when `problems` is empty). |
| `agy: <path> (<version>)` | Resolved `agy` executable path and `--version` output. |
| `ACP agent: <name and version>` | Agent name and version reported by `agy acp` during `initialize`. |
| `capabilities: <JSON>` | ACP capability flags: `appendInstructions`, `httpMcp`, `image`, and `close`. |
| `signed in: yes` or `signed in: no` | Whether `session/new` succeeded with the current `agy` sign-in. |
| `model antigravity-acp/<id> — <name>; efforts: <levels> (default <level>)` | One line per model available to the account, with its effort levels and default. |
| `profile: <path>` | Path to the isolated profile directory (`OMP_ANTIGRAVITY_HOME`). |
| `problem: <text>` | One line per problem found during the check. |

A `problem:` line carries a setup error from [Setup and sign-in](#setup-and-sign-in), without the
`antigravity-acp: ` prefix, or one of four problems that only the doctor reports:

| Problem | Meaning |
| --- | --- |
| `runtime does not advertise _meta.antigravity.systemPrompt.append` | `agy` cannot take Oh My Pi's instructions, so no session will start. |
| `runtime does not advertise HTTP MCP (OMP tools cannot be bridged)` | A request that carries tools will not start. |
| `runtime does not advertise image prompts` | Models are declared with `text` input only. |
| `no models are available to this account` | The signed-in account's catalog is empty. |

For the first three, install an `agy` version listed in [Tested versions](COMPATIBILITY.md#tested-versions).

### Live sessions and recent rebuilds

In an Oh My Pi session, `/antigravity-doctor` adds what the running extension knows.

`live sessions: none`, or `live sessions:` followed by one JSON object for each live session, with the keys
`key`, `state`, `pid`, `acpSessionId`, `model`, `effort`, `profile`, `tools`, `delivered`, `pending`, `late`,
and `broken` (`snapshot` in `src/session.ts`). The `state` is one of:

| State | The session is |
| --- | --- |
| `streaming` | Sending a turn's output to Oh My Pi |
| `parked` | Holding tool calls open while Oh My Pi runs them |
| `awaiting-results` | Waiting for tool results after the `agy` turn was cancelled |
| `prompting` | Running an `agy` turn with no Oh My Pi stream attached |
| `idle` | Waiting for the next request |

`recent rebuilds:` appears once a rebuild has happened in the current Oh My Pi process, with one
`<ISO time> <key>: <reason>` line for each. The 20 most recent are kept (`#rebuild` in `src/session.ts`).
[Session rebuilds](ARCHITECTURE.md#session-rebuilds) explains what a rebuild is. The reasons:

| Reason | What happened |
| --- | --- |
| `instructions, tools, or model changed` | The system prompt, bridged tool set, model id, or effort level changed between requests. |
| `history changed (branch, rewind, or compaction)` | Oh My Pi's transcript diverged from the messages already delivered to `agy` after a branch, a rewind, or a compaction. |
| `history changed while tool calls were pending` | Earlier transcript messages changed while the session was waiting for Oh My Pi tool results. |
| `missing results for …` | The next request after a `toolUse` stop did not supply results for every pending tool call. |
| `unexpected … message after pending tool calls` | A message role other than `toolResult`, `user`, or `developer` appeared after pending tool calls. |
| `previous Antigravity turn still running` | A new request started while the previous `agy` prompt turn had not finished. |
| `previous turn failed (…)` | The previous `agy` turn ended with an error stop reason (`cancelled`, `refusal`, an empty `end_turn`, or an unknown stop reason). |
| `a request ended before its prompt was fully sent (…)` | An error or abort interrupted prompt delivery before every part reached `agy`. |
| `aborted before Antigravity took in tool results resolved in place` | The request was aborted after inline tool results were settled, before `agy` emitted progress. |
| `rate limited while delivering earlier context parts` | `agy` hit a rate limit during an earlier part of a multi-part context replay. |
| `Antigravity ended its turn while OMP tool calls were pending` | `agy` ended its prompt turn without cancellation while bridged tool calls remained unsettled. |
| `Antigravity fell back to its default agent (offered /…)` | `agy` offered a default-agent slash command on a later command-list update. |
| `Antigravity attempted a non-OMP tool (…)` | `agy` reported a call to a tool that is not on the loopback MCP bridge. |
| `Antigravity requested permission for a non-OMP operation (…)` | `agy` requested permission for an operation other than a bridged Oh My Pi tool. |

## Error messages

Find a message by its fixed words: `…` stands for a value the extension fills in.

- An error that ends a turn reaches Oh My Pi with the prefix `antigravity-acp: `.
- A [Restricted profile](#restricted-profile) failure during a turn ends with
  `The turn was stopped; the next request rebuilds the session.`
- Where the action is "send the request again", nothing needs cleaning up first: the extension rebuilds the
  `agy` session from Oh My Pi's transcript.

### Setup and sign-in

| Message | What it means, and what to do |
| --- | --- |
| ``Antigravity CLI (agy) not found. Install it (https://antigravity.google/docs/install?tab=cli), sign in once with `agy`, or set OMP_ANTIGRAVITY_AGY.`` | `OMP_ANTIGRAVITY_AGY` is not set, and there is no `agy` on `PATH` or at `~/.local/bin/agy`.<br>**Do:** Install `agy` as in [Install `agy`](../README.md#1-install-agy), or set `OMP_ANTIGRAVITY_AGY` to its absolute path. |
| `OMP_ANTIGRAVITY_AGY must name an existing absolute path: …` | The variable holds a relative path, or a path that does not exist.<br>**Do:** Set it to the absolute path of the `agy` executable, or unset it. |
| `OMP_ANTIGRAVITY_HOME must be absolute: …` | The variable holds a relative path.<br>**Do:** Set it to an absolute directory, or unset it to use `~/.omp/antigravity-acp`. |
| ``Antigravity CLI is not signed in. Run `agy acp --login` (or `agy`) in a terminal and sign in, then retry.`` | `agy` has no usable sign-in: `session/new` answered with JSON-RPC error `-32000`, or with "authentication required". The doctor prints the same message without "then retry".<br>**Do:** Run `agy acp --login` in a terminal, then send the request again. |
| `agy acp exited during startup (code …): …` | The `agy` process exited before it answered `initialize`. The text after the colon is the end of its error output.<br>**Do:** Read that text. Run `agy --version` to check that `agy` itself starts. |
| `agy acp speaks ACP protocol …; omp-antigravity requires …` | `agy` answered `initialize` with a different ACP protocol version from the one the extension is built for.<br>**Do:** Install an `agy` version listed in [Tested versions](COMPATIBILITY.md#tested-versions). |
| `… does not advertise _meta.antigravity.systemPrompt.append` | This `agy` cannot take appended instructions, so Oh My Pi's system prompt cannot reach the model.<br>**Do:** Install an `agy` version listed in [Tested versions](COMPATIBILITY.md#tested-versions). |
| `… does not advertise HTTP MCP` | The request carries tools, and this `agy` cannot attach an HTTP MCP server.<br>**Do:** Install an `agy` version listed in [Tested versions](COMPATIBILITY.md#tested-versions). |
| `… did not advertise a model selector` | `session/new` returned no model option, so no model can be selected.<br>**Do:** Run `/antigravity-doctor` and check its `signed in` and `model` lines. |
| `… timed out after …s` | A startup step, or the delivery of a context part, did not finish in time. The message names the step: `agy acp initialize` (60 s; 15 s in the doctor, 10 s in model discovery), `session/new` (120 s; 20 s in the catalog probe), `model selection` and `effort selection` (30 s each; 10 s per model in the catalog probe), `Antigravity's command list (needed to confirm the restricted omp-host profile)` (5 s), or `Antigravity context delivery` (`OMP_ANTIGRAVITY_IDLE_TIMEOUT_MS`).<br>**Do:** Send the request again. |

### Restricted profile

[Restricted agent guard](ARCHITECTURE.md#restricted-agent-guard) explains these checks.

| Message | What it means, and what to do |
| --- | --- |
| `Antigravity did not apply the restricted omp-host profile (offered /…)` | At startup, `agy` offered a slash command that only its default agent has, so the restricted agent did not apply. No prompt was sent.<br>**Do:** Send the request again: every session start checks the agent file. If it repeats, compare `agy --version` with [Tested versions](COMPATIBILITY.md#tested-versions) and report it. |
| `Antigravity fell back to its default agent (offered /…)` | During a session, `agy` offered a default-agent slash command. The turn was stopped.<br>**Do:** Send the request again. |
| `Antigravity attempted a non-OMP tool (…)` | The model called a tool that is not one of Oh My Pi's, such as one that `agy` still declares. The turn was stopped.<br>**Do:** Send the request again. See [Residual agy tools](COMPATIBILITY.md#residual-agy-tools). |
| `Antigravity requested permission for a non-OMP operation (…)` | `agy` asked permission for something other than an Oh My Pi tool. The request was rejected, and the turn was stopped.<br>**Do:** Send the request again. |

### Model selection

| Message | What it means, and what to do |
| --- | --- |
| `Antigravity model "…" is not available to this account. Available: …` | The model id is not in the catalog `agy` offers your account.<br>**Do:** Use an id from the message, or from `omp models antigravity-acp`. |
| `agy did not confirm model "…" (reported …)` | `agy` took the selection but reported a different active model.<br>**Do:** Run `/antigravity-doctor` to see the live catalog, then send the request again. |
| `Antigravity model "…" does not offer effort "…". Offered: …` | The model does not have that effort level.<br>**Do:** Use a level from the message. For a model that offers none, pass no effort. |
| `agy did not confirm … at effort "…"` | `agy` took the selection but did not report that model and effort back.<br>**Do:** Send the request again with a level that `/antigravity-doctor` lists for the model. |

One message in this area comes from Oh My Pi, not from the extension. Oh My Pi `18.18.3` and `18.18.7`
resolve a suffixed `--model antigravity-acp/<model>:<effort>` argument before extensions register their
providers, and exit with `Model "…" not found`. On the command line, pass
`--model antigravity-acp/<model> --thinking <effort>` as separate flags.

### Tools

Each of these fails the request before anything is sent to `agy`, and names the tool (`projectTools` in
`src/bridge.ts`).

| Message | What it means, and what to do |
| --- | --- |
| `OMP tool "…" is provider-native and cannot be bridged to Antigravity` | Oh My Pi marks the tool as provider-native. Such a tool cannot be offered over the bridge.<br>**Do:** Turn the tool off for sessions that use `antigravity-acp`. |
| `OMP tool "…" has no JSON schema the bridge can declare: …` | Oh My Pi could not produce a JSON schema for the tool's parameters. The text after the colon is its error.<br>**Do:** Fix the tool's parameter schema. |
| `OMP tool "…" parameters must be a JSON object schema for MCP` | The tool's parameter schema is not an object at its top level, which MCP requires.<br>**Do:** Wrap the parameters in an object schema. |
| `OMP tools "…" and "…" map to the same MCP name "…"` | Two tool names become identical once they are made safe for MCP.<br>**Do:** Rename one of the two tools. |

### Turns

| Message | What it means, and what to do |
| --- | --- |
| `Antigravity rate limit (429 RESOURCE_EXHAUSTED); turn cancelled without retries. …` | `agy` reported a quota or rate-limit error. The extension cancelled the turn and failed it with HTTP status `429`, so that Oh My Pi's retry policy applies; see [Rate limits](ARCHITECTURE.md#rate-limits).<br>**Do:** Let Oh My Pi retry, wait, or switch to another model. If it happens on the first request to a Gemini 4 model, see [Gemini 4 rejects the RFC 2119 line](COMPATIBILITY.md#gemini-4-rejects-the-rfc-2119-line). |
| `Antigravity rate limit (429 RESOURCE_EXHAUSTED): …` | The same error, while earlier context parts were being delivered. Also status `429`.<br>**Do:** As above. The retry replays the transcript, because `agy` holds only part of it. |
| `Antigravity ended the turn without any output` | The turn ended normally with no text, no image, and no tool call. The message may end with `(last runtime notice: …)`, the last retry notice `agy` printed for an API error.<br>**Do:** Send the request again. A notice, when shown, names the upstream error. |
| `Antigravity cancelled the turn` | `agy` reported the turn as cancelled, and the extension had not cancelled it.<br>**Do:** Send the request again. |
| `Antigravity refused the request` | `agy` ended the turn as a refusal.<br>**Do:** Change the request, then send it again. |
| `Antigravity stopped with …; output is incomplete` | `agy` ended the turn with a stop reason the extension does not expect.<br>**Do:** Send the request again. |
| `no Antigravity progress for …s` | A streaming turn received no session update and no tool call from `agy` for `OMP_ANTIGRAVITY_IDLE_TIMEOUT_MS`.<br>**Do:** Send the request again. Raise the variable if long silences are expected. |
| `Antigravity did not acknowledge cancellation` | `agy` did not end a cancelled turn within 5 seconds, so the session was closed.<br>**Do:** Send the next request; it starts a new session. |
| `agy acp exited unexpectedly (code …): …` | The `agy` process exited while its session was live. The text after the colon is the end of its error output.<br>**Do:** Read that text, then send the request again; it starts a new process. |
| `session/prompt failed: …` | `agy` answered the prompt with an error instead of a result.<br>**Do:** Send the request again. To see the exchange, capture a [debug trace](#debug-traces). |
| `Antigravity stopped a context delivery part with …` | `agy` did not acknowledge an earlier part of a split prompt normally.<br>**Do:** Send the request again. |
| `the previous Antigravity turn did not end` | An earlier turn on the session was still open 5 seconds after the new request needed the session.<br>**Do:** Send the request again. |

### Requests and sessions

| Message | What it means, and what to do |
| --- | --- |
| `request contains no messages Antigravity has not already answered` | The request adds nothing to what `agy` has already answered (error code `duplicate_request`). A replay of an answered request is refused this way; see [Cache warming and duplicate requests](ARCHITECTURE.md#cache-warming-and-duplicate-requests).<br>**Do:** Nothing, for a replay. Otherwise send a new message. |
| `antigravity-acp cannot apply a replaced provider payload` | An `onPayload` hook returned a changed payload. The extension shows each payload to the hook but cannot send a replaced one.<br>**Do:** Remove the hook, or make it leave `antigravity-acp` payloads unchanged. |
| `the OMP session closed while Antigravity was starting` | Oh My Pi closed the session while `agy` was starting.<br>**Do:** Nothing. Send a request in the current session. |
| `the Antigravity session closed during startup (…)` | The session was closed while the extension waited for `agy`'s command list. The reason is in the parentheses.<br>**Do:** Nothing. Send a request in the current session. |
| `OMP closed the provider session before this request started` | Oh My Pi closed or reset the session while the request waited its turn.<br>**Do:** Nothing. Send a request in the current session. |
| `the Antigravity session closed before its prompt was sent` | The session closed between preparing a prompt and sending it.<br>**Do:** Send the request again. |
| `another antigravity-acp provider instance owns this OMP session (duplicate install?)` | A second copy of the extension is loaded in this Oh My Pi process.<br>**Do:** Keep one installation. To test a checkout beside an installed plugin, pass `--no-extensions`; see [Run a local checkout in Oh My Pi](../CONTRIBUTING.md#run-a-local-checkout-in-oh-my-pi). |
| `omp-antigravity is loaded twice (… and …); keep one installation of the antigravity-acp provider` | The extension was loaded from the two paths the message names.<br>**Do:** Keep one installation, as above. |
| `Request aborted` | You or Oh My Pi aborted the request; see [Aborts](ARCHITECTURE.md#aborts).<br>**Do:** Nothing. |

## Debug traces

Setting `OMP_ANTIGRAVITY_DEBUG=/path/to/dir` creates that directory with mode `0700` (an existing directory
keeps its own permissions, so use one only you can write to) and writes each trace file with mode `0600`
(`debugDump` in `src/session.ts`):

- `session-<timestamp>.json`: the session key and the desired state (`model`, `effort`, `instructions`,
  `profile`, bridged `tools` declarations, and `fingerprint`).
- `prompt-<timestamp>-<part>.json`: each outbound ACP prompt part (`transport`, `agent`, `agentPath`,
  `acpSessionId`, `model`, `effort`, `profile`, `part`, and `prompt`).
- `updates-<key>.jsonl`: each inbound `session/update` notification, each `parkedCall`, and each
  `inlineResult`.

For how `OMP_ANTIGRAVITY_DEBUG` retains `agy`'s own conversation files under `<OMP_ANTIGRAVITY_HOME>` and
how to clean up sensitive trace data, see [Local files](SECURITY.md#local-files).

## Upgrade and uninstall

### Upgrade

- **Extension**: install a newer commit with `omp plugin install github:alphastorm/omp-antigravity#<commit>`
  (for release 0.1.0,
  `omp plugin install github:alphastorm/omp-antigravity#f0a8720f838e135148211aa7b3aa8a4d4daa1aab`), or run
  `git pull && bun install` in a local checkout.
- **Antigravity CLI**: re-run `curl -fsSL https://antigravity.google/cli/install.sh | bash` and verify with
  `/antigravity-doctor` or `bun run doctor`.
- **Model catalog**: Oh My Pi caches discovered models for 24 hours; after an `agy` or account change, run
  `omp models antigravity-acp` or `/antigravity-doctor` to check the live catalog.

### Uninstall

Remove the Oh My Pi plugin and delete the extension's isolated profile directory:

```bash
omp plugin uninstall omp-antigravity
rm -rf ~/.omp/antigravity-acp
```

Uninstalling the plugin does not sign `agy` out: the sign-in stays in the OS keyring until you sign out in
`agy` itself, because the extension never touches the token.

To also remove the Antigravity CLI binary, delete `~/.local/bin/agy` and remove the `PATH` export line the
installer added to your shell profile (`~/.zshrc`, `~/.zprofile`, `~/.bashrc`, or `~/.profile`).
