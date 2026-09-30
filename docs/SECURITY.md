# Security

Companion documents: [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
[`DATABASE.md`](./DATABASE.md) · [ADR-0002](./decisions/0002-custom-session-auth.md) ·
[ADR-0003](./decisions/0003-tenant-scoped-repositories.md)

---

## 1. Threat model

What this product holds, and who wants it.

| Asset | Attacker | Impact |
|---|---|---|
| Customer contact data — names, emails, phones, notes | Another tenant, an ex-employee, a credential thief | Total loss of trust; possible regulatory exposure |
| Financial and commercial records — deals, values, pipelines | A competitor | Commercial intelligence |
| Authentication credentials and sessions | Credential stuffing, session theft | Full account takeover, across every tenant the user can reach |
| Organisation configuration — roles, custom fields, settings | A malicious or compromised member | Privilege escalation |
| Audit trail | Anyone who wants to act without being traced | Loss of accountability, which is the point of having it |

**The defining threat is cross-tenant access.** Everything else is a
well-understood problem with a known fix. A single missing `organizationId` in a
single query exposes every record of every customer of the platform. This is the
risk the architecture is primarily designed to make impossible, and the risk the
test suite exists to continuously disprove.

---

## 2. Defence in depth

| Layer | Control |
|---|---|
| Edge | `proxy.ts` redirects unauthenticated requests. Optimistic only, no database. |
| Transport | HTTPS enforced. `Secure`, `HttpOnly`, `SameSite=Lax` session cookie. |
| Session | Opaque 32-byte token, SHA-256 hashed at rest, revocable, sliding 30-day expiry. |
| Identity | bcrypt cost 12. Lockout after repeated failures. Email verification before organisation creation. |
| Tenant | `TenantRepository` forces the scope on every query. `organizationId` is never read from request input. |
| Authorization | Per-organisation `Role` documents over a code-level permission catalogue. Guards run in the Data Access Layer on every read and write. |
| Validation | Zod schemas, `strict()`, rejecting unknown keys. `organizationId` in a body is stripped, not honoured. |
| Query safety | Filters are built from allow-listed schema fields. Operator keys (`$ne`, `$gt`, `$where`) are rejected before they reach a driver. |
| Output | React escaping by default. No `dangerouslySetInnerHTML` on user content. Activity bodies are stored and rendered as plain text. |
| Errors | Typed `AppError` with a safe message. Unexpected errors return a request id, never internals. |
| Audit | Append-only log of consequential actions, with actor, target, diff, and origin. |
| Rate limit | Auth endpoints and password reset, behind a driver interface. |

---

## 3. The request checklist

Applied to **every** route handler and **every** Server Action, without exception.

```
 1. Is the session valid, unexpired, unrevoked?   → else 401
 2. Does the user have an ACTIVE membership?      → else 403
 3. Which organisation is active?                 → from the SESSION ONLY
 4. Does the role grant the required permission?  → else 403
 5. Is the input valid and within bounds?         → else 422
 6. Does the target record belong to that org?    → else 404
 7. Perform the operation.
 8. Record the audit entry and emit the event.
 9. Return the standard envelope.
```

A Server Action is a public HTTP endpoint that happens to be referenced by a
form. It receives the same treatment as a route handler, every time. The fact
that a button renders it is not evidence that the caller is allowed to call it.

Step 3 is where the design is strongest: the active organisation is read from
the session and there is no request field that can change it. The only way to
change it is a dedicated endpoint that verifies membership first.

---

## 4. Session design

| Property | Value | Why |
|---|---|---|
| Token | 32 bytes, `crypto.getRandomValues`, base64url | 256 bits of entropy; not guessable |
| Storage | SHA-256 hash in MongoDB | A database dump yields no usable tokens |
| Lookup | By hash | No comparison, therefore no timing attack to mount |
| Expiry | 30 days, sliding on use | Long enough to be usable, short enough to bound exposure |
| Revocation | `revokedAt` stamp | Immediate, auditable, and a session can be killed without rotating a secret |
| Cookie | `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/` | Not readable by JavaScript; not sent cross-site; not sent to a different path |
| Rotation | New token issued on login and on privilege change | Limits the value of a leaked token |
| Cleanup | TTL index on `expiresAt` | No cron, no orphaned rows |

**Why not JWT.** A self-contained JWT cannot be revoked before it expires, which
means logout, "sign out everywhere", and suspension would all be advisory. For a
product holding customer contact data, revocability is not optional. See
[ADR-0002](./decisions/0002-custom-session-auth.md).

**`proxy.ts` reads the cookie, never the database.** It runs on every route and
on every prefetch. A database call there would multiply connection pressure by an
order of magnitude for a check that the DAL performs properly anyway. The proxy
is a user-experience redirect; the DAL is the security control.

---

## 5. Authorization model

**Permissions are code, roles are data.** The catalogue lives in
`src/modules/rbac/permissions.ts` as a frozen object. There is no permissions
collection, so there is no way to widen a permission by inserting a row.

Every code is `<domain>.<action>`. The list below is generated from
`src/modules/rbac/permissions.ts`, and a test fails if the two disagree, so
this section cannot drift from the code it documents:

```
organization      read  update  delete  transferOwnership  settings
users             read  invite  update  remove
roles             read  create  update  delete
invitations       read  create  revoke
companies         read  create  update  delete
contacts          read  create  update  delete
leads             read  create  update  delete  convert
deals             read  create  update  delete  move
tags              read  create  update  delete
fieldDefinitions  read  create  update  delete
pipelines         read  create  update  delete
activities        read  create  update  delete
tasks             read  create  update  delete
notifications     read  update
auditLogs         read
savedViews        read  create  update  delete
```

**Roles are per-organisation documents.** Four are provisioned on creation:

| Role | Intent | Summary |
|---|---|---|
| `OWNER` | Accountable party | Everything, including deleting the organisation and transferring ownership |
| `ADMIN` | Operational control | Everything except ownership transfer, organisation deletion, and organisation settings |
| `MEMBER` | Day-to-day work | Full CRM, task and activity access; cannot manage members or settings |
| `VIEWER` | Read-only | Read everything permitted, write nothing |

**Guard helpers, not scattered conditions.** `requireUser()`,
`requireOrganization()`, `requirePermission("deals.update")`. A route that needs
authorization calls one. The permission check cannot be forgotten, because
forgetting it means the function does not exist.

**Never trust a role id from the client.** A request may say "assign this role"
by `roleId`; the service loads that role and asserts it belongs to the active
organisation before using it.

**Deny by default.** A permission code not in the catalogue does not exist, and a
role's permission array is intersected with the catalogue when it is saved, so a
typo or a stale code cannot grant access.

---

## 6. Cross-tenant isolation

The single most important property of this system. Enforced in three independent
layers, any one of which would be insufficient.

**Layer 1 — structural.** `TenantRepository` is constructed with an
`organizationId` and merges it into every filter, update and delete it issues.
The scope is not an argument a caller can forget to pass; it is captured in the
object.

**Layer 2 — schema.** Every tenant collection requires `organizationId`. Every
index is prefixed by it. An unscoped query on a large collection degrades to a
collection scan, so a mistake is slow in development rather than invisible.

**Layer 3 — test.** A dedicated suite asserts, for every route and every service,
that a record belonging to another organisation returns 404 — including when the
caller is the Owner of **both** organisations. The strongest case, because it
catches implementations that "scope by the user's current org" but would happily
read a specific id.

**Cross-tenant responses are 404, not 403.** A 403 confirms the record exists,
which is a disclosure in itself. A 403 is reserved for a permission failure on an
operation the caller was never authorised to consider.

**What to test explicitly**

- Reading a record by a guessed `ObjectId` from another organisation
- Updating and deleting the same
- Nested references: a contact id from org A passed to a deal in org B
- Stage moves using a stage id from another organisation's pipeline
- Accepting an invitation issued by another organisation
- Acting on a membership that belongs to another organisation
- Global search never returning another organisation's matches
- Notifications and audit logs never crossing the boundary
- Dashboard aggregates never including another organisation's rows
- Any request that includes `organizationId` in its body having that field
  **stripped**, not honoured

---

## 7. Input validation and injection

**SQL injection** is not applicable. **NoSQL injection** is the real risk, and it
is specific to MongoDB:

```ts
// The attack: JSON body {"password": {"$ne": null}} matches any user.
```

Mitigations, all of which are implemented:

1. **Strict Zod schemas.** `.strict()` rejects unknown keys outright, so
   `{"password": {"$ne": null}}` fails validation before it reaches a service.
2. **Explicit mappers.** A service never spreads a request body into a MongoDB
   filter. It reads named fields into a new object. This is what makes mass
   assignment impossible: `organizationId`, `roleId`, `createdBy`, `deletedAt`
   and `customFields` cannot be set by a client because no client value reaches
   them.
3. **Operator key rejection.** A shared guard scans filter objects and throws if
   any key begins with `$` or contains `.`.
4. **No `$where`,`$regex` from user input.** Search terms are escaped before
   becoming a regular expression.
5. **Bounded everything.** Strings capped in length, arrays capped in count,
   pagination capped (`pageSize` maximum 100), date ranges validated.

**XSS.** React escapes by default. The product does not use
`dangerouslySetInnerHTML` on any user-controlled value. Activity and note bodies
are stored and rendered as plain text. If rich text is ever introduced it goes
through a sanitiser at write time, not at read time, and never as raw HTML.

**CSRF.** Session cookies are `SameSite=Lax`, which blocks cross-site POSTs from
a form, and `withApi` additionally refuses any mutating request whose `Origin`
does not equal `env.APP_URL`. Four reasons the cookie attribute is not enough on
its own, each one a way a server-side check earns its keep:

- SameSite is a browser policy with no server-side enforcement. Nothing stops a
  non-browser client from sending the request.
- Same-site is not same-origin. A POST from `evil.vercel.app` to
  `yourapp.vercel.app` is same-site, so the cookie rides along.
- An open redirect on this origin turns a cross-site request into a same-site
  one before it reaches the check.
- Lax is blind to state-changing GETs.

The expected origin is `env.APP_URL` and never `Host`, `X-Forwarded-Host` or
`Referer`: those are request headers, so in any deployment not behind a trusted
proxy that overwrites them the expected value would be supplied by the party
being checked. The check **fails closed** — a missing `Origin`, and the literal
`"null"` a sandboxed iframe sends, are both refused. Next.js's own Server Actions
check allows a missing `Origin` through with a warning, and that leniency is
deliberately not copied: "no Origin" is the exact shape of a probe. Browsers send
`Origin` on every non-GET/HEAD request including same-origin, so an honest client
loses nothing.

Server Actions carry Next.js's own origin check as well. Defence in depth, not a
single mechanism.

**Open redirect.** Any redirect target supplied by a client is validated to be a
path on this application. The post-login `redirect` parameter accepts a
relative path only.

---

## 8. Secrets and environment

- All secrets are environment variables. `.env*` is gitignored; `.env.example`
  contains names and empty values only, never a real value.
- The application validates the environment once at boot and fails loudly if a
  required variable is missing or a placeholder value is still in place in
  production. A missing secret must never degrade to an insecure default.
- The boot check has two halves, and they run at different times.
  - **Presence is validated at build.** A missing `MONGODB_URI` or
    `SESSION_SECRET` fails `next build`, because the build imports every route
    module and therefore evaluates this module. A deployment cannot be produced
    from a configuration that is missing a value.
  - **Production hardening is validated at the first boot of a running
    process.** The placeholder-secret, console-mail and plaintext-origin rules
    describe properties of a deployment, and none of them affects build output.
    `next build` forces `NODE_ENV=production` for itself and evaluates the
    modules it imports, so enforcing them there would make
    `cp .env.example .env.local && npm run build` — the setup step this repository
    documents — a hard failure. The rules still run before the process serves a
    single request, which is the point of a boot check.
- `NODE_ENV` is required rather than defaulted. It is the single variable in
  front of all three hardening rules, so a value that defaulted silently would
  have a failure mode of *off* — an unset `NODE_ENV` skips every rule and
  nothing reports it.
- `MONGODB_URI`, `SESSION_SECRET`, `MAIL_API_KEY` and similar are never logged,
  never returned by an endpoint, and never included in an error message.
- Secrets are validated when the application boots rather than discovered on
  first use at 3am.

---

## 9. Rate limiting and abuse

Targets: login, registration, password reset, invitation acceptance, and
public search. Without limits, these are credential-stuffing and enumeration
vectors.

Driver interface, with an in-memory implementation now. **This is honest about
its limits:** on Vercel, each warm instance keeps its own counter, so the
effective limit is multiplied by the number of instances. That is acceptable for
MVP abuse resistance and is **not** acceptable as a security boundary. An
Upstash Redis driver replaces it before the product takes real money.

Account lockout is separate and enforced in the database, so it is consistent
across instances: after five consecutive failures, `lockedUntil` is set fifteen
minutes into the future.

### Enumeration resistance

Three separate mechanisms, because each defeats a different probe.

**Identical bodies.** Login returns one 401 `UNAUTHENTICATED` for an unknown
address, a wrong password, a locked-out account and a suspended account — same
code, same message, same field order, only the per-request id differing.
`POST /forgot-password` returns `200 { "sent": true, "message": "If that address
has an account, we have sent a link." }` whether or not the account exists, and
`POST /resend-verification` says the same thing whether or not the address is
already verified.

Registration is the deliberate exception: it answers 409
`EMAIL_ALREADY_REGISTERED`, because a sign-up form has to be able to say "this
address is taken". That trade buys a usable form at the cost of making
registration an enumeration oracle, and it is the reason every other endpoint in
the directory is uniform.

**Equalised work.** An unknown address used to return in the time it takes to
miss an index, where a registered one took a cost-12 bcrypt — an order of
magnitude, measurable over a network from outside. Every refused sign-in now
spends one real bcrypt verification first: the missing-account path in
`loginWithPassword`, and the locked-out and suspended paths in
`authenticateWithPassword`. The dummy hash is a genuine cost-12 hash rather than
a cheap stand-in.

What this does **not** claim, because nobody has measured it and the code should
not pretend otherwise: the residual difference. This is `bcryptjs`, a JavaScript
implementation, so a single hash is not a fixed quantum of time — it depends on
the machine and shares an event loop with the request doing the timing. What the
burn equalises is the one large term. A small constant difference remains, from
the index lookup, the document fetch and the failure-counter write. Stating it
as "identical timing" would be a claim nothing enforces.

**Log-only detail.** `AppError.internal` is the answer to "which of the four was
it", and it is never serialised into the response. `withApi` forwards it to
warn-level logs, so `login failed: locked-out` is answerable by an operator
deciding whether an account is under attack — which is impossible from the body,
by design.

**Supersession.** Issuing a reset or verification link retires the outstanding
one in the same transaction that creates the replacement. A link mailed to an
address an attacker controls is therefore dead as soon as the owner asks for a
new one, rather than redeemable for the rest of its hour or day. Retired rows
are marked with `usedAt`, never deleted, so "this link was spent" stays
distinguishable from "this link never existed".

**One narrow non-uniformity, stated because it is one.** A spent verification
token is answered `200 { "alreadyVerified": true }` when the address it verified
is already verified, and 400 when it is not. Somebody holding a spent token
learns the verification state of the address that token belongs to. That is a
narrow answer about an address they have already proved they can read, and it
buys not telling a legitimate user — who clicked twice, or whose mail client
prefetched the link — that their account is broken.

---

## 10. File handling — deferred, with the rules already fixed

Not built in the MVP. The constraints are recorded now so Stage 10 does not
rediscover them:

- Direct S3-compatible object storage, private buckets, no public URLs
- Authorisation checked on every download, never a signed URL handed to a browser
  and forgotten
- Server-side type validation by content sniffing, not by the declared extension
- Server-generated names; the client filename is metadata, never a path
- Explicit size limits, enforced by the server
- Malware scanning before a file becomes readable
- Never logged as a path; stored by key only

---

## 11. Security review

Performed at Gate 1 and again at each subsequent gate, using the
`security-review` skill and the `security-expert` subagent.

**Automated, on every push:** cross-tenant isolation suite · full permission
matrix · Zod strict-mode regression · dependency audit · secret scanning ·
`npm audit` · Biome.

**Manual, at each gate:** authorisation review of every new endpoint · IDOR
enumeration · mass-assignment check · error message leakage · session fixation ·
rate-limit effectiveness · audit completeness.

**Definition of "secure" for a release:** no open high or critical finding, every
new endpoint covered by a permission test, and the cross-tenant suite green
against a seeded second organisation.

---

## 12. The auth endpoints as built

What the nine `/api/v1/auth` endpoints actually do, checked against
docs/API.md §3. Anything not implemented is named here rather than left to be
discovered.

**Implemented and tested.** Origin enforcement on every mutating route (§7) ·
per-request database connection · request id on every response and every log
line · errors mapped from a catalogue so a route cannot invent a status · `POST`
bodies read through one `readJson` that checks the content type and the size
limit · five request schemas as Zod `strictObject` · single-use verification and
reset tokens enforced by a conditional update, so concurrent redemption has one
winner · issuing supersedes, in the same transaction as the insert · password
reset revokes every session for the account and clears the failure counter and
lockout · a lost password is not a locked account · account lockout in the
database, so it is consistent across instances · identical login and
forgot-password responses for known and unknown addresses (§9) · bcrypt work
spent on every refused sign-in (§9) · `internal` reasons in the log and never in
the body.

**Not implemented. Named, not implied.**

| Gap | What is true today | What closes it |
|---|---|---|
| Rate limiting | No limit is enforced on login, registration, forgot-password or resend-verification. `RATELIMIT_DRIVER` is configured and the in-memory driver exists, but no auth route calls it. Lockout is the only brake, and it is per-account — so it does nothing against credential stuffing across accounts, and it is the wrong tool for `forgot-password` and `resend-verification`, which are aimed at one victim. | Task 1.30 |
| Audit events | No sign-in, sign-out, failed sign-in, password change or token redemption is recorded. `src/modules/audit` is tenant-scoped and none of these events has a tenant — a sign-in happens before any organisation exists. | Auth event log, before the first audit consumer |
| Email verification not enforced | Verification issues a token and `GET /auth/me` reports `emailVerified`, but nothing refuses an unverified account. The mailer in 1.32 is not built, so no token reaches anybody. The account is usable the moment it is created. | 1.32 for delivery; a policy decision for enforcement |
| Delivery of tokens | Registration and forgot-password issue a token, discard it, and mail nothing. `MAIL_DRIVER=console` is a placeholder. A token exists in the database and in no inbox. | 1.32 |
| No email change, no MFA, no recovery codes | — | Post-MVP, by product decision |

The first three are the ones that matter. A sign-in endpoint with no rate limit
and no audit trail is the realistic attack surface in this codebase, and both are
known and scheduled rather than overlooked.

---

## 13. Known accepted risks

Recorded rather than hidden.

| Risk | Severity | Status |
|---|---|---|
| In-memory rate limiting is per-instance on Vercel | Low (abuse), **high if relied upon as a boundary** | Accepted for MVP. Redis driver before handling payments. |
| No rate limit, no audit trail and no email delivery on the auth endpoints | Medium | Accepted for the MVP, **scheduled and named** — see §12. The lockout is a per-account brake only, so credential stuffing across accounts is currently unthrottled. |
| `ObjectId` is enumerable, so guessing is trivial | — | Not a vulnerability, because every guess is rejected by the tenant guard. This is precisely why the isolation tests exist. |
| Email enumeration via timing on login | Low | Mitigated: identical bodies on every refusal, and one real bcrypt spent on every refused path including locked and suspended. `bcryptjs` timing is machine-dependent, so this equalises the dominant term, not the whole request — see §9. |
| No MFA | Medium for privileged roles | Accepted. Post-Gate 1. |
| Single-region database, single point of failure | Availability | Accepted. Atlas backups and PITR. |
| Audit logs have no tamper-evidence | Low | Accepted; logs are append-only by application design, not by cryptographic proof. Revisit if compliance demands it. |
| Admin of an organisation can read its members' activity | By design | Stated in the product terms, not a bug. |
