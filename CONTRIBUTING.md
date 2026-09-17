# Contributing to PageLens

## Setup

```bash
pnpm install
```

This installs both workspace packages (`extension/`, `proxy/`) and wires up git hooks
(`husky`'s `prepare` script runs automatically).

See `README.md` for pointing the extension at a running proxy, and `docs/DEPLOYMENT.md` for full
deployment details.

## Before opening a PR

```bash
pnpm typecheck   # tsc --noEmit in both packages
pnpm lint        # eslint .
pnpm format      # prettier --write . (pre-commit runs this on staged files automatically)
pnpm build       # builds both packages; also load extension/dist unpacked and click-test it
```

For UI-touching changes to the popup, content script, or highlighting, actually load the
extension in Chrome and test the golden path (search, click a result, jump) plus at least one
edge case (empty results, a page with very little text) — type-checking and lint don't verify
behavior.

## Commit messages

Enforced by commitlint (`@commitlint/config-conventional`) on a pre-commit git hook — a
non-conventional commit message is rejected outright. Format:

```
type(scope): short, imperative-mood summary
```

Common `type`s: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`. `scope` is
typically `extension`, `proxy`, or `docs`, matching the part of the repo the commit touches.
Keep the subject line only — no body — unless a change genuinely needs more explanation than a
subject line can carry.

Examples:

```
feat(extension): highlight top result on search
fix(proxy): reject requests with an empty query
docs(docs): add deployment guide
chore: bump vite to 8.3.0
```

## Code style

ESLint + Prettier are enforced automatically on commit via lint-staged — you don't need to
remember to run them, but `pnpm lint` / `pnpm format` locally will save you a failed commit.
The project has no other style guide beyond what those tools enforce; match the conventions
already used in the file you're editing (see `CLAUDE.md` for the reasoning behind specific
architectural choices, e.g. why the extension/proxy don't share a types package).

## Keeping the extension and proxy in sync

`extension/src/config.ts` and `proxy/lib/jev.ts` each define their own copy of the chunk-count
cap and token-budget estimate (see `CLAUDE.md` for why they aren't a shared package). If you
change one, change the other, or a limit will silently drift between the two sides.
