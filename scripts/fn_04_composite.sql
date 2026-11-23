-- 综合评分 v2：按业务口径改为两模块 —— 综合分 = AI评估(简历匹配)×0.50 + 问卷×0.50
-- 满分 100，保留 1 位小数，不设及格线；区分「已完成评分」与「资料待补全」；写评分历史。
CREATE OR REPLACE FUNCTION hb_compute_composite(p_candidate_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  c hb_candidates%ROWTYPE;
  v_resume numeric;
  v_survey numeric;
  v_composite numeric;
  v_complete boolean := true;
  v_missing text[] := '{}';
  v_detail jsonb;
  v_version int;
  v_rule_ver text;
  v_model_ver text;
BEGIN
  SELECT * INTO c FROM hb_candidates WHERE id = p_candidate_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('error', 'candidate_missing'); END IF;

  -- 权限校验（2026-11-20 P0）：外部调用必须是候选人本人或管理员；
  -- 内部可信调用（hb_submit_survey 已核验 token 与身份）带 hb.trusted_candidate 标记放行。
  -- 标记与 p_candidate_id 必须严格相等，防止借道改写他人。
  IF coalesce(current_setting('hb.trusted_candidate', true), '') <> p_candidate_id::text
     AND c.owner_id IS DISTINCT FROM auth.uid()
     AND NOT hb_is_admin() THEN
    RAISE EXCEPTION 'no permission to compute this candidate';
  END IF;

  -- 确认有权限后，才允许绕过协作写保护触发器（服务端可信写路径）
  PERFORM set_config('hb.internal_write', 'on', true);

  v_resume := COALESCE(c.resume_raw, c.score);
  SELECT r.score INTO v_survey FROM hb_survey_responses r
    WHERE r.candidate_id = c.id ORDER BY r.submitted_at DESC LIMIT 1;

  IF v_resume IS NULL THEN v_complete := false; v_missing := array_append(v_missing, 'resume'); END IF;
  IF v_survey IS NULL THEN v_complete := false; v_missing := array_append(v_missing, 'survey'); END IF;

  v_composite := round((COALESCE(v_resume, 0) * 0.50 + COALESCE(v_survey, 0) * 0.50)::numeric, 1);
  IF v_composite > 100 THEN v_composite := 100; END IF;

  v_detail := jsonb_build_object(
    'resume', jsonb_build_object('raw', v_resume, 'weight', 50, 'contribution', CASE WHEN v_resume IS NULL THEN NULL ELSE round((v_resume * 0.50)::numeric, 2) END, 'present', v_resume IS NOT NULL, 'label', 'AI评估'),
    'survey', jsonb_build_object('raw', v_survey, 'weight', 50, 'contribution', CASE WHEN v_survey IS NULL THEN NULL ELSE round((v_survey * 0.50)::numeric, 2) END, 'present', v_survey IS NOT NULL, 'label', '问卷评估'),
    'missing', to_jsonb(v_missing),
    'complete', v_complete,
    'formula', 'AI评估×0.50 + 问卷×0.50'
  );

  SELECT j.rule_version INTO v_rule_ver FROM hb_jobs j WHERE j.id = c.job_id;
  v_model_ver := c.evaluation->>'engineModel';

  SELECT COALESCE(MAX(h.version), 0) + 1 INTO v_version FROM hb_scoring_history h WHERE h.candidate_id = c.id;

  INSERT INTO hb_scoring_history (owner_id, candidate_id, job_id, version, reason_raw, market_raw, resume_raw, survey_raw, composite_score, complete, detail, rule_version, model_version)
  VALUES (c.owner_id, c.id, c.job_id, v_version, NULL, NULL, v_resume, v_survey, v_composite, v_complete, v_detail, v_rule_ver, v_model_ver);

  UPDATE hb_candidates SET composite_score = v_composite, composite_complete = v_complete, composite_detail = v_detail, updated_at = now()
  WHERE id = c.id;

  RETURN jsonb_build_object('candidate_id', c.id, 'composite', v_composite, 'complete', v_complete, 'detail', v_detail, 'version', v_version);
END;
$$;

-- P0 收紧：撤掉 PUBLIC/anon 的 EXECUTE，只保留登录用户与内部定义者调用
REVOKE EXECUTE ON FUNCTION hb_compute_composite(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hb_compute_composite(bigint) TO authenticated;
