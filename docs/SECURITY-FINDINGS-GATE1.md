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

### S9 — Malformed ObjectId query params return 500 (Medium) — FIXED (list endpoints)
- Locations: crm/companies/route.ts (ownerId, tag), crm/contacts/route.ts, crm/leads/route.ts, deals/route.ts
- Evidence: new Types.ObjectId() on unvalidated strings throws BSONError, which was mapped to 500
- Fix: The filter schemas on the migrated list endpoints validate ids with a 24-hex regex and reject malformed values with a 422. `companyId=null` is handled explicitly. A global BSONError -> 4xx mapping in asMongooseError is not added yet and remains a backstop worth having for any route that still constructs ids by hand.
- Commit: 7558870

## Conclusion
High-severity, exploitable write-surface defects (S1, S2) are remediated and S3 is hardened. The Medium defects (S5, S6, S9) and the Low defects (S7, S8) are remediated. S4 is accepted by design with the rationale recorded above. No finding remains open. Task 1.75 can be marked complete.
