-- 刷新候选人问卷（招聘方操作，候选人侧「刷新问卷」按钮调用）
--
-- 背景：问卷提交由 hb_submit_survey 做了「一人一问卷只提交一次」的强拦截。
-- 候选人填错、换人填写、需重填时，招聘方点「刷新问卷」走本函数恢复。
--
-- 行为：
--   · 清除该候选人全部答卷（hb_survey_responses）
--   · 该候选人的邀请恢复 active（清 used_at / used_by）
--   · 候选人 survey_status 回到 invited
--   · 调 hb_compute_composite 重算综合分：问卷缺失 → composite_complete=false，
--     composite_detail.missing 含 'survey'，前端显示「资料待补全」
--   · 评分历史不删除，重算会新增一条版本记录（历史保留）
--
-- 安全：SECURITY DEFINER 绕过 RLS，函数内强制校验 owner_id = auth.uid()。
--       协作者、管理员、其他账号一律返回 not_owner，不能刷新他人问卷。
CREATE OR REPLACE FUNCTION hb_reset_candidate_survey(p_candidate_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cand hb_candidates%ROWTYPE;
  v_deleted int := 0;
  v_restored int := 0;
  v_composite jsonb;
BEGIN
  SELECT * INTO v_cand FROM hb_candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RETURN jsonb_build_object('error', 'candidate_not_found');
  END IF;
  IF v_cand.owner_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  DELETE FROM hb_survey_responses WHERE candidate_id = p_candidate_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE hb_survey_invites
     SET status = 'active', used_at = NULL, used_by = NULL
   WHERE candidate_id = p_candidate_id AND status <> 'active';
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE hb_candidates
     SET survey_status = 'invited', updated_at = now()
   WHERE id = p_candidate_id;

  v_composite := hb_compute_composite(p_candidate_id);

  RETURN jsonb_build_object(
    'ok', true,
    'candidate_id', p_candidate_id,
    'deleted_responses', v_deleted,
    'restored_invites', v_restored,
    'composite', v_composite
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION hb_reset_candidate_survey(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hb_reset_candidate_survey(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION hb_reset_candidate_survey(bigint) TO anon;

-- 新建函数后刷新 PostgREST schema cache，否则前端会报
-- "Could not find the function public.hb_reset_candidate_survey in the schema cache"
NOTIFY pgrst, 'reload schema';
