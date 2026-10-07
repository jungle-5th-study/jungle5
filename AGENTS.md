# AGENTS.md

Instructions for AI coding agents working in this repository. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

jungle5 (정글5) is a members-only study and knowledge-sharing site for a Discord community, live at https://jungle5.xyz.
One Cloudflare Worker serves a Hono JSON API and a React SPA; data is in D1 (SQLite) via Drizzle ORM. Login is Discord OAuth only.
Every merge to `main` deploys to production automatically (including remote D1 migrations), so every change must be safe to ship on its own.

## Repo map

```text
src/worker/    Hono app: index.ts (entry), app.ts (middleware, security headers), auth/, routes/,
               policies.ts (all authorization), db/schema.ts (Drizzle schema), lib/
               discord/ (interactions endpoint + message command, TD-27)
src/html-worker/  second Worker `jungle5-html` (wrangler.html.jsonc): serves uploaded HTML on an isolated origin (TD-26)
src/shared/    zod schemas, API types, error codes, constants, ids.ts (UUIDv7), time.ts (KST helpers); shared with the SPA
src/web/       React SPA: main.tsx, router.tsx, pages/, components/, lib/; tests live next to code (*.test.tsx, jsdom)
migrations/    SQL migrations applied by wrangler (0000_init.sql has a hand-added seed row; 0001 is hand-written)
tests/         unit/ (policy tables), api/ (integration: real workerd + local D1), migration tests, helpers.ts
docs/          prd.md (product decisions D-xx), tsd.md (technical decisions TD-xx), ui.md (UI decisions UD-xx), operations.md
scripts/       ops scripts (build-d1-restore.py turns a D1 export into importable restore SQL; test-d1-restore.py round-trips it through local D1)
```

## Commands

```sh
pnpm install
cp .dev.vars.example .dev.vars   # keep ENV=test; set TOKEN_ENC_KEY from `openssl rand -base64 32`
pnpm db:migrate:local            # local D1 only
pnpm dev                         # http://localhost:8787 (test login form on the login page)
pnpm dev:html                    # isolated HTML worker on http://localhost:8788 (second terminal; needs HTML_* in .dev.vars)
pnpm typecheck                   # three tsc projects: worker/tests, web, node configs
pnpm lint
pnpm test                        # vitest projects "worker" (workerd + local D1) and "web" (jsdom)
pnpm build
pnpm db:generate                 # drizzle-kit migration from src/worker/db/schema.ts — review the SQL (see pitfalls)
pnpm exec wrangler deploy --dry-run   # after pnpm build; checks the bundle without deploying
```

## Read before changing

1. `docs/prd.md` §2.2 decisions table (D-xx) and §5.4 permission table — what the product must do.
2. `docs/tsd.md` §3 TD table and **§3.2 implementation notes** — how it is built and why; §6 auth, §7 API rules, §10 tests.
3. `docs/ui.md` §2 (UD-xx) and §3 tokens — for any UI work.

If code and docs disagree, ask or follow the docs; do not silently "fix" a decision. If your change alters a decision, add a new D/TD/UD row in the same PR (strike through superseded rows, do not delete them).

## Hard rules and known pitfalls

- **Authorization only in `src/worker/policies.ts`.** Routes call these pure functions; never inline permission checks in routes or rely on the UI hiding things. Update the table-driven tests in `tests/unit/policies.test.ts` when policies change. The SPA uses the `permissions` objects returned by the API and does not recompute policies.
- **Drizzle `db.batch()` only for writes.** Joined reads in a batch break because same-named columns collide. Run joined reads with `Promise.all` instead. Multiple writes that must be atomic go in one `db.batch()`.
- **At most 10 D1 queries per request** (TSD 7.2; Free limit is 50). Count them, including the session lookup and the 24h Discord re-check in middleware.
- **D1 enforces foreign keys, and `DROP TABLE` cascades.** Migrations run in a transaction, so `PRAGMA foreign_keys=OFF` is a no-op; `DROP TABLE` runs an implicit DELETE that fires child `ON DELETE CASCADE`/`SET NULL` (`defer_foreign_keys` does not stop it), and `ALTER TABLE RENAME` rewrites child FKs. Never apply drizzle-kit's generated table-rebuild SQL (`__new_x` + DROP + RENAME) as-is. See the header of `migrations/0001_cleanup_kinds_managers.sql` and `tests/migrations.test.ts`.
- **Migrations are additive-only** (TSD 9.2): add tables/columns. Dropping or renaming a column takes two deploys (stop using it, then drop). Never edit a migration that is already on `main`. Add a migration test for anything non-trivial.
- **Client-generated UUIDv7 ids for creates** (TD-13, `src/shared/ids.ts`). Same id + same author → 200 with the existing row (idempotent replay); same id from someone else → 409 `DUPLICATE`.
- **Optimistic concurrency with version columns** (TD-14). `UPDATE … WHERE id=? AND version=?`; 0 rows → 409 `VERSION_CONFLICT` with `latest`. Rounds have separate `infoVersion` and `notesVersion`. Posts have no version (author-only, last write wins).
- **CSP: `script-src 'self'; style-src 'self'`** (TSD 9.5). No inline `<script>`, no inline styles, no React `style={}` props, no external CDNs (fonts are self-hosted). Use Tailwind classes and the semantic tokens in `src/web/styles.css`.
- **Markdown is rendered client-side only** with react-markdown + remark-gfm + rehype-sanitize (TD-12). The server stores raw Markdown. Never use `dangerouslySetInnerHTML`; links are http/https only.
- **Test login exists only when `ENV=test`** (`POST /auth/test-login`, TSD 9.1). Never register it or the dev login form in production code paths.
- **Times:** store UTC epoch ms; display in KST (`src/shared/time.ts`, `src/web/lib/kst.ts`). KST has no DST.
- **Mutations need CSRF headers:** `Origin` must equal `APP_ORIGIN` and `Content-Type: application/json` (also for body-less DELETE). The one exception is the file upload `PUT /api/posts/:id/html`, which needs `Content-Type: text/html` or `application/gzip` instead (TD-25; the SPA sends gzip, which the server stores without decompressing).
- **Errors** use `{ error: { code, message } }` with the codes in `src/shared/errors.ts` and TSD §7. Hidden content returns 404, not 403.
- **UI copy is Korean**, short and plain, matching existing screens. Code comments and identifiers are English.

## Definition of done

- `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass.
- Every new or changed endpoint has at least one permission-denied test in `tests/api/` (TSD 10), plus normal and validation cases.
- New request paths stay within 10 D1 queries.
- If behavior or a decision changed, the matching D/TD/UD row (and any affected doc section) is updated in the same PR.
- PR description says what changed, why, and how it was tested (`.github/pull_request_template.md`).

## Don'ts

- No `--remote` wrangler commands (`d1 migrations apply --remote`, `d1 execute --remote`, `deploy`, `secret put`, `pnpm db:migrate:remote`, `pnpm deploy`). CI deploys production; agents never touch it.
- No secrets, tokens, webhook URLs, `.dev.vars` or real member data in the repo, logs, tests or PRs.
- Don't change `wrangler.jsonc` production values, `.github/workflows/*` or the backup/restore scripts unless the task is explicitly about them.
- Don't add dependencies casually; most versions are pinned exactly and the Worker has a 10 ms CPU budget per request on the Free plan.
- Don't commit or push unless the human asks.
