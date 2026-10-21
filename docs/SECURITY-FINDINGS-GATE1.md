# Security Findings — Gate 1

Gate: 1 (MVP)
Date: 2026-10-04
Methodology: Three-parallel security review (auth/session/crypto; authorization/tenant isolation; input validation/data exposure) against docs/SECURITY.md.

## Summary
- Total findings: 9 (3 High, 4 Medium, 2 Low)
- High findings: 3 — S1–S3 remediated (S2/S3 were latent, non-exploitable gaps)
- Medium findings: 4 — S5, S6, S9 remediated; S4 accepted by design
- Low findings: 2 — S7, S8 remediated
- No open High or Critical finding; no open Medium or Low finding.

This document is the artifact for task 1.75.

## Findings and Remediation

### S1 — Unbounded request body buffering (High) — FIXED
- Location: src/shared/api/with-api.ts (readJson), all mutating routes
- Evidence: readJson used request.text() with no size limit; 20 routes called request.json() directly
- Fix: Added streaming body cap (256KB) enforced against Content-Length and received bytes; PAYLOAD_TOO_LARGE (413); migrated all direct request.json() calls to readJson
- Commit: 7b7064e

### S2 — Cross-tenant write on lead conversion (High) — FIXED
- Location: src/modules/crm/lead.service.ts:~443
- Evidence: ContactModel.updateOne used contactId from lead without organizationId filter.
- Verification: `contactId` is validated at write time through the tenant-scoped `contactRepo.findById` when the lead is created/updated, so the raw call was a latent cross-tenant write rather than a live one. It is still a defence-in-depth defect because the filter itself carried no tenant scope.
- Fix: Use ContactRepository.updateOne (tenant-scoped; scope applied in constructor)
- Commit: 9a1d844

### S3 — Lead conversion accepts unvalidated pipeline/stage (High) — FIXED
- Location: src/modules/crm/lead.service.ts:~398
- Evidence: Conversion created a deal without checking the stage belongs to the pipeline in this tenant, unlike POST /deals.
- Fix: Validate via PipelineRepository.getStage; wire PipelineRepository into LeadService
- Commit: 9a1d844

### S4 — Invitation token not bound to invited email (Medium) — ACCEPTED RISK (by design)
- Location: src/modules/organizations/invitation.service.ts:292-441
- Evidence: acceptInvitation verifies token, expiry, role, and user, but does not compare invitation.email to the accepting account's email.
- Analysis: The invitation token is the bearer credential; the flow must work for an invitee who has no account yet and registers after following the link, so the stored email cannot be a precondition for acceptance without breaking that journey. Requiring the match also contradicts the API contract asserted by tests/integration/org/invitation-api.test.ts, which accepts an invited token for the session that holds it. The attempted fix was reverted (it failed those tests).
- Disposition: Accepted by design. The residual risk — a leaked token can be redeemed by whoever holds it — is inherent to any bearer invite link and is bounded by token expiry and single use.

### S5 — Unallow-listed sort and uncapped pagination on CRM/deals lists (Medium) — FIXED
- Locations: companies/route.ts, contacts/route.ts, leads/route.ts, deals/route.ts
- Evidence: sort was an arbitrary string handed to parseSort and then to Mongo; page/pageSize lacked caps in places.
- Fix: Migrated all four lists to the shared listQuery() with explicit sortable allow-lists and MAX_PAGE/MAX_PAGE_SIZE, plus validated (regex) ObjectId filters and a bound/escaped search term.
- Commit: 7558870

### S6 — POST /activities accepts arbitrary entityId (Medium) — FIXED
- Location: src/app/api/v1/activities/route.ts
- Evidence: entityId not validated against a tenant-owned entity; entityType was any non-empty string.
- Fix: entityType is a closed set (contact, company, lead, deal, task) and the id is resolved through the matching tenant-scoped repository (or the task lookup) before the activity is written.
- Commit: 6820232

### S7 — Saved-view read lacks ownership check (Low) — FIXED
- Location: src/modules/crm/saved-view.service.ts:201
- Evidence: getById returned any view in the organisation; update/delete already checked owner-or-shared.
- Fix: getById takes the reader and applies the same owner-or-shared predicate; a private view owned by somebody else is a 403.
- Commit: 6758d60

### S8 — notifications/stream permission gate mismatch (Low) — FIXED
- Location: src/app/api/v1/notifications/stream/route.ts:18
- Evidence: used requireOrg(), which only proves an active membership, while docs/API.md and every sibling route specify notifications.read.
- Fix: requirePermission("notifications.read"). Only the refusal path is covered by a test, because a permitted request opens a change stream and never ends.
- Commit: 617952b

### S9 — Malformed ObjectId query params return 500 (Medium) — FIXED
- Locations: crm/companies/route.ts (ownerId, tag), crm/contacts/route.ts, crm/leads/route.ts, deals/route.ts, and later crm/contacts/[id]/route.ts (companyId, ownerId, tags)
- Evidence: new Types.ObjectId() on unvalidated strings throws BSONError, which was mapped to 500
- Fix, in three parts. The filter schemas on the migrated list endpoints validate ids with a 24-hex regex and reject malformed values with a 422, and `companyId=null` is handled explicitly. The contact update endpoint was then found to be the route that "constructs ids by hand" its own write-up warned about: `companyId`, `ownerId` and `tags` were plain strings, so `{"ownerId": "garbage"}` was a 500 for a caller's typo. Those three fields now carry the same regex. Finally the backstop is in place — `asMongooseError` maps a `BSONError` to `VALIDATION_FAILED`, so any route that constructs an id from unvalidated input is covered without having been audited. `BSONVersionError` is excluded from that arm, since a driver that cannot speak to its server is a deployment fault and must stay a 500.
- Commits: 7558870 (list endpoints), 27dc3ba / see git log (contact update + global backstop)
- Tests: `tests/unit/shared/errors.test.ts` covers the mapping, the exclusion, the absence of a field detail, and that the rejected value stays out of the response; `tests/integration/crm/contact-api.test.ts` covers the endpoint.

## Conclusion
High-severity, exploitable write-surface defects (S1, S2) are remediated and S3 is hardened. The Medium defects (S5, S6, S9) and the Low defects (S7, S8) are remediated. S4 is accepted by design with the rationale recorded above. No finding remains open. Task 1.75 can be marked complete.

---

# Delta review — organisation settings and membership endpoints

Date: 2026-10-19
Scope: the endpoints and screens added after the review above —
`GET/PATCH /organizations/current`, `GET/PATCH/DELETE
/organizations/current/members[/:id]`, `POST /organizations/current/leave`
(commits `d0a3146`, `3498d87`, `18fda46`), plus the settings and member screens
and `MemberSelect`. Method: read-through of the route, service and guard layers
against `docs/SECURITY.md`, with the isolation suite
(`tests/integration/security/cross-tenant-404-sweep.test.ts`) and the route
permission sweep (`tests/unit/architecture/route-permissions.test.ts`) as the
executable evidence.

Rationale for a delta rather than a second full review: the surface is four
routes over services that already existed, and the questions it raises —
privilege escalation through the role field, tenant scope on a named id,
last-owner lockout — are enumerable rather than open-ended.

## Summary
- Total findings: 5 (0 High, 0 Critical, 1 Medium, 4 Low)
- The Medium finding is accepted with a mitigation recorded below.
- No open High or Critical finding on the new surface.

### What was checked and found sound
- **Tenant scope on a named id.** Every member route resolves `:id` through the
  session's organisation (`_id` + `organizationId` in the same filter), and
  `MEMBERSHIP_NOT_FOUND` is collapsed to the canonical 404 at the route, so a
  foreign id and an absent id are indistinguishable. Covered by the cross-tenant
  sweep for PATCH and DELETE.
- **Privilege escalation through `roleKey`.** `assertAssignableRole` refuses
  `OWNER` (`422`), and the role id is resolved from the session's organisation,
  so a key can only name this tenant's role. A caller without `users.update`
  cannot reach the handler at all.
- **Mass assignment.** `PATCH /organizations/current` is a `strictObject` over
  five fields and `$set`s from an allow-list; `slug`, `isActive`, `settings` and
  the audit fields are not reachable from a body. Unknown keys are a 422.
- **Last-owner lockout.** Suspend, remove and leave all refuse when the
  membership being acted on is the only active owner (`409 OWNER_REQUIRED`), so
  the organisation cannot be left with nobody who can delete or transfer it.
- **Malformed ids.** `isObjectIdOrHexString` at the edge (not
  `ObjectId.isValid`, which accepts any twelve characters), with `BSONError`
  mapped to `VALIDATION_FAILED` (S9) as the backstop.
- **Self-service "leave" cannot be aimed.** The membership is found from the
  caller's own id; no id is accepted from the request.

### D1 — Membership privilege changes are not written to the audit log (Medium)
- Location: `src/modules/organizations/membership.service.ts` (`changeMemberRole`,
  `setMembershipStatus`, `removeMember`, `leaveOrganization`)
- Evidence: each function sets `updatedBy` on the membership row and writes no
  `AuditLog` row, so the audit screen cannot answer "who made this person an
  ADMIN". `PATCH /organizations/current` is audited (`settings.update`); the
  privilege change next to it is not.
- Why it matters: the audit log exists so that a change to the authorization
  boundary is attributable. A role change is the most security-relevant
  membership event there is.
- Mitigation, and why this is accepted rather than fixed in Gate 1: the change
  *is* attributable — every mutation writes `updatedBy` (and `updatedAt`) on the
  membership itself, so "who did this" is answerable from the row; what is
  missing is the historical before/after and the single filtered view. Neither
  `docs/PLAN.md` 1.37 nor 1.38 asks for membership auditing, and the two services
  predate the endpoints and had no audit calls when they were written.
- Follow-up (not a Gate 1 condition): emit a `membership.role_changed` /
  `membership.status_changed` event and record it, which is also the natural fix
  for `membership.joined` — declared in `organization.events.ts` and never
  emitted or subscribed (the event drift recorded in `ARCHITECTURE.md` §7).

### D2 — Last-owner guard is read-then-write, not atomic (Low)
- Location: `membership.service.ts` (`ownersRemaining` then `findOneAndUpdate`)
- Evidence: the count and the write are separate operations. Two concurrent
  requests acting on two different owners could each observe one remaining owner
  and both proceed.
- Why it is Low and not reachable today: `assertAssignableRole` refuses to grant
  `OWNER` and ownership transfer is its own operation, so an organisation has a
  single owner; the race needs two, which the current model does not produce.
- Disposition: accepted. If transfer gains a concurrent path, the guard and the
  write belong in one transaction or behind a conditional update.

### D3 — `users.update` can demote or suspend a peer administrator (Low, by design)
- Location: RBAC — `ADMIN` holds every permission except `organization.delete`,
  `organization.transferOwnership` and `organization.settings`.
- Evidence: an ADMIN may change another ADMIN's role or status. Recorded because
  it is a decision: "administrator" is the administrative tier, and a tier whose
  members cannot correct each other is not an administrative tier. What is
  withheld — deleting the organisation, transferring ownership, changing
  organisation settings — stays withheld.
- Disposition: accepted by design.

### D4 — The member directory returns every member's name and email to any member (Low, by design)
- Location: `GET /organizations/current/members`, permission `users.read`
- Evidence: `users.read` is in the VIEWER base set, so MEMBER and VIEWER receive
  the full directory with addresses.
- Analysis: this is the audience the product already shows members to, and the
  data the assignee picker needs. Nothing secret is returned — no password
  material, no session or invitation tokens, no other tenant's rows. The
  permission is also what an administrator-controls-the-directory design would
  have to widen to keep pickers working for ordinary members.
- Disposition: accepted by design.

### D5 — `GET .../members` is unpaginated (Low)
- Location: `members/route.ts` → `listMembersWithUsers`
- Evidence: the whole directory is returned in one response, with no
  `page`/`pageSize` and no cap, unlike the list endpoints migrated under S5.
- Analysis: the response is tenant-scoped and permission-gated, so this is a
  cost and response-size issue rather than a disclosure. It is the shape the
  pickers and the member screen want, and a directory large enough for it to
  matter is a scale problem the product does not have yet.
- Disposition: accepted, with a note that the S5 treatment (allow-listed sort,
  capped page size) is the fix when a tenant is large enough to need it.

## Conclusion
No High or Critical finding on the new surface. Three properties that would have
been High had they been missing are present and tested: the tenant scope on a
named id, the refusal to assign `OWNER`, and the last-owner lockout. D1 is the
one Medium, accepted with its mitigation and follow-up recorded; D2–D5 are Low
and accepted. Gate 1's "no open High or Critical finding" condition holds for
this delta.

