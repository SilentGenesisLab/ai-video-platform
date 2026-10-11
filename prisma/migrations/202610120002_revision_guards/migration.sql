CREATE FUNCTION prevent_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Revision history is immutable';
END;
$$;
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON "Revision"
FOR EACH ROW EXECUTE FUNCTION prevent_revision_mutation();
CREATE UNIQUE INDEX "AgentRun_one_active_per_conversation" ON "AgentRun" ("conversationId") WHERE status IN ('queued', 'running');
