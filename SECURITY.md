# Security policy

## Reporting a vulnerability

Report vulnerabilities in OMP Antigravity privately through GitHub Security Advisories at
<https://github.com/alphastorm/omp-antigravity/security/advisories/new>. Do not open a public issue or pull
request for a suspected vulnerability.

Include in your report:

- The `omp-antigravity` commit, the Oh My Pi (OMP) version, the output of `agy --version`, and the operating
  system.
- The output of `bun src/doctor.ts --json` from a checkout, or of `/antigravity-doctor` in Oh My Pi, with
  your user name and file paths redacted.

Never include OS keyring material, anything under `<OMP_ANTIGRAVITY_HOME>/gemini/antigravity-cli/` (default
`~/.omp/antigravity-acp`), files from an `OMP_ANTIGRAVITY_DEBUG` trace directory, or conversation content.

## Scope

This policy covers the `omp-antigravity` extension code in this repository, including process isolation, the
restricted `agy` profile (`omp-host`), child environment filtering, and the loopback tool bridge. Read
[Security model](docs/SECURITY.md) for the trust boundaries and data flow.

Report bugs in the Antigravity CLI (`agy`) or the Antigravity service to Google. Report bugs in Oh My Pi to
<https://github.com/can1357/oh-my-pi>.

## Supported versions

Security fixes land on `main` and in the release that follows. Only the latest release is supported: install
the fixed commit with `omp plugin install github:alphastorm/omp-antigravity#<commit>`.
