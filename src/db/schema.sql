-- DebtCheck schema
-- Run in Supabase SQL Editor

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  free_checks_used int not null default 0,
  plan text not null default 'free',        -- free | pay_per_check | subscription
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  full_name text not null,
  birth_date text not null,
  region_id int,
  result jsonb,                             -- raw FSSP response
  debts_count int default 0,
  total_amount numeric(12,2) default 0,
  is_paid boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  yookassa_payment_id text unique,
  amount int not null,
  product text not null,                   -- single_check | subscription_month
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Monitoring subscriptions: users who want alerts on new debts
create table if not exists monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  full_name text not null,
  birth_date text not null,
  region_id int,
  last_check_at timestamptz,
  last_debts_hash text,                    -- md5 of last result to detect changes
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists checks_user_id_idx on checks(user_id);
create index if not exists monitors_active_idx on monitors(is_active);
