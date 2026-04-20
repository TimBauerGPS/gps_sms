CREATE UNIQUE INDEX IF NOT EXISTS sent_messages_company_twilio_sid_idx
  ON public.sent_messages(company_id, twilio_sid)
  WHERE twilio_sid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.message_media (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sent_message_id  uuid NOT NULL REFERENCES public.sent_messages(id) ON DELETE CASCADE,
  media_index      integer NOT NULL,
  twilio_media_sid text,
  storage_bucket   text NOT NULL,
  storage_path     text NOT NULL,
  filename         text,
  mime_type        text,
  file_size_bytes  bigint,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_media_company_id_idx
  ON public.message_media(company_id);

CREATE INDEX IF NOT EXISTS message_media_sent_message_id_idx
  ON public.message_media(sent_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS message_media_sent_message_media_index_idx
  ON public.message_media(sent_message_id, media_index);

CREATE UNIQUE INDEX IF NOT EXISTS message_media_company_twilio_media_sid_idx
  ON public.message_media(company_id, twilio_media_sid)
  WHERE twilio_media_sid IS NOT NULL;

ALTER TABLE public.message_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_media: company members only"
  ON public.message_media FOR ALL
  USING (company_id = get_user_company_id());

INSERT INTO storage.buckets (id, name, public)
VALUES ('message-media', 'message-media', false)
ON CONFLICT (id) DO NOTHING;
