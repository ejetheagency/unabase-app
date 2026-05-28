# OPS_STATE — UnaBase email deliverability sweep

> Crash-recovery file. A new thread must be able to resume from this in < 5 min.
> Update after every major step. Keep chat short. No giant JSON in chat. All
> operational work goes through resumable scripts. Commit after every safe patch.

## Current task  (CHANGED 2026-05-28 — SAFETY FREEZE)
**Protocol discovery + safety freeze ONLY. No lead/Supabase/manifest/UI mutation.**
A client is live on this system; stability is paramount.

### DOCTRINE CORRECTION (critical)
Missing `_emailStatus` means **"needs verification review", NOT "invalid"**. The
broad sweep wrongly treated unverified-as-invalid. The real issue: some
recovered/revived leads never went through the newer verification process.
DM emails are valuable and must NOT be blindly replaced by generic site emails.
Website-published email is *evidence*, not automatically superior. Already-
contacted/cycled leads are sacred.

### Freeze state (done)
- All 3 lead files reverted to HEAD `514f8f3` (git clean). No mutations stand.
- `OPS_STATE.md`, `scripts/sweep-unverified-emails.js`, `scripts/sweep-report.latest.json` preserved.
- Sweep script is now **report-only by default** — requires `--apply` to mutate
  files; `--supabase`/`--commit` also gated behind `--apply`.

### Verified protocol findings (2026-05-28, read-only)
- ACTUAL protocol: Apollo discovery → activity probe → Apollo /people/match unlock
  (captures `email_status`) → Claude WebFetch site extraction → DM cross-check →
  deploy. Fix path: website-published (free) first, Apollo `email_status==='verified'`
  second (budget-capped). Source: unabasi-leads/BATCH_PLAYBOOK.md, tools/unlock-domains.js.
- `email_status` fix: BEFORE discarded Apollo email_status (shipped pattern-guesses);
  AFTER keeps it, only verified/likely count. (unabasi-leads is NOT a git repo — no diff;
  documented by app commit 514f8f3 + current tools/unlock-domains.js:46-69.)
- The 9 flagged leads (8 + Habanero=.co/.com TLD fix) were ALREADY fixed by 514f8f3 —
  all carry `_emailStatus` at HEAD. No action needed on them.
- Revived/reactivated cohort: commits c0daec2 (49 pilot re-ignited: 15→Hoy fresh +
  34 `_reactivationMode`), 19435d0 (3 `_recoveredFrom` bounced swaps), 7a7027f (Hoy filter).
- **Numbers: 224 total leads, 215 missing `_emailStatus` (missing = NORMAL, not invalid).
  Revival/reactivation-tagged = 56; of those 49 lack `_emailStatus`.** ← real review set.
- The pilot cohort got basic ICP enrichment only, NOT the newer deliverability pass.

### Cohort audit DONE + FIXED (report-only, 2026-05-28) — nothing mutated, git clean
Command: `node scripts/sweep-unverified-emails.js --web --cohort`.
Two script fixes applied + verified:
  1. rootDomain() now ccTLD-aware (com.mx/com.ar/com.pe/… via TWO_PART_SUFFIX set).
  2. HARD RULE: sweep NEVER overwrites a specific (non-role) existing email — it only
     SETS/REPLACES when existing is empty or a generic role inbox.
56 cohort leads, 7 already stamped; of the 49 unverified:
  16 website_published (own email confirmed on site — safe to STAMP),
  15 named_kept (specific email kept primary + verified site inbox as fallback),
  14 named_unverified (specific email kept, no site confirm — Apollo candidates),
  2 website_published(set) = Zeta Positivo only (was EMPTY → info@zetapositivo.com.ar),
  4 no_verified_email = New Walk, Happy Monster, Cinebrand, Intelygente (role inbox, unconfirmed).
Verified: Panorámica now kept_existing (christian@panoramicafilms.com.mx preserved); swap list clean.
NOTE: Zeta Positivo is DUPLICATED across leads-2026-05-27 and leads-past (dedup separately).
Report: scripts/sweep-report.latest.json.

### UI field-read audit (index.html, 2026-05-28) — for lifecycle-safe patching
- `_emailStatus`, `_emailVerifiedAt`, `_emailVerificationSource`, `_emailSweepNote`,
  `_emailFallback`, `_emailReplaced`: **NOT read anywhere in index.html → UI-inert.**
- `channelPriority`/`primario`/`secundario`: **NOT read by index.html → UI-inert**
  (but it IS structured data other tooling/pitches may use — applyNoEmail rewrites it).
- `contactEmail`: **IS read** — Paso 1 email step + emailUsable (1430-1502), mailto (1590).
  Changing it changes action state. (Role-inbox who-label at 1093 is EJE-only, gated by CLIENT_ID!=='eje'.)
- Placement (Hoy / Acción Ahora / Historial) driven by `_revivedFromPilot`/`_recoveredFrom`
  (Hoy, lines 1295-1301) and `_reactivationMode`+`_reactivationActivatedAt` (BLUE REACTIVAR, 2079-2097).
  None of the proposed patch fields touch these. Sorting/urgency = dueMs/msgs, not email.
- Live data flow: active batch from reports-manifest.json (active = leads-2026-05-28); PL from
  leads-past.json (always fetched, 2012); SEED_PAST embedded (1918/1948). Cohort leads live in
  leads-2026-05-27 (archived) + leads-past, surfaced into UI via revival/reactivation tags.

### Review sheet EXPORTED (2026-05-28) — applied NOTHING, data still frozen
Operator chose "export sheet, apply nothing". Per-lead triage sheet for all 56:
  `unabase-app/scripts/cohort-review.csv`
Columns: priority, suggested_action, company, file, domain, current_email,
current_status, cohort_tags, site_finding, fallback_inbox, notes.
Priority tally: A1=14 (stamp-verified), A2=2 (empty-fill: Zeta, dup), B1=15 (keep+fallback),
B2=14 (keep, Apollo-verify), C1=4 (triage role inbox), D1=7 (already verified).

### A1 APPLIED (files-only, 2026-05-28) — committed locally, NOT pushed
Tool: `node scripts/apply-a1-stamps.js --apply` (dedicated, no-network, idempotent).
Stamped 14 confirmed-deliverable leads (email already published on own site):
  4 in leads-2026-05-27.json, 10 in leads-past.json.
Set ONLY: _emailStatus="website_published", _emailVerifiedAt, _emailVerificationSource, _emailSweepNote.
PROVEN clean (deep-compare vs HEAD): 0 contactEmail changes, 0 other-field changes,
0 non-website_published statuses. channelPriority untouched. No Supabase, no push, no deploy.
Rollback: `git -C unabase-app checkout -- public/leads-2026-05-27.json public/leads-past.json`.

### Still NOT applied (await operator, per-group)
A2 (2, contactEmail fill — Zeta dup), B1 (15 fallbacks), B2 (14 Apollo), C1 (4 triage + channelPriority caveat), D1 (no-op).

### Hybrid enrichment review (report-only, 2026-05-28) — NOTHING applied
Scope = unresolved only: A2(2 Zeta dup), B2(14), C1(4) + flagged-still-unresolved
VPro(no_email_use_whatsapp), Aqua(domain_rebranded), Grappi(no_verified_email).
Habanero RESOLVED (website_published contact@habanerofilms.com). Other 5 flagged verified.
Free steps done: cache pool checked = NO Apollo people/email data anywhere (research-cache
+ discovery caches are company-level only); website inspection already in sweep report.
Apollo people/match (step 4) NOT run — ~17 unique domains > 15 pre-flight threshold (Enrichment credits). Awaiting operator approval to spend.
Suspect wrong-domain (Habanero-style): Underground@nbcuni.com (NBCUniversal — almost
certainly wrong), Brodaju rene@brodaju.com vs site brodaju.com.co, Aqua (rebranded).
Freemail-but-likely-valid: La Villa juliopachongonzalez@yahoo.com (known recovered), Misil gmail.

### Suspect-only Apollo run DONE (operator-approved, 3 domains, 2026-05-28) — report-only
- undergroundproducciones.com → VERIFIED DM: Pablo Culell Ok (VP Original Content, NBCUni),
  pablo.culell@nbcuni.com [verified] + LinkedIn. ⚠️ ICP flag: NBCUniversal exec, not a boutique
  productora — possible mis-scope. Current underground@nbcuni.com is a non-person generic addr.
- vprovideo.com → person found (Osiel Hernández, Cámaras) but NO email (unavailable) → keep WhatsApp.
- grappi.cl → 0 DMs / 0 emails → needs manual WebFetch (grappi.cl/contacto).
NOTHING applied (no contactEmail change, no Supabase, no push).
DECISION (operator, 2026-05-28): RE-SCOPE Underground — do NOT wire in pablo.culell@nbcuni.com.
Underground Producciones reads as NBCUniversal-affiliated (verified DM = NBCUni VP), inconsistent
with the boutique-productora ICP. Flagged for operator ICP review (exclude / reclassify / keep-as-misfit).
contactEmail left as underground@nbcuni.com (unverified, untouched). No lead-file mutation made for this flag.

### Grappi WebFetch DONE (free, report-only, 2026-05-28)
grappi.cl / /contacto / /about / /nosotros are JS-rendered — static fetch returns only the
title ("Grappi - Productora Audiovisual Santiago"). No email, DM, IG, team, or clients extractable.
Apollo also returned 0. contacto@grappi.cl exists ONLY in embedded SEED_PAST (not in leads-past.json,
not confirmed on live site) — role inbox, domain-consistent, UNVERIFIED. IG @grappifilming also from
SEED_PAST, canonical not confirmable. Lifecycle: BLUE Acción Ahora (_reactivationMode, already-cycled).
Verdict: no verified DM; contacto@grappi.cl acceptable only as low-confidence fallback; needs a
human browser check (JS site). → MANUAL-REVIEW. No mutation made.

### Cycle-2 deep website scrape DONE (operator-approved, report-only, 2026-05-28)
4 parallel read-only agents deep-crawled 19 unresolved sites (every tab + footer + curl for JS sites).
Findings saved → scripts/enrichment-cycle2-findings.md. NOTHING applied.
Big wins: new DMs (Intelygente full team, Magma Gugliotta+Videla, Doin CEO Carolina Guerrero, Happy
Monster 6 directors, Misil/La Villa co-founders), new IGs (HUAU @be_huau, Doin, CBRA, Mun, Brodaju),
new emails (Zeta info@, HUAU hola@, Doin david@, Magma juanpablo@, Grappi contacto@, La Villa gmail).
Key flags: New Walk IG typo (should be newwalkproductions); several "personal" emails (pau@,fernando@,
david@,cristobal@,rene@) NOT on site = unconfirmed; Aqua REBRANDED→Anchoita Films (anchoitafilms.com.ar);
GEO/ICP: Morena+Mun = Spain, Torneos = sports conglomerate, Kuarzo site DOWN(503).
### Cycle-2 SAFE enrichment APPLIED (files-only, NOT committed yet, 2026-05-28)
Tool: scripts/apply-cycle2-safe.js --apply (guarded, idempotent). Touched ONLY instagramHandle,
instagramUrl, additionalContacts[], _cycle2Context/_cycle2ScrapedAt on 18 lead entries in
leads-2026-05-27 + leads-past. Applied: 6 IG fixes (incl New Walk typo→newwalkproductions), 22 new
DMs into additionalContacts, 18 context notes. VERIFIED: 0 protected fields changed, 0 non-SAFE changed
(deep-compare vs HEAD). The "contactName" lines in git diff are nested DM entries, not lead-level.
leads-2026-05-28 untouched. NOT committed, no Supabase, no push. Rollback: git checkout -- those 2 files.
SAFE committed locally as 287fccc (ahead 2, not pushed).

### Group A (minus Grappi) APPLIED + verified (files-only, 2026-05-28)
Tool: scripts/apply-groupA.js --apply (guarded). Verified vs HEAD:
- Zeta Positivo: DEDUP (removed identical dup from leads-2026-05-27 → 29→28; kept always-loaded
  past copy) + filled contactEmail=info@zetapositivo.com.ar [website_published].
- Doin Media → contactName Carolina Guerrero / CEO. Intelygente → Pablo Castro / Founder.
  Magma Cine → Juan Pablo Gugliotta / Co-founder. (names only set where previously empty.)
Only intended fields on 4 leads changed; Zeta removed from -27 only. No Supabase, not pushed.

### STILL PENDING (no action): 
- Grappi contacto@grappi.cl fill (operator skipped this round).
- Group B identity: Aqua→Anchoita rebrand (changes lead id), Brodaju rene@ vs info@brodaju.com.co, Mun name Moragues vs Ardèvol.
- Group C unconfirmed personal emails (pau@/fernando@/david@/cristobal@/misil gmail/rene@) — keep vs Apollo-verify.
- Group D ICP/geo: Morena+Mun (Spain), Torneos (sports), Underground (NBCUni) — disposition.
- Kuarzo site down (recrawl). VPro WhatsApp-only.

### Remaining-unresolved grouping (report-only, NOTHING applied)
- SAFE keep (13, email present/likely-valid): B2 same-domain DMs ×10 (Fósforo, Mun, Kuarzo, Minded
  Factory, Torneos, Morena, HUAU, CBRA, Doin, Magma) + Misil(gmail) + La Villa(yahoo recovered) + Brodaju.
- SAFE-FIX pending approval (1): Zeta Positivo — fill info@zetapositivo.com.ar (empty now) + DEDUP (-27 & past).
- MANUAL-REVIEW (6): C1 role inboxes New Walk/Happy Monster/Cinebrand/Intelygente + Grappi(JS site) + Aqua(rebranded domain hunt).
- BLOCKED/NO-EMAIL (1): VPro (WhatsApp only; Apollo person, no email).
- ICP-MISFIT (1): Underground (NBCUniversal-affiliated; re-scope, do not wire pablo.culell@nbcuni.com).

### Next (separate): today's held batch (leads-2026-05-28) deployment.

### Prior (now SUSPENDED) task
Was: deliverability sweep of unverified emails. Suspended pending protocol verify.

**Scope clarification (operator, 2026-05-28):** the live focus is the *revived
past leads* brought back into the cycle whose emails turned out invalid — NOT
today's batch. Today's batch (`leads-2026-05-28.json`) is built but **held from
deploy** until enrichment is confirmed.

Operator-flagged invalid-email revived leads to confirm:
Mariachi · ChileRayo · Aqua Films · Sunomono · Storylab · Grappi · Linkvids · Vpro

## Mode locked for this run
- Apollo: **OFF** (website-published verification only, zero credit spend — operator decision).
- Supabase patch: **HELD** (needs operator OK).
- Push / deploy: **HELD** (today's batch must not deploy until enrichment confirmed).

## Last successful commit (rollback point)
`514f8f3` — "Fix 9 bounced/invalid emails with deliverability verification"
(HEAD of unabase-app is at 514f8f3.)

## Current production state
- App is static (`public/index.html` + `public/leads-*.json`), Supabase-backed
  (table `leads`, id = domain of website, client_id `unabase_default`).
- batch-2026-05-28 committed locally (b73f734) but enrichment fixes pending → not deployed.
- ~40 untracked historical `leads-*.json` files live in `public/` — DO NOT commit them.

## Files being modified
- `public/leads-2026-05-28.json`  (today's held batch)
- `public/leads-2026-05-27.json`  (revival/reactivation)
- `public/leads-past.json`        (revived past leads — primary focus)
- `scripts/sweep-unverified-emails.js`   (the sweep tool)
- `scripts/sweep-report.latest.json`     (per-lead result log)

## Exact next command
```
node unabase-app/scripts/sweep-unverified-emails.js --web
```
(Apollo stays off. Add `--supabase` / `--commit` ONLY after operator confirms.)
Re-running is safe/idempotent: verified leads are skipped, only unverified re-checked.

## Known doctrine
- Channel priority: **email primary**, LinkedIn complementary, IG/WhatsApp last resort.
- NEVER promote an extrapolated/pattern-guessed email to verified/primary.
- Keep ONLY Apollo `email_status === 'verified'`; website-published = `website_published`.
- NEVER delete a lead. No verified email → `_emailStatus:"no_verified_email"` + note, keep record.
- Apollo budget: pre-flight quote required before >15 unlocks (Enrichment credits, not invoiced).
- Canonical IG = the handle the company's own site footer links to.
- Commit by explicit filename only — never `git add public/*.json`.

## Rollback point
```
git -C unabase-app checkout -- public/leads-2026-05-28.json public/leads-2026-05-27.json public/leads-past.json
# or hard rollback to last good commit:
git -C unabase-app reset --hard 514f8f3   # destructive — operator approval only
```

## Unfinished checklist
- [ ] Full website-only sweep pass completes (running in background).
- [ ] Review results for the 8 operator-flagged revived leads.
- [ ] Isolate today's batch (28) results separately from revived/past results.
- [ ] Commit patched files locally (rule 6) — explicit filenames only.
- [ ] (HELD) Patch matching Supabase rows — needs operator OK.
- [ ] (HELD) Deploy today's batch / push — needs operator OK after enrichment confirmed.
