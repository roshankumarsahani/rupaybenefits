-- RuPay Benefits — PostgreSQL starter schema
-- Apply only when the Oracle Cloud PostgreSQL instance and backend are ready.
-- owner_id must be taken from the authenticated server-side session; never trust
-- an owner_id supplied by the browser.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    name TEXT NOT NULL,
    bank TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'RuPay',
    last4 CHAR(4),
    benefit_cycle TEXT NOT NULL DEFAULT 'Monthly'
        CHECK (benefit_cycle IN ('Monthly', 'Quarterly', 'Semi-annual', 'Annual', 'Mixed / multiple cycles')),
    benefits JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(benefits) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS cards_owner_created_idx
    ON cards (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    brand TEXT NOT NULL,
    code TEXT NOT NULL,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('self', 'family', 'purchased')),
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'sold', 'redeemed')),
    card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
    family_member_name TEXT,
    supplier_name TEXT,
    supplier_phone TEXT,
    value_inr NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (value_inr >= 0),
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT purchased_voucher_has_supplier
        CHECK (
            source_type <> 'purchased'
            OR (
                NULLIF(trim(supplier_name), '') IS NOT NULL
                AND NULLIF(trim(supplier_phone), '') IS NOT NULL
            )
        ),
    CONSTRAINT family_voucher_has_member
        CHECK (
            source_type <> 'family'
            OR NULLIF(trim(family_member_name), '') IS NOT NULL
        ),
    CONSTRAINT voucher_code_not_blank CHECK (NULLIF(trim(code), '') IS NOT NULL),
    CONSTRAINT voucher_brand_not_blank CHECK (NULLIF(trim(brand), '') IS NOT NULL),
    CONSTRAINT voucher_owner_brand_code_unique UNIQUE (owner_id, brand, code)
);

CREATE INDEX IF NOT EXISTS vouchers_owner_brand_idx
    ON vouchers (owner_id, lower(brand));

CREATE INDEX IF NOT EXISTS vouchers_owner_status_expiry_idx
    ON vouchers (owner_id, status, expiry_date);

CREATE INDEX IF NOT EXISTS vouchers_owner_source_idx
    ON vouchers (owner_id, source_type);

-- Supplier name and phone intentionally live on each voucher row. This preserves
-- the seller details that were entered for a particular bulk-purchase batch,
-- even if the same seller's contact details are later changed on a new purchase.
