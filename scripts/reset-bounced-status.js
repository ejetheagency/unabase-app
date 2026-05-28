#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/reset-bounced-status.js
//
// The 8 leads whose outreach BOUNCED (invalid emails) never actually received
// contact, so their Supabase cycle status is reset to 'none' (sin contactar).
// Their lifecycle restarts when Scarlett contacts the new working channel.
// TARGETED: only these 8 ids, status field only. Reads current status first.
// (Anon key + RLS "allow all" — same client the app uses. No other tables touched.)
//
//   node scripts/reset-bounced-status.js          # READ-ONLY preview
//   node scripts/reset-bounced-status.js --apply   # PATCH status->none

const SB_URL = 'https://ogdsuztzhmnnjolilsuo.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZHN1enR6aG1ubmpvbGlsc3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMDI0MDMsImV4cCI6MjA5MTc3ODQwM30.9iKhJJWd_zg6WfdxTR9ojK4DVLR3e-bLdPXY-0uDp7Q';
const CLIENT_ID = 'unabase_default';
const APPLY = process.argv.includes('--apply');

// id = dom(website) per sbUpsertLead
const IDS = ['mariachifilms.com', 'chilerayo.com', 'aquafilms.com.ar', 'sunomonofilms.com', 'storylab.com.ar', 'grappi.cl', 'linkvids.io', 'vprovideo.com'];
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

(async () => {
  console.log((APPLY ? 'APPLY' : 'READ-ONLY') + ' — reset bounced leads to never-contacted (status=none)\n');
  let reset = 0, already = 0, missing = 0, err = 0;
  for (const id of IDS) {
    const q = `${SB_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}&select=id,company,status`;
    let rows = [];
    try { const r = await fetch(q, { headers: H }); rows = await r.json(); } catch (e) { console.log('  ' + id.padEnd(22) + ' READ ERR ' + e.message); err++; continue; }
    if (!Array.isArray(rows) || !rows.length) { console.log('  ' + id.padEnd(22) + ' (no Supabase row — already effectively none)'); missing++; continue; }
    const cur = rows[0].status || 'none';
    if (cur === 'none') { console.log('  ' + id.padEnd(22) + ' already none — skip'); already++; continue; }
    if (APPLY) {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}`, {
          method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
          body: JSON.stringify({ status: 'none', updated_at: new Date().toISOString() }),
        });
        const out = await r.json();
        const ok = r.ok && Array.isArray(out) && out[0] && out[0].status === 'none';
        console.log('  ' + id.padEnd(22) + (ok ? cur + ' -> none ✓' : 'PATCH FAIL http ' + r.status));
        ok ? reset++ : err++;
      } catch (e) { console.log('  ' + id.padEnd(22) + ' PATCH ERR ' + e.message); err++; }
    } else {
      console.log('  ' + id.padEnd(22) + cur + '  → would reset to none');
    }
  }
  console.log(`\n${APPLY ? 'reset' : 'would reset'}: ${APPLY ? reset : IDS.length - already - missing - err} | already none: ${already} | no-row: ${missing} | errors: ${err}`);
  console.log('Only the `status` field was touched; action/message history rows left intact.');
})();
