# Security model

This page is for the person who runs OMP Antigravity with Oh My Pi (OMP) and has to answer for it. It says what
reaches Google, what Google's Antigravity terms say, and what the extension does with credentials, the
environment of the `agy` process, the tool bridge, and the files left on disk.

## What leaves your machine

The extension itself opens no network connection except the loopback Model Context Protocol (MCP) tool bridge
on `127.0.0.1` (`ToolBridge` in `src/bridge.ts`). Every connection to Google is made by Google's official
Antigravity CLI in Agent Client Protocol (ACP) server mode (`agy acp`) under your signed-in Google account.

During an `agy` session, the extension hands `agy`:

- Oh My Pi's system prompt and the `# omp-antigravity transport notes`, appended on `session/new` through
  `_meta.antigravity.systemPrompt.append` (`openSession` in `src/acp.ts`, `composeInstructions` in
  `src/convert.ts`).
- Your user and developer messages, and the text and images that Oh My Pi tools return.
- After a rebuild, the earlier conversation, replayed under `[OMP history]`; see
  [Session rebuilds](ARCHITECTURE.md#session-rebuilds).

All of it reaches Google's service through `agy`, so that the model can answer.

`agy` also makes one extra model call to title a conversation (observed with `agy` `1.5.5`). A session that
never receives a prompt, such as the doctor's catalog probe, is not titled; see
[Conversation-title call](COMPATIBILITY.md#conversation-title-call).

## Google's Antigravity terms

OMP Antigravity launches Google's official `agy` CLI over the Agent Client Protocol (ACP), which Google
documents for editors and other ACP clients at <https://antigravity.google/docs/cli/acp/>. Google's
Antigravity terms of service (<https://antigravity.google/terms>, read on 2026-11-10) state:

> Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts.

Review the terms and judge whether your use is permitted; nothing here is legal advice.

The same terms allow human review of interactions and their use for model improvement, subject to your
account settings. Do not send material through this provider that you are not permitted to share with Google.

## Credentials

You sign in to `agy` yourself, with `agy acp --login` or from an interactive `agy` session. `agy` stores the
credentials in the OS keyring (macOS Keychain) and reuses them in `agy acp`. The extension never reads,
copies, or refreshes the token.

The provider registration in `ompAntigravity` (`src/index.ts`) carries `apiKey: "agy-cli-managed-sign-in"`
and `baseUrl: "https://antigravity-acp.invalid/"`. Both are placeholders that Oh My Pi's provider interface
requires; neither is a credential or an endpoint.

Uninstalling the plugin does not sign `agy` out: the sign-in stays in the OS keyring until you sign out in
`agy` itself.

## Child environment

`childEnv` in `src/acp.ts` builds the environment of every `agy` process from an allowlist:

| Category | Allowed variables |
|---|---|
| User and paths | `HOME`, `USER`, `LOGNAME`, `PATH`, `SHELL`, `TMPDIR` |
| Locale, terminal, and desktop | `LANG`, `TZ`, `TERM`, `__CF_USER_TEXT_ENCODING`, `LC_*`, `XDG_*` |
| Network proxies | `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY`, `http_proxy`, `https_proxy`, `no_proxy`, `all_proxy` |
| TLS certificates | `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS` |
| Operator passthrough | Comma-separated variable names listed in `OMP_ANTIGRAVITY_ENV_PASSTHROUGH` |

Everything else is dropped. That includes `GEMINI_API_KEY`, `GOOGLE_*`, and `AGY_ADC_AUTH`, so an inherited
variable cannot switch `agy` onto a paid API-key or Application Default Credentials (ADC) route.

A name you list in `OMP_ANTIGRAVITY_ENV_PASSTHROUGH` is passed through even if it is one of these; see
[Environment variables](OPERATIONS.md#environment-variables).

## Tool bridge

When a request includes Oh My Pi tools, `ToolBridge` (`src/bridge.ts`) serves them to `agy` over MCP:

- It listens on `127.0.0.1` only, on a port the operating system chooses.
- Every request must carry the session's bearer token: 32 random bytes in hex, compared in constant time
  (`timingSafeEqual`). A request without it gets `401`.
- Only the path `/mcp` is served; anything else gets `404`. Request bodies are capped at 16 MiB.
- It executes nothing. A tool call is held open until Oh My Pi returns the result.

When `agy` asks permission (`session/request_permission`) for a bridged `mcp_omp_<name>` tool, `#onPermission`
in `src/session.ts` answers `allow_once`; Oh My Pi still validates the call and applies its approval policy
when it executes it. A permission request for anything else is rejected and ends the turn.

If the model calls any tool other than `mcp_omp_*`, the extension fails the turn with
`Antigravity attempted a non-OMP tool (…)`, and the next request rebuilds the session; see
[Restricted agent guard](ARCHITECTURE.md#restricted-agent-guard).

## Restricted agy profile

`agy` has tools, rules, skills, and workflows of its own. The extension runs it with those excluded, so that
it only serves the model.

- **Its own profile, and an empty working directory.** Each Oh My Pi session, and each subagent, gets its own
  `agy` process, started with `--agent omp-host` in a profile directory the extension owns, not in your
  project. [Process and profile](ARCHITECTURE.md#process-and-profile) has the exact command and files.
- **Built-in tools, rules, skills, and workflows disabled.** The `omp-host` agent file sets
  `excludeDefaultComponents: true`. The extension checks the file before every session start and rewrites it
  if it is missing or different.
- **No client file access or terminal.** The extension declares the ACP client capabilities
  `fs.readTextFile`, `fs.writeTextFile`, and `terminal` as `false`.
- **No project instructions or ambient MCP servers.** `agy acp` does not load MCP servers from `agy`'s user
  config, and the empty working directory keeps `agy` from reading the Oh My Pi project's `AGENTS.md`
  (observed with `agy` `1.5.5`).
- **Confirmed before any prompt.** `agy` does not fail when the agent is missing, so the extension checks
  that the restricted agent applied before it sends anything, and refuses the session otherwise; see
  [Restricted agent guard](ARCHITECTURE.md#restricted-agent-guard).

What remains: `agy` does not honor `_meta` tool filtering, and with the restricted agent it still declares
`manage_task` and, when an MCP server is attached, `list_resources` and `read_resource` (observed with `agy`
`1.5.5`). The extension cannot remove them. A call to any of them fails the turn.

## Local files

Everything is under `<OMP_ANTIGRAVITY_HOME>`, by default `~/.omp/antigravity-acp`. `ensureProfile` in
`src/acp.ts` creates `gemini/config/agents` and `workspace` there with mode `0700`. An existing directory
keeps its own permissions, so keep it private: `agy` writes its own files with default permissions.

`agy` writes under `gemini/antigravity-cli/` and offers no RPC to disable or delete any of it:

| Files | Contents | Removed |
|---|---|---|
| `brain/<id>`, `conversations/<id>.db` with its `-wal` and `-shm` files, `annotations/<id>.pbtxt` | The full transcript of one conversation: prompts and tool output | By the extension, when that session's `agy` process closes (`close` in `src/acp.ts`) |
| `conversation_summaries.db`, `jetbox_summaries_proto.pb` | Each conversation's title and status | Never by the extension |
| `log/`, about 25 KB per session (observed with `agy` `1.5.5`) | `agy`'s own logs; they name the signed-in account and conversation titles | Never by the extension |

Closing a process means `SIGTERM` to the process group, up to 2 seconds for it to exit, then `SIGKILL`, then
the deletion above.

Transcripts stay on disk in two cases:

- **Oh My Pi is killed with `SIGKILL`.** The files of the sessions that were open remain until you delete
  them.
- **`OMP_ANTIGRAVITY_DEBUG` is set.** The extension then keeps `agy`'s transcript files, and writes its own
  trace files, with mode `0600`, to the directory you named. It creates that directory with mode `0700`; an
  existing directory keeps its own permissions, so use one only you can write to. See
  [Debug traces](OPERATIONS.md#debug-traces).

Debug files and retained transcripts contain full prompt text, system instructions, and tool output. Remove
the directory when you are finished.

To remove everything, make sure no `agy` process is running and delete the profile directory:

```bash
rm -rf ~/.omp/antigravity-acp
```

The extension recreates the profile on next use.

## Supply chain

- **Runtime dependencies**: three, pinned to exact versions in `package.json`: `@agentclientprotocol/sdk`,
  `@modelcontextprotocol/server`, and `zod`.
- **`agy`**: installed separately, by Google's official installer
  (`https://antigravity.google/cli/install.sh`). The extension never downloads or updates it.
- **The extension**: installed in Oh My Pi from GitHub, pinned to a commit; see
  [Install the extension](../README.md#3-install-the-extension).

## Reporting a vulnerability

Report suspected vulnerabilities privately by following the [Security policy](../SECURITY.md).
