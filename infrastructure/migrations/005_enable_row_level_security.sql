-- GridProof uses a trusted server-side Postgres connection. These tables must
-- not become readable through Supabase's anon/authenticated PostgREST roles by
-- default. No client policies are created here; access stays behind the API.
alter table users enable row level security;
alter table zones enable row level security;
alter table providers enable row level security;
alter table evidence_events enable row level security;
alter table candidate_events enable row level security;
alter table agent_decisions enable row level security;
alter table epoch_scores enable row level security;
alter table chain_commitments enable row level security;
alter table audit_logs enable row level security;
alter table notification_outbox enable row level security;
