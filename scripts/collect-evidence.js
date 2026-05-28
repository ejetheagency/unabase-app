#!/usr/bin/env node
/* eslint-disable no-console */
// tools/collect-evidence.js — READ-ONLY evidence collector PROTOTYPE.
//
// Restores peak-hunter collection power (puppeteer JS render + hydrateScroll +
// multi-page footer/contact/team discovery + JSON-LD + IG/LinkedIn/phone/DM
// extraction + optional Apollo email_status) but writes ONLY to an append-only
// evidence store. It NEVER touches public/leads-*.json, Supabase, manifest,
// git, or any lifecycle/contact field. Report-only.
//
//   node tools/collect-evidence.js                 # default targets
//   node tools/collect-evidence.js dom1 dom2 ...    # specific domains
//   node tools/collect-evidence.js --apollo         # also capture Apollo email_status
//
// Output: ../unabase-app/scripts/evidence/<domain>.json  (append-only runs[])

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = null; }

const EVID_DIR = path.join(__dirname, '..', '..', 'unabase-app', 'scripts', 'evidence');
const APP_PUBLIC = path.join(__dirname, '..', '..', 'unabase-app', 'public');
const APOLLO = process.argv.includes('--apollo');
const argTargets = process.argv.slice(2).filter(a => !a.startsWith('--'));
const TARGETS = argTargets.length ? argTargets : ['grappi.cl', 'aquafilms.com.ar', 'anchoitafilms.com.ar', 'kuarzo.com', 'mariachifilms.com'];
const PAGE_PATHS = ['', '/contacto', '/contact', '/contact-us', '/nosotros', '/about', '/about-us', '/equipo', '/team', '/quienes-somos', '/somos'];

// ── helpers ──────────────────────────────────────────────────────────────
const TWO = new Set(['com.mx', 'com.ar', 'com.pe', 'com.co', 'com.br', 'com.uy', 'com.ec', 'com.cl', 'com.es', 'com.gt', 'com.do', 'com.pa', 'com.ve', 'com.bo', 'co.uk']);
const rootDom = d => { const p = String(d || '').toLowerCase().split('.').filter(Boolean); if (p.length < 2) return d; const l2 = p.slice(-2).join('.'); return (TWO.has(l2) && p.length >= 3) ? p.slice(-3).join('.') : l2; };
const eDom = e => { const m = String(e || '').toLowerCase().match(/@([^@\s]+)$/); return m ? m[1] : ''; };
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'proton.me', 'protonmail.com', 'live.com']);
const NOISE = new Set(['sentry.io', 'wixpress.com', 'example.com', 'mysite.com', 'misitio.com', 'mydomain.com', 'sentry.wixpress.com', 'domain.com', 'email.com', 'wix.com']);
const ROLE_RE = /^(info|contacto?|contact|hola|hello|ventas|sales|admin|prensa|comercial|general|direccion|soporte|hi|mail|correo)/i;
// Boundary-safe email regex run over RAW HTML (tags separate tokens, so adjacent
// UI labels can't glue onto an address the way cheerio .text() did). Lookbehind/
// lookahead reject mid-token starts and trailing-word glue.
const RAW_EMAIL_RE = /(?<![A-Za-z0-9._%+\-@])[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}(?![A-Za-z0-9.\-])/g;
const STRICT = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,24}$/;
// Real TLDs only — kills glued artifacts whose "TLD" is junk (.cls/.clenviar/.clhorario).
const VALID_TLD = new Set(('com net org io co tv video app studio agency film films media digital design xyz info biz online site shop world live life fm gg me cc club work productions production ' +
  'cl ar mx pe es uy ec br gt do pa ve bo cr ni hn sv us uk ca fr de it nl se no fi pt ie ch at pl cz ro be dk').split(' '));
const validTld = d => { const p = String(d || '').toLowerCase().split('.'); return VALID_TLD.has(p[p.length - 1]); };
const isRole = e => ROLE_RE.test(String(e || '').split('@')[0]);
const isNoise = e => { const d = eDom(e); return !d || NOISE.has(d) || /\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e) || /^[a-f0-9]{16,}@/i.test(e); };
const validEmail = e => { e = String(e || '').toLowerCase().trim(); return STRICT.test(e) && !isNoise(e) && validTld(eDom(e)); };
// person-name gate for heuristic DM sources (NOT applied to Apollo data)
const isPersonName = n => {
  n = String(n || '').trim();
  if (!/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ'’.]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ'’.]+){1,3}$/.test(n)) return false;
  if (/(productora|films?|studio|estudio|audiovisual|media|cine|agency|agencia|company|compañ|productions?|content|contenido|l[ií]der|marketing|digital|group|grupo|team|equipo|nosotros|servicios|contacto|portfolio|brand|creativ)/i.test(n)) return false;
  return true;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── puppeteer page render (goSmart + hydrateScroll equivalents) ───────────
async function renderPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
  } catch {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch { return null; }
  }
  try {
    await page.evaluate(async () => { // hydrateScroll — trigger lazy content
      await new Promise(res => { let y = 0; const t = setInterval(() => { window.scrollBy(0, 600); y += 600; if (y >= document.body.scrollHeight + 1200 || y > 25000) { clearInterval(t); res(); } }, 90); });
    });
    await sleep(400);
  } catch {}
  try { return await page.content(); } catch { return null; }
}

// ── extract candidates from one rendered page ─────────────────────────────
function extractPage(html, pageUrl, siteDom, acc) {
  const $ = cheerio.load(html);
  const inFooter = el => $(el).parents('footer,[class*=footer],[id*=footer]').length > 0;
  const note = (map, key, src, extra) => { if (!map[key]) map[key] = { sources: new Set(), ...extra }; map[key].sources.add(src); if (extra) Object.assign(map[key], extra, { sources: map[key].sources }); };
  // email accumulator now tracks distinct METHODS (mailto/visible/jsonld/apollo) + pages
  const addEmail = (raw, method) => { const e = String(raw || '').toLowerCase().trim(); if (!validEmail(e)) return; if (!acc.emails[e]) acc.emails[e] = { methods: new Set(), pages: new Set() }; acc.emails[e].methods.add(method); acc.emails[e].pages.add(pageUrl); };

  // EMAILS — structured mailto first, then boundary-safe visible from RAW HTML
  $('a[href^="mailto:"]').each((_, a) => addEmail(decodeURIComponent(($(a).attr('href') || '').replace(/^mailto:/i, '').split('?')[0]), 'mailto'));
  (html.match(RAW_EMAIL_RE) || []).forEach(e0 => addEmail(e0, 'visible'));

  // social links
  $('a[href]').each((_, a) => {
    const h = ($(a).attr('href') || '').toLowerCase();
    const foot = inFooter(a);
    let m;
    if ((m = h.match(/instagram\.com\/([a-z0-9_.]+)/i))) { const hd = m[1].replace(/\/$/, ''); if (hd && !['p', 'reel', 'explore', 'accounts', 'tv'].includes(hd)) note(acc.igs, hd, pageUrl, { footerCanonical: foot || (acc.igs[hd] && acc.igs[hd].footerCanonical) }); }
    else if ((m = h.match(/linkedin\.com\/(company|in)\/([a-z0-9\-_%]+)/i))) note(acc.linkedins, 'linkedin.com/' + m[1] + '/' + m[2], pageUrl);
    else if ((m = h.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\+?\d[\d\s\-]{6,})/i))) note(acc.phones, m[1].replace(/[\s\-]/g, ''), pageUrl, { kind: 'whatsapp' });
  });
  $('a[href^="tel:"]').each((_, a) => { const t = ($(a).attr('href') || '').replace(/^tel:/i, '').replace(/[\s\-()]/g, ''); if (/\+?\d{7,}/.test(t)) note(acc.phones, t, pageUrl, { kind: 'tel' }); });

  // JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const data = JSON.parse($(s).contents().text());
      const arr = Array.isArray(data) ? data : [data];
      for (const o of arr) {
        if (!o || typeof o !== 'object') continue;
        if (o.email) addEmail(String(o.email).replace(/^mailto:/i, ''), 'jsonld');
        if (o.telephone) note(acc.phones, String(o.telephone).replace(/[\s\-()]/g, ''), 'jsonld', { kind: 'jsonld' });
        (Array.isArray(o.sameAs) ? o.sameAs : [o.sameAs]).filter(Boolean).forEach(u => { const m = String(u).match(/instagram\.com\/([a-z0-9_.]+)/i); if (m) note(acc.igs, m[1].replace(/\/$/, ''), 'jsonld', { jsonld: true }); });
        for (const f of [].concat(o.founder || [], o.employee || [], o.author || [])) { const nm = f && (typeof f === 'string' ? f : f.name); if (nm && isPersonName(nm)) acc.dms.push({ name: String(nm).trim(), title: (f && f.jobTitle) || 'founder/employee (JSON-LD)', source: 'jsonld' }); }
      }
    } catch {}
  });

  // DMs — STRUCTURED team cards only (name + separate title, both valid). The old
  // broad role-keyword-anywhere heuristic is REMOVED (it captured taglines).
  $('[class*=team],[class*=Team],[class*=member],[class*=Member],[class*=equipo],[class*=Equipo],[class*=staff],[class*=persona],[itemtype*=Person]').slice(0, 300).each((_, el) => {
    const $el = $(el);
    const name = ($el.find('[itemprop=name]').first().text() || $el.find('h1,h2,h3,h4,h5,strong,b').first().text() || '').trim();
    const title = ($el.find('[itemprop=jobTitle]').first().text() || $el.children('p,span,em,small').first().text() || '').trim();
    if (isPersonName(name) && title && title !== name && title.length >= 2 && title.length <= 60 && !isPersonName(title)) {
      acc.dms.push({ name, title: title.replace(/\s+/g, ' ').slice(0, 60), source: 'team-card' });
    }
  });
}

// ── Apollo email_status (reuses unlock-domains.js logic) ──────────────────
async function apolloDMs(domain) {
  const KEY = process.env.APOLLO_API_KEY; if (!KEY) return [];
  const TITLES = ['founder', 'co-founder', 'ceo', 'director', 'partner', 'owner', 'head', 'president', 'managing director', 'executive producer'];
  try {
    const s = await axios.post('https://api.apollo.io/api/v1/mixed_people/api_search', { page: 1, per_page: 10, q_organization_domains: domain, person_titles: TITLES }, { headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json' }, timeout: 30000 });
    const out = [];
    for (const sp of (s.data?.people || []).slice(0, 4)) {
      await sleep(700); if (!sp.id) continue;
      try {
        const m = await axios.post('https://api.apollo.io/api/v1/people/match', { id: sp.id, reveal_personal_emails: true }, { headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json' }, timeout: 30000 });
        const p = m.data?.person; if (!p) continue;
        const email = p.email && !String(p.email).includes('not_unlocked') ? String(p.email).toLowerCase() : null;
        out.push({ name: [p.first_name, p.last_name].filter(Boolean).join(' '), title: p.title || null, email, email_status: p.email_status || null, linkedin: p.linkedin_url || null });
      } catch {}
    }
    return out;
  } catch { return []; }
}

// ── confidence tiering ────────────────────────────────────────────────────
function tierEmail(email, info, siteDom, apollo) {
  const ap = apollo.find(a => a.email === email);
  if (ap && ap.email_status === 'verified') return 'VERIFIED';
  const domMatch = rootDom(eDom(email)) === rootDom(siteDom);
  // PUBLISHED requires a STRUCTURED WEBSITE source (mailto/jsonld) on a domain-
  // matching address. Apollo does NOT confer PUBLISHED — Apollo only grants
  // VERIFIED (above) when email_status==='verified'; an unverified/extrapolated
  // Apollo email is a guess and must fall through to CORROBORATED/DERIVED.
  // Visible-text-only emails are also intentionally held BELOW published.
  const structured = info.methods.has('mailto') || info.methods.has('jsonld');
  if (domMatch && structured) return 'PUBLISHED';
  if (info.methods.size >= 2 || info.pages.size >= 2) return 'CORROBORATED';
  if (FREEMAIL.has(eDom(email))) return 'FREEMAIL';
  return 'DERIVED';
}

// ── current lead (READ-ONLY, for the proposal delta) ──────────────────────
function currentLead(siteDom) {
  for (const f of ['leads-2026-05-28.json', 'leads-2026-05-27.json', 'leads-past.json']) {
    try { const a = JSON.parse(fs.readFileSync(path.join(APP_PUBLIC, f), 'utf8')); const l = a.find(x => { try { return new URL(x.website).hostname.replace(/^www\./, '') === siteDom; } catch { return false; } }); if (l) return { file: f, contactName: l.contactName || null, contactEmail: l.contactEmail || null, instagramHandle: l.instagramHandle || null, _emailStatus: l._emailStatus || null }; } catch {}
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(EVID_DIR)) fs.mkdirSync(EVID_DIR, { recursive: true });
  if (!puppeteer) { console.error('puppeteer not available — abort'); process.exit(1); }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const summary = [];

  for (const domain of TARGETS) {
    const siteDom = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const base = 'https://' + siteDom;
    const acc = { emails: {}, igs: {}, linkedins: {}, phones: {}, dms: [] };
    const pagesVisited = []; let rendered = false;
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; unabase-evidence/1.0)');
    for (const p of PAGE_PATHS) {
      const url = base + p;
      const html = await renderPage(page, url);
      if (html && html.length > 200) { rendered = true; pagesVisited.push(url); extractPage(html, url, siteDom, acc); }
    }
    await page.close();

    const apollo = APOLLO ? await apolloDMs(siteDom) : [];
    apollo.forEach(a => { if (a.email && validEmail(a.email)) { if (!acc.emails[a.email]) acc.emails[a.email] = { methods: new Set(), pages: new Set() }; acc.emails[a.email].methods.add('apollo'); } if (a.name) acc.dms.push({ name: a.name, title: a.title, email: a.email, email_status: a.email_status, linkedin: a.linkedin, source: 'apollo' }); });

    // tier emails
    const emails = Object.entries(acc.emails).map(([e, info]) => ({ email: e, tier: tierEmail(e, info, siteDom, apollo), isRole: isRole(e), domainMatch: rootDom(eDom(e)) === rootDom(siteDom), methods: [...info.methods], pages: info.pages.size })).sort((a, b) => ['VERIFIED', 'PUBLISHED', 'CORROBORATED', 'FREEMAIL', 'DERIVED'].indexOf(a.tier) - ['VERIFIED', 'PUBLISHED', 'CORROBORATED', 'FREEMAIL', 'DERIVED'].indexOf(b.tier));
    const igs = Object.entries(acc.igs).map(([h, info]) => ({ handle: h, tier: (info.footerCanonical ? 'PUBLISHED' : (info.jsonld && info.sources.size >= 2 ? 'CORROBORATED' : (info.sources.size >= 1 ? 'PUBLISHED' : 'DERIVED'))), footerCanonical: !!info.footerCanonical, sources: [...info.sources] }));
    // dedup dms by name
    const seen = new Set(); const dms = acc.dms.filter(d => { const k = (d.name || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    const phones = Object.entries(acc.phones).map(([p, info]) => ({ phone: p, kind: info.kind || 'tel', sources: [...info.sources] }));

    const cur = currentLead(siteDom);
    const bestEmail = emails.find(e => e.tier === 'VERIFIED') || emails.find(e => e.tier === 'PUBLISHED' && !e.isRole) || emails.find(e => e.tier === 'PUBLISHED') || emails.find(e => e.tier === 'CORROBORATED') || emails[0] || null;
    const canonIG = igs.find(i => i.footerCanonical) || igs[0] || null;
    const proposal = {
      note: 'REPORT-ONLY — not applied. Requires safety-gate approval.',
      primaryEmailCandidate: bestEmail ? { email: bestEmail.email, tier: bestEmail.tier, role: bestEmail.isRole } : null,
      canonicalIG: canonIG ? canonIG.handle : null,
      additionalContacts: dms.slice(0, 8),
      vsCurrent: cur ? { current_contactEmail: cur.contactEmail, current_contactName: cur.contactName, current_ig: cur.instagramHandle, current_status: cur._emailStatus } : null,
    };

    // append-only evidence store
    const run = { collectedAt: new Date().toISOString(), method: rendered ? 'puppeteer+cheerio' : 'failed/unreachable', apollo: APOLLO, pagesVisited, candidates: { emails, igs, linkedins: Object.keys(acc.linkedins), phones, dms }, proposal };
    const fp = path.join(EVID_DIR, siteDom + '.json');
    let store = { domain: siteDom, runs: [] };
    if (fs.existsSync(fp)) { try { store = JSON.parse(fs.readFileSync(fp, 'utf8')); if (!Array.isArray(store.runs)) store.runs = []; } catch {} }
    store.runs.push(run);
    fs.writeFileSync(fp, JSON.stringify(store, null, 2));

    summary.push({ domain: siteDom, ok: rendered, pages: pagesVisited.length, emails: emails.length, top: bestEmail ? bestEmail.tier + ':' + bestEmail.email : '—', ig: canonIG ? canonIG.handle : '—', dms: dms.length, apolloVerified: apollo.filter(a => a.email_status === 'verified').length });
  }
  await browser.close();

  // ── compact summary ─────────────────────────────────────────────────────
  console.log('\n── evidence collected (READ-ONLY, append-only store) ──');
  for (const s of summary) console.log('  ' + s.domain.padEnd(24) + (s.ok ? 'ok ' : 'XX ') + 'pg=' + s.pages + ' em=' + s.emails + ' dm=' + s.dms + (APOLLO ? ' apolloV=' + s.apolloVerified : '') + '  ig=' + String(s.ig).padEnd(18) + ' top=' + s.top);
  console.log('\nevidence files: unabase-app/scripts/evidence/<domain>.json');
})();
