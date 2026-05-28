#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/reset-bounced-full.js
//
// FULL never-contacted reset for the bounced leads. The "1/1 contactado" badge
// comes from action/message rows, not just leads.status — so this clears
// actions + messages_sent + status_history for each lead AND sets status=none.
// SAFEGUARD: if a lead shows a genuine SUCCESS state (replied/meeting/closed) in
// status or status_history, it is NOT reset — it's flagged for removal from
// today's batch instead (it was really contacted, not a bounce).
//
//   node scripts/reset-bounced-full.js          # READ-ONLY diagnostic
//   node scripts/reset-bounced-full.js --apply   # clear rows + status=none

const SB_URL = 'https://ogdsuztzhmnnjolilsuo.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZHN1enR6aG1ubmpvbGlsc3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMDI0MDMsImV4cCI6MjA5MTc3ODQwM30.9iKhJJWd_zg6WfdxTR9ojK4DVLR3e-bLdPXY-0uDp7Q';
const CLIENT_ID = 'unabase_default';
const APPLY = process.argv.includes('--apply');
const IDS = ['mariachifilms.com', 'chilerayo.com', 'aquafilms.com.ar', 'sunomonofilms.com', 'storylab.com.ar', 'grappi.cl', 'linkvids.io', 'vprovideo.com'];
const SUCCESS = new Set(['replied', 'meeting', 'closed']);
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
const base = t => `${SB_URL}/rest/v1/${t}`;
const get = async (t, q) => { try { const r = await fetch(base(t) + '?' + q, { headers: H }); return await r.json(); } catch { return []; } };
const del = async (t, id) => { const r = await fetch(base(t) + `?lead_id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=representation' } }); return r.ok ? (await r.json()).length : -1; };

(async () => {
  console.log((APPLY ? 'APPLY' : 'READ-ONLY') + ' — full never-contacted reset\n');
  const flagged = [];
  for (const id of IDS) {
    const lead = await get('leads', `id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}&select=status`);
    const st = (lead[0] && lead[0].status) || '(no row)';
    const acts = await get('actions', `lead_id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}&select=channel`);
    const msgs = await get('messages_sent', `lead_id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}&select=channel`);
    const hist = await get('status_history', `lead_id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}&select=status`);
    const histStates = (Array.isArray(hist) ? hist : []).map(h => h.status);
    const success = SUCCESS.has(st) || histStates.some(s => SUCCESS.has(s));
    const nA = Array.isArray(acts) ? acts.length : 0, nM = Array.isArray(msgs) ? msgs.length : 0, nH = Array.isArray(hist) ? hist.length : 0;
    if (success) {
      flagged.push(id);
      console.log('  ' + id.padEnd(22) + 'status=' + st + ' acts=' + nA + ' msgs=' + nM + ' hist=[' + histStates.join(',') + ']  ⚠️ SUCCESS → REMOVE from batch (not reset)');
      continue;
    }
    if (APPLY) {
      const dA = await del('actions', id), dM = await del('messages_sent', id), dH = await del('status_history', id);
      await fetch(base('leads') + `?id=eq.${encodeURIComponent(id)}&client_id=eq.${CLIENT_ID}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'none', updated_at: new Date().toISOString() }) });
      console.log('  ' + id.padEnd(22) + 'CLEARED: actions -' + dA + ', messages -' + dM + ', history -' + dH + ', status->none ✓');
    } else {
      console.log('  ' + id.padEnd(22) + 'status=' + st + ' acts=' + nA + ' msgs=' + nM + ' hist=[' + histStates.join(',') + ']  → would clear all + status=none');
    }
  }
  if (flagged.length) console.log('\nFLAGGED as genuinely contacted (remove from today batch): ' + flagged.join(', '));
  else console.log('\nNone were genuinely contacted (no replied/meeting/closed) — all safe to reset.');
})();
