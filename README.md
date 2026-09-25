# Wyrd

Mobile-first magical-language, puzzle, and duel game prototype inspired by the idea of composable Wyrdmarks.

Current implementation focus: **M0 — grammar**.

## Workspace

- `packages/wyrd-grammar` — semantic types, AST, parser, diagnostics.
- `packages/wyrd-content` — v0 glyph registry and data-first content.
- `packages/wyrd-resolver` — deterministic resolver boundary (M1).
- `apps/duel-sim` — text-only duel simulator boundary (M2).

## Development

```bash
pnpm install
pnpm check
```

`pnpm install` configures `.githooks/pre-commit`, which automatically bumps patch versions for affected tiers. GitHub Actions runs the same version rules as a PR backstop.

The prototype intentionally contains no production backend, map, inventory, or multiplayer code yet.
