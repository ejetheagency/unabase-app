#!/usr/bin/env node
// dedup-guard.js — PERMANENT no-repeat-lead guard.
//
// A lead (by website domain) must appear in AT MOST ONE dispatched batch, ever.
// Run before every deploy, like audit-drafts.js --gate.
//
//   node scripts/dedup-guard.js          # report every cross-batch duplicate
//   node scripts/dedup-guard.js --gate   # exit nonzero if the ACTIVE batch
//                                         # reuses any domain from another batch
//
// Rationale: the operator must never be served the same company twice. The
// dashboard also dedups at render-time (gateLeads), but this stops a repeat at
// the source — the moment a batch is built — so it never ships in the first place.

const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const GATE = process.argv.includes('--gate');

const dom = u => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'reports-manifest.json'), 'utf8')); }
catch (e) { console.error('cannot read manifest:', e.message); process.exit(2); }

const batches = (manifest.batches || []).filter(b => b.file && fs.existsSync(path.join(PUB, b.file)));
const domToBatches = new Map(); // domain -> [batch_id,...]
for (const b of batches) {
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(PUB, b.file), 'utf8')); } catch { continue; }
  if (!Array.isArray(arr)) continue;
  const seenInBatch = new Set();
  for (const l of arr) {
    const d = dom(l.website || ''); if (!d || seenInBatch.has(d)) continue; seenInBatch.add(d);
    if (!domToBatches.has(d)) domToBatches.set(d, []);
    domToBatches.get(d).push(b.batch_id);
  }
}

const dups = [...domToBatches.entries()].filter(([, bs]) => bs.length > 1);
console.log(`Scanned ${batches.length} dispatched batches, ${domToBatches.size} distinct domains.`);
console.log(`Cross-batch duplicate domains: ${dups.length}`);
dups.forEach(([d, bs]) => console.log('  ' + d + ' -> ' + bs.join(', ')));

if (GATE) {
  const active = manifest.active_batch_id;
  const activeDups = dups.filter(([, bs]) => bs.includes(active));
  if (activeDups.length) {
    console.error(`\nDEDUP GATE FAILED: active batch ${active} reuses ${activeDups.length} already-shipped domain(s):`);
    activeDups.forEach(([d, bs]) => console.error('  ' + d + ' (also in ' + bs.filter(b => b !== active).join(', ') + ')'));
    process.exit(1);
  }
  console.log(`\nDEDUP GATE PASSED: active batch ${active} is fully novel (no repeated leads).`);
}
