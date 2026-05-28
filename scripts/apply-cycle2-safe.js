#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/apply-cycle2-safe.js
//
// Cycle-2 SAFE enrichment, FILES-ONLY. Applies ONLY non-destructive metadata
// from the website deep-scrape (scripts/enrichment-cycle2-findings.md):
//   - instagramHandle / instagramUrl  (correct typo / add missing canonical IG)
//   - additionalContacts[]            (append newly-found DMs: name + title + ig;
//                                       NO contactEmail, NO contactLinkedIn — those
//                                       feed Paso-1/UI, kept out to stay inert)
//   - _cycle2Context                  (additive note string; never overwrites
//                                       notableClients/companyBrief/pitch)
//
// Touches NOTHING else. Hard guard ABORTS if any protected field changes:
//   contactEmail, contactName, contactTitle, contactPhone, _emailStatus,
//   channelPriority, source_date, status, notableClients, companyBrief,
//   emailCercana, pitchEmailES, _reactivationMode/_reactivationActivatedAt/
//   _reactivationEmailES, _revivedFromPilot, _recoveredFrom.
// Idempotent. ICP-misfits (Torneos, Underground) and primary-email changes are
// intentionally EXCLUDED (those go through the separate email plan).
//
//   node scripts/apply-cycle2-safe.js          # DRY-RUN (default)
//   node scripts/apply-cycle2-safe.js --apply  # write files only

const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const FILES = ['leads-2026-05-27.json', 'leads-past.json'];
const APPLY = process.argv.includes('--apply');
const TS = new Date().toISOString();
const dom = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const ig = h => ({ instagramHandle: h, instagramUrl: `https://www.instagram.com/${h}/` });
const dm = (contactName, contactTitle, instagram) => ({ contactName, contactTitle, ...(instagram ? { instagram } : {}), source: 'cycle2-website-scrape', verified: false });

// keyed by registrable domain of the lead's website
const E = {
  'newwalkproductions.com': { ...ig('newwalkproductions'), _cycle2Context: 'San Pedro Sula, Honduras. IG corrected from newwalkproduction→newwalkproductions. Also TikTok/YT/X @newwalkproductions(hn).' },
  'huau.cl': { ...ig('be_huau'), _cycle2Context: 'Santiago, Chile; full-service AV + creative. Verified clients: Netflix, Hyundai, Nissan, Pepsi, Claro, Santander, Puma. Extra email hola@huau.cl on site (see email plan).' },
  'doinmedia.com': { ...ig('doinmedia'), additionalContacts: [dm('Carolina Guerrero', 'CEO'), dm('David', 'Creative Producer', 'davidricardogg'), dm('Hernando', 'CFO')], _cycle2Context: 'Bogotá, Colombia. Verified clients: Novo Nordisk, Save the Children, World Vision, DHL, GeoPark, UNODC (current Amazon/Facebook unconfirmed).' },
  'cbrafilms.com': { ...ig('cbrafilms'), _cycle2Context: 'Santiago, Chile; advertising/corporate + 8x8 studio rental. Site email contacto@cbrafilms.com; cristobal@ not on site (see email plan).' },
  'munfilms.com': { ...ig('mun_films'), additionalContacts: [dm('Pau Ardèvol', 'Director'), dm('Caterina Cladera', 'Producción')], _cycle2Context: 'Barcelona (Sant Just Desvern), SPAIN — geo/ICP flag. Branded content/motion; clients Nespresso, Pepsi, VW, SEAT. NAME CONFLICT: site Pau Ardèvol vs current Pau Moragues (see plan).' },
  'brodaju.com.co': { ...ig('brodajucolombia'), _cycle2Context: 'Bogotá (+Medellín, Barranquilla), Colombia. Canonical domain .com.co; site email info@brodaju.com.co. current rene@brodaju.com + Rene Martinez NOT on site (see plan). Clients: Migración Colombia, OIM, UNODC, UNFPA.' },
  'intelygente.net': { additionalContacts: [dm('Pablo Castro', 'Founder, Strategy & Direction'), dm('Toña González', 'Creative Director'), dm('Andrés Beltrán', 'Production Director'), dm('Carlos Díaz', 'Post-Production Director'), dm('Jorge Ariza', 'Administrative Director')], _cycle2Context: 'Bogotá, Colombia; video + commercial photo + digital. Verified clients: Google, Intel, Getty, Chevrolet, ExxonMobil, Liberty, UN. WhatsApp +57 312 380 8677. Founder Pablo Castro confirmed.' },
  'magmacine.com.ar': { additionalContacts: [dm('Juan Pablo Gugliotta', 'Co-founder & Producer'), dm('Nathalia Videla Peña', 'Co-founder & Producer')], _cycle2Context: 'Buenos Aires, Argentina; feature/series/doc. Clients Netflix, Amazon, Fox, Movistar, Participant. 2nd domain email juanpablo@magmacine.com.ar (see email plan).' },
  'ahappymonster.com': { additionalContacts: [dm('Rafa Delgado "El Turco"', 'Film Director'), dm('Ayesha Fernández', 'Film Director'), dm('Kevin de la Isla O’Neill', 'Film Director'), dm('Daniel Pérez', 'Film Director'), dm('Ken Arthur', 'Film Director')], _cycle2Context: 'CDMX, Mexico; creative production house. Phone +52 55 3988-3925, WhatsApp +52 55 5500-7533. No single founder surfaced; 6 directors.' },
  'misilproducciones.com': { additionalContacts: [dm('Facundo Salomón', 'Founder, Casting Director/Producer'), dm('Ezequiel Rossi', 'Director & Producer'), dm('Lucho Terranegra', 'AD/Editor'), dm('Zoe Montagna', 'Producer & Comms')], _cycle2Context: 'Buenos Aires, Argentina; fiction/brand content. Site has NO email (WhatsApp +54 11 4064-4356 only); current gmail not on site (see plan).' },
  'lavillaproducciones.com': { additionalContacts: [dm('Julio César Pachón González', 'CEO & Co-founder'), dm('Edwin Daniel Díaz', 'Director & Co-founder')], _cycle2Context: 'Bogotá, Colombia; film/series/music video. Site email lavillaproduccionescolombia@gmail.com (see plan); current yahoo from prior recovery.' },
  'zetapositivo.com.ar': { _cycle2Context: 'Garín, Buenos Aires, Argentina; 3D animation/VFX/motion. Verified clients: Cheetos, Raid, Banco Familiar (current Coca-Cola/Pepsi/Fanta unconfirmed). Site email info@zetapositivo.com.ar (empty now — see email plan). Maximiliano Gaspar not verifiable on site.' },
  'fosforo.video': { _cycle2Context: 'Monterrey, Mexico; corporate/training video + animation. Clients CEMEX, OXXO, Tec de Monterrey, Hey Banco. Site form-only; fernando@fosforo.video not on site (see plan).' },
  'mindedfactory.com': { _cycle2Context: 'Barcelona HQ (offices incl. Bogotá) — geo flag. Commercials/branded/music; clients Nike, Mercedes, VW, DAZN. Office emails barcelona@/madrid@/bogota@…; current david@ not on site (see plan).' },
  'aquafilms.com.ar': { _cycle2Context: 'REBRANDED to Anchoita Films — new domain anchoitafilms.com.ar (both live). Buenos Aires + Madrid; fiction/doc/theater. No email on site. IG @volareshumano confirmed. NOTE: website/domain change is in the email/identity plan (changes lead id).' },
  'grappi.cl': { _cycle2Context: 'Santiago, Chile. JS-rendered site; raw HTML exposed contacto@grappi.cl (see email plan). No IG/DM surfaced. Client Sony unconfirmed on site.' },
  'morenafilms.com': { _cycle2Context: 'MADRID, SPAIN — geo/ICP flag (not LATAM). Feature/content producer; Milton Maestas not verifiable on site. IG/email confirmed.' },
};

const PROTECTED = ['contactEmail', 'contactName', 'contactTitle', 'contactPhone', '_emailStatus', 'channelPriority', 'source_date', 'status', 'notableClients', 'companyBrief', 'emailCercana', 'pitchEmailES', '_reactivationMode', '_reactivationActivatedAt', '_reactivationEmailES', '_revivedFromPilot', '_recoveredFrom'];
const snap = l => JSON.stringify(PROTECTED.map(k => l[k] === undefined ? null : l[k]));

const changes = []; const guardFail = [];
for (const file of FILES) {
  const fp = path.join(PUBLIC, file);
  const leads = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let fileTouched = 0;
  for (const l of leads) {
    const d = dom(l.website);
    const e = E[d];
    if (!e) continue;
    const before = snap(l);
    const applied = [];
    if (e.instagramHandle && l.instagramHandle !== e.instagramHandle) {
      if (APPLY) { l.instagramHandle = e.instagramHandle; l.instagramUrl = e.instagramUrl; }
      applied.push('IG=' + e.instagramHandle);
    }
    if (e.additionalContacts) {
      const existing = new Set((l.additionalContacts || []).map(c => (c.contactName || '').toLowerCase()));
      const add = e.additionalContacts.filter(c => !existing.has(c.contactName.toLowerCase()));
      if (add.length) { if (APPLY) l.additionalContacts = (l.additionalContacts || []).concat(add); applied.push('+' + add.length + 'DM'); }
    }
    if (e._cycle2Context && l._cycle2Context !== e._cycle2Context) {
      if (APPLY) { l._cycle2Context = e._cycle2Context; l._cycle2ScrapedAt = TS; }
      applied.push('ctx');
    }
    if (snap(l) !== before) guardFail.push(file + ':' + d + ' PROTECTED FIELD CHANGED');
    if (applied.length) { changes.push({ file: file.replace('leads-', '').replace('.json', ''), d, company: l.companyName, applied }); fileTouched++; }
  }
  if (APPLY && guardFail.length) { console.error('ABORT — protected field mutation:\n  ' + guardFail.join('\n  ')); process.exit(1); }
  if (APPLY && fileTouched) fs.writeFileSync(fp, JSON.stringify(leads, null, 2));
}

console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — cycle-2 SAFE enrichment: ${changes.length} lead(s)`);
for (const c of changes) console.log('  ' + String(c.company || '?').slice(0, 24).padEnd(24) + ' [' + c.file + ']  ' + c.applied.join(' '));
if (guardFail.length) console.error('GUARD: ' + guardFail.length + ' protected-field change(s) DETECTED (would abort on --apply)');
console.log('fields touched (only): instagramHandle, instagramUrl, additionalContacts, _cycle2Context/_cycle2ScrapedAt');
