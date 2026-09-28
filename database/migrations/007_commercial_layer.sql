CREATE TABLE commercial_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
    CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  currency text NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  monthly_price_minor bigint NOT NULL DEFAULT 0
    CHECK (monthly_price_minor >= 0),
  included_ingest bigint NOT NULL DEFAULT 0
    CHECK (included_ingest >= 0),
  included_read bigint NOT NULL DEFAULT 0
    CHECK (included_read >= 0),
  included_tracked_users integer NOT NULL DEFAULT 0
    CHECK (included_tracked_users >= 0),
  max_projects integer NOT NULL DEFAULT 1
    CHECK (max_projects BETWEEN 1 AND 1000000),
  overage_ingest_per_1000_minor bigint NOT NULL DEFAULT 0
    CHECK (overage_ingest_per_1000_minor >= 0),
  overage_read_per_1000_minor bigint NOT NULL DEFAULT 0
    CHECK (overage_read_per_1000_minor >= 0),
  overage_tracked_user_minor bigint NOT NULL DEFAULT 0
    CHECK (overage_tracked_user_minor >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO commercial_plans (
  code,
  name,
  status,
  currency,
  monthly_price_minor,
  included_ingest,
  included_read,
  included_tracked_users,
  max_projects,
  features
) VALUES (
  'legacy',
  'Legacy',
  'active',
  'USD',
  0,
  1000000000000,
  1000000000000,
  100000000,
  100000,
  '{"realtime":true,"clientTokens":true,"androidAttestation":true,"prioritySupport":true}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE account_subscriptions (
  account_id uuid PRIMARY KEY
    REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL
    REFERENCES commercial_plans(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing','active','past_due','canceled')),
  provider text NOT NULL DEFAULT 'manual',
  provider_customer_ref text,
  provider_subscription_ref text,
  period_start date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  period_end date NOT NULL DEFAULT (date_trunc('month', CURRENT_DATE) + interval '1 month')::date,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

INSERT INTO account_subscriptions (
  account_id,
  plan_id,
  status
)
SELECT
  a.id,
  p.id,
  'active'
FROM accounts a
JOIN commercial_plans p ON p.code = 'legacy'
ON CONFLICT (account_id) DO NOTHING;

CREATE TABLE account_entitlement_overrides (
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  value jsonb NOT NULL,
  updated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, entitlement_key)
);

CREATE TABLE billing_usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_version text NOT NULL DEFAULT 'v1',
  finalized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_start, period_end),
  CHECK (period_end > period_start)
);

CREATE INDEX billing_usage_account_period_idx
  ON billing_usage_periods (
    account_id,
    period_start DESC
  );

CREATE TABLE billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id uuid
    REFERENCES commercial_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','paid','void','uncollectible')),
  currency text NOT NULL
    CHECK (currency ~ '^[A-Z]{3}$'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  subtotal_minor bigint NOT NULL DEFAULT 0
    CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0
    CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0
    CHECK (total_minor >= 0),
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  provider_invoice_ref text,
  notes text,
  generated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE UNIQUE INDEX billing_invoices_account_period_unique_idx
  ON billing_invoices (
    account_id,
    period_start,
    period_end
  )
  WHERE status <> 'void';

CREATE INDEX billing_invoices_account_created_idx
  ON billing_invoices (account_id, created_at DESC);

CREATE TABLE billing_invoice_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id uuid NOT NULL
    REFERENCES billing_invoices(id) ON DELETE CASCADE,
  item_type text NOT NULL
    CHECK (item_type IN ('base','overage','adjustment')),
  description text NOT NULL,
  metric_key text,
  quantity bigint NOT NULL DEFAULT 1,
  unit_amount_minor bigint NOT NULL DEFAULT 0,
  amount_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_invoice_items_invoice_idx
  ON billing_invoice_items (invoice_id, id);

CREATE TABLE platform_roles (
  admin_user_id uuid PRIMARY KEY
    REFERENCES admin_users(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role IN ('superadmin','billing','support','viewer')),
  granted_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  project_id uuid
    REFERENCES projects(id) ON DELETE SET NULL,
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_platform_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending_customer','pending_internal','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  category text NOT NULL DEFAULT 'technical'
    CHECK (category IN ('billing','technical','account','security','other')),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX support_cases_account_created_idx
  ON support_cases (account_id, created_at DESC);

CREATE INDEX support_cases_status_priority_idx
  ON support_cases (status, priority, updated_at DESC);

CREATE TABLE support_case_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL
    REFERENCES support_cases(id) ON DELETE CASCADE,
  author_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  author_type text NOT NULL
    CHECK (author_type IN ('tenant','platform','system')),
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_case_messages_case_idx
  ON support_case_messages (case_id, id);
