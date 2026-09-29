# Documentation

Every architectural or product decision in this repository is recorded here.
Code answers "how"; these documents answer "why", and "what comes next".

## Start here

| Document | Read it when you need to know |
|---|---|
| [DISCOVERY.md](./DISCOVERY.md) | What existed before, what was decided, what the environment looks like, which skills are installed |
| [PRODUCT.md](./PRODUCT.md) | What the product is, who it is for, what is in the MVP, and what is deliberately out |
| [PLAN.md](./PLAN.md) | **The master implementation plan.** Every task, in order, one commit each |
| [ROADMAP.md](./ROADMAP.md) | The fourteen stages, the seven gates, and the sequencing rationale |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Directory layout, request lifecycle, tenancy enforcement, error envelopes, event bus |
| [DATABASE.md](./DATABASE.md) | Every collection, every field, every index and the query it serves |
| [SECURITY.md](./SECURITY.md) | Threat model, the request checklist, session design, isolation, known accepted risks |
| [API.md](./API.md) | The v1 REST contract, error codes, query parameters, rate limits |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to write code, commit, and open a pull request in this repository |

## Architecture decisions

Each ADR records the context, the options considered, the decision, the reason,
and the trade-offs accepted. A new significant decision gets a new file; the
existing ones are never rewritten.

| ADR | Decision |
|---|---|
| [0001](./decisions/0001-mongodb-and-mongoose.md) | MongoDB and Mongoose as the datastore |
| [0002](./decisions/0002-custom-session-auth.md) | Custom database-backed sessions rather than JWTs or a framework |
| [0003](./decisions/0003-tenant-scoped-repositories.md) | Tenant scoping lives in the repository, not in the caller |
| [0004](./decisions/0004-per-organization-roles.md) | Per-organisation role documents over a code-level permission catalogue |
| [0005](./decisions/0005-service-layer-and-adapters.md) | Services hold the logic; route handlers and Server Actions are thin adapters |

## Where the roadmap lives

`ROADMAP.md` is the document referenced by the project brief. It carries the
fourteen stages, the seven gates, and the sequencing rationale. `PLAN.md` is its
execution counterpart: the task-by-task breakdown of the current stage, where
each task is one commit. The two answer different questions — "what order, and
why" versus "what exactly, next".

## Conventions

- Documentation is written in the same commit as the change it describes. A
  change that alters the data model updates `DATABASE.md` in the same commit.
- If the code and the documentation disagree, that is a bug in one of them, and
  it is a review rejection.
- Anything written here that is not true is worse than nothing written here.
