-- 档案问卷回填（2026-11-20 补建）
-- 背景：PROFILE_QUESTIONS 的 8 道档案题（pf_*）在前端标注「提交后自动回填台账」，
-- 但 hb_submit_survey 里从未实现写回，导致候选人填了身份证/期望薪资等，台账仍显示「—」。
-- 本脚本定义服务端白名单回填函数，并一次性补齐存量答卷。
-- 映射与 src/services.js 的 PROFILE_QUESTIONS.profile_field 保持一致。
-- 幂等：可重复执行；问卷没填的字段保留台账原值（COALESCE 不清空）。
-- 执行顺序：fn_03_submit.sql 之后。

CREATE OR REPLACE FUNCTION hb_apply_survey_profile(p_candidate_id bigint, p_answers jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_owner text;
BEGIN
  IF p_candidate_id IS NULL OR p_answers IS NULL THEN RETURN; END IF;
  SELECT owner_id INTO v_owner FROM hb_candidates WHERE id = p_candidate_id;
  -- P0：外部调用必须是候选人本人或管理员，或来自已核验 token 的内部可信调用。
  -- 标记与 p_candidate_id 严格相等，防止匿名借道篡改他人档案。
  IF coalesce(current_setting('hb.trusted_candidate', true), '') <> p_candidate_id::text
     AND v_owner IS DISTINCT FROM auth.uid()
     AND NOT hb_is_admin() THEN
    RAISE EXCEPTION 'no permission to backfill this candidate';
  END IF;
  -- 确认有权限后，才绕过协作写保护触发器（服务端可信写路径）
  PERFORM set_config('hb.internal_write', 'on', true);

  UPDATE hb_candidates SET
    id_number            = COALESCE(NULLIF(btrim(p_answers->>'pf_id_number'), ''), id_number),
    career_plan          = COALESCE(NULLIF(btrim(p_answers->>'pf_career_plan'), ''), career_plan),
    leave_reason         = COALESCE(NULLIF(btrim(p_answers->>'pf_leave_reason'), ''), leave_reason),
    acceptable_regions   = COALESCE(NULLIF(btrim(p_answers->>'pf_acceptable_regions'), ''), acceptable_regions),
    target_cities        = COALESCE(NULLIF(btrim(p_answers->>'pf_target_cities'), ''), target_cities),
    expected_salary_note = COALESCE(NULLIF(btrim(p_answers->>'pf_expected_salary'), ''), expected_salary_note),
    available_note       = COALESCE(NULLIF(btrim(p_answers->>'pf_available'), ''), available_note),
    consent_archive      = COALESCE(
      CASE p_answers->>'pf_consent'
        WHEN '0' THEN '同意'
        WHEN '1' THEN '不同意'
        ELSE NULL
      END,
      NULLIF(btrim(p_answers->>'pf_consent'), ''),
      consent_archive),
    updated_at = now()
  WHERE id = p_candidate_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION hb_apply_survey_profile(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hb_apply_survey_profile(bigint, jsonb) TO authenticated;

-- 存量回填：每人只取最新一次答卷（一人一码，正常只有一份；防御历史重复）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (candidate_id) candidate_id, answers
    FROM hb_survey_responses
    WHERE candidate_id IS NOT NULL
    ORDER BY candidate_id, submitted_at DESC
  LOOP
    PERFORM hb_apply_survey_profile(r.candidate_id, r.answers);
  END LOOP;
END $$;
