-- 记录漏斗历史事件（幂等：同一候选人同一阶段只记一次，保留首次到达时间戳）
CREATE OR REPLACE FUNCTION hb_record_funnel(p_candidate_id bigint, p_stage text, p_channel text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  c hb_candidates%ROWTYPE;
BEGIN
  SELECT * INTO c FROM hb_candidates WHERE id = p_candidate_id;
  IF c.id IS NULL THEN RETURN; END IF;
  INSERT INTO hb_funnel_events (owner_id, candidate_id, job_id, project_id, stage, channel, event_at)
  VALUES (c.owner_id, c.id, c.job_id, (SELECT project_id FROM hb_jobs WHERE id = c.job_id), p_stage, p_channel, now())
  ON CONFLICT (candidate_id, stage) DO NOTHING;
END;
$$;
