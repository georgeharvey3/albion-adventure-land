# Community Suggestions — Implementation Plan

*Friends suggest sites from inside the app; George reviews, touches up, and
approves from his phone; approved sites go live for everyone in ~2–3 minutes.*

Decided July 2026 (design session). This introduces the project's **first
backend** — a deliberate, owner-approved exception to the no-backend rule in
`CLAUDE.md`. The exception is narrow and this plan keeps it that way: the
backend is a *suggestions inbox*, never the source of truth for the map.

---

## 0. Design summary (decisions already made — don't re-litigate)

| Decision | Choice |
|---|---|
| Audience | A few non-technical friends; low volume (a few suggestions/month) |
| Backend | Cloudflare Worker + D1; D1 holds **only** pending/rejected suggestions (disposable data) |
| Submit auth | Open endpoint — approval is the gate; rate limiting + payload validation for hygiene |
| Admin auth | Single admin token (Worker secret), entered once on George's devices |
| Category | Friend picks a leaf `SiteCategory` in the form; George can override at review |
| Approve action | Worker commits the approved site to `data/community.json` via the GitHub contents API → existing ingest/build/Pages pipeline deploys it |
| Site IDs | Assigned at ingest by the existing rule: `slug(name) + rounded(lat,lng)` — the Worker never invents IDs |
| Review UX | Admin mode inside the PWA: pending suggestions as ghost pins on the real map + editable review card with nearest-existing-sites duplicate warning |
| Deferred (v1) | Offline submission outbox · photos on suggestions · friend-facing status tracking (fire-and-forget; WhatsApp is the notification layer) |

**The load-bearing property:** the app still loads exactly one
`public/data/sites.json`. Community sites are an ordinary fifth ingest source.
Offline behaviour, rarity derivation, stats, and outing mode need **zero
changes**. If a change to this plan would give the client a second data path,
that change is wrong.

```
friend's phone                Cloudflare                       GitHub
┌─────────────┐   POST /api/  ┌──────────────┐  contents API  ┌──────────────────┐
│ Suggest form│──suggestions──▶ Worker + D1  │───(approve)───▶│ data/community.json│
└─────────────┘               │ pending queue│                │  → push to main   │
George's phone                └──────▲───────┘                │  → ingest → build │
┌─────────────┐  GET pending /       │                        │  → Pages deploy   │
│ Admin mode  │──approve/reject──────┘                        └────────┬──────────┘
└─────────────┘                                                        ▼
                                                     everyone's PWA fetches sites.json
```

---

## Phase A — `data/community.json` as a fifth ingest source

*Shippable alone; the Worker doesn't exist yet and nothing breaks.*

1. **Add `data/community.json`** — committed, initially `[]`. Each record is a
   flat, human-editable object (this is also the by-hand escape hatch if the
   Worker is ever down):

   ```json
   {
     "name": "St Winifred's Well",
     "lat": 53.2891,
     "lng": -3.1245,
     "category": "wells",
     "description": "…",
     "county": "Flintshire",
     "suggestedBy": "Rosie",
     "approvedAt": "2026-07-16"
   }
   ```

2. **Add `src/data/mappings/community.ts`** — a `SourceMapping` like the other
   four. Records are converted to `RawRow` (stringify lat/lng) so they flow
   through the existing `ingest()` — same validation, same id derivation, same
   rejected-row logging. `source: "community"`. `category` values are already
   vocabulary slugs, so `normalizeCategory` passes them through.

3. **Wire into `scripts/ingest.ts`** — add to `SOURCES` with a JSON reader
   instead of `parseCsv` (small special case in the loop; the mapping/ingest
   path is shared from there).

4. **`Site.suggestedBy?: string`** — new optional field on `Site`
   (`src/data/types.ts`), populated only by this source; shown on the detail
   card as "Suggested by Rosie" (same slot as the CAMRA attribution line).

**Acceptance:** a hand-added record in `community.json` appears on the map with
a stable id, correct pin colour, attribution line, and counts in stats/rarity —
after nothing but the normal build. Cross-source dedupe drops a community
record whose derived id collides with an existing site (log it, per the
never-silent rule).

---

## Phase B — the Worker

*New top-level `worker/` directory with its own `package.json` +
`wrangler.toml`; it imports the category vocabulary from `../src/data/types.ts`
so the two ends can't drift.*

**D1 schema (one table):**

```sql
CREATE TABLE suggestions (
  id          TEXT PRIMARY KEY,          -- uuid, queue-internal; NOT a site id
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  payload     TEXT NOT NULL,             -- JSON: name/lat/lng/category/description/county/suggestedBy
  submitted_at TEXT NOT NULL,
  resolved_at TEXT,
  ip_hash     TEXT                       -- for rate limiting only
);
```

**Routes (4, JSON, CORS locked to the Pages origin):**

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/suggestions` | none | Validate → insert as `pending` → 201 |
| `GET /api/admin/pending` | admin token | List pending suggestions |
| `POST /api/admin/approve` | admin token | Body = suggestion id **+ the touched-up fields** (George's edits travel here). Re-validate → append to `data/community.json` via GitHub contents API → mark row `approved` |
| `POST /api/admin/reject` | admin token | Mark `rejected` (kept — a "we already said no" record for the review card) |

**Validation (submit and approve both):** name 1–120 chars; lat/lng numbers
inside a Britain bounding box (49.8–61.0, −8.7–1.8); `category` ∈
`SITE_TYPES`; description ≤ 2,000 chars; suggestedBy ≤ 60 chars; reject
unknown fields; total payload ≤ 8 KB.

**Hygiene on the open submit route:** per-IP-hash cap (e.g. 10/hour, counted
from D1) and a global pending cap (e.g. 500) so the inbox can't be flooded into
D1 free-tier limits.

**Admin auth:** `Authorization: Bearer <token>` compared constant-time against
a Worker secret.

**The approve commit:** read `data/community.json` (contents API, keep the
`sha`) → parse → append → `PUT` with the `sha`. On a 409 sha conflict, re-read
and retry once (single-admin, low volume — this is belt-and-braces). Commit
message: `Add community site: <name> (suggested by <who>)`. Pushes made with a
PAT trigger workflows, so the existing `deploy.yml` fires — verify this on the
first real approve.

**Secrets (wrangler secrets, never in the repo):** `ADMIN_TOKEN`; `GITHUB_PAT`
— fine-grained, **contents read/write on this one repo only**, ~1-year expiry
(set a calendar reminder). This token can write to the repo: the approve
handler must stay the only code path that uses it, and must only ever write
`data/community.json`.

**Deploy:** manual `wrangler deploy` for now; a GitHub Action later only if
Worker changes become frequent.

**Acceptance:** `wrangler dev` locally — a submitted suggestion round-trips
through pending → approve and produces a correct commit on a test branch/repo;
bad payloads (out-of-range coords, unknown category, oversized body) get 4xx
with a reason; admin routes 401 without the token.

---

## Phase C — the Suggest form (friend-facing)

1. **Entry point:** a "Suggest a site" action in the UI (placement: with the
   tabs/site-card tray — decide in situ, it's cosmetic).
2. **Location:** two affordances — "use my location" (the geolocation plumbing
   exists for near-me) and drop/drag a pin on the map. Show coords read-only.
3. **Fields:** name (required), category (required — picker over the existing
   two-level taxonomy, same labels/colours as the filter), description
   (optional, encouraged), "your name" (optional; prefilled from
   localStorage after first use).
4. **Submit:** plain `fetch` POST to the Worker (base URL via
   `VITE_SUGGESTIONS_API`). Online-only by design: if offline or the POST
   fails, keep the filled form and say "no signal — try again when you're
   back online" (don't lose their typing). On 201, thank-you note:
   "George will take a look — if he approves it, it'll appear on the map."
5. **No new dependencies.** No SDK, no form library.

**Acceptance:** a friend with the app installed can suggest a site in under a
minute with no account and no instructions; a failed submit never loses the
draft; the request doesn't fire without name + category + pin.

---

## Phase D — Admin mode (George-facing)

1. **Unlock:** a low-key settings affordance ("admin") prompts for the token
   once; store in localStorage; verify with a `GET /api/admin/pending` call.
   Wrong token → clear and stay in normal mode. Admin mode is invisible
   otherwise; the token's absence from friends' devices *is* the gate.
2. **Pending pins:** when unlocked and online, fetch pending suggestions and
   render as visually distinct **ghost pins** (e.g. dashed/translucent, category
   colour) on the normal map, ignoring the type filter. A badge shows the count.
3. **Review card:** tapping a ghost pin opens a card (reuse `SiteDetail`
   layout): every field editable (name, category picker, description, county,
   suggestedBy), coordinates nudgeable by dragging the ghost pin. Below the
   fields: **nearest existing sites** (top 3 by haversine with distances —
   `src/geo` already has this) as the duplicate warning, plus any nearby
   *rejected* suggestion ("already suggested, said no").
4. **Actions:** Approve → POST the edited fields; on success remove the ghost
   pin and note "live in ~2 minutes after the deploy". Reject → confirm, POST.
5. **Failure honesty:** if approve fails (GitHub API down, token expired),
   surface the Worker's error verbatim — never mark it approved locally.

**Acceptance:** the full field loop works on a phone: friend submits → ghost
pin appears on George's map → George fixes a typo, changes category, drags the
pin 50 m → Approve → site is on everyone's map (fresh online load) with the
corrected data, a stable id, and attribution. Reject removes it and it stays
remembered. A device without the token can see none of this and hits 401 on
every admin route.

---

## Phase E — Docs

- **`CLAUDE.md`:** amend the architecture section — the no-backend rule gains
  its scoped exception: *"one Cloudflare Worker exists as the suggestions
  inbox; the repo remains the source of truth for all site data; do not expand
  the Worker's role without raising it."* Note `data/community.json` is
  machine-appended (hand-edits fine; keep it valid JSON).
- **Spec (`plans/britain-sites-app-spec.md`):** update the status table and
  §11 open decisions; add this feature's summary with a pointer to this plan.

---

## Risks & watch-items

- **PAT expiry** is the one moving part that rots: approve starts failing in
  ~a year. The admin card surfacing the raw error (Phase D.5) makes this
  diagnosable from the phone; calendar reminder to rotate.
- **Workflow trigger:** confirm the Worker's PAT-authored push actually
  triggers `deploy.yml` on the first real approve (it should; `GITHUB_TOKEN`
  pushes wouldn't).
- **`community.json` growth:** irrelevant at this scale; it rides the same
  ingest as 1,000+-row CSVs.
- **Duplicate ids across sources:** already handled (cross-source dedupe with
  logging) — the review card's proximity warning exists to catch *near*
  duplicates the id rule can't.

## Explicitly deferred (v2 candidates, in likely order of felt need)

1. Offline submission outbox (IndexedDB queue + auto-flush) — build when a
   friend actually loses a suggestion to no signal.
2. Photos on suggestions (needs R2 + moderation + offline image caching).
3. Friend-facing status ("my suggestions" list).
4. Reusing the Worker for visited-state sync — the spec's deferred sync item;
   this Worker is deliberately *not* designed for it, only proof the platform
   works.

## Build order

A → B → C → D → E. A and B are independently verifiable without touching the
UI; C ships before D only in the trivial sense that submissions queue harmlessly
until admin mode exists. Nothing here blocks or is blocked by Phase 3 of the
main spec.
