<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (all coding agents)

Stack: Next.js 16 App Router, TypeScript strict, PostgreSQL through `pg` with hand-written parameterised SQL (no ORM), zod, vitest.

1. Never edit an existing file in `migrations/`. A schema change is a NEW file `NNNN_snake_case.sql` using the number given in the task. The migrator aborts on a changed checksum or a duplicate version.
2. SQL lives only in `src/server/**`. Pages and components never import `pg` or `src/server/db/*`.
3. A client component (`'use client'`) may import from `src/server/**` only: `'use server'` action files, `import type`, and the pure vocabulary modules already used that way (`authz/permissions.ts`, `opportunities/stage.ts`, `quotations/status.ts`, `dashboard/dates.ts`, `auth/form-state.ts`). Never a value import from a repository, `db/` or `auth/dal.ts`.
4. Every exported function in a `'use server'` file starts with `assertPermission(...)` from `src/server/auth/dal.ts`. Server Actions are public HTTP endpoints.
5. Row scope: a SALES_REP reads and writes only rows they own. Enforce it in the repository query (see `pushScope` in `src/server/crm/quotations/repository.ts` and `pushRepScope` in `src/server/crm/opportunities/followups.ts`), never only in the UI.
6. Multi-statement writes run in one transaction (`beginTransaction` / `commitTransaction` / `rollbackTransaction` from `src/server/db/transaction.ts`).
7. Every behaviour change gets tests in `tests/crm/` (or `tests/foundation/` for sign-in and sessions). Never weaken or delete an existing test to make a change pass; if a test encodes the old rule, update it and list it in the PR.
8. Never run `npm run db:migrate`, `db:seed` or `db:seed:acceptance` against `DATABASE_URL` from a feature branch. The test suites create and drop their own databases.
9. No new dependency unless the task asks for one.
10. One task per branch, one PR per task. Do not touch files outside the task's scope.
11. The interface is Arabic (default, right to left) and English. Text a user sees goes in `src/i18n/messages/en.ts` and `ar.ts`, never inline: Server Components and Server Actions read it with `getMessages()` from `src/i18n/server.ts`, Client Components with `useMessages()` from `src/i18n/I18nProvider.tsx`. Use logical classes (`ms-`, `pe-`, `start-`, `text-end`), never `ml-`, `pr-`, `left-`, `text-right`.

Definition of done: run all three and paste the summary lines in the PR description.
- `npm run lint` → 0 errors
- `npm run test:crm` → all pass
- `npm run test:foundation` → all pass (this also runs `next build`)