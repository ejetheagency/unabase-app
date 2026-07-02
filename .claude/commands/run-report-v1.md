---
description: Run the daily UnaBase lead report (V1 standard — pool dispatch or fresh mine, full enrichment, deploy)
---

# Run Report V1 — locked standard daily process

Execute the full daily UnaBase report end-to-end. `source_date` = today.
Repos: app `/Users/jofreeyzaguirre/claude/unabase-app` (git), engine `/Users/jofreeyzaguirre/claude/unabasi-leads` (not git).
Canonical detail: `unabasi-leads/RUN-REPORT-V1.md`. Default batch size: 10.

## Phase 0 — Preflight
- Health check (read-only): Apollo auth, Hunter searches left, Vercel up.
- Count USABLE pool leads in `unabasi-leads/staging/pool-a-tier.json` (exclude Brazil [no-BR doctrine] + already-shipped/burned).
- Mode: **POOL DISPATCH** if usable ≥ batch size; else **FRESH MINE**.

## Phase 1 — Source candidates (client geo mix, NO Brazil)
Client mix = operator doctrine: MX-dominant; ≥6 of every 10 from priority tiers (Mexico / Argentina / Colombia+CentralAmerica), MX plurality; remaining from any LATAM/Spanish-speaking (ES/PE/CL/UY ok). Score floor 8.5.
- **POOL DISPATCH:** select the strongest complete leads by score, honoring the geo mix.
- **FRESH MINE (pool dry):** use PRECISE sourcing — WebSearch for named productoras + Apollo `/organizations` `industry=Motion Pictures` + Hunter. DO NOT use raw `batch-builder.js` keyword discovery (it dumps agency/ecommerce noise — see [[feedback-precise-sourcing-over-keyword-discovery]]). Fan out parallel discovery agents per country. Dedup vs ALL past `public/leads-*.json` + pool history (build the master name list first).

## Phase 2 — Enrichment (MANDATORY — this is what makes a report V1-grade)
For every selected lead:
1. **Strict-IG verify** (puppeteer, pattern of `scripts/ig-verify-YYYY-MM-DD.js`): og:title name-match AND posts ≥ 10. Capture follower count. Replace/drop dead handles (e.g. CMO, La Ventana had dead handles). Every shipped lead carries an IG handle + follower count (or a documented email-only exception).
2. **DM-roster harvest** — fan out parallel WebFetch agents (1 per ~2 companies). Each fetches homepage + `/equipo /nosotros /contacto /contactos /quienes-somos /team /about /info` and loops subpages. Return EVERY named decision-maker (Founder/Co-Founder/CEO/COO/Owner/Managing Partner/Partner/President/Director General/Executive Producer/Productor Ejecutivo/Head of Production/Director). EXCLUDE community/social/junior/intern/assistant/designer/dev/HR/coordinator. Never invent.
3. **Email recovery** — Hunter `domain-search` (limit≤10) + Apollo `/people/match` verified-only for primary + additional DMs. Website-published > Apollo-verified > Hunter-sourced. Never ship extrapolated as confirmed.
4. **Cross-check** — drop deceased/stale contacts (caught: Guarango/Stefan Kaspar †); prefer a current named DM. Primary email localpart must match contactName OR be a generic role inbox (info/contacto/hola/produccion…) — else the audit gate flags NAME_EMAIL_MISMATCH.
5. **Rich companyBrief (~300–450 chars):** location · what they produce · named credits/clients/awards · DM names · IG-verified line.
6. **additionalContacts[]** = all harvested DMs (name/title/email-or-null). Set **companyEmail** (CC) when a same-domain role inbox exists alongside a personal primary.

## Phase 3 — Build + gate (ALL THREE gates must pass — triple-check before deploy)
- Write `public/leads-YYYY-MM-DD.json` (dispatch format: `_dispatched_batch_id`, `_dispatched_at`, `source_date`, `approved:true`, `readyToSend:true`, `_operatorVerified:false`, plus all lead fields incl. `contactLinkedIn`/`whatsapp`/`altChannel`).
- **EVERY lead carries a named DECISION-MAKER** (owner/founder/CEO/partner) found via site + press/festival coverage — never a guessed email; role inbox allowed for the email field only, never as the sole contact. No identifiable DM → don't ship that lead.
- **GATE A — link-liveness (NO BLACK SCREENS):** `node scripts/link-liveness.js --gate public/leads-YYYY-MM-DD.json` → every website + Instagram URL the client clicks must open LIVE (0 dead). Fix the data (correct handle/URL) or drop the field/lead; re-run until 0 dead. Spot-open 2–3 links manually as a second check.
- **GATE B — audit:** `node scripts/audit-drafts.js --gate` → **0 high-severity** (add the batch to the manifest first so the audit scans it). Fix and re-run until clean.
- **GATE C — dedup:** `node scripts/dedup-guard.js --gate` → active batch fully novel vs all history.

## Phase 4 — Manifest + deploy
- POOL DISPATCH: move the dispatched leads `pool.leads → dispatched_history` (tag `_pool_status:dispatched`, `dispatched_batch_id`, `dispatched_at`), update `current_size`, append `session_log`.
- `reports-manifest.json`: unshift new batch entry (rich `note` + `supply_metrics`), set `active_batch_id`, archive the prior active batch.
- Commit ONLY `public/leads-YYYY-MM-DD.json` + `public/reports-manifest.json` by explicit filename (never `git add public/*.json` — ~40 untracked historical files). Push to `main` (Vercel auto-deploys).
- Verify live: `curl` the Vercel `reports-manifest.json` (active_batch_id) + the leads file (count + companies).

## Quality bar (all must pass)
- 100% email-bearing (deliverable, never guessed) · **named decision-maker on 100% of leads** (via site + press) · 100% strict-IG verified (or documented email-only) · **100% of client-clickable links resolve LIVE (link-liveness gate, no black screens)** · multi-DM wherever a roster exists · briefs ≥300 chars · score ≥8.5 · deduped vs all past + pool · NO Brazil · client geo mix · audit gate 0 high-sev.

When done: report the batch table (company/geo/score/DM/IG-followers), confirm live, and note pool runway remaining.
