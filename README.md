<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
  <img src="assets/logo-light.svg" alt="" width="72" height="72">
</picture>

# OMP Antigravity

**Antigravity serves the model. Oh My Pi keeps control.**

**For Oh My Pi. Uses Google's official `agy` CLI and your own Google sign-in, not an API key.**

OMP Antigravity adds the `antigravity-acp` model provider to [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP).
Each request goes through Google's official Antigravity CLI (`agy acp`) over the Agent Client Protocol, so
Antigravity serves Gemini, Claude, and GPT-OSS models while Oh My Pi keeps its own system prompt, tools,
approval policy, and session transcript.

**[Quick start](#quick-start)** · **[How it works](#how-it-works)** ·
**[Operations](docs/OPERATIONS.md)** · **[Security and terms](docs/SECURITY.md)** ·
**[Compatibility](docs/COMPATIBILITY.md)** · **[Website](https://alphastorm.github.io/omp-antigravity/)** ·
**[Changelog](CHANGELOG.md)**

[![CI][ci-badge]][ci]
[![Release][release-badge]][release]
[![Oh My Pi][omp-badge]][compat]
[![agy][agy-badge]][compat]
[![License][license-badge]][license]

[ci]: https://github.com/alphastorm/omp-antigravity/actions/workflows/ci.yml
[ci-badge]: https://img.shields.io/github/actions/workflow/status/alphastorm/omp-antigravity/ci.yml?branch=main&label=CI&color=1C232B&labelColor=0B0E11
[release]: https://github.com/alphastorm/omp-antigravity/releases/latest
[release-badge]: https://img.shields.io/github/v/release/alphastorm/omp-antigravity?label=release&color=C4E05C&labelColor=0B0E11
[compat]: docs/COMPATIBILITY.md#tested-versions
[omp-badge]: https://img.shields.io/badge/Oh%20My%20Pi-18.18.7-1C232B?labelColor=0B0E11
[agy-badge]: https://img.shields.io/badge/agy-1.5.5-1C232B?labelColor=0B0E11
[license]: LICENSE
[license-badge]: https://img.shields.io/github/license/alphastorm/omp-antigravity?color=1C232B&labelColor=0B0E11

<sub><strong>Control by design:</strong> tools run under Oh My Pi's approval policy · a tool of
<code>agy</code>'s own fails the turn · the sign-in token is never read</sub>

</div>

> **First release, 0.1.0.** Tested on macOS `arm64` with Oh My Pi `18.18.3` and `18.18.7` and `agy` `1.5.5`.
> [Compatibility](docs/COMPATIBILITY.md) lists the limits observed in that `agy`.
>
> **Read Google's terms before you install.** Google documents [`agy acp`](https://antigravity.google/docs/cli/acp/)
> for editors and other ACP clients. Its [Antigravity terms of service](https://antigravity.google/terms) also say:
> "Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."
> Review the terms and judge whether your use is permitted; nothing here is legal advice.
> [Security model](docs/SECURITY.md#googles-antigravity-terms) has the detail.

Community project; not affiliated with or endorsed by the Oh My Pi maintainers or Google.

## How it works

![Who owns what. Oh My Pi, the coding agent, keeps control: its own system prompt, tools, approval policy, and session transcript. Antigravity, through Google's official agy CLI, serves the model: Gemini, Claude, and GPT-OSS under your own Google sign-in, in a restricted profile that excludes its default tools, rules, and skills. They talk over ACP and a loopback MCP bridge on 127.0.0.1 behind a bearer token. When the model calls a tool, Oh My Pi runs it under its own approval policy and answers in place. A large or slow result arrives in full as the next prompt. If agy tries a tool of its own, the turn fails and the session is rebuilt from Oh My Pi's transcript.](assets/how-it-works.png)

Each Oh My Pi session runs its own `agy acp` process, in a profile the extension owns that excludes `agy`'s
default tools, rules, and skills ([Process and profile](docs/ARCHITECTURE.md#process-and-profile)).

When the model calls an Oh My Pi tool, the call waits on a loopback bridge while Oh My Pi validates it and
runs it under its own approval policy. A small, fast result returns in place; a large or slow one arrives as
the next prompt ([Tool continuation](docs/ARCHITECTURE.md#tool-continuation)).

Oh My Pi's transcript stays the record. When it stops matching what `agy` has seen, after a branch, a rewind,
a compaction, or a change of model, effort, instructions, or tools, the extension opens a new `agy` session
and replays it ([Session rebuilds](docs/ARCHITECTURE.md#session-rebuilds)).

## Use it when

- You want Antigravity-served Gemini, Claude, or GPT-OSS models in Oh My Pi, with Oh My Pi's own tools,
  approvals, and transcript.
- Oh My Pi's built-in `google-antigravity` provider is unavailable to you and the official `agy` CLI is not.
- You want the sign-in handled by Google's own binary and the OS keyring, not by an extension.

## Use something else when

- Google's Antigravity terms do not permit your use, or the material is not yours to share with Google.
- You need steering messages to take effect in the middle of a turn. Here they wait for the next one.
- You run many concurrent subagents on a small machine. Each live session holds its own pair of `agy`
  processes, about 300 MB.
- You need a platform other than macOS `arm64`. The offline tests run on Linux; the live path has not.

## Requirements

- **Oh My Pi**: installed, with `omp` on `PATH`.
- **Antigravity CLI (`agy`)**: installed with Google's official installer. The extension looks for `agy` on
  `PATH`, then at `~/.local/bin/agy`.
- **Google account**: signed in to `agy`.
- **Platform**: tested on macOS `arm64`. The official `agy` installer supports macOS and Linux; Linux is not
  live-tested. Windows is unsupported, because the extension manages `agy` as a POSIX process group.
- **Bun**: only for a checkout (`bun install`, `bun run doctor`, the tests). `omp plugin install` uses the Bun
  that `omp` embeds.

The exact versions tested are in [Tested versions](docs/COMPATIBILITY.md#tested-versions).

## Quick start

### 1. Install `agy`

Install Google's official Antigravity CLI ([install guide](https://antigravity.google/docs/install/)) and
confirm that the binary runs:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version
```

The installer places the binary at `~/.local/bin/agy` and appends a `PATH` export to `~/.zshrc`,
`~/.zprofile`, `~/.bashrc`, and `~/.profile`.

### 2. Sign in once

Sign in from a terminal. Signing in from an interactive `agy` session works as well.

```bash
agy acp --login
```

Credentials stay in the OS keyring (macOS Keychain), where `agy acp` reuses them. The extension never reads,
copies, or refreshes the token.

### 3. Install the extension

Install the extension in Oh My Pi, pinned to the commit of release 0.1.0:

```bash
omp plugin install github:alphastorm/omp-antigravity#f0a8720f838e135148211aa7b3aa8a4d4daa1aab
```

To run from a checkout instead, see
[Run a local checkout in Oh My Pi](CONTRIBUTING.md#run-a-local-checkout-in-oh-my-pi).

### 4. Check the runtime

In an Oh My Pi session, run `/antigravity-doctor`. In a checkout, `bun run doctor` prints the same report. It
checks the binary, the sign-in, the ACP capabilities, and the models your account is offered, without
generating:

```text
omp-antigravity doctor: ok
agy: <path> (<version>)
ACP agent: <name and version>
capabilities: <JSON>
signed in: yes
model antigravity-acp/<id> — <name>; efforts: <levels> (default <level>)
profile: <path>
```

A usable runtime prints `omp-antigravity doctor: ok`, `signed in: yes`, and one `model` line for each model.
A `problem:` line names what to fix; [Error messages](docs/OPERATIONS.md#error-messages) explains each one.

To confirm that Oh My Pi discovers the models, run `omp models antigravity-acp` in a shell.

### 5. Run a first prompt

Start Oh My Pi with a model id and an effort from step 4:

```bash
omp --model antigravity-acp/gemini-4-argon --thinking high
```

## Choose a model and effort

- **In config files and agent definitions**, write `antigravity-acp/<model>` or
  `antigravity-acp/<model>:<effort>`, for example `antigravity-acp/gemini-4-argon:high`.
- **On the command line**, pass `--model antigravity-acp/<model>` and `--thinking <effort>` as separate
  flags, as in step 5. Oh My Pi `18.18.3` and `18.18.7` resolve a suffixed
  `--model antigravity-acp/<model>:<effort>` argument before extensions register their providers, and exit
  with `Model "…" not found`.
- **Effort levels are exact.** Each model accepts only the levels `agy` advertises for it, as listed in
  step 4. An effort the model does not offer fails the request; another level is never substituted.
- **Reasoning cannot be switched off.** When Oh My Pi asks for reasoning off (`disableReasoning` or
  `forceReasoningOff`), a model that uses effort levels stays at its `agy` default.

Context limits, input modalities, tool choice, and usage accounting are in
[Models and effort](docs/OPERATIONS.md#models-and-effort).

The catalog comes from your own Google account each time Oh My Pi discovers models. This is the catalog
offered to the test account at release 0.1.0, observed with `agy` `1.5.5`:

| Model id | Name in `agy` | Efforts (default) |
| --- | --- | --- |
| `antigravity-acp/gemini-4-carbon` | Gemini 4 Carbon | `low`, `medium`, `high` (`medium`) |
| `antigravity-acp/gemini-4-argon` | Gemini 4 Argon | `low`, `medium`, `high` (`medium`) |
| `antigravity-acp/gemini-3.8-flash` | Gemini 3.8 Flash | `low`, `medium`, `high` (`medium`) |
| `antigravity-acp/claude-opus-5-5` | Claude Opus 5.5 | `low`, `medium`, `high` (`medium`) |
| `antigravity-acp/claude-sonnet-5-5` | Claude Sonnet 5.5 | `low`, `medium`, `high` (`medium`) |
| `antigravity-acp/gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | none (`n/a`) |

## Documentation

| To | Read |
| --- | --- |
| Choose an effort, set a timeout, read the doctor report, decode an error message, upgrade, or uninstall | [Operations](docs/OPERATIONS.md) |
| Predict how a turn, a tool result, a rebuild, an abort, or a rate limit behaves | [Architecture](docs/ARCHITECTURE.md) |
| Check the tested versions, the platforms, the known limits of `agy`, and the record of release 0.1.0 | [Compatibility](docs/COMPATIBILITY.md) |
| See what reaches Google, what Google's terms say, and what the extension does with credentials, the environment, and local files | [Security model](docs/SECURITY.md) |
| Report a vulnerability privately | [Security policy](SECURITY.md) |
| Run a checkout in Oh My Pi, the checks, and the live smoke test | [Contributing](CONTRIBUTING.md) |
| See what changed in each release | [Changelog](CHANGELOG.md) |
| Read the attribution and third-party notices | [Notices](NOTICE.md) |
| Read the overview on the web | [Website](https://alphastorm.github.io/omp-antigravity/) |

## License and attribution

`omp-antigravity` is original code released under the MIT License in [`LICENSE`](LICENSE). Its design was
informed by two MIT-licensed projects—[zacbemis/pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider)
and [SenCha930511/omp-antigravity-acp-provider](https://github.com/SenCha930511/omp-antigravity-acp-provider);
see [`NOTICE.md`](NOTICE.md) for detailed attribution and third-party license notices.

Antigravity, Gemini, and Google are trademarks of Google LLC. Other model and product names belong to their
owners and are used only to identify them.
