#!/usr/bin/env node
// link-liveness.js — pre-deploy gate: every client-clickable link must resolve LIVE.
// "No black screens." Checks each lead's website + instagramUrl actually open to a real page.
//
// Usage:
//   node scripts/link-liveness.js public/leads-2026-07-02.json          # report
//   node scripts/link-liveness.js --gate public/leads-2026-07-02.json   # exit 1 if any dead link
//
// Checks:
//   website     -> HTTP 200-399, non-empty body, not a known parked/expired marker
//   instagramUrl-> reachable AND not IG's "page isn't available / removed" marker
// A field that is null/absent is SKIPPED (email-only leads are allowed by protocol #2/#3),
// but a field that is PRESENT and dead is a FAILURE.

const fs = require('fs');

const args = process.argv.slice(2);
const gate = args.includes('--gate');
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node scripts/link-liveness.js [--gate] <leads-file.json>'); process.exit(2); }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PARKED = [/domain (is )?for sale/i, /buy this domain/i, /parkingcrew/i, /sedoparking/i, /godaddy\.com\/domainsearch/i, /this domain is parked/i, /account suspended/i, /future home of something/i];
const IG_DEAD = [/Sorry, this page isn'?t available/i, /page isn'?t available/i, /the link you followed may be broken/i, /Page Not Found/i, /content isn'?t available/i, /user not found/i];

async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } });
    const body = await r.text().catch(() => '');
    return { status: r.status, body, finalUrl: r.url };
  } finally { clearTimeout(t); }
}

async function checkWebsite(url) {
  try {
    const { status, body } = await fetchWithTimeout(url);
    if (status < 200 || status >= 400) return { ok: false, reason: `HTTP ${status}` };
    if (!body || body.trim().length < 200) return { ok: false, reason: 'empty/blank body' };
    for (const p of PARKED) if (p.test(body)) return { ok: false, reason: 'parked/suspended domain' };
    return { ok: true, reason: `HTTP ${status}` };
  } catch (e) { return { ok: false, reason: (e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message)) }; }
}

async function checkInstagram(url) {
  try {
    const { status, body } = await fetchWithTimeout(url);
    if (status === 404) return { ok: false, reason: 'HTTP 404' };
    if (status >= 500) return { ok: false, reason: `HTTP ${status}` };
    for (const p of IG_DEAD) if (p.test(body)) return { ok: false, reason: 'IG: page not available' };
    // A live profile page exposes an og:title / al:ios metadata or the handle in title.
    const hasProfileMeta = /og:title/i.test(body) || /profilePage|ProfilePage|"@type":"Person"/i.test(body) || /al:ios:url/i.test(body);
    if (status >= 200 && status < 400 && hasProfileMeta) return { ok: true, reason: `HTTP ${status} live` };
    // IG often login-walls with 200 but still renders profile meta for real accounts; if none present, flag for manual.
    if (status >= 200 && status < 400) return { ok: true, reason: `HTTP ${status} (login-wall; no dead marker)`, soft: true };
    return { ok: false, reason: `HTTP ${status}` };
  } catch (e) { return { ok: false, reason: (e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message)) }; }
}

(async () => {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const leads = Array.isArray(raw) ? raw : (raw.leads || []);
  const fails = [];
  const softs = [];
  let checked = 0;

  for (const l of leads) {
    const name = l.companyName || l.company || l.website || '?';
    const web = l.website || null;
    const ig = l.instagramUrl || (l.instagramHandle ? 'https://www.instagram.com/' + String(l.instagramHandle).replace(/^@/, '') + '/' : null);

    if (web) {
      checked++;
      const r = await checkWebsite(web);
      if (!r.ok) fails.push({ name, field: 'website', url: web, reason: r.reason });
    }
    if (ig) {
      checked++;
      const r = await checkInstagram(ig);
      if (!r.ok) fails.push({ name, field: 'instagram', url: ig, reason: r.reason });
      else if (r.soft) softs.push({ name, url: ig });
    }
  }

  console.log(`\nLINK-LIVENESS: ${leads.length} leads, ${checked} links checked.`);
  if (softs.length) {
    console.log(`\n~ ${softs.length} IG login-walled (no dead marker; spot-check manually):`);
    softs.forEach(s => console.log(`   ~ ${s.name}  ${s.url}`));
  }
  if (fails.length) {
    console.log(`\n✖ ${fails.length} DEAD LINK(S):`);
    fails.forEach(f => console.log(`   ✖ ${f.name} [${f.field}] ${f.url}  →  ${f.reason}`));
  } else {
    console.log('\n✔ all present links resolve live (0 dead).');
  }

  if (gate && fails.length) { console.error(`\nGATE FAIL: ${fails.length} dead link(s). Fix the data and re-run.`); process.exit(1); }
  process.exit(0);
})();
