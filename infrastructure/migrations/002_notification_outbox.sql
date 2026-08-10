create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('review_required', 'chain_committed')),
  audience text not null check (audience in ('reviewer', 'operator', 'public')),
  channel text not null check (channel in ('outbox', 'webhook')),
  title text not null,
  message text not null,
  payload jsonb not null,
  status text not null check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists notification_outbox_status_created_at_idx on notification_outbox(status, created_at);
create index if not exists notification_outbox_kind_created_at_idx on notification_outbox(kind, created_at);
