create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('public', 'reporter', 'reviewer', 'admin')),
  phone_or_email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  zone_key text not null unique,
  name text not null,
  discos_feeder_code text not null,
  region text not null,
  centroid_lat numeric(9, 6) not null,
  centroid_lng numeric(9, 6) not null,
  created_at timestamptz not null default now(),
  constraint zones_zone_key_bytes32 check (zone_key ~ '^0x[0-9a-fA-F]{64}$')
);

create table if not exists providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete restrict,
  wallet_address text not null unique,
  provider_type text not null check (provider_type in ('sensor', 'reporter')),
  zone_id uuid not null references zones(id) on delete restrict,
  reputation_cache integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint providers_wallet_address_evm check (wallet_address ~ '^0x[0-9a-fA-F]{40}$')
);

create table if not exists evidence_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete restrict,
  zone_id uuid not null references zones(id) on delete restrict,
  idempotency_key text not null unique,
  source text not null check (source in ('sensor', 'reporter')),
  status text not null check (status in ('grid_up', 'grid_down', 'unknown')),
  voltage numeric,
  confidence_hint numeric check (confidence_hint is null or (confidence_hint >= 0 and confidence_hint <= 1)),
  raw_payload jsonb not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_key text unique,
  zone_id uuid not null references zones(id) on delete restrict,
  status text not null check (status in ('outage', 'restored')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  window_start timestamptz not null,
  window_end timestamptz not null,
  evidence_event_ids uuid[] not null,
  created_at timestamptz not null default now()
);

create table if not exists agent_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_event_id uuid not null references candidate_events(id) on delete restrict,
  agent_name text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  decision text not null check (decision in ('approve', 'escalate', 'reject')),
  hypothesis text not null,
  supporting_evidence_ids uuid[] not null default '{}',
  notification_draft text,
  reasoning_trace jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists epoch_scores (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones(id) on delete restrict,
  epoch_start timestamptz not null,
  uptime_bps integer not null check (uptime_bps >= 0 and uptime_bps <= 10000),
  evidence_hash text not null,
  created_at timestamptz not null default now(),
  unique (zone_id, epoch_start),
  constraint epoch_scores_evidence_hash_bytes32 check (evidence_hash ~ '^0x[0-9a-fA-F]{64}$')
);

create table if not exists chain_commitments (
  id uuid primary key default gen_random_uuid(),
  epoch_score_id uuid not null unique references epoch_scores(id) on delete restrict,
  tx_hash text unique,
  block_number bigint,
  status text not null check (status in ('pending', 'confirmed', 'failed')),
  explorer_url text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint chain_commitments_tx_hash check (tx_hash is null or tx_hash ~ '^0x[0-9a-fA-F]{64}$')
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete restrict,
  subject_provider_id uuid references providers(id) on delete restrict,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists evidence_events_zone_observed_at_idx on evidence_events(zone_id, observed_at);
create index if not exists candidate_events_zone_window_start_idx on candidate_events(zone_id, window_start);
create index if not exists chain_commitments_status_idx on chain_commitments(status);
create index if not exists audit_logs_created_at_idx on audit_logs(created_at);
