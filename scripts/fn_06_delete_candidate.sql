-- 删除候选人 + 级联清理关联数据
-- 背景：hb_survey_responses 的客户端 INSERT/UPDATE/DELETE 权限已收归服务端函数
-- （写入走 hb_submit_survey，删除需要同样在服务端完成），前端直接 DELETE 会报
-- permission denied for table hb_survey_responses，导致候选人根本删不掉。
-- 本函数在服务端以表 owner 身份级联清理，前端只调一次 RPC。
CREATE OR REPLACE FUNCTION hb_delete_candidate(p_candidate_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner text;
BEGIN
  SELECT owner_id INTO v_owner FROM hb_candidates WHERE id = p_candidate_id;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error', 'candidate_not_found');
  END IF;
  IF v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  DELETE FROM hb_survey_responses WHERE candidate_id = p_candidate_id;
  DELETE FROM hb_survey_invites   WHERE candidate_id = p_candidate_id;
  DELETE FROM hb_scoring_history  WHERE candidate_id = p_candidate_id;
  DELETE FROM hb_funnel_events    WHERE candidate_id = p_candidate_id;
  DELETE FROM hb_events           WHERE candidate_id = p_candidate_id;
  DELETE FROM hb_candidates       WHERE id = p_candidate_id;

  RETURN jsonb_build_object('ok', true, 'candidate_id', p_candidate_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION hb_delete_candidate(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hb_delete_candidate(bigint) TO authenticated;
