# 0001 — Monorepo & tooling

- Status: accepted
- Date: 2026-09-29

## Context

Conch ships a web app, a Node gateway, a design system and a shared protocol. They
change together and must stay type-compatible.

## Decision

- **pnpm workspaces** (strict, content-addressed, supply-chain protections such as
  minimum release age and build-script allowlists) + **Turborepo** for task graph and
  caching.
- **TypeScript 6** everywhere (typescript-eslint does not yet support the TS 7 native
  compiler), shared bases in `@conch/tsconfig`.
- Internal packages are consumed **as source** (`exports` → `src/`), compiled by the
  consumer's bundler. No per-package build step until something needs publishing.
- **ESLint 9 flat config** (jsx-a11y does not yet support ESLint 10) + **Prettier**.
- **Vitest** for unit tests, **Storybook 10** for component development and docs,
  **Playwright** (system Chrome) for screenshot-based visual QA.

## Consequences

Fast iteration and a single source of truth for types. If Nacre is ever published,
add a library build (tsup/vite lib mode) at that point.
