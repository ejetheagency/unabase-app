# Enrichment Capability Audit (2026-05-28) — READ-ONLY analysis, nothing mutated

## Brutal-honest verdict
The peak enrichment engine **was never degraded — it was bypassed.** A full
headless-browser "hunter" still exists and is wired into the pipeline; today's
remediation work reimplemented a thin static-regex subset and ignored it.

Three enrichment tiers actually exist in this repo:
1. **PEAK (automated hunter):** `unabasi-leads/index.js` → `enrich.js` (launches
   **puppeteer**) → `enrichment/contactHunter.js` `huntContacts()` — **3,082 lines**,
   45 `page.goto`, steps 1–10 + rounds A–D + `founderDeepRecovery` + `exhaustiveInstagramSearch`
   + `verifyInstagramIdentity` + `exhaustivePhoneSearch` + `hydrateScroll` (lazy-load) +
   `extractJsonLd`. Wired at index.js:862,1218. Real JS rendering, DOM parsing (cheerio),
   IG-bio hunting, multi-DM capture, phone/LinkedIn, multi-round fallback.
2. **HYBRID (documented current protocol):** `tools/batch-builder.js` = Apollo discovery +
   dedup + probe → emits a dossier, then **delegates site extraction to Claude WebFetch**
   ("emails, IG, brand context — needs LLM reading"). No puppeteer; the LLM is the scraper.
3. **TODAY'S REMEDIATION (what I built):** `unabase-app/scripts/sweep-unverified-emails.js`
   = Node static `fetch()` → raw HTML string → regex on **5 fixed paths**. No browser, no DOM,
   no IG/LinkedIn/phone/DM, no confidence model.

Today's *good* results (IGs/DMs/context) came from the **subagent WebFetch+curl crawl**
(≈ tier 2's extraction step), NOT from the sweep. The sweep is below both historical tiers.

## Answers to the 7 questions
1. **Why less "hunter-like":** I stopped invoking the hunter. `huntContacts()` (puppeteer,
   founderDeepRecovery, IG-bio multi-CEO discovery) was never run during remediation. Not
   decay — a bypass.
2. **Too static/HTML-limited:** YES. Sweep = `fetch()` + regex on raw HTML. Peak = puppeteer
   rendered DOM + cheerio. Sweep misses obfuscated/JS-injected emails, lazy content, JSON-LD.
3. **JS-rendered traversal degraded:** From full puppeteer render (+ `hydrateScroll`) to ZERO.
   That's why Grappi/Morena/Torneos returned only `<title>` in my sweep/WebFetch.
4. **Website exploration depth changed:** Peak `step3WebsiteCrawl` discovers + follows nav
   links across rounds; sweep hits 5 hardcoded paths with no link discovery. Subagents (today)
   did follow nav — mid-tier.
5. **Permission/tooling behavior changed:** YES. Safety era = report-only/`--apply`-gated,
   Apollo budget-gated (off by default, suspect-only), and **puppeteer never launched**. Also
   `enrichment/apollo.js` does NOT capture `email_status` — only `tools/unlock-domains.js` does
   → the main Apollo path still lacks the deliverability signal (the original root bug's home).
6. **Lost multi-page/footer/team/social depth:** In the sweep, YES (email-regex only). Peak has
   `step8Social`, `exhaustiveInstagramSearch`, footer parsing (24 refs), `founderDeepRecovery`
   (IG-bio @-tag → multiple CEOs). Subagents recovered footer-IG + team DMs today — partial.
7. **Evidence collection weaker:** YES. Sweep emits flat `_emailStatus` (+ ad-hoc `_cycle2Context`).
   The peak hunter already emits a rich model the data still carries: `contactConfidence`,
   `contactStrength`, `contactSource`, `primaryContactPath`, `recoveryNote`, `dataGaps`,
   `additionalContacts[]`, `fitSignals/fitVerified`, `entertainmentSignals`, `readyToSend`
   (51 keys on a single lead). My sweep ignored all of it.

## Capability comparison
| capability | PEAK hunter (contactHunter+puppeteer) | HYBRID (batch-builder+Claude WebFetch) | sweep-unverified-emails.js | today's subagents |
|---|---|---|---|---|
| JS rendering | ✅ puppeteer + hydrateScroll | ⚠️ none (markdown) | ❌ static fetch | ⚠️ none (+curl raw) |
| DOM parsing | ✅ cheerio | ✅ LLM reads | ❌ regex | ✅ LLM reads |
| link discovery / depth | ✅ follow nav, multi-round | ✅ LLM follows | ❌ 5 fixed paths | ✅ LLM follows |
| IG / social hunt | ✅ exhaustive + verify + bio @-tags | ⚠️ footer only | ❌ | ⚠️ footer + team |
| DM / founder capture | ✅ multi-DM + derive + confirm | ⚠️ LLM judgment | ❌ | ✅ team DMs |
| phone / LinkedIn | ✅ dedicated rounds | ⚠️ incidental | ❌ | ⚠️ incidental |
| Apollo email_status | ⚠️ only via unlock-domains | ⚠️ only via unlock-domains | ✅ (gated off) | ✅ suspect-only |
| evidence + confidence | ✅ confidence/strength/source | ⚠️ partial | ❌ flat status | ❌ ad-hoc |
| multi-round fallback | ✅ rounds A–D, deepRescue, alt paths | ⚠️ LLM | ❌ | ⚠️ per-agent |

## Recovery architecture — aggression + safety (proposed, NOT built)
**Principle: re-wire the existing hunter as a READ-ONLY evidence collector; gate all writes.**

### 1. Aggressive evidence collection (read-only)
- Reinstate `contactHunter.huntContacts()` (puppeteer) as a collector that writes to an
  **evidence store only** — never to `public/leads-*.json` or Supabase.
- Restores JS render (`hydrateScroll`), DOM (cheerio), IG-bio hunting, founderDeepRecovery,
  phone/LinkedIn, multi-round fallback.
- **Tiered cost control:** cheap pass first (Apollo cache + static) → escalate to a full
  puppeteer hunt ONLY for leads with gaps. Keep the subagent WebFetch crawl as a parallel breadth collector.
- **Fix the email_status gap:** port unlock-domains.js's `email_status` capture into the main
  Apollo/evidence path so deliverability is always recorded.

### 2. Structured evidence storage (provenance ledger)
- Append-only, domain-keyed: `scripts/evidence/<domain>.json`. Never destructive.
- Schema: `{domain, collectedAt, sources:[{type,url,method,ts}], candidates:{emails:[{value,
  source,page,isRole,domainMatch,apolloStatus,corroborations}], dms:[{name,title,source,linkedin,
  ig}], igHandles:[{handle,source,isFooterCanonical}], phones:[], context:{location,clients,desc}},
  flags:[]}`. Records WHAT + WHERE (provenance), decoupled from the live lead.

### 3. Confidence scoring (deterministic, evidence-based)
- Tiers: **VERIFIED** (Apollo email_status=verified) > **PUBLISHED** (domain-match mailto/footer,
  multi-page) > **CORROBORATED** (≥2 independent sources agree) > **FREEMAIL-PERSONAL** >
  **DERIVED/PATTERN** (never auto-promoted).
- Promote highest-tier DM email → primary candidate; role inbox → fallback; guesses → flag only.
- Reuse/extend existing `contactConfidence`/`contactStrength`; make scoring explicit + reproducible.

### 4. Safe mutation gating (formalize today's safeguards)
- Collection NEVER writes leads. A separate **promote** step reads evidence+confidence → emits a
  per-field, risk-tagged **proposal** (report-only by default).
- `--apply` required; field-level guards (never overwrite a specific email with a role inbox);
  **PROTECTED denylist never touched**: contactEmail(without approval), contactName, contactTitle,
  channelPriority, source_date, status, messages, `_reactivation*`, `_revivedFromPilot`,
  `_recoveredFrom`, lifecycle. Deep-compare vs HEAD; commit-per-patch; no push/Supabase without OK.
- **Confidence gates auto-eligibility:** VERIFIED/PUBLISHED → SAFE auto-apply queue;
  CORROBORATED → review; DERIVED/low → manual only.
- Idempotent + resumable + report artifact (patterns already proven in A1 / cycle-2 / Group A).

Net: tier-1 hunter aggression (puppeteer, IG, multi-source) feeding an evidence ledger with
confidence, with every live write passing the tier-3 safety gate. No silent mutation, no
lifecycle corruption — by construction.
