# Dental Hub CRM — Architecture

Scope: Foundation v0 + CRM Domain Slice 1. This describes what exists today and
where later CRM modules will attach. See [FOUNDATION-V0.md](./FOUNDATION-V0.md)
for the foundation and [CRM-DOMAIN-V0.md](./CRM-DOMAIN-V0.md) for the CRM
domain, its locked identity rules and its reference data.

---

## 1. Application boundaries

Dental Hub CRM is a single standalone Next.js application serving one
organization: Dental Hub. There is no tenant concept, no account routing, and no
shared agency platform. It shares no code with any other product.

There are exactly three boundaries that matter:

```
┌──────────────────────────────────────────────────────────┐
│ Browser                                                   │
│   Holds one opaque session cookie. Nothing else.          │
│   No user id, no role, no expiry claim, no signing secret.│
└───────────────────────────┬──────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼──────────────────────────────┐
│ src/proxy.ts            — optimistic UX redirect only     │
│ src/app/**              — routes, pages, Server Actions   │
│ src/components/**       — presentation                    │
└───────────────────────────┬──────────────────────────────┘
                            │ the ONLY way in
┌───────────────────────────▼──────────────────────────────┐
│ src/server/**           — 'server-only', all SQL lives here│
└───────────────────────────┬──────────────────────────────┘
                            │ pg
┌───────────────────────────▼──────────────────────────────┐
│ PostgreSQL — canonical application storage                │
└──────────────────────────────────────────────────────────┘
```

Rules that hold throughout:

1. **No SQL outside `src/server/`.** Pages and components consume data through
   the repository and the DAL, never a connection.
2. **No authentication state is trusted from the browser.** The cookie is an
   opaque random token; everything about the user is re-derived from the database
   on every request.
3. **Nothing in `src/server/auth/` or `src/server/db/` may enter a client
   bundle.** The runtime-facing modules import `server-only`, which turns a
   mistaken client import into a build error rather than a leak.

---

## 2. Directory structure

```
migrations/                  Numbered, immutable .sql migrations
  0001_foundation.sql
  0002_crm_catalogs.sql      Slice 1: sources, campaigns, categories, products, outcome reasons
  0003_crm_identity.sql      Slice 1: accounts, contacts, links, phone channels

scripts/
  load-env.ts                .env loading for standalone Node (no dotenv)
  migrate.ts                 npm run db:migrate
  seed.ts                    npm run db:seed
  test-db.ts                 Disposable test databases + safety guards

src/
  proxy.ts                   Next 16 Proxy (formerly Middleware). Optimistic only.

  app/
    layout.tsx               Root layout, product metadata
    page.tsx                 Redirects to /crm
    login/
      page.tsx               Public. Redirects to /crm if already signed in.
      login-form.tsx         'use client' — useActionState
    crm/
      layout.tsx             Authenticated shell; runs requireSession()
      page.tsx               Foundation home
      forbidden/page.tsx     Explicit 403
      settings/users/        ADMIN user administration
      settings/password/     Every user changes their own password
    api/health/route.ts      Liveness + readiness

  components/shell/          AppShell, SidebarNav, SignOutButton, navigation

  server/
    db/
      types.ts               Db = Pool | PoolClient | Client
      client.ts              'server-only' — lazy pooled connection
      migrator.ts            Migration runner (shared with scripts and tests)
    auth/
      password.ts            argon2id hashing
      session.ts             Opaque session mint / resolve / revoke
      login-throttle.ts      Per-email sign-in attempt limit
      cookie-name.ts         Cookie name, importable from Proxy
      cookie.ts              'server-only' — cookie read/write
      dal.ts                 'server-only' — THE authorization boundary
      actions.ts             'use server' — login / logout
      password-actions.ts    'use server' — change own password
      form-state.ts          Types shared with Client Components
    authz/
      permissions.ts         Roles, permissions, can()
    users/
      dto.ts                 UserRow (private) → PublicUser (safe)
      repository.ts          All crm_user SQL
      admin-actions.ts       'use server' — user administration
    crm/                       CRM domain modules (Slice 1+)
      catalog/
        repository.ts          All CRM catalog SQL (sources, campaigns, categories, products, outcome reasons)
      accounts/
        repository.ts          All crm_account + crm_account_contact SQL
      contacts/
        phone.ts               E.164 normalisation, default country EG
        repository.ts          All crm_contact + crm_contact_channel SQL

tests/foundation/            Acceptance suite
tests/crm/                   CRM domain suite (no build or server needed)
docs/                        This document, FOUNDATION-V0.md and CRM-DOMAIN-V0.md
```

### Why some modules carry `server-only` and others do not

`server-only` throws when resolved outside React's `react-server` condition —
including in plain Node. Modules that scripts and tests must import directly
(`migrator.ts`, `password.ts`, `session.ts`, `repository.ts`, `permissions.ts`,
`dto.ts`) therefore take their database handle as a parameter and carry no
marker. They are pure and never reach a client bundle because nothing in
`src/app` imports them directly.

The Next-runtime glue — `db/client.ts`, `auth/cookie.ts`, `auth/dal.ts`,
`auth/actions.ts`, `users/admin-actions.ts` — is what a Client Component could
plausibly import by mistake, so that is where the marker lives.

---

## 3. Authentication flow

### Sign in

```
POST /login  (Server Action)
  │
  ├─ zod validates shape
  ├─ email normalised: lower(trim(email))
  ├─ upsert crm_login_throttle: attempts + 1 (atomic, before any verify)
  │     └─ over 5 in a 15-minute window → "Too many sign-in attempts"
  ├─ SELECT crm_user WHERE email = $1
  │     └─ not found → verify against a dummy hash, then fail
  ├─ argon2id verify
  ├─ user.is_active checked AFTER verification
  │     └─ all three failures return one identical message
  ├─ DELETE crm_login_throttle for this email
  ├─ token = randomBytes(32) → base64url          ← never persisted
  ├─ INSERT crm_session (token_hash = sha256(token), expires_at = now + TTL)
  ├─ Set-Cookie: HttpOnly; SameSite=Lax; Secure(prod); Path=/; Expires
  └─ 303 → /crm
```

Why a single error message: distinguishing "no such account" from "wrong
password" from "deactivated" turns the login form into an account-enumeration
oracle. The dummy-hash verification keeps response times comparable when no
account exists.

Why throttle per email, counted up front: the attempt is recorded before the
password is checked, so parallel guesses cannot all see "under the limit".
Unknown emails are throttled the same way, so a lockout reveals nothing about
which accounts exist. The trade-off is that anyone can lock a known email out
for up to 15 minutes; per-IP limits belong at the reverse proxy, where the
client address can be trusted.

### Every authenticated request

```
Request
  │
  ├─ src/proxy.ts — cookie present?      ← optimistic, no database
  │     └─ absent → 307 /login?next=…
  │
  └─ src/server/auth/dal.ts — authoritative
        resolveSession(token):
          SELECT … FROM crm_session s JOIN crm_user u ON u.id = s.user_id
           WHERE s.token_hash = sha256($1)
             AND s.revoked_at IS NULL
             AND s.expires_at > now()
             AND u.is_active = true
        │
        ├─ no row → redirect('/login')
        └─ row    → { sessionId, user: PublicUser, role }
```

All four conditions are evaluated server-side, in one query, on every request.
That single `WHERE` clause is what makes revocation, expiry and deactivation take
effect immediately rather than at next sign-in.

`getCurrentSession` is wrapped in React `cache()`, so a render pass costs one
query no matter how many layouts and components ask who the user is.

### Why Proxy is not the security boundary

Next 16 renamed Middleware to Proxy. It runs on every matched route including
prefetches, and the session token is opaque — its presence says nothing about
validity. Proxy therefore only bounces visitors with no cookie at all, as a UX
shortcut. `dal.ts` is the real gate, and it runs inside `/crm/layout.tsx`, which
every route under `/crm` passes through.

Proxy deliberately does **not** redirect signed-in visitors away from `/login`: a
stale cookie would ping-pong against the DAL forever. The login page performs
that check itself, authoritatively.

### Sign out

`logoutAction` sets `revoked_at` on the session row, clears the cookie, and
redirects. Because revocation is a database fact, a cookie captured before logout
is dead the moment it is replayed.

### Change password

```
POST /crm/settings/password  (Server Action)
  │
  ├─ assertPermission('crm:access')        ← any signed-in user, own account only
  ├─ zod: new ≥ 12 chars, confirmation matches, differs from current
  ├─ argon2id verify of the CURRENT password
  │     └─ wrong → "Your current password is incorrect.", nothing written
  ├─ hash the new password (before the transaction, so no row waits on argon2)
  └─ one transaction:
        UPDATE crm_user SET password_hash = …
        UPDATE crm_session SET revoked_at = now()
         WHERE user_id = $1 AND id <> <this session> AND revoked_at IS NULL
```

The current password is required so a session left open on a shared machine
cannot be used to take the account over. Every other session is revoked because
changing the password is how a user locks out someone who learned the old one;
the session making the change stays signed in.

---

## 4. Persistence boundary

### Schema

```sql
crm_user
  id             uuid PK      DEFAULT gen_random_uuid()
  display_name   text         NOT NULL
  email          text         NOT NULL UNIQUE
  password_hash  text         NOT NULL
  role           text         NOT NULL
  is_active      boolean      NOT NULL DEFAULT true
  created_at     timestamptz  NOT NULL DEFAULT now()
  updated_at     timestamptz  NOT NULL DEFAULT now()

crm_session
  id             uuid PK      DEFAULT gen_random_uuid()
  user_id        uuid         NOT NULL REFERENCES crm_user(id) ON DELETE CASCADE
  token_hash     bytea        NOT NULL UNIQUE     -- sha256 of the opaque token
  created_at     timestamptz  NOT NULL DEFAULT now()
  expires_at     timestamptz  NOT NULL
  revoked_at     timestamptz

crm_schema_migration            -- the one supporting table
  version        integer PK
  name           text         NOT NULL
  checksum       text         NOT NULL
  applied_at     timestamptz  NOT NULL DEFAULT now()
```

`crm_schema_migration` is justified as the only extra table: any migration system
needs a ledger, and "re-running migrations is safe" is not a testable claim
without one.

CRM Domain Slice 1 adds nine domain tables, fully specified in
[CRM-DOMAIN-V0.md](./CRM-DOMAIN-V0.md):

```sql
crm_source            -- where inbound interest originates (seeded reference data)
crm_source_campaign   -- a campaign belongs to exactly one source
crm_product_category  -- stable catalog grouping (seeded reference data)
crm_product           -- a product belongs to exactly one category
crm_outcome_reason    -- kind/code/label/requires_note/is_active (seeded reference data)
crm_account           -- an organisation; name is NOT unique
crm_contact           -- a person; NO account_id column; email unique-when-present
crm_account_contact   -- the only account↔contact meeting point; surrogate id PK + UNIQUE (account_id, contact_id)
crm_contact_channel   -- PHONE only for now; value is E.164 and globally unique
```

Structural facts worth knowing without opening the migrations:

- `crm_contact` has **no `account_id`**: contacts relate to accounts only
  through `crm_account_contact`, so one contact may serve many accounts.
- The canonical phone identity is global: one E.164 `value` can never belong
  to two contacts (partial unique index over PHONE rows).
- `is_whatsapp` is a capability flag on a PHONE channel, never an identity;
  a CHECK keeps it off any future non-phone channel type.
- Contact email is `UNIQUE` with default `NULLS DISTINCT` semantics: many
  contacts may lack an email; a recorded email identifies exactly one contact.
- Every CRM foreign key is `ON DELETE RESTRICT`. Lifecycle is `is_active`;
  nothing removes CRM history silently.

### Invariants enforced by the database, not by convention

| Constraint | Fact it makes unrepresentable |
|---|---|
| `crm_user_email_normalised` — `email = lower(btrim(email))` | A non-normalised address. This is what makes `UNIQUE(email)` genuinely case-insensitive without the `citext` extension. |
| `crm_user_email_structure` | An address with no sensible `@`. Structural only — real validation is Zod's job, and SQL is the wrong place to attempt RFC 5322. |
| `crm_user_password_hashed` — `password_hash LIKE '$argon2%'` | A plaintext password in the password column. |
| `crm_user_role_known` | An unrecognised role. |
| `crm_session_token_hash_len` — `octet_length = 32` | A token hash that is not a SHA-256 digest. |
| `crm_session_token_hash_unique` | Two sessions sharing a token. |
| `crm_session_expiry_after_creation` — `expires_at > created_at` | A session with a zero-length or negative lifetime. Immediate invalidation is `revoked_at`'s job; an expired session is a *historical* one whose window has passed, not one that never opened. |

`gen_random_uuid()` is built into PostgreSQL 13+, so no extension is required.

Role is `text` + `CHECK` rather than a PostgreSQL `ENUM`: adding a role later is a
single `DROP CONSTRAINT` / `ADD CONSTRAINT` inside an ordinary transactional
migration, whereas `ALTER TYPE … ADD VALUE` carries transactional restrictions.

### Migrations

Forward-only, numbered `NNNN_snake_case.sql`, applied by
`src/server/db/migrator.ts`:

1. `pg_advisory_lock` on a fixed key, so concurrent runners serialise.
2. Ledger created if absent.
3. Each pending migration runs in **one transaction together with its ledger
   row** — a failure can never record a half-applied migration.
4. Applied migrations are compared by SHA-256. A changed checksum **aborts the
   run**; applied migrations are immutable and a change means a new migration.
5. A ledger entry whose file has vanished also aborts the run.

The runner is owned in-repo rather than delegated to a CLI tool because the
acceptance suite must drive it programmatically — create a disposable database,
migrate, assert, migrate again, assert the second run changed nothing.

---

## 5. Authorization

One vocabulary, in `src/server/authz/permissions.ts`:

| Role | `crm:access` | `users:read` | `users:manage` | `contacts:read` | `contacts:write` | `contacts:merge` | `catalog:manage` |
|---|---|---|---|---|---|---|---|
| `ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `SALES_MANAGER` | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| `SALES_REP` | ✅ | — | — | ✅ | ✅ | — | — |

Every entry is a capability check. Row scope — which specific records a user
may touch — is deliberately not expressed here; it is enforced where data is
queried.

Three entry points, all in `dal.ts`:

- `requireSession()` — authenticated or redirect to `/login`.
- `requirePermission(p)` — for rendering; redirects to `/crm/forbidden`.
- `assertPermission(p)` — for Server Actions; throws instead of navigating.

**Server Actions are public HTTP endpoints.** Every action in
`users/admin-actions.ts` re-authorises on entry. Rendering a form conditionally
is presentation, never protection.

`forbidden()` / `unauthorized()` are not used: they require the experimental
`authInterrupts` flag in Next 16.3.5. An explicit `/crm/forbidden` route achieves
the same result without opting the project into an experimental API.

---

## 6. Sessions

| Property | Choice | Why |
|---|---|---|
| Token | 32 random bytes, base64url | 256 bits of entropy; unguessable |
| Storage | `sha256(token)` only | A database dump yields no usable credential |
| Secret | **none** | Nothing is signed, so no `SESSION_SECRET` exists to leak or rotate |
| Lifetime | 12h absolute (`SESSION_TTL_HOURS`) | Simple and predictable |
| Renewal | none in v0 | Sliding renewal needs a policy decision first |
| Revocation | `revoked_at` timestamp | Immediate, server-side, auditable |
| Cookie | HttpOnly, SameSite=Lax, Path=/ | Lax blocks cross-site POST while still allowing inbound links |
| Production | `Secure` + `__Host-` prefix | The browser itself then enforces Secure, `Path=/` and no `Domain` |

The absence of a signing secret is a structural property, not a policy: there is
no key material in this system to expose.

`last_used_at` is deliberately omitted. Recording it would mean a database
`UPDATE` on every authenticated request for no benefit in v0. It belongs with a
sliding-session policy, and can be added then.

---

## 7. Data transfer

`UserRow` (with `password_hash`) never leaves `src/server`. `toPublicUser()`
projects it to `PublicUser`, which has no hash field at all — not a redacted one,
an absent one. There is no code path that can accidentally serialise a hash,
because the field does not exist on the type that crosses the boundary.

---

## 8. Extension points for later CRM modules

Adding Leads, Pipeline or Quotations should touch these seams and nothing else.

**A new table** — add `migrations/0004_<name>.sql` (or later). Never edit an
applied migration; the checksum guard will refuse it.

**New permissions** — add to `PERMISSIONS` and grant them in `ROLE_PERMISSIONS`
in `permissions.ts`. Every call site already goes through `can()`, so no other
file changes. This is where lead ownership, pipeline movement, quotation and
won/lost rules will live.

**A new repository** — `src/server/<domain>/repository.ts`, taking `Db` as its
first parameter like `users/repository.ts`. This keeps it usable from the app, a
transaction, a script and a test without modification.

**A new route** — `src/app/crm/<module>/page.tsx`. It inherits the authenticated
shell and the session check from `crm/layout.tsx` automatically; add
`requirePermission('<module>:read')` for anything narrower.

**Enabling navigation** — flip `status` from `'planned'` to `'available'` in
`src/components/shell/navigation.ts` and give the item an `href`. Until then the
entry renders as inert text with no link, so there are never dead links or fake
pages.

**A new Server Action** — start it with `assertPermission(...)`. It is a public
endpoint.

---

## 9. Technology

| Area | Choice |
|---|---|
| Framework | Next.js 16.3.5, App Router |
| Runtime | Node.js 24 |
| Language | TypeScript, strict |
| UI | React 19.2, Tailwind CSS v4 |
| Database | PostgreSQL 17 |
| Driver | `pg` — explicit parameterised SQL, no ORM |
| Hashing | `@node-rs/argon2` (argon2id, m=19456, t=2, p=1) |
| Validation | `zod` |
| Tests | `vitest` against disposable PostgreSQL |

`serverExternalPackages: ['pg', '@node-rs/argon2']` keeps the driver and the
native binding out of the bundle and required by Node at runtime.

No ORM: the foundation schema is two tables, and an ORM would have been the
largest dependency in the project for the smallest schema it will ever have.
Explicit SQL also means the constraints above are visible where they are
enforced.
