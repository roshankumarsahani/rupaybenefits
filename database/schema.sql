-- RuPay Benefits PostgreSQL schema. Apply with npm run migrate.
-- Every read/write in the API is scoped to the authenticated user.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bank TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'RuPay',
  last4 CHAR(4),
  benefit_cycle TEXT NOT NULL DEFAULT 'Monthly'
    CHECK (benefit_cycle IN ('Monthly','Quarterly','Semi-annual','Annual','Mixed / multiple cycles')),
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$')
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_owner_id_fkey') THEN
    ALTER TABLE cards ADD CONSTRAINT cards_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS cards_owner_created_idx ON cards (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  code TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('self','family','purchased')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','redeemed')),
  card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
  family_member_name TEXT,
  supplier_name TEXT,
  supplier_phone TEXT,
  value_inr NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (value_inr >= 0),
  expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchased_voucher_has_supplier CHECK (
    source_type <> 'purchased' OR (
      NULLIF(trim(supplier_name),'') IS NOT NULL AND NULLIF(trim(supplier_phone),'') IS NOT NULL
    )
  ),
  CONSTRAINT family_voucher_has_member CHECK (
    source_type <> 'family' OR NULLIF(trim(family_member_name),'') IS NOT NULL
  ),
  CONSTRAINT voucher_code_not_blank CHECK (NULLIF(trim(code),'') IS NOT NULL),
  CONSTRAINT voucher_brand_not_blank CHECK (NULLIF(trim(brand),'') IS NOT NULL)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_owner_id_fkey') THEN
    ALTER TABLE vouchers ADD CONSTRAINT vouchers_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS vouchers_owner_brand_idx ON vouchers (owner_id, lower(brand));
CREATE INDEX IF NOT EXISTS vouchers_owner_status_expiry_idx ON vouchers (owner_id, status, expiry_date);
CREATE INDEX IF NOT EXISTS vouchers_owner_source_idx ON vouchers (owner_id, source_type);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_owner_brand_code_unique
  ON vouchers (owner_id, lower(brand), lower(code));

-- Seller name and phone are stored on each purchased voucher row, so every code
-- in a bulk purchase retains its own provenance.
