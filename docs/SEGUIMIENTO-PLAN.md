# Seguimiento — build spec (Phase 2+)

Manual tracker for leads **outside** the automated outreach (ads, referrals, inbound, fuzzy stages the
cadence can't model). **Isolated** from the outreach `leads`/cadence so it can never affect Hoy/Tareas.
Reminders are computed **live at render** (no cron, nothing to rot). ISEJE-only, owner-gated.
Registered in `docs/ARCHITECTURE.md` §6.

## 1. Data model (2 new tables, project ogdsuztzhmnnjolilsuo)

### tracked_leads
| col | type | notes |
|---|---|---|
| id | uuid pk `default gen_random_uuid()` | |
| client_id | text not null | always `'eje'` |
| user_name | text | who added it |
| company | text not null | |
| decisor_name | text | the person — see **D1** |
| contact_email | text | |
| contact_phone | text | |
| instagram | text | handle (no @) |
| linkedin | text | url |
| source | text not null | enum: `ad_ig, ad_meta, referral, inbound, event, manual, other` |
| stage | text not null `default 'nuevo'` | enum below |
| created_at | timestamptz `default now()` | |
| updated_at | timestamptz `default now()` | **bumped on every stage/note change; this drives the reminders** |

### tracked_lead_notes
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| tracked_lead_id | uuid not null → `tracked_leads(id) on delete cascade` | |
| client_id | text not null | |
| user_name | text | |
| note_text | text not null | |
| stage_at_time | text | the stage when the note was written (history) |
| created_at | timestamptz `default now()` | |

### Stages (the manual funnel)
`nuevo → contactado → respondio → conversacion → reunion → propuesta → ganado | perdido | pausa`
(`perdido` = died; `pausa` = revive later)

### Sources
`ad_ig, ad_meta, referral, inbound, event, manual, other`

## 2. Reminder logic (pure function, computed at render, NO background job)
`staleDays(stage)`: contactado 5 · respondio 4 · conversacion 10 · reunion 3 · propuesta 7 · pausa/perdido 30 (resurface as "¿revisar?") · ganado never.
A lead **needs attention** when `now - updated_at >= staleDays(stage)`.
Sort: needs-attention first (most overdue on top), then by `updated_at desc`. Tab badge = count needing attention.

## 3. Bridge from the outreach pipeline (Phase 6, read-only)
A `leads` row with `status='replied'` and no follow-up logged surfaces a card: *"Este lead respondió. ¿Seguiste o murió?"*
One tap creates a `tracked_leads` row (source `inbound`) with the decisor prefilled. **Never writes to `leads`.**

## 4. UI (app.html, ISEJE-only)
- Tab **"Seguimiento"** (owner-gated).
- List: one card per tracked lead — company, decisor, source chip, stage chip, last-update, note preview, attention flag.
- **"+ Añadir decisor"**: form (source, company, decisor name, email/phone/ig/linkedin, stage, first note).
- Open a lead: stage selector + timestamped note history + "add note / change stage" (each bumps `updated_at`).
- Reminders + badge computed live on open.

## 5. Isolation / safety
- New tables only; zero change to `leads`/`messages_sent`/`actions`/etc.
- All code ISEJE-scoped; `unabase_default` untouched.
- Anon-key select/insert/update; no delete from the app.
- No cron; every reminder derived at render.

## 6. Failure guide
| Symptom | Cause | Fix |
|---|---|---|
| Add fails silently | RLS not allowing anon insert | check policies (§8) |
| Reminders wrong | `updated_at` not bumped on note/stage change | bump it on every write |
| Lead double-listed | dedup by `id` | |

## 7. OPEN DECISIONS (need operator sign-off before build)
- **D1 — names:** require `decisor_name` always (enforces the hard names rule), OR allow an "unknown / IG-only" ad lead that you name later? Ad leads sometimes arrive as just an IG handle.
- **D2 — stages & sources:** confirm the lists in §1, or adjust wording.

## 8. DDL to run once in the Supabase SQL editor
```sql
create table if not exists public.tracked_leads (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  user_name text,
  company text not null,
  decisor_name text,
  contact_email text, contact_phone text, instagram text, linkedin text,
  source text not null,
  stage text not null default 'nuevo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.tracked_lead_notes (
  id uuid primary key default gen_random_uuid(),
  tracked_lead_id uuid not null references public.tracked_leads(id) on delete cascade,
  client_id text not null,
  user_name text,
  note_text text not null,
  stage_at_time text,
  created_at timestamptz not null default now()
);
alter table public.tracked_leads enable row level security;
alter table public.tracked_lead_notes enable row level security;
create policy tl_read   on public.tracked_leads      for select using (true);
create policy tl_write  on public.tracked_leads      for insert with check (true);
create policy tl_update on public.tracked_leads      for update using (true);
create policy tln_read  on public.tracked_lead_notes for select using (true);
create policy tln_write on public.tracked_lead_notes for insert with check (true);
```
(Policies use `true` to match the app's anon-key access, same posture as the existing tables. Tighten later if we lock down.)
```
