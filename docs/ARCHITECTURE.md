# EJE Platform Architecture

Single source of truth for how the EJE Outreach system works **technically**. When something breaks,
this tells you WHERE it lives and HOW to diagnose it. Read `CLAUDE.md` first for the product overview.
This doc is updated whenever a mechanism is added or changed. No mechanism ships without an entry here.

Supabase project: `ogdsuztzhmnnjolilsuo`. Every row in every table carries `client_id`.

---

## 1. Workspaces
- `public/app.html` is the live app. It switches on `client_id` read from `localStorage.eje_ws`.
- `unabase_default` = Scarlett's UnaBase cockpit. `eje` = EJE's own outreach (owner-gated). `eje_web` = retired.
- `ISEJE = (EJE_CLIENT === 'eje')` scopes ALL EJE-only behavior. EJE logic must never leak into `unabase_default`.

## 2. Data model
| Table | Holds (one row per...) | Written by | Read by |
|---|---|---|---|
| `leads` | decisor/company. `id` = domain. Has `status`, `source_date`, `lead_data` jsonb | dispatch scripts, `sbUpsertLead`, reconciliation | everything |
| `messages_sent` | real touch (email/ig/li/wa) with `sent_at` | `markSent`→`sbMsgWrite`, reconciliation | **the cadence** (`cadOf` counts these) |
| `actions` | lead+channel completed mark, `completed_at` (delete-then-insert = 1 per pair) | `markSent`→`sbActionWrite` | durable backup of 2nd-touch marks |
| `status_history` | status change | `sbStatusWrite` | audit |
| `notes` | free note per lead+user | `sbNoteWrite` | card |
| `landing_events` | getunabase.com landing analytics (UnaBase ads) | landing page JS | ads funnel |
| `tracked_leads` *(planned)* | manual/ad-hoc decisor for Seguimiento | Seguimiento add form | Seguimiento tab |
| `tracked_lead_notes` *(planned)* | timestamped stage-note history | Seguimiento | Seguimiento tab |

**CRITICAL:** `messages_sent` / `actions` / `status_history` / `notes` have a FK to `leads(id)`. Upsert the
lead row BEFORE any child write, or the insert 409s and the write silently vanishes.

PostgREST caps every response at 1000 rows. Always paginate reads (`sbPageAll`).

## 3. Cadence engine (drives Hoy + Tareas)
- `cadOf(l)` counts touches from `messages_sent` timestamps (`MSGS`). `replied`/`loom_sent`/`meeting`/`closed`/`skip` are terminal.
- `cadNext(n)`: 1 = email · 2 = ig (+2d) · 3 = email (+5d) · 4 = wa (+7d) · then monthly.
- **EJE rule: the 2nd touch is IG or LinkedIn, NEVER email.** `resolveCh` (ISEJE) fallback chain: ig → li → wa → email (last resort only).
- **Hoy** = leads whose `source_date == today`. **Tareas** = follow-ups for contacted leads (first-touches excluded).
- FAILURE MODE: a real send not logged in `messages_sent` makes the cadence under-count, and the task re-appears as "due." Fix = reconcile (§4), never guess a date.

## 4. Reconciliation (source of truth for sends)
- RULE: every time, corroborate actual Gmail sends against the platform before trusting Hoy/Tareas or reporting counts.
- Read `contact@` Sent via IMAP (creds in `eje-leads/.env`). Match `"<Company> x EJE"` (1st touch) and
  `"<Name>, no recibí tu feedback"` (follow-up) to leads; log an email `messages_sent` at the REAL send date; set `status=contacted`.
- **ADDITIVE ONLY. Never blanket-DELETE `messages_sent`** (a blanket delete once wiped 56 real 2nd-touch marks). Targeted per-lead deletes only, to fix a known-wrong row.
- IG/LinkedIn touches are NOT in email; only the app's send button or the operator's word logs them. `actions` is the durable backup.
- **MailReach warm-up + reachout traffic in the Sent folder are IGNORED** (only real EJE subjects are wired). Do not treat warm-up as outreach.

## 5. HARD RULES (gates, never violate)
1. **NAMES:** no lead is staged / drafted / reported without a named decisor. A role inbox (info@, contacto@) is allowed ONLY when a real named person is attached for the 2nd touch. *(Bug 2026-09-18: Baure / EVOGRAF / Frambuesa shipped nameless.)*
2. **2nd touch = IG or LinkedIn, never email.**
3. **Reconcile additively; never blanket-delete.**
4. **Everything EJE is ISEJE-scoped;** `unabase_default` is untouched.
5. **No background jobs for the platform;** derived state (reminders, cadence) is computed at render, so there is nothing to silently rot.

## 6. Seguimiento (NEW section, in build)
Manual tracker for leads outside the automated flow (ad, referral, inbound, fuzzy stages). Isolated
tables (`tracked_leads` / `tracked_lead_notes`), reminders computed live at render (no cron). Build spec:
`docs/SEGUIMIENTO-PLAN.md` (created when Phase 2 starts). Also: card swipe/next navigation (Phase 1, UI only, no data).

## 7. File map
- `public/app.html` — the live app (all EJE + UnaBase logic).
- `eje-leads/scripts/eje-work-draft.py` — IMAP draft creation into contact@.
- `eje-leads/.env` — contact@ IMAP creds (gitignored).
- `eje-leads/checkpoint/data/eje-batch-YYYY-MM-DD.json` — daily batches.
- `docs/` — this architecture + build plans.

## 8. Where to look when X breaks
| Symptom | Cause | Fix |
|---|---|---|
| Task re-appears after marked done | the touch is missing from `messages_sent` | reconcile (§4) |
| Hoy shows 0 for EJE | `source_date` not copied into lead objects in `loadUniverse` | check the map at `loadUniverse` |
| Lead shows nameless | names gate (Rule 1) failed at build | backfill `contact_name` |
| 2nd touch opens email | lead missing both IG and LinkedIn | enrich the channel |
| 409 on a child insert | lead row not upserted first | upsert lead, then child |
| Spend/sends look wrong | trusting the UI over the inbox | reconcile from Sent first |
