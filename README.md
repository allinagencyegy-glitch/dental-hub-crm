# Dental Hub CRM

Internal CRM for Dental Hub. Next.js 16 (App Router), TypeScript, PostgreSQL.

Current release: **Foundation v0 + CRM Domain Slice 1** — persistence,
migrations, authentication, users, roles, the application shell, and the CRM
domain core (catalogs, accounts, contacts, account-contact relationships and
canonical phone identity). Leads, opportunities, follow-ups and activities are
still deferred.

- [docs/FOUNDATION-V0.md](docs/FOUNDATION-V0.md) — scope, acceptance criteria, what is deferred
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — boundaries, auth flow, persistence, extension points
- [docs/CRM-DOMAIN-V0.md](docs/CRM-DOMAIN-V0.md) — CRM domain slices, identity rules, reference data

## Prerequisites

- Node.js 24+
- PostgreSQL 17 (local; no Docker required)

## Setup

One-time, as a PostgreSQL superuser. `CREATEDB` lets the test suite create and
drop its own disposable databases; the application never needs the superuser
password.

```sql
CREATE ROLE dental_hub_crm LOGIN PASSWORD '<choose a local dev password>' CREATEDB;
CREATE DATABASE dental_hub_crm OWNER dental_hub_crm;
```

Then:

```bash
cp .env.example .env     # fill in DATABASE_URL and TEST_ADMIN_DATABASE_URL
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000 and sign in with a seeded development account
(see [docs/FOUNDATION-V0.md](docs/FOUNDATION-V0.md#5-development-seed)).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply pending migrations (safe to re-run) |
| `npm run db:seed` | Create the synthetic dev operators if absent |
| `npm run test:foundation` | Build, then run the full acceptance suite |
| `npm run test:crm` | CRM domain suite against a disposable database |

## Note on this checkout's location

Next.js 16 cannot bundle from an exFAT volume — neither Turbopack nor the
webpack builder. If `npm run build` fails with a junction-point or `readlink`
error, the repository is on an exFAT drive and needs to be moved to an NTFS
volume. See
[docs/FOUNDATION-V0.md](docs/FOUNDATION-V0.md#7-known-environment-constraint).
