# Dental Hub CRM — CRM Domain v0

The CRM sales domain, built in slices on top of Foundation v0. This document is
the contract for **Slice 1: Domain Core**, the only slice implemented.

Later slices (leads, opportunities, follow-ups, activities) do not exist yet:
no tables, no repositories, no permissions, no routes.

---

## 1. Slice 1 scope

| # | Capability | What exists |
|---|---|---|
| 1 | CRM catalogs | `crm_source`, `crm_source_campaign`, `crm_product_category`, `crm_product` |
| 2 | Outcome reasons | `crm_outcome_reason` with `kind` / `code` / `label` / `requires_note` / `is_active` |
| 3 | Accounts | `crm_account` |
| 4 | Contacts | `crm_contact` — **no `account_id` column** |
| 5 | Account-contact relationships | `crm_account_contact`, many-to-many with one primary contact per account |
| 6 | Contact channels | `crm_contact_channel` — PHONE is the canonical telephone identity |
| 7 | Slice-1 permissions | `contacts:read`, `contacts:write`, `contacts:merge`, `catalog:manage` |
| 8 | Repositories | `src/server/crm/catalog/`, `src/server/crm/accounts/`, `src/server/crm/contacts/` |
| 9 | Migrations | `0002_crm_catalogs.sql`, `0003_crm_identity.sql` (0001 is untouched) |
| 10 | CRM tests | `npm run test:crm` |

---

## 2. Locked identity rules

These rules are structural. Each is enforced by the database itself, not by
convention.

### Contacts never reference accounts directly

`crm_contact` has no `account_id`. Accounts and contacts meet only in
`crm_account_contact`, so one contact may relate to many accounts (a dentist
who owns two clinics) and one account may have many contacts.

- The surrogate `id` primary key follows the locked table convention;
  `UNIQUE (account_id, contact_id)` makes the same relationship twice
  unrepresentable.
- A partial unique index (`WHERE is_primary`) allows at most one primary
  contact per account. A contact may be primary for several accounts.

### PHONE is the canonical telephone identity

- Phone values are stored only as **E.164** (`+201012345678`). The repository
  normalises before insert; the `crm_contact_channel_value_e164` CHECK makes a
  non-E.164 value unrepresentable however it is written.
- Egyptian local numbers are normalised with **default country EG**: a leading
  `0` trunk prefix is replaced by `+20`; a leading `00` becomes `+`; a bare
  national number gets `+20` prepended. The full rule set is documented in
  `src/server/crm/contacts/phone.ts`.
- A partial unique index on `value WHERE channel_type = 'PHONE'` makes one
  canonical phone value belong to exactly one contact, globally and
  permanently — "the same number, two contacts" is unrepresentable, even for
  inactive channels.

### WhatsApp is not an identity namespace

There is no WhatsApp channel type and no WhatsApp identity. `is_whatsapp` is a
capability flag on a PHONE channel, and the
`crm_contact_channel_whatsapp_phone_only` CHECK keeps it that way if more
channel types ever arrive. In later slices WhatsApp may appear as an inbound
lead channel, a communication medium or a follow-up type — never as an
identity.

### Email

Contact email is lowercased and trimmed (`crm_contact_email_normalised`,
mirroring `crm_user`). It is `UNIQUE` with the default **`NULLS DISTINCT`**
semantics — an audited choice: PostgreSQL 17's `NULLS NOT DISTINCT` was
considered and rejected, because any number of contacts may have no email
recorded, while a recorded email identifies exactly one contact.

### Account names are not identifiers

`crm_account.name` carries no uniqueness constraint. Two unrelated accounts
can share a trading name; the uuid is the identity.

---

## 3. Cross-table integrity and delete policy

| Relationship | Enforcement |
|---|---|
| Campaign → source | `REFERENCES crm_source ON DELETE RESTRICT` |
| Product → category | `REFERENCES crm_product_category ON DELETE RESTRICT` |
| Account ↔ contact | `REFERENCES … ON DELETE RESTRICT` on both sides of `crm_account_contact` |
| Channel → contact | `REFERENCES crm_contact ON DELETE RESTRICT` |

**No CRM table uses `ON DELETE CASCADE`.** A parent row that still has
dependents cannot be deleted; lifecycle is expressed with `is_active`, never
with silent removal. The foundation's only CASCADE (`crm_session` → `crm_user`)
is unchanged: a session is not history.

Codes and kinds are stored normalised (`lower(btrim(…))` CHECKs), which is what
makes their UNIQUE constraints genuinely case-insensitive.

---

## 4. Reference data

Stable, production-required reference data is seeded by migration 0002 so every
environment carries the same rows.

**Sources** (lead-source vocabulary, including WhatsApp — a valid lead source
and communication medium even though PHONE is the canonical contact identity):

`whatsapp`, `facebook`, `instagram`, `phone`, `website`, `exhibition`,
`referral`, `walk_in`, `existing_customer`, `outbound`

**Product categories** (approved Dental Hub business model groupings):

`dental_units`, `autoclaves`, `compressors`, `scalers`, `clinic_packages`,
`accessories`, `other_equipment`

**Outcome reasons by kind** (`other` is the only reason with
`requires_note = true` in every kind):

- `disqualify`: `spam`, `wrong_number`, `job_applicant`, `student_research`,
  `out_of_scope`, `other`
- `lost`: `price_too_high`, `bought_competitor`, `no_budget`,
  `timing_postponed`, `no_response`, `wrong_fit`, `clinic_closed`, `other`
- `hold`: `awaiting_clinic_readiness`, `awaiting_finance`, `awaiting_stock`,
  `ramadan_seasonal`, `customer_travelling`, `other`

There is deliberately no `callback_requested` reason: a callback is future work
(a follow-up) recorded by a later slice, not a terminal outcome.

No Dental Hub product models are seeded: product rows are operational data,
entered through the application, not migration truth.

### The requires-note rule

`crm_outcome_reason.requires_note` is policy read from the reason row at write
time. It is deliberately **not** mirrored onto transactional records: when
later slices record an outcome, their repository consults the reason row
(`outcomeReasonRequiresNote`) and demands a note if required. Copying the flag
onto transactions would let the two copies disagree.

---

## 5. Permissions

Added to the single vocabulary in `src/server/authz/permissions.ts`:

| Permission | ADMIN | SALES_MANAGER | SALES_REP |
|---|---|---|---|
| `contacts:read` | ✅ | ✅ | ✅ |
| `contacts:write` | ✅ | ✅ | ✅ |
| `contacts:merge` | ✅ | ✅ | — |
| `catalog:manage` | ✅ | ✅ | — |

A rep works contacts but cannot merge them (a destructive, history-altering
operation) and cannot manage the catalog.

All of these are **capability** checks. Row scope — which records a user may
touch — stays a separate concern, enforced where data is queried; no ownership
qualifier appears in any permission string.

---

## 6. Repositories

All SQL lives under `src/server/`, explicit and parameterised, every function
taking its `Db` explicitly:

| Module | Contents |
|---|---|
| `catalogs/repository.ts` | Sources, campaigns, categories, products, outcome reasons; `normaliseCode`; `DuplicateCodeError` |
| `accounts/repository.ts` | Accounts and the account-contact link; `DuplicateAccountContactError`, `PrimaryContactConflictError` |
| `contacts/repository.ts` | Contacts and phone channels; `findContactByPhone` (identity lookup); `DuplicateContactEmailError`, `DuplicatePhoneError` |
| `contacts/phone.ts` | `normalisePhoneToE164` — the one place phone normalisation is defined |

Repositories normalise on the way in and translate unique-violation
`23505` into named domain errors. Foreign-key violations (`23503`) and CHECK
violations (`23514`) are asserted directly against the database in the test
suite, so the constraints are verified as database facts, not as repository
behaviour only.

---

## 7. Tests

```bash
npm run test:crm
```

Runs `tests/crm/` against a disposable PostgreSQL database (same
`dental_hub_crm_test_<hex>` guards as the foundation suite). No production
build and no HTTP server are involved — this suite drives the schema and the
repositories directly. Coverage includes: fresh apply and no-op re-run of all
migrations, seeded reference data, code/email/phone normalisation, uniqueness
and nullable-unique semantics, campaign/source and product/category
consistency, many-to-many account-contact behaviour, canonical phone identity,
the WhatsApp capability rule, RESTRICT delete policy, Slice-1 permission
matrix, and zero foreign product vocabulary.

`npm run test:foundation` remains the full acceptance gate: the one obsolete
assertion ("no sales-domain tables") was retired and replaced with positive
assertions that the Slice 1 tables exist and the deferred tables
(`crm_lead`, `crm_opportunity`, `crm_follow_up`, `crm_activity`) still do not.

---

## 8. Explicitly not in Slice 1

- `crm_lead`, `crm_opportunity`, `crm_follow_up`, `crm_activity`
- Contact merge implementation (only the `contacts:merge` permission exists)
- Non-PHONE channel types
- Row-scope rules
- Any UI routes for CRM domain data
