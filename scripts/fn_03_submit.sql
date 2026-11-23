-- 提交岗位问卷（C 端作答）
--
-- 身份核验策略（2026-11-16 调整）：
--   早期强制微信登录（auth.uid() 必须存在），候选人必须扫码，落地体验很重。
--   现在改为「姓名 + 手机号」核对唯一身份：
--     · 一人一码（invite 绑定了 candidate_id）时，把填写的姓名/手机号与档案比对，
--       两者至少一项吻合即放行；都不吻合返回 identity_mismatch 并带上档案姓名，
--       前端可提示候选人核对。
--     · 通用问卷（未绑定候选人）不做强核对，按姓名+手机号查已有自然人，查不到则新建。
--   微信登录若存在仍优先使用（可用于已绑定微信的自然人）。
--   手机号未接短信验证，phone_verified 一律记 false。
CREATE OR REPLACE FUNCTION hb_submit_survey(p_token text, p_answers jsonb, p_name text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite hb_survey_invites%ROWTYPE;
  v_survey hb_surveys%ROWTYPE;
  v_score jsonb;
  v_phone text;
  v_caller text;
  v_person_id bigint;
  v_person_no text;
  v_cand_id bigint;
  v_cand hb_candidates%ROWTYPE;
  v_existing bigint;
  v_resp_id bigint;
  v_q jsonb;
  v_raw jsonb;
  v_job_title text;
  v_cand_phone text;
  v_name_ok boolean := false;
  v_phone_ok boolean := false;
BEGIN
  v_caller := auth.uid();

  -- 本函数是候选人填问卷的服务端可信写路径：后续对 hb_candidates 的更新
  -- （person 关联 + survey_status）以及内部触发的 hb_compute_composite 重算
  -- 都要让协作写保护触发器（hb_collab_guard_candidate_trg）放行。
  -- is_local=true → 仅当前事务有效，事务结束自动失效，客户端无法借道绕过。
  PERFORM set_config('hb.internal_write', 'on', true);

  IF p_token IS NULL OR p_token = '' THEN
    RETURN jsonb_build_object('error', 'invite_missing');
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_missing');
  END IF;

  -- 手机号规范化：只留数字，去掉 86 国际前缀
  v_phone := regexp_replace(coalesce(trim(p_phone), ''), '[^0-9]', '', 'g');
  IF length(v_phone) > 11 AND left(v_phone, 2) = '86' THEN
    v_phone := right(v_phone, 11);
  END IF;
  IF v_phone = '' THEN
    RETURN jsonb_build_object('error', 'phone_required');
  END IF;

  SELECT * INTO v_invite FROM hb_survey_invites WHERE token = p_token;
  IF v_invite.id IS NULL THEN
    RETURN jsonb_build_object('error', 'invite_not_found');
  END IF;
  IF v_invite.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'invite_used');
  END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('error', 'invite_expired');
  END IF;

  SELECT * INTO v_survey FROM hb_surveys WHERE id = v_invite.survey_id;
  IF v_survey.id IS NULL THEN
    RETURN jsonb_build_object('error', 'survey_missing');
  END IF;
  IF v_survey.status <> 'open' THEN
    RETURN jsonb_build_object('error', 'survey_closed');
  END IF;

  -- 必答题校验
  FOR v_q IN SELECT * FROM jsonb_array_elements(coalesce(v_survey.questions, '[]'::jsonb)) LOOP
    IF coalesce((v_q->>'required')::boolean, true) THEN
      v_raw := p_answers -> (v_q->>'id');
      IF v_raw IS NULL OR v_raw = 'null'::jsonb THEN
        RETURN jsonb_build_object('error', 'required_missing', 'question', v_q->>'title');
      END IF;
      IF (v_q->>'type') = 'text' AND (v_raw #>> '{}') = '' THEN
        RETURN jsonb_build_object('error', 'required_missing', 'question', v_q->>'title');
      END IF;
      IF (v_q->>'type') = 'multi' AND jsonb_array_length(v_raw) = 0 THEN
        RETURN jsonb_build_object('error', 'required_missing', 'question', v_q->>'title');
      END IF;
    END IF;
  END LOOP;

  v_score := hb_score_survey_answers(v_survey.questions, p_answers);

  -- 一人一码：与候选人档案核对身份
  IF v_invite.candidate_id IS NOT NULL THEN
    SELECT * INTO v_cand FROM hb_candidates WHERE id = v_invite.candidate_id;
    IF v_cand.id IS NOT NULL THEN
      v_name_ok := (trim(p_name) = trim(coalesce(v_cand.name, '')));
      v_cand_phone := regexp_replace(coalesce(v_cand.phone, ''), '[^0-9]', '', 'g');
      IF length(v_cand_phone) > 11 AND left(v_cand_phone, 2) = '86' THEN
        v_cand_phone := right(v_cand_phone, 11);
      END IF;
      v_phone_ok := (v_cand_phone <> '' AND v_cand_phone = v_phone);
      IF NOT (v_name_ok OR v_phone_ok) THEN
        RETURN jsonb_build_object('error', 'identity_mismatch', 'expected_name', v_cand.name,
                                  'name_matched', v_name_ok, 'phone_matched', v_phone_ok);
      END IF;
      v_cand_id := v_cand.id;
    END IF;
  END IF;

  -- 自然人识别：微信 uid 优先 → 姓名+手机号 → 仅手机号
  -- 注意：匿名访问时 auth.uid() 返回 'anon'（不是 NULL），绝不能当作微信身份
  -- 去匹配自然人，否则所有匿名填写者会被并进同一条档案（2026-11-20 事故）。
  IF v_caller IS NOT NULL AND v_caller <> 'anon' THEN
    SELECT p.id INTO v_person_id FROM hb_persons p
     WHERE p.owner_id = v_survey.owner_id AND p.wechat_user_id = v_caller
     ORDER BY p.id LIMIT 1;
  END IF;
  IF v_person_id IS NULL THEN
    SELECT p.id INTO v_person_id FROM hb_persons p
     WHERE p.owner_id = v_survey.owner_id AND p.phone_normalized = v_phone AND p.name = trim(p_name)
     ORDER BY p.id LIMIT 1;
  END IF;
  IF v_person_id IS NULL THEN
    SELECT p.id INTO v_person_id FROM hb_persons p
     WHERE p.owner_id = v_survey.owner_id AND p.phone_normalized = v_phone
     ORDER BY p.id LIMIT 1;
  END IF;
  IF v_person_id IS NULL THEN
    INSERT INTO hb_persons (owner_id, name, phone_normalized, phone, wechat_user_id)
    VALUES (v_survey.owner_id, trim(p_name), NULLIF(v_phone, ''), NULLIF(trim(p_phone), ''), NULLIF(v_caller, 'anon'))
    RETURNING id INTO v_person_id;
    v_person_no := 'P-' || to_char(now(), 'YYYY') || '-' || lpad(v_person_id::text, 4, '0');
    UPDATE hb_persons SET person_no = v_person_no WHERE id = v_person_id;
  ELSE
    UPDATE hb_persons
       SET wechat_user_id = coalesce(wechat_user_id, NULLIF(v_caller, 'anon')),
           phone_normalized = coalesce(phone_normalized, NULLIF(v_phone, '')),
           phone = coalesce(phone, NULLIF(trim(p_phone), ''))
     WHERE id = v_person_id;
  END IF;
  SELECT p.person_no INTO v_person_no FROM hb_persons p WHERE p.id = v_person_id;

  -- 应聘记录
  IF v_cand_id IS NULL THEN
    SELECT c.id INTO v_cand_id FROM hb_candidates c
     WHERE c.job_id = v_invite.job_id AND c.name = trim(p_name)
     ORDER BY c.id LIMIT 1;
  END IF;
  SELECT j.title INTO v_job_title FROM hb_jobs j WHERE j.id = v_invite.job_id;
  IF v_cand_id IS NULL THEN
    INSERT INTO hb_candidates (owner_id, job_id, name, role_title, stage, source, phone,
                               person_id, person_no, channel, survey_status, created_at, updated_at)
    VALUES (v_survey.owner_id, v_invite.job_id, trim(p_name), v_job_title, 'screening', '岗位问卷',
            NULLIF(trim(p_phone), ''), v_person_id, v_person_no, '问卷', 'submitted', now(), now())
    RETURNING id INTO v_cand_id;
  ELSE
    UPDATE hb_candidates
       SET person_id = v_person_id,
           person_no = v_person_no,
           survey_status = 'submitted',
           phone = CASE WHEN v_cand.phone IS NULL OR v_cand.phone = '' THEN NULLIF(trim(p_phone), '') ELSE v_cand.phone END,
           updated_at = now()
     WHERE id = v_cand_id;
  END IF;

  -- 内部可信标记：token 已核验、候选人身份已核对、记录已落库。
  -- 后续内部调用的 hb_apply_survey_profile / hb_compute_composite / hb_record_funnel
  -- 凭此标记放行；标记绑定本候选人 id，攻击者无法借道改写他人。
  -- is_local=true → 仅当前事务有效，客户端无法跨请求伪造。
  PERFORM set_config('hb.trusted_candidate', v_cand_id::text, true);

  -- 防重复：同一人同一问卷只能提交一次
  SELECT r.id INTO v_existing FROM hb_survey_responses r
   WHERE r.candidate_id = v_cand_id AND r.survey_id = v_survey.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_submitted', 'candidate_id', v_cand_id);
  END IF;

  INSERT INTO hb_survey_responses (survey_id, owner_id, employee_no, employee_name, answers, score,
                                   detail, submitted_at, invite_id, person_id, candidate_id,
                                   survey_version, rule_version, phone_verified, wechat_user_id)
  VALUES (v_survey.id, v_survey.owner_id, v_person_no, trim(p_name), p_answers,
          (v_score->>'score')::numeric, v_score->'detail', now(), v_invite.id, v_person_id, v_cand_id,
          coalesce(v_survey.version, 1),
          (SELECT j.rule_version FROM hb_jobs j WHERE j.id = v_invite.job_id),
          false, NULLIF(v_caller, 'anon'))
  RETURNING id INTO v_resp_id;

  UPDATE hb_survey_invites SET status = 'used', used_at = now(), used_by = NULLIF(v_caller, 'anon') WHERE id = v_invite.id;

  -- 档案题（pf_*）白名单回填到候选人台账（身份证、期望薪资、入职时间等）
  PERFORM hb_apply_survey_profile(v_cand_id, p_answers);

  INSERT INTO hb_funnel_events (owner_id, candidate_id, job_id, project_id, stage, channel, event_at)
  VALUES (v_survey.owner_id, v_cand_id, v_invite.job_id,
          (SELECT j.project_id FROM hb_jobs j WHERE j.id = v_invite.job_id), 'survey_done', v_invite.channel, now());

  PERFORM hb_compute_composite(v_cand_id);

  RETURN jsonb_build_object('response_id', v_resp_id, 'score', (v_score->>'score')::numeric,
                            'detail', v_score->'detail', 'person_id', v_person_id,
                            'person_no', v_person_no, 'candidate_id', v_cand_id,
                            'survey_version', coalesce(v_survey.version, 1),
                            'identity', CASE WHEN v_caller IS NOT NULL THEN 'wechat' ELSE 'name_phone' END);
END;
$$;

REVOKE EXECUTE ON FUNCTION hb_submit_survey(text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hb_submit_survey(text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION hb_submit_survey(text, jsonb, text, text) TO anon;
