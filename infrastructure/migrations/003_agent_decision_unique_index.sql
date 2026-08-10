create unique index if not exists agent_decisions_candidate_agent_unique_idx
  on agent_decisions(candidate_event_id, agent_name);
