## Summary

<!-- What problem does this change solve? -->

## Validation

<!-- List the exact commands and results: `bun run check`, `bun run test`, `bun run test:docs`. Name the
Oh My Pi and agy versions of any live run (`bun run test:live`, a manual session) and what it exercised;
say plainly what was not exercised live. -->

## Documentation

- [ ] Each changed behavior is described in the one page that owns it (see `CONTRIBUTING.md`), and
      `CHANGELOG.md` has a line under `## Unreleased`.
- [ ] A changed environment variable or error message is in `docs/OPERATIONS.md`; a changed tested
      version is in `docs/COMPATIBILITY.md`, the README, and the site.

## Security and privacy impact

- [ ] No token, transcript, account name, host or user name, private path, or raw debug file is included
      in this pull request.
- [ ] Changes to the child environment, the tool bridge, the restricted agy profile, or local files are
      described, and `docs/SECURITY.md` is updated when the boundary changed.
