#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/apply-a1-stamps.js
//
// A1-ONLY, FILES-ONLY stamp. For the leads whose EXISTING contactEmail was
// confirmed already published on their own website (result
// 'website_published(confirmed)' in sweep-report.latest.json), set EXACTLY four
// metadata fields:
//     _emailStatus = "website_published"
//     _emailVerifiedAt
//     _emailVerificationSource
//     _emailSweepNote
//
// It touches NOTHING else: no contactEmail, no contactName/Title/Phone, no
// channelPriority, no source_date/status/messages, no lifecycle/reactivation
// fields, no Supabase, no git. Idempotent (skips already-stamped). Hard guard
// aborts the write if any contactEmail would change.
//
//   node scripts/apply-a1-stamps.js            # DRY-RUN preview (default)
//   node scripts/apply-a1-stamps.js --apply    # write files only

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const REPORT = path.join(__dirname, 'sweep-report.latest.json');
const APPLY = process.argv.includes('--apply');

const STATUS = 'website_published';
const TS = new Date().toISOString();
const SOURCE = 'website:confirmed';
const NOTE = 'Existing email confirmed published on company site (A1 stamp 2026-05-28).';
const ALLOWED = ['_emailStatus', '_emailVerifiedAt', '_emailVerificationSource', '_emailSweepNote'];

const dom = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const a1 = JSON.parse(fs.readFileSync(REPORT, 'utf8')).report
  .filter(r => typeof r.result === 'string' && r.result.startsWith('website_published(confirmed)'));

// target domains grouped by file
const byFile = {};
for (const r of a1) (byFile[r.file] = byFile[r.file] || new Set()).add(r.domain);

const changes = [];
const guardFail = [];
let touched = 0;

for (const file of Object.keys(byFile)) {
  const fp = path.join(PUBLIC, file);
  const leads = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let fileTouched = 0;
  for (const l of leads) {
    const d = dom(l.website);
    if (!byFile[file].has(d)) continue;
    if (!l.contactEmail) { guardFail.push(`${file}:${d} — no contactEmail, skipped`); continue; }
    const beforeEmail = l.contactEmail;
    if (l._emailStatus === STATUS) { changes.push({ file, d, company: l.companyName, status: 'already-stamped (skip)' }); continue; }
    if (APPLY) {
      l._emailStatus = STATUS;
      l._emailVerifiedAt = TS;
      l._emailVerificationSource = SOURCE;
      l._emailSweepNote = NOTE;
    }
    if (l.contactEmail !== beforeEmail) { guardFail.push(`${file}:${d} — contactEmail CHANGED (abort)`); }
    changes.push({ file, d, company: l.companyName, email: beforeEmail });
    touched++; fileTouched++;
  }
  // HARD GUARD: never write if any contactEmail changed
  if (APPLY && guardFail.some(g => g.includes('CHANGED'))) {
    console.error('ABORT — contactEmail mutation detected, no files written.');
    process.exit(1);
  }
  if (APPLY && fileTouched) fs.writeFileSync(fp, JSON.stringify(leads, null, 2)); // match existing format (no trailing newline)
}

if (guardFail.length) console.error('GUARD NOTES:\n  ' + guardFail.join('\n  '));
console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — A1 confirmed-email stamps: ${touched} lead(s)`);
for (const c of changes) console.log('  ' + String(c.company || '?').slice(0, 28).padEnd(28) + ' [' + c.file.replace('leads-', '').replace('.json', '') + ']  ' + (c.status || c.email));
console.log('fields set (only): ' + ALLOWED.join(', '));
