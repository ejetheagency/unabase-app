#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/apply-batch-verified-stamps.js
//
// Records the deliverability verification of today's original batch. For each
// of the 8 original-batch domains whose CURRENT contactEmail matches an
// Apollo-VERIFIED DM (from scripts/evidence/<domain>.json), stamp:
//   _emailStatus="verified", _emailVerifiedAt, _emailVerificationSource
// FILES ONLY. Guard: never stamps unless current contactEmail == a verified DM
// email; never changes contactEmail/contactName/anything else.
//
//   node scripts/apply-batch-verified-stamps.js          # DRY-RUN
//   node scripts/apply-batch-verified-stamps.js --apply

const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const EVID = path.join(__dirname, 'evidence');
const APPLY = process.argv.includes('--apply');
const TS = new Date().toISOString();
const dom = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const DOMAINS = ['fightfilms.la', 'woofilms.tv', 'unlimitedfilms.com', 'mangofilms.com', 'cactuscine.com', 'altanafilms.com', 'traziende.mx', 'sur-film.com'];

// verified DM emails per domain (from evidence)
const verifiedEmails = {};
for (const d of DOMAINS) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(EVID, d + '.json'), 'utf8'));
    const dms = s.runs[s.runs.length - 1].candidates.dms || [];
    verifiedEmails[d] = new Set(dms.filter(x => x.email_status === 'verified' && x.email).map(x => x.email.toLowerCase()));
  } catch { verifiedEmails[d] = new Set(); }
}

const fp = path.join(PUBLIC, 'leads-2026-05-28.json');
const leads = JSON.parse(fs.readFileSync(fp, 'utf8'));
const log = []; const guard = [];
let touched = 0;
for (const l of leads) {
  const d = dom(l.website);
  if (!verifiedEmails[d]) continue;
  const em = (l.contactEmail || '').toLowerCase();
  if (!em || !verifiedEmails[d].has(em)) { guard.push(d + ' — current email not in verified set (' + (em || 'empty') + ') — NOT stamped'); continue; }
  if (l._emailStatus === 'verified') { log.push(d + ' — already verified'); continue; }
  if (APPLY) {
    l._emailStatus = 'verified';
    l._emailVerifiedAt = TS;
    l._emailVerificationSource = 'apollo-verified:batch-audit-2026-05-28';
  }
  log.push(d + ' → verified (' + em + ')');
  touched++;
}
if (APPLY && touched) fs.writeFileSync(fp, JSON.stringify(leads, null, 2));
console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — batch verified-stamps: ${touched}`);
log.forEach(x => console.log('  ' + x));
if (guard.length) console.log('GUARD (not stamped):\n  ' + guard.join('\n  '));
