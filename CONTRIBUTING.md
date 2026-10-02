# Contributing

## Before you write code

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/SECURITY.md`](./docs/SECURITY.md). They are short, and they explain why
the code is shaped the way it is. Most "why is it done this weird way" questions
have an answer in there.

The rule that matters most: **the organisation boundary is absolute.** A bug
there is a security incident, not a defect.

## Local setup

```bash
npm install
cp .env.example .env.local        # fill in SESSION_SECRET
npm run dev
```

The application needs a MongoDB instance. One is already running locally at
`127.0.0.1:27017`. Transactions require a replica set:

```bash
mongod --replSet rs0 --dbpath .mongo-data
mongosh --eval "rs.initiate()"
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | Biome — lint and format check |
| `npm run lint:fix` | Biome — apply fixes |
| `npm run format` | Biome — format only |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm run validate` | Lint, typecheck, and tests. **Run before every commit.** |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run verify:ui` | Computed-style and contrast checks against a running server |

### `npm run verify:ui`

Type checking, linting, and unit tests all passed while three separate visual
bugs were live: unstyled form controls, a dark mode that inverted into
near-white surfaces, and a `dark:` variant that had never once applied because
`:where()` gave it zero specificity. None of them can be reached by any tool
that only reads source.

So the design system gets a check that reads the browser's computed styles. It
asserts the things that are invisible in a diff — that a control is not
transparent, that its height matches the button beside it, that the ink ramp
inverts rather than turning a dark card white, and that text meets WCAG AA in
both themes.

It needs a built app and a browser, so it sits outside `validate`:

```bash
npm run build
npm run start &
google-chrome --headless --remote-debugging-port=9222 about:blank &
npm run verify:ui
```

Run it after touching anything under `src/components/ui` or the tokens in
`globals.css`.

`npm run validate` is the gate. Nothing is committed while it is red.

A `pre-commit` hook enforces it. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

The hook runs `npm run validate` and refuses the commit on failure, so the rule
holds even under deadline. Documentation-only changes skip it, because lint and
typecheck have nothing to say about prose.

## Code conventions

**Formatting and linting** are owned entirely by Biome. There is no ESLint
config and there will not be one — `next lint` was removed in Next 16. Do not
add one.

**Aliases.** `@/` maps to `src/`. Use it; do not write `../../..`.

**Types.** `strict` is on and stays on. No `any`. No non-null assertions without
a comment explaining the invariant that makes them safe. Prefer a type guard to
a cast.

**Naming.** Modules own their types. A type is not shared because two things
happen to have the same shape — duplication is cheaper than a premature
abstraction that binds two domains together.

**Comments.** Comments explain *why*, never *what*. If a comment restates the
line below it, delete it. If a decision was not obvious, it probably belongs in
an ADR.

## Architecture rules

These are not style preferences. A change that violates one is a review
rejection.

### 1. Business logic lives in services

`route.ts` files and Server Actions are adapters: they parse input, run guards,
call a service, format a response. They contain no business rules. If logic
appears in both, it is being implemented twice and one copy is already wrong.

### 2. Modules import through `index.ts`

```ts
import { contactService } from "@/modules/crm/contacts";   // correct
import { contactRepository } from "@/modules/crm/contacts/contact.repository";  // wrong
```

Cross-module writes happen in the owning module's service, or in an explicit
orchestration service. Never reach into another module's internals.

### 3. Never query a Mongoose model directly

Go through the module's repository. A repository is tenant-scoped by
construction — that is the whole point of [ADR-0003](./docs/decisions/0003-tenant-scoped-repositories.md).
`Model.find` outside a repository is a review finding.

### 4. Every mutation is authorised

```ts
await requireSession();
const org = await requireOrganization(session);
await requirePermission(org, "deals.update");
```

All three, every time, including in Server Actions. A Server Action is a public
HTTP endpoint that happens to be referenced by a button.

### 5. The organisation comes from the session

There is no request parameter, body field, or query string named
`organizationId` that the server honours. Zod schemas are `.strict()`, so a
body containing one is rejected rather than silently stripped — if you need to
accept it deliberately, that is a bug.

### 6. Validate at the boundary, map to the domain inside

Zod at the edge, plain typed objects in the service. A service never imports a
Zod schema or a `Request`.

### 7. Errors are typed

Throw `AppError` with a stable `code` and a safe message. Never return an error
shape from a service. Never let a driver error or a stack trace reach a client.

### 8. Index what you query

A new query and its index land in the same commit. Use `explain()` rather than
guessing. See [ADR-0001](./docs/decisions/0001-mongodb-and-mongoose.md).

### 9. Enums are open

Clients must render an unrecognised enum value as a neutral fallback. Adding a
value to an enum must not break an older client.

### 10. No `dangerouslySetInnerHTML` on user content

Activity bodies, notes and field values are plain text. If rich text is ever
needed it is sanitised at write time.

## Testing

| Layer | What belongs there |
|---|---|
| Unit | Business logic in services, guards, validators, formatters. No database. |
| Integration | Repositories and services against a real in-memory MongoDB. Real queries, real indexes. |
| API contract | Every route handler: status code, envelope, validation errors. |
| Authorization | **Every endpoint, every permission.** Plus the cross-tenant matrix. |
| e2e | The critical business flow, and the isolation flow. |
| Component | **Not established yet.** `src/components/**` is at 0% and excluded from the coverage gate. See [the open item in PLAN.md](./docs/PLAN.md#open-components-have-no-unit-coverage). |

**A feature without tests is not finished.** A feature without an authorization
test, when it has a permission, is not finished either.

**The cross-tenant suite is not optional.** It exists to answer one question
continuously: *can organisation A reach organisation B?* The expected answer is
always no — including when the caller is Owner of both organisations.

## Definition of done

A feature is complete when all of these ship together:

```
UI  +  API  +  Database  +  Validation  +  Authorization
   +  Error handling  +  Loading state  +  Empty state
   +  Tests  +  Documentation
```

A page that renders is not a feature. A page that exists, is protected, is
tested, is documented, has an empty state, and cannot leak another tenant's data
is a feature.

## Commits

**Every commit must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/).**
No exceptions.

```
<type>[optional scope]: <description>
```

| Type | Use for |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Neither a fix nor a feature |
| `perf` | Performance |
| `test` | Adding or correcting tests |
| `build` | Build system, dependencies |
| `ci` | CI configuration |
| `chore` | Maintenance and tooling |
| `style` | Formatting only |

Scopes in this repository: `auth`, `org`, `rbac`, `db`, `crm`, `pipelines`,
`activities`, `tasks`, `notify`, `audit`, `api`, `ui`, `test`, `docs`, `ci`,
`chore`, `deps`.

One commit, one logical change. Never mix a refactor with a feature. The subject
line is imperative mood, under 72 characters, no trailing period. The body
explains *why*, not *what*.

```
feat(crm): add contacts module

fix(crm): scope contact queries to active organization
test(auth): prove cross tenant isolation fails
docs: record next 16 breaking changes
```

## Pull requests

- `npm run validate` passes.
- Tests pass.
- New endpoints have permission tests.
- Data model changes update `docs/DATABASE.md` in the same PR.
- Architectural changes come with a new ADR in `docs/decisions/`.
- The PR description states what was verified, not just what was written.

## Definition of done for a stage

A stage is not done when the code compiles. It is done when its gate criteria
in [`docs/ROADMAP.md`](./docs/ROADMAP.md) are satisfied, the security review
reports nothing open at high or critical, and CI is green on a clean checkout.
