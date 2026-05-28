#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/apply-bounced-recovery.js
//
// Recovery for the 8 leads whose main-channel email BOUNCED. Swaps each bounced
// address for the best DELIVERABLE channel found by the deep evidence collector
// (verified DM email > published email > LinkedIn worst-case), and tags
// _recoveredFrom so they surface in "Hoy" for Scarlett. FILES ONLY — no Supabase,
// no push, no deploy. (leads-2026-05-28 / Mariachi rides the batch deploy, task 2.)
//
//   node scripts/apply-bounced-recovery.js          # DRY-RUN
//   node scripts/apply-bounced-recovery.js --apply   # write files only

const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const FILES = ['leads-2026-05-28.json', 'leads-2026-05-27.json', 'leads-past.json'];
const APPLY = process.argv.includes('--apply');
const TS = new Date().toISOString();
const dom = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// domain → recovery channel (from scripts/evidence/*.json, deep collector)
const R = {
  'sunomonofilms.com': { email: 'yun@sunomonofilms.com', status: 'verified', name: 'Yun Mateo Palos', title: 'Creative Director', li: 'http://www.linkedin.com/in/yun-mateo-palos-35a705223', src: 'apollo-verified', note: 'bounced produccion@ → verified DM Yun Mateo Palos' },
  'storylab.com.ar': { email: 'paulap@storylab.com.ar', status: 'verified', name: 'Paula Perez', title: 'Commercial Director', li: 'http://www.linkedin.com/in/paula-p%c3%a9rez-32b4319', src: 'apollo-verified', note: 'bounced nv@ (Nacho Viale) → verified DM Paula Perez' },
  'linkvids.io': { email: 'laura.casadiego@linkvids.io', status: 'verified', name: 'Laura Casadiego', title: 'Head of Production', li: 'http://www.linkedin.com/in/lvcasadiego', src: 'apollo-verified', note: 'bounced martin.pons@ → verified DM Laura Casadiego' },
  'aquafilms.com.ar': { email: 'produccion@anchoitafilms.com.ar', status: 'website_published', src: 'website-rebrand', note: 'Aqua rebranded to Anchoita Films; produccion@anchoitafilms.com.ar' },
  'grappi.cl': { email: 'contacto@grappi.cl', status: 'website_published', src: 'website-mailto', note: 'role inbox; no DM email on JS site' },
  'vprovideo.com': { email: 'sofia.ventas@vprovideo.com', status: 'website_published', src: 'website-mailto', note: 'sales/role inbox; only deliverable found' },
  'mariachifilms.com': { email: 'mariachifilms@gmail.com', status: 'website_published', src: 'website-published-gmail', note: 'corp agonzalez@ bounced; published gmail is only deliverable alt (in 2026-05-28 batch)' },
  'chilerayo.com': { dead: true, status: 'no_deliverable_email_use_linkedin', name: 'Leonardo Oyarzun Ramirez', title: 'Director', li: 'http://www.linkedin.com/in/leonardooyarzun', channel: 'linkedin', src: 'no-email-linkedin-fallback', note: 'contacto@ bounced; no deliverable email (DMs only extrapolated) → LinkedIn (Leonardo Oyarzun) as main channel' },
};

const log = [];
for (const file of FILES) {
  const fp = path.join(PUBLIC, file);
  const leads = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let touched = 0;
  for (const l of leads) {
    const r = R[dom(l.website)];
    if (!r) continue;
    const beforeEmail = l.contactEmail || null;
    const beforeName = l.contactName || null;
    if (APPLY) {
      l._recoveredFrom = beforeEmail || '(was empty)';   // surfaces in Hoy
      l._recoveredAt = TS;
      l._recoveryNote = r.note;
      if (r.dead) {
        l._emailReplaced = beforeEmail;
        l.contactEmail = null;                            // clear dead addr so UI won't re-email it
        l._emailStatus = r.status;
        l.channelPriority = { ...(l.channelPriority || {}), primario: r.channel };
      } else {
        if (beforeEmail && beforeEmail !== r.email) l._emailReplaced = beforeEmail;
        l.contactEmail = r.email;
        l._emailStatus = r.status;
        l._emailVerifiedAt = TS;
        l._emailVerificationSource = 'cycle2-deep-scrape:' + r.src;
      }
      if (r.name) l.contactName = r.name;
      if (r.title) l.contactTitle = r.title;
      if (r.li) l.contactLinkedin = r.li;
    }
    log.push({ co: l.companyName, file: file.replace('leads-', '').replace('.json', ''), before: beforeEmail || '(empty)', after: r.dead ? 'EMAIL DEAD → LinkedIn:' + (r.name) : r.email, name: beforeName + (r.name ? ' → ' + r.name : '') });
    touched++;
  }
  if (APPLY && touched) fs.writeFileSync(fp, JSON.stringify(leads, null, 2));
}

console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — bounced-email recovery (${log.length} leads), files only, push-to-Hoy via _recoveredFrom:`);
for (const x of log) console.log('  ' + String(x.co || '?').slice(0, 18).padEnd(18) + ' [' + x.file + ']  ' + x.before + '  →  ' + x.after);
console.log('NO Supabase, NO push, NO deploy.');
