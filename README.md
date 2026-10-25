# Dental Hub CRM

The internal sales CRM for Dental Hub. Inquiries come in as leads; a lead that
is worth pursuing is qualified into an opportunity; the opportunity is priced
with quotations and closed as won or lost. Every promised call, visit or demo
is a follow-up with a due date, and managers watch the whole pipeline from the
dashboard.

Next.js 16 (App Router), TypeScript, PostgreSQL through `pg` with hand-written
SQL, zod, vitest.

## What it does

| Area | Where | What a user can do |
|---|---|---|
| Dashboard | `/crm` | New leads, open pipeline, won/lost, quotation outcomes, overdue follow-ups, conversion funnel and per-rep figures for a chosen period |
| Leads | `/crm/leads` | Capture an inquiry, search, mark contacted, disqualify with a reason, archive/restore, link the doctor's clinic, schedule follow-ups, qualify into an opportunity |
| Opportunities | `/crm/opportunities` | Move through the stages, edit value and owner, mark won or lost with a reason, see the full activity timeline |
| Pipeline | `/crm/pipeline` | Board of open deals by stage, filtered by owner, source or stage |
| Quotations | from an opportunity | Line items in EGP, discount and tax, draft → sent → accepted/rejected/expired, numbered revisions, printable view / PDF |
| Follow-ups | `/crm/followups` | Everything due, overdue or done, with the outcome recorded on completion |
| Users | `/crm/settings/users` | Admins create accounts, change roles, deactivate people |

Rules the system enforces for you:

- **One contact per phone number and email.** Egyptian numbers are stored in
  one canonical form (`010…` and `+2010…` are the same person), and a new lead
  for a known phone or email is attached to the existing contact.
- **Sales reps see only their own leads, deals, quotations and follow-ups.**
  This is enforced in the database queries, not just hidden in the UI.
- **The commercial record stays intact.** Leads are archived, not deleted;
  a sent quotation is revised into a new version rather than edited; stage
  changes and activities are only ever appended.

### Roles

| Role | Can |
|---|---|
| Sales Rep | Work their own leads, opportunities, quotations and follow-ups |
| Sales Manager | Everything a rep can, across the whole team, including assigning and reassigning owners |
| Admin | Everything a manager can, plus user administration |

## Run it locally

Prerequisites: **Node.js 22+** and **PostgreSQL 16+** running locally (no
Docker needed).

One-time, as a PostgreSQL superuser. `CREATEDB` lets the test suites create and
drop their own throwaway databases; the app never needs the superuser password.

```sql
CREATE ROLE dental_hub_crm LOGIN PASSWORD '<choose a local dev password>' CREATEDB;
CREATE DATABASE dental_hub_crm OWNER dental_hub_crm;
```

Then:

```bash
cp .env.example .env          # put your password into DATABASE_URL and TEST_ADMIN_DATABASE_URL
npm install
npm run db:migrate
npm run db:seed               # three development accounts
npm run db:seed:acceptance    # optional: a few sample leads, a deal and follow-ups
npm run dev
```

Open http://localhost:3000 and sign in with one of the development accounts.
Their password is `SEED_DEV_PASSWORD` from `.env` (`DentalHubDev!2024` by
default):

| Email | Role |
|---|---|
| `admin@dentalhub.test` | Admin |
| `manager@dentalhub.test` | Sales Manager |
| `rep@dentalhub.test` | Sales Rep |

These accounts and the sample data are for development only. Both seed scripts
refuse to run when `NODE_ENV=production`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply pending migrations (safe to re-run) |
| `npm run db:seed` | Create the development accounts if absent (never resets a password) |
| `npm run db:seed:acceptance` | Create sample leads, an opportunity and follow-ups in the local `dental_hub_crm` database only |
| `npm run test:crm` | Domain suite: migrations, constraints, repositories and use cases |
| `npm run test:foundation` | Production build, then sign-in, sessions and HTTP acceptance against a real server |

Both test suites create a disposable `dental_hub_crm_test_<hex>` database,
run against it and drop it. They never touch `DATABASE_URL`.

## Working on the code

Read [AGENTS.md](AGENTS.md) first. It holds the project rules for people and
coding agents alike: migrations are append-only, SQL lives only in
`src/server/**`, every Server Action starts with `assertPermission`, row scope
is enforced in the query, multi-statement writes run in one transaction, and
every behaviour change comes with tests. A change is done when `lint`,
`test:crm` and `test:foundation` all pass.

Further reading:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): boundaries, sign-in and
  sessions, persistence, invariants, extension points
- [docs/CRM-DOMAIN-V0.md](docs/CRM-DOMAIN-V0.md): contact and account identity
  rules, reference data
- [docs/FOUNDATION-V0.md](docs/FOUNDATION-V0.md): the original foundation scope
  and acceptance criteria

## Before going live

This repository runs well locally, but it is not yet deployed anywhere. A
production setup still needs:

- a host for the Node.js server and a managed PostgreSQL database with backups;
- a domain with HTTPS (the session cookie is `Secure` in production);
- `npm run db:migrate` against the production database, then real accounts for
  the team created from **Users**. Do not run either seed script there.

## Known environment constraint

Next.js 16 cannot bundle from an exFAT volume. If `npm run build` fails with a
junction-point or `readlink` error, move the checkout to an NTFS (or other
non-exFAT) drive. See
[docs/FOUNDATION-V0.md](docs/FOUNDATION-V0.md#7-known-environment-constraint).
