# Monorepo Guide (Turborepo + npm Workspaces)

This document explains how this repository is structured as a monorepo, how it was created, and how to work with it.

## What this monorepo contains

Top-level layout:

- `apps/demo`: Next.js app (`@harrison/demo`)
- `packages/pseudonymization`: shared pseudonymization library (`@harrison/pseudonymization`)
- `packages/client-encryption`: shared client encryption library (`@harrison/client-encryption`)
- `packages/e2ee`: shared E2EE helpers (`@harrison/e2ee`)
- `turbo.json`: Turborepo task graph
- `package.json`: root workspace config + root scripts

## How this monorepo was created

The repo started as a single Next.js app at root. It was migrated into a monorepo in these steps:

1. Workspace scaffolding was added:
- npm workspaces in root `package.json`
- `turbo.json`
- shared package TypeScript config in `packages/tsconfig.base.json`
- package reference graph in `packages/tsconfig.json`

2. App relocation:
- Original app files were moved to `apps/demo`
- New app package manifest was created at `apps/demo/package.json`
- Root scripts (`dev`, `build`, `lint`, etc.) were changed to delegate to `@harrison/demo`

3. Shared libraries:
- Three package workspaces were created under `packages/*`
- Real code was migrated from app-local modules into package modules
- App imports were rewired to package imports (`@harrison/*`)

4. Workspace compatibility fixes:
- `packageManager` was added at root to satisfy Turborepo workspace resolution
- Dependency spec was switched from `workspace:*` to `0.1.0` because npm in this environment rejected `workspace:*` with `EUNSUPPORTEDPROTOCOL`
- Package entrypoints currently export from `src/index.ts` for dev-time local linking

## Root workspace configuration

Root `package.json` contains:

- `"workspaces": ["apps/*", "packages/*"]`
- `"packageManager": "npm@11.6.0"`
- repo orchestration scripts:
  - `npm run build:repo` -> `turbo run build`
  - `npm run lint:repo` -> `turbo run lint`
  - `npm run typecheck:repo` -> `turbo run typecheck`

Root app convenience scripts:

- `npm run dev` -> `@harrison/demo`
- `npm run build` -> `@harrison/demo`
- `npm run lint` -> `@harrison/demo`

## Turborepo task graph

Defined in `turbo.json`:

- `build`
  - depends on `^build`
  - caches `dist/**` and `.next/**`
- `lint`
  - depends on `^lint`
- `typecheck`
  - depends on `^typecheck`
- `dev`
  - non-cached, persistent

`^task` means: run the same task in dependency workspaces first.

## Package-level setup

Each package has:

- its own `package.json`
- its own `tsconfig.json` extending `packages/tsconfig.base.json`
- `src/index.ts` as API entrypoint
- scripts: `build`, `typecheck`, `lint`

Package names:

- `@harrison/pseudonymization`
- `@harrison/client-encryption`
- `@harrison/e2ee`

App dependency wiring (`apps/demo/package.json`):

- Depends on the three local packages via version `0.1.0`

## TypeScript project references

- Root `tsconfig.json` references `./packages`
- `packages/tsconfig.json` references each package project
- Package `tsconfig.json` files are `composite: true`

This supports incremental cross-package type checking.

## Running common workflows

From repo root:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run typecheck:repo
npm run lint:repo
npm run build:repo
```

Package-only examples:

```bash
npm run typecheck -w @harrison/pseudonymization
npm run typecheck -w @harrison/client-encryption
npm run typecheck -w @harrison/e2ee
```

## Why this structure is useful here

- Keeps `apps/demo` focused on UI/routes/auth
- Keeps crypto/pseudonymization/E2EE logic reusable and testable in isolated packages
- Makes future additions easy:
  - new app in `apps/*`
  - new shared module in `packages/*`
- Lets Turborepo run only affected tasks when changes are scoped

## Current known constraints

- npm environment rejected `workspace:*`; local package dependencies use `0.1.0` instead
- Package lint uses shared ESLint config from `apps/demo`
- Package exports currently point to source (`src/index.ts`) during this migration phase

## Suggested next hardening steps

1. Add repo-wide test runner and package test scripts (for example Vitest).
2. Add package build artifacts to release flow (`dist`) if publishing externally.
3. Add CI pipeline with `typecheck`, `lint`, and tests at repo level.
4. Optionally move package ESLint config to a shared root flat config file.
