#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/sweep-unverified-emails.js
//
// Sweep every still-unverified active/revival/reactivation email across the
// three live lead files, verify via FREE website-published extraction first,
// then (only when explicitly enabled + budget-capped) Apollo deliverability.
//
// ROOT BUG THIS GUARDS AGAINST: Apollo `email_status` used to be discarded, so
// extrapolated/pattern-guessed emails were shipped as if deliverable. Here we
// preserve ONLY Apollo `email_status === 'verified'`, and otherwise rely on
// emails actually published on the company's own site. Pattern-guesses are
// NEVER promoted to a verified/primary email.
//
// Channel doctrine: email = primary, LinkedIn = complementary, IG/WhatsApp =
// last resort. We NEVER blindly replace a same-domain named DM email with a
// generic role inbox — the DM stays primary; a verified company inbox is only
// stored as a fallback. We never delete a lead.
//
// IMPORTANT DOCTRINE CORRECTION: a MISSING `_emailStatus` means "needs
// verification review", NOT "invalid". Do not treat unverified as bad.
//
// SAFETY: this script is REPORT-ONLY BY DEFAULT. It will not mutate lead files,
// Supabase, or anything live unless you pass --apply. A client is on this system.
//
// ─────────────────────────────────────────────────────────────────────────
// MODES:
//
//   node scripts/sweep-unverified-emails.js
//       SCAN: count targets + list first 10 + Apollo pre-flight quote. No network, no writes.
//
//   node scripts/sweep-unverified-emails.js --web [--limit=N]
//       REPORT-ONLY website verification. Computes every result + writes the
//       report file, but does NOT touch lead files. Safe to run anytime.
//
//   node scripts/sweep-unverified-emails.js --web --apply
//       Same, but ALSO patches the lead JSON files. Requires explicit --apply.
//
//   ... --apollo --max-unlocks=N   add Apollo (budget-capped) to the web pass.
//   ... --supabase                 PATCH matching Supabase rows (requires --apply).
//   ... --commit                   git add + commit + push (requires --apply).
//
// Detailed per-lead results → scripts/sweep-report.latest.json. Output kept compact.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── paths ──────────────────────────────────────────────────────────────────
const APP_ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(APP_ROOT, 'public');
const REPO_ROOT = path.join(APP_ROOT, '..');
const ENV_PATH = path.join(REPO_ROOT, 'unabasi-leads', '.env');
const REPORT_PATH = path.join(__dirname, 'sweep-report.latest.json');
const FILES = ['leads-2026-05-28.json', 'leads-2026-05-27.json', 'leads-past.json'];

// ── args ─────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const opt = (n, d) => { const a = ARGV.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const MODE_WEB = flag('web');
const MODE_COHORT = flag('cohort'); // restrict targets to revived/reactivated leads only
const MODE_APPLY = flag('apply');   // REQUIRED to mutate lead files / Supabase. Default = report-only.
const MODE_APOLLO = flag('apollo');
const MODE_SUPABASE = flag('supabase') && MODE_APPLY; // never patch DB without --apply
const MODE_COMMIT = flag('commit') && MODE_APPLY;     // never commit without --apply
const MAX_UNLOCKS = parseInt(opt('max-unlocks', '15'), 10);
const LIMIT = opt('limit') ? parseInt(opt('limit'), 10) : Infinity;

// ── supabase (anon key + RLS "allow all" → PATCH ok; matches public/index.html) ─
const SB_URL = 'https://ogdsuztzhmnnjolilsuo.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZHN1enR6aG1ubmpvbGlsc3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMDI0MDMsImV4cCI6MjA5MTc3ODQwM30.9iKhJJWd_zg6WfdxTR9ojK4DVLR3e-bLdPXY-0uDp7Q';
const CLIENT_ID = 'unabase_default';

const VERIFIED_STATUSES = new Set(['verified', 'website_published']);
const NOISE_DOMAINS = ['sentry.io', 'wixpress.com', 'example.com', 'sentry-next.wixpress.com', 'godaddy.com', 'cloudflare.com', 'wix.com', 'squarespace.com', 'jimdo.com', 'domain.com', 'email.com', 'yourdomain.com', 'sentry.wixpress.com',
  // template/placeholder domains that ship with site builders — never real contacts
  'mysite.com', 'misitio.com', 'mydomain.com', 'tudominio.com', 'tu-dominio.com', 'sitename.com', 'wixsite.com', 'test.com', 'domain.tld', 'company.com', 'empresa.com'];
// free-mail providers: accepted as a published contact ONLY via an explicit mailto:
// link and ONLY when the lead has no usable domain email (never to replace a DM).
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es', 'icloud.com', 'proton.me', 'protonmail.com', 'live.com', 'live.com.mx', 'gmx.com']);
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── env loader (no dotenv dependency) ──────────────────────────────────────
function loadApolloKey() {
  if (process.env.APOLLO_API_KEY) return process.env.APOLLO_API_KEY;
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    const m = raw.match(/^APOLLO_API_KEY=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

// ── domain helpers (dom() replicated exactly from index.html:866) ──────────
function dom(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function emailDomain(e) { const m = String(e || '').toLowerCase().match(/@([^@\s]+)$/); return m ? m[1] : ''; }
// two-part public suffixes common in LATAM/ES so e.g. foo.com.mx resolves to
// "foo.com.mx" (registrable), not "com.mx".
const TWO_PART_SUFFIX = new Set(['com.mx', 'com.ar', 'com.pe', 'com.co', 'com.br', 'com.uy', 'com.ec', 'com.bo', 'com.py', 'com.ve', 'com.gt', 'com.sv', 'com.do', 'com.pa', 'com.ni', 'com.hn', 'com.cl', 'com.pr', 'net.mx', 'org.mx', 'com.es', 'co.uk', 'org.uk', 'com.au', 'co.cr']);
function rootDomain(d) {
  const p = String(d || '').toLowerCase().split('.').filter(Boolean);
  if (p.length < 2) return d;
  const last2 = p.slice(-2).join('.');
  if (TWO_PART_SUFFIX.has(last2) && p.length >= 3) return p.slice(-3).join('.');
  return last2;
}
function domainMatches(siteDom, em) {
  const sd = rootDomain(siteDom), ed = rootDomain(emailDomain(em));
  return !!sd && !!ed && sd === ed;
}
// role/generic inbox (info@, contacto@, ventas@…) — NOT a decision-maker contact.
const ROLE_RE = /^(info|contacto?|contact|hola|hello|ventas|sales|admin|administracion|gerencia|comercial|prensa|press|rrhh|jobs|talent|hi|mail|correo|general|studio|estudio|team|equipo|booking|reservas|cuentas|finanzas|soporte|support|hey|holamundo|new\.?business|newbusiness|proyectos|projects)$/i;
function isRoleEmail(e) { const lp = String(e || '').split('@')[0].toLowerCase().replace(/[._-].*$/, ''); return ROLE_RE.test(lp) || /^(info|contacto?|ventas|hola|hello|admin|prensa|comercial)/i.test(String(e || '').split('@')[0]); }
function isNoiseEmail(e) {
  const ed = emailDomain(e);
  if (!ed) return true;
  if (NOISE_DOMAINS.includes(ed)) return true;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e)) return true;
  if (/^[a-f0-9]{16,}@/i.test(e)) return true; // hashed/sentry ids
  return false;
}
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,24}/gi;
const MAILTO_RE = /mailto:([^"'?>\s]+)/gi;

// ── free website extraction (homepage + contact/about variants) ────────────
async function fetchText(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; unabase-sweep/1.0)' },
    });
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (!/text|html|xml/i.test(ct)) return '';
    return await r.text();
  } catch { return ''; }
  finally { clearTimeout(t); }
}

async function websiteVerify(website) {
  const siteDom = dom(website);
  if (!siteDom) return null;
  const base = `https://${siteDom}`;
  const paths = ['', '/contact', '/contacto', '/about', '/nosotros'];
  const mailtoHits = new Set();
  const visibleHits = new Set();
  const pages = await Promise.all(paths.map(p => fetchText(base + p)));
  const STRICT = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,24}$/;
  const clean = s => String(s || '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
  for (const html of pages) {
    if (!html) continue;
    const mailtoRe = new RegExp(MAILTO_RE.source, 'gi');
    let m;
    while ((m = mailtoRe.exec(html))) {
      let e; try { e = clean(decodeURIComponent(m[1])); } catch { e = clean(m[1]); }
      if (STRICT.test(e) && !isNoiseEmail(e)) mailtoHits.add(e);
    }
    const visible = html.match(EMAIL_RE) || [];
    for (const e0 of visible) {
      const e = clean(e0);
      if (STRICT.test(e) && !isNoiseEmail(e)) visibleHits.add(e);
    }
  }
  const all = [...mailtoHits, ...visibleHits];
  if (!all.length) return null;
  // STRICT selection — only emails we can trust as this company's published address:
  //   1) domain-matching mailto   2) domain-matching visible
  //   3) free-mail (gmail/…) but ONLY via an explicit mailto link (real contact intent)
  // Anything non-domain & non-freemail (placeholders, partners, ad networks) is dropped.
  const domMailto = [...mailtoHits].find(e => domainMatches(siteDom, e));
  const domVisible = [...visibleHits].find(e => domainMatches(siteDom, e));
  const freeMailto = [...mailtoHits].find(e => FREEMAIL.has(emailDomain(e)));
  const chosen = domMailto || domVisible || freeMailto || null;
  if (!chosen) return null;
  return {
    email: chosen,
    via: mailtoHits.has(chosen) ? 'mailto' : 'visible',
    domainMatch: domainMatches(siteDom, chosen),
    role: isRoleEmail(chosen),
  };
}

// ── Apollo verification (mirrors tools/unlock-domains.js; keeps ONLY verified) ─
const APOLLO_TITLES = ['founder', 'co-founder', 'ceo', 'director', 'partner', 'owner', 'head', 'president', 'managing director', 'executive producer', 'productor ejecutivo'];
async function apolloVerify(domain, key) {
  try {
    const s = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 1, per_page: 10, q_organization_domains: domain, person_titles: APOLLO_TITLES }),
    });
    const sj = await s.json().catch(() => ({}));
    const ppl = (sj && sj.people) || [];
    for (const sp of ppl.slice(0, 4)) {
      await sleep(700);
      if (!sp.id) continue;
      const m = await fetch('https://api.apollo.io/api/v1/people/match', {
        method: 'POST',
        headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sp.id, reveal_personal_emails: true }),
      });
      const mj = await m.json().catch(() => ({}));
      const p = mj && mj.person;
      if (!p) continue;
      const email = p.email && !String(p.email).includes('not_unlocked') ? p.email : null;
      const status = p.email_status || null;
      // STRICT: only Apollo-confirmed verified is acceptable as primary.
      if (email && status === 'verified' && !isNoiseEmail(email)) {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
        return {
          email: email.toLowerCase(),
          name: name && name.split(/\s+/).length >= 2 ? name : null,
          title: p.title || null,
          linkedin: p.linkedin_url || null,
          phone: (p.phone_numbers && p.phone_numbers[0] && p.phone_numbers[0].sanitized_number) || null,
        };
      }
    }
    return null;
  } catch { return null; }
}

// ── load files ───────────────────────────────────────────────────────────
function load(file) {
  const fp = path.join(PUBLIC, file);
  return { fp, leads: JSON.parse(fs.readFileSync(fp, 'utf8')) };
}
function isTarget(l) {
  if (!l.contactEmail) return false;
  return !l._emailStatus || !VERIFIED_STATUSES.has(l._emailStatus);
}

// ── patchers ─────────────────────────────────────────────────────────────
// contactEmail becomes (or already is) a verified site-published address.
function markPublished(l, email, hit, ts) {
  if (email !== l.contactEmail) { l._emailReplaced = l.contactEmail || null; l.contactEmail = email; }
  l._emailStatus = 'website_published';
  l._emailVerifiedAt = ts;
  l._emailVerificationSource = `website:${hit.via}:domain-match`;
  l._emailSweepNote = hit.role
    ? 'Verified company inbox published on site (role address; no named DM email available).'
    : 'Email confirmed published on company site.';
}
// keep the named DM as primary (doctrine: decision-maker contact) but record the
// verified company inbox as a deliverable fallback. DM itself stays unverified.
function markNamedKept(l, inbox, hit, ts) {
  l._emailFallback = inbox;
  l._emailFallbackStatus = 'website_published';
  l._emailFallbackSource = `website:${hit.via}:domain-match`;
  l._emailStatus = 'named_unverified';
  l._emailVerifiedAt = ts;
  l._emailVerificationSource = 'sweep:dm-kept-site-fallback';
  l._emailSweepNote = `Kept named DM (${l.contactEmail}) as primary; verified company inbox ${inbox} stored as fallback. DM address NOT yet verified — confirm via Apollo.`;
}
// plausible same-domain named DM, but the site gave us nothing to confirm it.
function markNamedUnverified(l, ts) {
  l._emailStatus = 'named_unverified';
  l._emailVerifiedAt = ts;
  l._emailVerificationSource = 'sweep:dm-unconfirmed';
  l._emailSweepNote = `Named DM (${l.contactEmail}) on company domain but not confirmed on site. Deliverability UNVERIFIED — confirm via Apollo before treating as primary.`;
}
function applyApolloHit(l, hit, ts) {
  l.contactEmail = hit.email;
  if (hit.name) l.contactName = hit.name;
  if (hit.title) l.contactTitle = hit.title;
  if (hit.phone && !l.contactPhone) l.contactPhone = hit.phone;
  l._emailStatus = 'verified';
  l._emailVerifiedAt = ts;
  l._emailVerificationSource = 'apollo:email_status=verified';
  l._emailSweepNote = `Apollo-verified DM email${hit.linkedin ? ` | LinkedIn: ${hit.linkedin}` : ''}.`;
}
function applyNoEmail(l, ts) {
  l._emailStatus = 'no_verified_email';
  l._emailVerifiedAt = ts;
  l._emailVerificationSource = 'sweep:none-found';
  l._emailSweepNote = 'No deliverable email confirmed (website + Apollo). Email primary channel MISSING — original contactEmail left in place but NOT verified.';
  // best fallback only if already known
  if (l.channelPriority && l.channelPriority.secundario) {
    l.channelPriority = { ...l.channelPriority, primario: l.channelPriority.secundario };
  }
}

// ── Supabase PATCH (only matching rows; filtered by id + client_id) ─────────
async function patchSupabase(l) {
  const id = dom(l.website);
  if (!id) return { ok: false, reason: 'no-id' };
  const url = `${SB_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}`;
  try {
    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        contact_email: l.contactEmail || null,
        contact_name: l.contactName || null,
        lead_data: l,
        updated_at: now(),
      }),
    });
    if (!r.ok) return { ok: false, reason: `http ${r.status}` };
    const rows = await r.json().catch(() => []);
    return { ok: true, matched: Array.isArray(rows) ? rows.length : 0 };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  // Target selector. Default = unverified-email leads. --cohort = ONLY the
  // revived/reactivated leads (the set that may have skipped the newer
  // email_status verification). NOTE: a missing _emailStatus is NORMAL, not
  // "invalid" — cohort mode is the doctrine-correct, narrow scope.
  const COHORT_TAGS = ['_reactivationMode', '_revivedFromPilot', '_recoveredFrom'];
  const inCohort = l => COHORT_TAGS.some(t => l[t]);
  const selects = l => MODE_COHORT ? inCohort(l) : isTarget(l);

  const datasets = FILES.map(load);
  const targets = [];
  for (const ds of datasets) {
    for (const l of ds.leads) if (selects(l)) targets.push({ ds, l });
  }

  // step 3 — compact target count
  const byFile = {};
  for (const ds of datasets) byFile[path.basename(ds.fp)] = ds.leads.filter(selects).length;
  console.log('── sweep-unverified-emails ──');
  console.log('total targets : ' + targets.length);
  console.log('by file       : ' + JSON.stringify(byFile));
  console.log('first 10:');
  targets.slice(0, 10).forEach(({ l }) => {
    console.log('  - ' + (dom(l.website) || '?').padEnd(28) + ' | ' + String(l.companyName || '?').slice(0, 24).padEnd(24) + ' | ' + (l.contactEmail || ''));
  });

  if (!MODE_WEB) {
    console.log('\n[scan only] no --web flag → no network, no writes.');
    console.log('Apollo pre-flight: up to ' + targets.length + ' domains could need Apollo if website fails.');
    console.log('Next: --web (free website pass) then optionally --apollo --max-unlocks=N.');
    return;
  }

  // step 4 — verify
  const summary = { swept: 0, alreadyProcessed: 0, replaced: 0, websitePublished: 0, namedKept: 0, namedUnverified: 0, apolloVerified: 0, noVerifiedEmail: 0, errors: 0 };
  const report = [];
  const changed = []; // leads to push to supabase
  let processed = 0;
  let apolloUsed = 0;
  const apolloKey = MODE_APOLLO ? loadApolloKey() : null;
  if (MODE_APOLLO && !apolloKey) { console.error('\nABORT: --apollo set but APOLLO_API_KEY not found in ' + ENV_PATH); process.exit(1); }

  // writeAll() — checkpoint: persist all files + report. Called every
  // CHECKPOINT_EVERY leads and once at the end. Makes the run RESUMABLE: a
  // crash loses at most CHECKPOINT_EVERY leads, and re-running skips leads
  // already marked verified/website_published (isTarget excludes them).
  const CHECKPOINT_EVERY = 15;
  const filesModified = [];
  function writeAll() {
    // Lead files are mutated ONLY with --apply. Without it this is report-only:
    // we still compute every verification result + write the report, but never
    // touch live lead data (a client is on this system).
    if (MODE_APPLY) {
      for (const ds of datasets) {
        fs.writeFileSync(ds.fp, JSON.stringify(ds.leads, null, 2)); // no trailing newline → matches existing format, minimal diff
        if (!filesModified.includes(path.basename(ds.fp))) filesModified.push(path.basename(ds.fp));
      }
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ at: now(), mode: { MODE_WEB, MODE_APPLY, MODE_APOLLO, MAX_UNLOCKS, LIMIT }, summary, report }, null, 2) + '\n');
  }

  for (const { ds, l } of targets) {
    if (processed >= LIMIT) break;
    processed++; summary.swept++;
    const ts = now();
    const before = l.contactEmail;
    const rec = {
      file: path.basename(ds.fp), company: l.companyName, domain: dom(l.website),
      before: before || null, currentStatus: l._emailStatus || '(none)',
      cohortTags: COHORT_TAGS.filter(t => l[t]), result: null,
    };
    // cohort audit: leads that already carry a status already went through the
    // newer verification — record + skip (no fetch). Focus is the ones missing it.
    if (MODE_COHORT && l._emailStatus) {
      summary.alreadyProcessed++;
      rec.result = 'already_processed:' + l._emailStatus;
      report.push(rec);
      continue;
    }
    try {
      let done = false;
      const site = dom(l.website);
      // A "specific" existing address (a named DM, or any non-role/non-freemail
      // inbox) is NEVER overwritten by the sweep — doctrine: don't replace DMs.
      // We only SET/REPLACE when the existing email is empty or a generic role inbox.
      const exExists = !!before;
      const exSpecific = exExists && !isRoleEmail(before); // includes named-DM AND freemail personal
      // 4a free website pass (domain-matching published email only)
      const web = await websiteVerify(l.website);
      if (web && web.email) {
        if (web.email === before) {
          markPublished(l, web.email, web, ts);          // existing email confirmed on site
          summary.websitePublished++;
          rec.result = 'website_published(confirmed)';
          changed.push(l); done = true;
        } else if (exSpecific) {
          markNamedKept(l, web.email, web, ts);          // keep existing specific addr; site email = fallback
          summary.namedKept++;
          rec.result = 'kept_existing(fallback=' + web.email + ')';
          changed.push(l); done = true;
        } else {
          markPublished(l, web.email, web, ts);          // existing empty/role → safe to set verified site email
          summary.websitePublished++;
          if (l.contactEmail !== before) summary.replaced++;
          rec.result = 'website_published(set):' + l.contactEmail;
          changed.push(l); done = true;
        }
      }
      // 4b apollo (budget-capped, opt-in)
      if (!done && MODE_APOLLO && apolloUsed < MAX_UNLOCKS) {
        apolloUsed++;
        const ap = await apolloVerify(site, apolloKey);
        if (ap && ap.email) {
          applyApolloHit(l, ap, ts);
          summary.apolloVerified++;
          if (l.contactEmail !== before) summary.replaced++;
          rec.result = 'apollo_verified:' + l.contactEmail;
          changed.push(l); done = true;
        }
      }
      // 4c nothing verified
      if (!done) {
        if (exSpecific) {
          markNamedUnverified(l, ts);                    // specific existing addr, unconfirmed → keep, needs Apollo
          summary.namedUnverified++;
          rec.result = 'kept_existing(unverified)';
        } else {
          applyNoEmail(l, ts);                           // empty/role + nothing found
          summary.noVerifiedEmail++;
          rec.result = 'no_verified_email';
        }
        changed.push(l);
      }
    } catch (e) {
      summary.errors++;
      rec.result = 'ERROR:' + e.message;
    }
    report.push(rec);
    if (processed % CHECKPOINT_EVERY === 0) writeAll();
  }

  // step 5 — final write
  writeAll();

  // step 7 — supabase (after files patched)
  let sbOk = 0, sbMiss = 0, sbErr = 0;
  if (MODE_SUPABASE) {
    for (const l of changed) {
      const r = await patchSupabase(l);
      if (r.ok && r.matched > 0) sbOk++;
      else if (r.ok) sbMiss++;
      else sbErr++;
    }
  }

  // step 8 — compact summary
  console.log('\n── result ' + (MODE_APPLY ? '(APPLIED — lead files mutated)' : '(REPORT-ONLY — no lead files touched; pass --apply to mutate)') + ' ──');
  console.log('swept            : ' + summary.swept);
  if (MODE_COHORT) console.log('already_processed: ' + summary.alreadyProcessed + '  (had _emailStatus, skipped)');
  console.log('website_published: ' + summary.websitePublished + '  (verified, primary)');
  console.log('named_kept       : ' + summary.namedKept + '  (DM primary, verified inbox fallback)');
  console.log('named_unverified : ' + summary.namedUnverified + '  (DM kept, needs Apollo)');
  console.log('apollo_verified  : ' + summary.apolloVerified + (MODE_APOLLO ? ` (unlocks ${apolloUsed}/${MAX_UNLOCKS})` : ' (apollo off)'));
  console.log('replaced email   : ' + summary.replaced + '  (only empty/role/wrong-domain)');
  console.log('no_verified_email: ' + summary.noVerifiedEmail);
  console.log('errors           : ' + summary.errors);
  console.log('files modified   : ' + (MODE_APPLY ? (filesModified.join(', ') || '(none)') : '(report-only)'));
  if (MODE_SUPABASE) console.log('supabase patched : ' + sbOk + ' ok, ' + sbMiss + ' no-row, ' + sbErr + ' err');
  console.log('report           : scripts/' + path.basename(REPORT_PATH));
  if (MODE_APOLLO && apolloUsed >= MAX_UNLOCKS && summary.noVerifiedEmail > 0)
    console.log('NOTE: hit --max-unlocks cap; re-run with higher cap to sweep the rest.');

  // step 9 — commit + push
  if (MODE_COMMIT) {
    try {
      // add ONLY the sweep-target files by name (never a public/*.json glob —
      // public/ holds ~40 untracked historical batch files we must not commit).
      const addList = FILES.map(f => 'public/' + f).concat(['scripts/sweep-unverified-emails.js', 'scripts/' + path.basename(REPORT_PATH)]);
      execSync('git add ' + addList.map(x => JSON.stringify(x)).join(' '), { cwd: APP_ROOT, stdio: 'inherit' });
      execSync(`git commit -m "Sweep unverified emails: ${summary.websitePublished} website-published, ${summary.apolloVerified} apollo-verified, ${summary.noVerifiedEmail} flagged no-email"`, { cwd: APP_ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: APP_ROOT, stdio: 'inherit' });
      console.log('git: committed + pushed.');
    } catch (e) { console.error('git step failed: ' + e.message); }
  } else {
    console.log('git: skipped (no --commit).');
  }
})();
