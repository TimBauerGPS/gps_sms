-- Migration 002: database helper functions
-- Applies after 001_initial_schema.sql

-- ---------------------------------------------------------------------------
-- increment_unread(conversation_id uuid)
-- Atomically increments the unread_count on a conversation row and
-- refreshes last_message_at to now().
-- Called from the twilio-inbound Netlify function via supabase.rpc().
-- SECURITY DEFINER runs with the privileges of the function owner (postgres),
-- so it works regardless of RLS policies on the conversations table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_unread(conversation_id uuid)
RETURNS void AS $$
  UPDATE public.conversations
  SET unread_count     = unread_count + 1,
      last_message_at  = now()
  WHERE id = conversation_id;
$$ LANGUAGE sql SECURITY DEFINER;
