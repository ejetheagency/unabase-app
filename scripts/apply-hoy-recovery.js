#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/apply-hoy-recovery.js
//
// Promote the recovered bounced leads into TODAY's report so they render in Hoy
// as NEW leads (the bounce means no contact ever landed). For each, move its
// recovered record into leads-2026-05-28.json with source_date=today, strip the
// old reactivation/revival markers, keep _recoveredFrom (forces Hoy render), and
// REMOVE it from leads-2026-05-27.json / leads-past.json (erase old-batch register).
// Mariachi is already in the 05-28 batch. FILES ONLY (no Supabase here).
//
//   node scripts/apply-hoy-recovery.js          # DRY-RUN
//   node scripts/apply-hoy-recovery.js --apply

const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const APPLY = process.argv.includes('--apply');
const TODAY = '2026-05-28';
const dom = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const RECOVER = ['sunomonofilms.com', 'linkvids.io', 'vprovideo.com', 'aquafilms.com.ar', 'storylab.com.ar', 'grappi.cl', 'chilerayo.com'];
const STRIP = ['_reactivationMode', '_reactivationActivatedAt', '_reactivationEmailES', '_reactivationAsksForByName', '_revivedFromPilot', '_pilotRevivalReason', '_revivedAt'];

const A28 = path.join(PUBLIC, 'leads-2026-05-28.json');
const A27 = path.join(PUBLIC, 'leads-2026-05-27.json');
const APAST = path.join(PUBLIC, 'leads-past.json');
const b28 = JSON.parse(fs.readFileSync(A28, 'utf8'));
const b27 = JSON.parse(fs.readFileSync(A27, 'utf8'));
const bpast = JSON.parse(fs.readFileSync(APAST, 'utf8'));

const in28 = new Set(b28.map(l => dom(l.website)));
const log = [];
const promote = [];

for (const d of RECOVER) {
  // gather copies from -27 / past, prefer the recovered (_recoveredFrom) one
  const copies = [...b27, ...bpast].filter(l => dom(l.website) === d);
  const src = copies.find(l => l._recoveredFrom) || copies[0];
  if (!src) { log.push(d + '  — NOT FOUND (skip)'); continue; }
  if (in28.has(d)) { log.push(d + '  — already in 05-28 (skip move)'); continue; }
  const fresh = { ...src };
  for (const k of STRIP) delete fresh[k];
  fresh.source_date = TODAY;
  fresh._promotedToTodayAt = new Date().toISOString();
  fresh._promotedReason = 'bounced-email recovery — treated as new (no contact landed)';
  // _recoveredFrom already present (forces Hoy render); ensure it exists
  if (!fresh._recoveredFrom) fresh._recoveredFrom = src.contactEmail || '(was empty)';
  promote.push(fresh);
  log.push(d + '  → promoted to 05-28 as NEW (email=' + (fresh.contactEmail || '(LinkedIn channel)') + ')');
}

// build new file contents
const new28 = b28.concat(promote);
const new27 = b27.filter(l => !RECOVER.includes(dom(l.website)));
const newpast = bpast.filter(l => !RECOVER.includes(dom(l.website)));

console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — promote recovered leads into today's report (Hoy):`);
log.forEach(x => console.log('  ' + x));
console.log(`\n  leads-2026-05-28: ${b28.length} → ${new28.length}  (+${new28.length - b28.length})`);
console.log(`  leads-2026-05-27: ${b27.length} → ${new27.length}  (${new27.length - b27.length})`);
console.log(`  leads-past:       ${bpast.length} → ${newpast.length}  (${newpast.length - bpast.length})`);

if (APPLY) {
  fs.writeFileSync(A28, JSON.stringify(new28, null, 2));
  fs.writeFileSync(A27, JSON.stringify(new27, null, 2));
  fs.writeFileSync(APAST, JSON.stringify(newpast, null, 2));
  console.log('\nwritten. NOTE: Supabase status for these still reads its old value — a targeted');
  console.log('status→none reset is needed for a clean "new/sin contactar" badge (separate, your OK).');
}
