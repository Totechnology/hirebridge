-- 员工通过邀请 token 读取题面：只返回题目与选项文字，不返回选项分值/标准答案/内部评分规则
CREATE OR REPLACE FUNCTION hb_get_survey_for_fill(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  invite_row hb_survey_invites%ROWTYPE;
  survey_row hb_surveys%ROWTYPE;
  job_title text;
  sanitized jsonb := '[]'::jsonb;
  q jsonb; opts jsonb; o jsonb; clean_opts jsonb := '[]'::jsonb;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN RETURN jsonb_build_object('error', 'invite_missing'); END IF;
  SELECT * INTO invite_row FROM hb_survey_invites WHERE token = p_token;
  IF invite_row.id IS NULL THEN RETURN jsonb_build_object('error', 'invite_not_found'); END IF;
  IF invite_row.status <> 'active' THEN RETURN jsonb_build_object('error', 'invite_used'); END IF;
  IF invite_row.expires_at IS NOT NULL AND invite_row.expires_at < now() THEN
    RETURN jsonb_build_object('error', 'invite_expired');
  END IF;
  SELECT * INTO survey_row FROM hb_surveys WHERE id = invite_row.survey_id;
  IF survey_row.id IS NULL THEN RETURN jsonb_build_object('error', 'survey_missing'); END IF;
  IF survey_row.status <> 'open' THEN RETURN jsonb_build_object('error', 'survey_closed'); END IF;
  SELECT title INTO job_title FROM hb_jobs WHERE id = invite_row.job_id;

  -- 剥离选项分值，只保留选项文字
  FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(survey_row.questions, '[]'::jsonb)) LOOP
    opts := COALESCE(q -> 'options', '[]'::jsonb);
    clean_opts := '[]'::jsonb;
    FOR o IN SELECT * FROM jsonb_array_elements(opts) LOOP
      clean_opts := clean_opts || jsonb_build_object('label', o->>'label');
    END LOOP;
    sanitized := sanitized || jsonb_build_object(
      'id', q->>'id', 'type', q->>'type', 'title', q->>'title',
      'required', COALESCE((q->>'required')::boolean, true),
      'options', clean_opts);
  END LOOP;

  RETURN jsonb_build_object(
    'survey_id', survey_row.id,
    'survey_version', COALESCE(survey_row.version, 1),
    'title', survey_row.title,
    'description', survey_row.description,
    'job_id', invite_row.job_id,
    'job_title', job_title,
    'candidate_id', invite_row.candidate_id,
    'invite_id', invite_row.id,
    'questions', sanitized);
END;
$$;
