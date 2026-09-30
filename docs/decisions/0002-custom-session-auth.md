# ADR-0002 — Custom database-backed sessions

- **Status:** accepted
- **Date:** 2026-09-29
- **Deciders:** project owner, lead architect
- **Affects:** identity module, Data Access Layer, every authenticated route

## Context

The product holds customer contact data across organisational boundaries. The
security requirement is that a session can be ended, individually or globally,
and that ending it takes effect immediately. Password reset must also invalidate
every existing session for that user.

Deployment is Vercel. The application is a set of stateless functions, so
session state must live in the database or be cryptographically self-contained.

## Options considered

**Auth.js (NextAuth)** — matches two sibling projects, and social login would
be fast later. Against it: a framework dependency whose Next 16 compatibility
must be tracked, an opinionated extension model for something the product needs
full control of, and an authorisation story that would have to be bolted on
anyway because Auth.js does not model organisations and roles.

**Better Auth** — modern, first-class multi-tenant organisation plugin, closer to
what this product needs. Against it: newer ecosystem, and a plugin that models
organisations would still not model a per-organisation custom permission set,
which is the core of this product's access model.

**Self-contained JWT signed with `jose`** — stateless, fast, and the pattern
Next.js's own documentation demonstrates. The disqualifying property: a JWT
cannot be revoked before it expires. "Log out", "sign out everywhere", and
"suspend this user" would all become advisory.

**Opaque token, hashed in the database** — the token is 32 random bytes; the
database stores only its SHA-256 hash. Lookup is by hash, so there is no string
comparison and therefore no timing attack to mount. Revocation is a timestamp.

## Decision

**Opaque random token, SHA-256 hashed at rest, delivered in an httpOnly cookie.**

| Property | Value |
|---|---|
| Token | 32 bytes from `crypto.getRandomValues`, base64url |
| Stored | SHA-256 hex digest |
| Lookup | By hash |
| Cookie | `bn_session`, `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/` |
| Expiry | 30 days, sliding on use |
| Revocation | `revokedAt` timestamp, so revocation is auditable |
| Rotation | New token on login and on any privilege change |
| Cleanup | TTL index on `expiresAt` |

`jose` is retained in the dependency set for signing short-lived tokens where a
stateless artefact is genuinely the right shape — email verification and
password reset links, which are single-use and self-expiring by nature.

## Rationale

Revocability is not a nicety for a system holding customer contact data. A
stateless session means a user who suspects compromise cannot actually log the
attacker out. A database-backed session costs one indexed read per authenticated
request — the smallest possible price for the ability to end access instantly,
and for "sign out everywhere" to mean what it says.

Opaque tokens rather than JWTs for the session also means a database disclosure
does not yield usable credentials. A leaked JWT is a working credential for its
whole lifetime. A leaked hash is not.

## Trade-offs accepted

| Consequence | Mitigation |
|---|---|
| One database read per authenticated request | The read is a single indexed lookup on a unique field, and the result is memoised per request in the Data Access Layer |
| Sessions do not work if the database is down | Correct. The alternative is serving authenticated requests from a cache that may be stale — strictly worse |
| Cookie-based auth is CSRF-exposed | `SameSite=Lax` plus an `Origin` check on mutating route handlers, enforced centrally in `withApi` against `env.APP_URL` and failing closed. See `SECURITY.md` §7 |
| No built-in OAuth | Not required in the MVP. Adding a provider later means a new `POST /auth/oauth/:provider` that creates a user and a session, using the same primitives |

## The boundary that matters

`proxy.ts` reads the cookie and redirects. It never queries the database — it
runs on every route and every prefetch, and a database call there would multiply
connection pressure for a check the Data Access Layer performs properly anyway.

The proxy is a user-experience redirect. The Data Access Layer is the security
control. Every Server Action and route handler calls the DAL regardless of what
the proxy did, because a Server Action on a path matched by the proxy is
reachable without it.

## Revisit when

Enterprise SSO or SCIM enters scope. Those are authorisation to *establish*
identity and belong at the identity-provider boundary; the session mechanism
below them stays as it is.
