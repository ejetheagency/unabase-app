#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/apply-groupA.js
//
// Operator-approved "Group A minus Grappi" enrichment. FILES-ONLY, guarded.
// Exactly four changes, nothing else:
//   1. Zeta Positivo (zetapositivo.com.ar): fill empty contactEmail =
//      info@zetapositivo.com.ar (website footer) + stamp website_published;
//      DEDUP — keep the leads-past.json copy (always-loaded pool), REMOVE the
//      byte-identical duplicate from leads-2026-05-27.json (archived batch).
//   2. Doin Media (doinmedia.com): contactName=Carolina Guerrero, title=CEO.
//   3. Intelygente (intelygente.net): contactName=Pablo Castro, title=Founder, Strategy & Direction.
//   4. Magma Cine (magmacine.com.ar): contactName=Juan Pablo Gugliotta, title=Co-founder & Producer.
//
// GUARDS: name fields are only SET when currently empty (never overwrite);
// Zeta email only set when currently empty. Aborts on any guard violation.
// Grappi, identity (Aqua/Brodaju/Mun), ICP, and unconfirmed-email decisions are
// intentionally OUT OF SCOPE.
//
//   node scripts/apply-groupA.js          # DRY-RUN (default)
//   node scripts/apply-groupA.js --apply  # write files only

const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const APPLY = process.argv.includes('--apply');
const TS = new Date().toISOString();
const dom = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const NAMES = {
  'doinmedia.com': { n: 'Carolina Guerrero', t: 'CEO' },
  'intelygente.net': { n: 'Pablo Castro', t: 'Founder, Strategy & Direction' },
  'magmacine.com.ar': { n: 'Juan Pablo Gugliotta', t: 'Co-founder & Producer' },
};
const ZETA = 'zetapositivo.com.ar';
const ZETA_EMAIL = 'info@zetapositivo.com.ar';

const log = []; const guardFail = [];

function handle(file) {
  const fp = path.join(PUBLIC, file);
  let leads = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let touched = false;

  // dedup Zeta out of the archived -27 batch (keep the past copy)
  if (file === 'leads-2026-05-27.json') {
    const before = leads.length;
    const zetas = leads.filter(l => dom(l.website) === ZETA);
    if (zetas.length) {
      leads = leads.filter(l => dom(l.website) !== ZETA);
      log.push(`DEDUP: removed ${zetas.length} Zeta dup from ${file} (kept past copy)`);
      touched = true;
    }
  }

  for (const l of leads) {
    const d = dom(l.website);
    if (NAMES[d]) {
      const { n, t } = NAMES[d];
      if (l.contactName && l.contactName.trim()) { guardFail.push(`${file}:${d} contactName already set (${l.contactName}) — refuse overwrite`); continue; }
      if (APPLY) { l.contactName = n; if (!l.contactTitle) l.contactTitle = t; l.contactSource = 'website-team-page-cycle2'; }
      log.push(`NAME: ${d} → ${n} / ${t}`);
      touched = true;
    }
    if (d === ZETA && file === 'leads-past.json') {
      if (l.contactEmail && l.contactEmail.trim()) { guardFail.push(`${file}:${d} contactEmail already set (${l.contactEmail}) — refuse overwrite`); continue; }
      if (APPLY) {
        l.contactEmail = ZETA_EMAIL;
        l._emailStatus = 'website_published';
        l._emailVerifiedAt = TS;
        l._emailVerificationSource = 'website:footer';
        l._emailSweepNote = 'Filled from website footer mailto (cycle-2). DM Maximiliano Gaspar not verified on site.';
      }
      log.push(`EMAIL: ${d} (empty) → ${ZETA_EMAIL} [website_published]`);
      touched = true;
    }
  }

  if (APPLY && guardFail.length) { console.error('ABORT — guard:\n  ' + guardFail.join('\n  ')); process.exit(1); }
  if (APPLY && touched) fs.writeFileSync(fp, JSON.stringify(leads, null, 2));
  return touched;
}

['leads-2026-05-27.json', 'leads-past.json'].forEach(handle);
console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — Group A (minus Grappi):`);
log.forEach(x => console.log('  ' + x));
if (guardFail.length) console.error('GUARD (would abort on --apply):\n  ' + guardFail.join('\n  '));
