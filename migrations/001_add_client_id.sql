-- ═══════════════════════════════════════════════════════════
-- MIGRATION: Add client_id to all tables for workspace isolation
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- ═══════════════════════════════════════════════════════════

-- 1. Add client_id column to all tables (default = 'unabase_default')
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT 'unabase_default';
ALTER TABLE actions ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT 'unabase_default';
ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT 'unabase_default';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT 'unabase_default';
ALTER TABLE status_history ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT 'unabase_default';

-- 2. Backfill all existing data to unabase_default (safety — DEFAULT handles this, but explicit)
UPDATE leads SET client_id = 'unabase_default' WHERE client_id IS NULL;
UPDATE actions SET client_id = 'unabase_default' WHERE client_id IS NULL;
UPDATE messages_sent SET client_id = 'unabase_default' WHERE client_id IS NULL;
UPDATE notes SET client_id = 'unabase_default' WHERE client_id IS NULL;
UPDATE status_history SET client_id = 'unabase_default' WHERE client_id IS NULL;

-- 3. Add indexes for filtered queries
CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_actions_client ON actions(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages_sent(client_id);
CREATE INDEX IF NOT EXISTS idx_notes_client ON notes(client_id);
CREATE INDEX IF NOT EXISTS idx_status_client ON status_history(client_id);

-- Done. All existing data is now tagged as unabase_default.
-- New workspaces (operator, client_X) will be isolated by client_id.
