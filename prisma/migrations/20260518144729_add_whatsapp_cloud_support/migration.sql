DO $$
DECLARE
  target_table text;
BEGIN
  IF to_regclass('public.whatsapp_accounts') IS NOT NULL THEN
    target_table := 'public.whatsapp_accounts';
  ELSIF to_regclass('public."WhatsAppChannel"') IS NOT NULL THEN
    target_table := 'public."WhatsAppChannel"';
  ELSE
    RAISE EXCEPTION 'Neither whatsapp_accounts nor "WhatsAppChannel" exists.';
  END IF;

  EXECUTE format(
    'ALTER TABLE %s
       ADD COLUMN IF NOT EXISTS channel VARCHAR(32) NOT NULL DEFAULT %L,
       ADD COLUMN IF NOT EXISTS meta_access_token TEXT,
       ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(255),
       ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR(255),
       ADD COLUMN IF NOT EXISTS cloud_status VARCHAR(64)',
    target_table,
    'personal'
  );

  EXECUTE format(
    'UPDATE %s
        SET channel = %L
      WHERE channel IS NULL OR BTRIM(channel) = %L',
    target_table,
    'personal',
    ''
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_accounts_channel_check'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s
         ADD CONSTRAINT whatsapp_accounts_channel_check
         CHECK (channel IN (%L, %L))',
      target_table,
      'personal',
      'cloud'
    );
  END IF;
END $$;
