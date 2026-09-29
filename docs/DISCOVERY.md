# Phase 0 — Discovery Report

> Status: complete. Phase 1 (MVP Foundation) is **not** started; it begins on approval.
> Date: 2026-09-29

---

## 1. Repository assessment

`biz-nexus` is an unmodified `create-next-app` scaffold. There is **no application
code, no database layer, no authentication, and no test infrastructure**. Nothing
built by a previous effort exists that could be preserved or removed.

### Current stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.3.7 |
| UI runtime | React | 19.2.8 |
| Compiler | React Compiler | 1.0.0 (enabled) |
| Bundler | Turbopack (default in v16) | — |
| Language | TypeScript (`strict: true`) | 5.x |
| Styling | Tailwind CSS v4 (`@theme` in CSS, no config file) | 4.x |
| Lint / format | Biome 2.4.2 | 2.4.2 |
| Tests | **none** | — |
| Database | **none connected** | — |

### Current file inventory

```
src/app/layout.tsx     root layout, Geist fonts, generic metadata
src/app/page.tsx       create-next-app splash screen
src/app/globals.css    Tailwind v4 import + two CSS variables
public/*.svg           default Next.js logo assets
biome.json             2-space indent, recommended + next/react rules
next.config.ts         reactCompiler: true
tsconfig.json          strict, "@/*" -> "./src/*"
```

### Conventions already established

- `@/*` path alias resolves to `./src/*`.
- Biome owns lint **and** format. There is no ESLint config — and that is correct
  for v16, since `next lint` was removed in Next 16.
- Tailwind v4 with no `tailwind.config.ts`; design tokens live in
  `src/app/globals.css` under `@theme inline`.
- `LayoutProps<"/">` is already used in the root layout, confirming the v16
  generated global route types are in use.
- `next-env.d.ts` is gitignored (correct, it is generated).

---

## 2. Next.js 16 breaking changes that affect this build

The repository `AGENTS.md` warns that this is not the Next.js in training data.
Verified against the bundled docs at `node_modules/next/dist/docs/`. The items
that will shape the implementation:

| Change | Impact on this project |
|---|---|
| `params` / `searchParams` are **Promises only**; synchronous access removed | Every dynamic page and route handler must `await props.params`. Use the generated `PageProps<'/route'>` / `RouteContext<'/route'>` global types. |
| `cookies()` / `headers()` are **async only** | The session data-access layer must be `async` throughout. |
| `middleware.ts` → **`proxy.ts`** | Optimistic auth redirects belong in `src/proxy.ts`, not `middleware.ts`. Runs on the Node runtime by default; must stay DB-free. |
| `revalidateTag(tag)` now requires a 2nd argument | Use `revalidateTag(tag, 'max')` or `updateTag(tag)`. |
| `next lint` removed | Biome is the linter. Add `tsc --noEmit` as the typecheck gate. |
| Turbopack is the default bundler | `next.config.ts` webpack settings would be ignored. |
| `forbidden()` / `unauthorized()` require `experimental.authInterrupts: true` | Enables real 401/403 responses from the server tree. |
| Server Actions are reachable **without** going through `proxy.ts` on matched paths | Authorization must be enforced **inside** every action and route handler, not only at the edge. |
| Layouts do not re-render on navigation and do not gate segments | Auth checks must live close to the data (Data Access Layer), not in `layout.tsx` alone. |

---

## 3. Environment findings

| Finding | Detail |
|---|---|
| MongoDB **running locally** on `127.0.0.1:27017`, version **8.0.26** | Ready for development. Existing databases: `meet`, `mongodbVSCodePlaygroundDB`, `mwenaro`, `smartduka`. We will use a new, separate database. |
| Docker available (29.7.2) | Not required for the MVP, since MongoDB is already up. |
| Node **v24.15.0**, npm **11.16.0** | Satisfies Next 16 requirements. |
| No `.env` file exists | `.env*` is gitignored, so `.env.example` must be committed explicitly. |
| No CI configuration | No `.github/`. To be added in Phase 1. |

### Sibling-project conventions

Five sibling projects under `~/sass` were inspected to avoid inventing a house
style. A consistent stack emerges:

```
next 16 · react 19 · typescript · tailwind v4 · biome 2.4.2
mongoose · zod · react-hook-form + @hookform/resolvers · sonner
lucide-react · class-variance-authority · clsx · tailwind-merge · next-themes
```

Typical layout in those projects: `src/app`, `src/components/{ui,layout,forms}`,
`src/lib/{api,models,validations}`, `src/types`. Auth was `next-auth`.

**Decision:** adopt the same dependency set for continuity, but restructure into
the domain-module layout required by this product (see `docs/ARCHITECTURE.md`).
Auth deliberately deviates — see ADR-0002.

---

## 4. Confirmed product decisions

These were put to the user and answered. They are now fixed for Phase 1.

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | Database | **MongoDB + Mongoose** | No migrations; schema versioning instead. Referential integrity must be re-implemented by hand. Local dev on the running MongoDB, Atlas in production. |
| 2 | Target market | **Generic B2B SME, no vertical** | No sector assumptions. Pipelines, roles, tags and custom fields must be configurable. |
| 3 | Tenancy model | **User in many organizations; organization-level isolation** | `Organization` + `Membership` + per-org `Role`. No branches or teams in the MVP. Schema keeps room for them. |
| 4 | Authentication | **Custom sessions, `jose` + httpOnly cookie** | No NextAuth dependency. Full control over revocation, expiry, and auditability. |
| 5 | Deployment | **Vercel** | Serverless constraints apply: no long-lived Node process. Connection pooling must be serverless-safe. Background jobs, email and file storage need external drivers. |

---

## 5. Technical debt

There is no pre-existing debt. The debt we would incur is the debt of *omission* —
the following foundation is absent and must be built before any feature:

| Missing foundation | Consequence if skipped |
|---|---|
| Database connection management | Connection storms on serverless; duplicated client instances across hot reloads. |
| Tenant scoping | Cross-tenant data leakage. The single highest-severity risk in this product. |
| Permission catalogue and guards | Authorization logic scattered across route handlers; impossible to audit or test. |
| Service layer | Business logic duplicated between Server Actions and route handlers; the two drift. |
| Error and response envelope | Inconsistent API contracts; client code branches on response shape. |
| List query / pagination / filter primitives | Nine incompatible filtering systems by Stage 9. |
| Test harness | No regression safety net, and no way to prove tenant isolation. |
| CI | Nothing runs on push. |

---

## 6. Skills audit

### Already available and sufficient

| Skill | Use in this project |
|---|---|
| `perfectcode-zen-plan` | Multi-agent planning consultation for each stage. |
| `perfectcode-zen-implement` | Parallel implementation with quality gates. |
| `perfectcode-zen-evaluation` | Post-stage review against the plan. |
| `frontend-design` | Design-system direction for the MVP UI. |
| `impeccable` | UI/UX review, empty/loading/error states, accessibility. |
| `conventional-git-commit` | **Mandatory** — all commits in this repo use Conventional Commits. |
| `interactive-questions` | Structured decision capture. |
| `agent-configuration` | Subagent/permission tuning. |
| `browser-screenshot` | Visual verification of the running app. |
| Subagents `test-engineer`, `security-expert`, `database-architect`, `ui-ux-designer`, `performance-engineer`, `devops-engineer` | Fill the specialist roles for each gate. |

### Gaps found and closed

Five skills were missing for capabilities this project depends on. All were
installed globally to `~/.agents/skills/` from first-party or established sources:

| Installed skill | Source | Installs | Gap it closes |
|---|---|---|---|
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | 752.6K | React 19 / Next 16 rendering, data-fetching and bundle performance |
| `tdd` | `mattpocock/skills` | 981.1K | Test-first workflow for services and authorization |
| `security-review` | `getsentry/skills` | 17.1K | Systematic vulnerability review (OWASP-class) |
| `mongodb-query-optimizer` | `mongodb/agent-skills` (first-party) | 5.8K | Index design and query shape for the org-scoped access patterns |
| `mongodb-connection` | `mongodb/agent-skills` (first-party) | 4.6K | Serverless-safe pooling and caching for Vercel |

> The installer reported `PromptScript does not support global skill installation`
> for each. That refers to the PromptScript agent adapter, not to the skills
> themselves; the files are present and were verified readable.

### Deliberately not installed

`supabase`, `prisma-compute`, `clerk-nextjs-patterns` — wrong database or wrong
auth provider for this project. `anthropics/skills@webapp-testing` overlaps
heavily with the Playwright plan; Playwright is the better fit for an
authorization-critical e2e suite.

---

## 7. Resulting architectural posture

Summarised here; expanded in the documents that follow.

```
Repository    greenfield — nothing to preserve, nothing to remove
Database      MongoDB 8 + Mongoose 9, Atlas in production
Tenancy       organizationId on every tenant document, enforced in the
              repository layer, never in the client
Auth          DB-backed session, opaque hashed token, httpOnly SameSite cookie
Authorization per-organization Role documents over a code-level permission
              catalogue, enforced by guards in the Data Access Layer
Application   domain modules under src/modules, shared infrastructure under
              src/shared, thin HTTP adapters in route handlers and actions
Testing       Vitest + mongodb-memory-server, Playwright for the critical flow
Hosting       Vercel; no long-lived process; no in-process durability assumed
```

---

## 8. Open questions deferred to a later gate

These are recorded now and will be asked at the stated point. None of them block
Phase 1.

| # | Question | Needed by |
|---|---|---|
| A | Transactional email provider for password reset (Resend vs Postmark vs SES). Default in code: a `console` driver in development. | Phase 1, before password reset ships |
| B | Multi-currency rules and tax jurisdictions for the Finance domain. | Gate 2, before Stage 3 |
| C | Cash vs accrual accounting, and whether full bookkeeping is ever in scope. | Gate 2, before Stage 3 |
| D | Public API-key authentication for third-party integrations. | Stage 11 |
| E | Object storage provider for Stage 10 documents. | Stage 10 |
| F | Background job / queue provider for the Stage 7 automation engine under Vercel. | Stage 7 |
| G | MFA / SSO for enterprise customers. | Post-Gate 1 |
