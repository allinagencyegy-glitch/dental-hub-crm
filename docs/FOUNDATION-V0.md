# Dental Hub CRM — Foundation v0

The first production-quality slice of Dental Hub CRM. It establishes persistence,
migrations, authentication, users, roles and the application shell — and nothing
else. No sales-domain functionality is implemented, by design.

Dental Hub is the product owner and the sole organization. There is no
multi-tenancy, no account routing, and no agency layer.

---

## 1. Scope

| # | Capability | What exists |
|---|---|---|
| 1 | PostgreSQL persistence | `pg` driver, explicit parameterised SQL, single pooled connection |
| 2 | Migration system | In-repo forward-only runner over numbered `.sql` files with a checksummed ledger |
| 3 | Authentication | Opaque database-backed sessions, argon2id passwords |
| 4 | Users | `crm_user` with normalised unique email and active flag |
| 5 | Roles and permissions | `ADMIN`, `SALES_MANAGER`, `SALES_REP` with one server-side authorization boundary |
| 6 | Application shell | Sidebar, top bar, reserved navigation, sign out |
| 7 | Secure session handling | HttpOnly, SameSite=Lax, Secure + `__Host-` in production, server-side expiry and revocation |
| 8 | Health / readiness | `GET /api/health` |
| 9 | Development seed | Three synthetic operators, rerunnable and non-destructive |
| 10 | Automated foundation tests | 65 tests over a disposable PostgreSQL database plus a production HTTP tier |

### Routes

| Route | Access |
|---|---|
| `/login` | Public |
| `/crm` | Any authenticated user |
| `/crm/settings/users` | `ADMIN` only |
| `/crm/forbidden` | Authenticated; shown when a permission check fails |
| `/api/health` | Public liveness and readiness |
| `/` | Redirects to `/crm` |

---

## 2. Acceptance criteria

Every item below is covered by an automated test in `tests/foundation/`.
Run them with `npm run test:foundation`.

### Migrations

| # | Criterion | Test |
|---|---|---|
| 1 | Migration applies cleanly to a fresh PostgreSQL database | `migration.test.ts` |
| 2 | Re-running migrations is a safe no-op | `migration.test.ts` |
| 3 | A checksum is recorded for every applied migration | `migration.test.ts` |
| 4 | Editing an already-applied migration aborts the run | `migration.test.ts` |
| 5 | Primary keys are `uuid`; timestamps are `timestamptz` | `migration.test.ts` |
| 6 | No sales-domain tables are created | `migration.test.ts` |

### Identity

| # | Criterion | Test |
|---|---|---|
| 7 | Email is stored lowercased and trimmed | `user-identity.test.ts` |
| 8 | Differently-cased addresses are the same account | `user-identity.test.ts` |
| 9 | A non-normalised address is refused by the database | `user-identity.test.ts` |
| 10 | Passwords are never stored in plaintext | `user-identity.test.ts` |
| 11 | The database refuses a non-argon2 `password_hash` | `user-identity.test.ts` |
| 12 | Correct passwords verify; wrong ones do not | `user-identity.test.ts` |
| 13 | Identical passwords produce distinct hashes (per-password salt) | `user-identity.test.ts` |
| 14 | An unknown role is refused by the database | `user-identity.test.ts` |
| 15 | Re-running the seed leaves existing accounts untouched | `user-identity.test.ts` |

### Sessions

| # | Criterion | Test |
|---|---|---|
| 16 | Tokens carry 256 bits of entropy and are unique | `session-lifecycle.test.ts` |
| 17 | Only `sha256(token)` is persisted — never the token | `session-lifecycle.test.ts` |
| 18 | A valid session resolves to its user | `session-lifecycle.test.ts` |
| 19 | An unknown token resolves to nothing | `session-lifecycle.test.ts` |
| 20 | A revoked session is rejected and cannot be replayed | `session-lifecycle.test.ts` |
| 21 | An expired session is rejected | `session-lifecycle.test.ts` |
| 22 | Deactivating a user stops their live sessions | `session-lifecycle.test.ts` |
| 23 | Deactivation enforced even when applied directly in SQL | `session-lifecycle.test.ts` |
| 24 | All sessions for a user can be revoked at once | `session-lifecycle.test.ts` |

### Authorization

| # | Criterion | Test |
|---|---|---|
| 25 | `ADMIN` has full foundation administration | `authorization.test.ts` |
| 26 | `SALES_MANAGER` and `SALES_REP` have authenticated CRM access only | `authorization.test.ts` |
| 27 | Exactly three roles exist | `authorization.test.ts` |
| 28 | No sales-domain permissions are encoded yet | `authorization.test.ts` |
| 29 | The last active admin cannot be deactivated | `authorization.test.ts` |
| 30 | The last active admin cannot be demoted | `authorization.test.ts` |
| 31 | An admin may be deactivated or demoted once another active admin exists | `authorization.test.ts` |

### HTTP (production build, real server)

| # | Criterion | Test |
|---|---|---|
| 32 | Unauthenticated `/crm` redirects to `/login` | `http-acceptance.test.ts` |
| 33 | Unauthenticated user administration is refused | `http-acceptance.test.ts` |
| 34 | A wrong password issues no session | `http-acceptance.test.ts` |
| 35 | An unknown email issues no session | `http-acceptance.test.ts` |
| 36 | A deactivated user cannot sign in, even with the right password | `http-acceptance.test.ts` |
| 37 | Failures do not reveal which credential was wrong | `http-acceptance.test.ts` |
| 38 | A successful login sets HttpOnly + SameSite=Lax + Secure + `Path=/` | `http-acceptance.test.ts` |
| 39 | The cookie is opaque — no user id, email or role inside it | `http-acceptance.test.ts` |
| 40 | Only the token hash reaches the database | `http-acceptance.test.ts` |
| 41 | Authenticated `/crm` succeeds | `http-acceptance.test.ts` |
| 42 | `ADMIN` reaches user administration | `http-acceptance.test.ts` |
| 43 | `SALES_MANAGER` and `SALES_REP` are refused it | `http-acceptance.test.ts` |
| 44 | Logout revokes the session server-side | `http-acceptance.test.ts` |
| 45 | A cookie captured before logout cannot be replayed | `http-acceptance.test.ts` |
| 46 | A session revoked in the database is rejected on the next request | `http-acceptance.test.ts` |
| 47 | An expired session is rejected over HTTP | `http-acceptance.test.ts` |
| 48 | Deactivating a user ends their live session immediately | `http-acceptance.test.ts` |
| 49 | No password hash appears in any HTML response | `http-acceptance.test.ts` |
| 50 | No password hash appears in any RSC payload | `http-acceptance.test.ts` |
| 51 | The session token never appears in a response body | `http-acceptance.test.ts` |
| 52 | The health endpoint exposes no database credentials | `http-acceptance.test.ts` |
| 53 | No All In Studio / M1 vocabulary reaches the UI | `http-acceptance.test.ts` |

### Session exposure rule

A session credential necessarily appears in the `Set-Cookie` response header —
that is how a cookie is delivered. The rule the suite enforces is therefore:

- no plaintext password anywhere;
- no `password_hash` / `passwordHash` in any response;
- **no session token in any response body** — HTML, RSC payload, JSON, Client
  Component props or public DTOs.

The `Set-Cookie` header itself is expected to carry the token and is asserted for
its security attributes, not for absence.

---

## 3. Explicitly deferred

None of the following exist in Foundation v0. No tables, no routes, no
permissions, no placeholder pages.

- Leads
- Customers
- Pipeline
- Follow-ups / Tasks
- Quotations
- Won / lost handling
- Reports and dashboards
- WhatsApp integration
- Meta integrations
- AI features

These appear in the sidebar as reserved, disabled entries marked **Soon**. They
have no `href`, so there is nothing to click and no fake page behind them.

Also deferred: password reset workflows, sliding-session renewal, a
`last_used_at` column, and any permission concerning lead ownership, pipeline
movement, quotations, won/lost or task work.

---

## 4. Getting started

### Prerequisites

- Node.js 24+
- PostgreSQL 17 (any local instance; no Docker required)

### One-time database setup

Run once per machine, as a PostgreSQL superuser. `CREATEDB` is what lets the test
suite create and drop its own disposable databases.

```sql
CREATE ROLE dental_hub_crm LOGIN PASSWORD '<choose a local dev password>' CREATEDB;
CREATE DATABASE dental_hub_crm OWNER dental_hub_crm;
```

The application never needs the superuser password.

### Project setup

```bash
cp .env.example .env     # then fill in DATABASE_URL and TEST_ADMIN_DATABASE_URL
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply pending migrations (safe to re-run) |
| `npm run db:seed` | Create the synthetic dev operators if absent |
| `npm run test:foundation` | Build, then run the full acceptance suite |

---

## 5. Development seed

`npm run db:seed` creates three synthetic operators **if they do not already
exist**. It uses `ON CONFLICT DO NOTHING` semantics: re-running it never resets a
password, never changes a role, and never touches `updated_at`.

| Display name | Email | Role |
|---|---|---|
| Admin Operator | `admin@dentalhub.test` | `ADMIN` |
| Sales Manager Operator | `manager@dentalhub.test` | `SALES_MANAGER` |
| Sales Rep Operator | `rep@dentalhub.test` | `SALES_REP` |

The shared development password comes from `SEED_DEV_PASSWORD` in `.env`, and
defaults to `DentalHubDev!2024`.

**This password is for local development only.** It must never be used in a
deployed environment.

`.test` is a reserved TLD (RFC 2606) and can never resolve to a real mailbox.
None of these records correspond to real Dental Hub staff or customers, and no
real customer data exists anywhere in this repository.

The seed refuses to run when `NODE_ENV=production`.

If a password ever needs resetting in development, that should be added as an
explicit, separate, dev-only action — not folded into `db:seed`.

---

## 6. Testing

```bash
npm run test:foundation
```

This builds the application, then runs the suite against **disposable PostgreSQL
databases** created and dropped per run.

Three guards make it impossible for a test run to touch a real database:

1. The target name must match `dental_hub_crm_test_<hex>`.
2. `NODE_ENV=production` is refused outright.
3. The target must differ from `DATABASE_URL`.

The suite has two tiers:

- **Direct database tier** — migrations, identity, sessions and authorization,
  exercised against real PostgreSQL.
- **HTTP tier** — boots the production build (`next start`) on an ephemeral port
  and drives it with `fetch`, a manual cookie jar and `redirect: 'manual'`.
  Login is submitted exactly as a browser with JavaScript disabled would submit
  it, so the real Server Action path is under test; there is no test-only
  authentication endpoint.

---

## 7. Known environment constraint

**Next.js 16 cannot build from an exFAT volume.** This repository currently lives
on `E:`, which is formatted exFAT.

- Turbopack creates junction points under `.next/node_modules/` for every
  server-external package (`pg`, `@node-rs/argon2`). exFAT supports neither
  junctions nor symlinks, so the build aborts with
  `failed to create junction point ... (os error 1)`.
- The webpack builder (`next build --webpack`) fails differently but just as
  hard: `readlink` returns `EISDIR` for ordinary files on exFAT, so module
  resolution fails on the first file it touches.
- Relocating `distDir` does not help — Next always resolves it relative to the
  project root.

`npm run lint`, `npm run db:migrate` and `npm run db:seed` all work on exFAT;
only bundling is affected.

**Resolution: move the repository to an NTFS volume** (or reformat the drive).
No code change can work around this — it is a filesystem capability limit.
