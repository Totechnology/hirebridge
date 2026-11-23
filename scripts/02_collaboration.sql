-- ═══════════════════════════════════════════════════════════════
-- 增量脚本：岗位协作授权 hb_job_shares + 协作读写 RLS 放行
-- 执行顺序：00_schema.sql → 01_interviews.sql → fn_*.sql → 02_collaboration.sql
-- 说明：平台迭代中新增的「按岗位整包授权」协作能力。
--   · 管理员把某岗位整包授权给某用户（hb_job_shares），被授权人可在该岗位下
--     查看并协作处理候选人：改资料/阶段/面试/台账，但不可删除、不可改授权、
--     AI 派生字段只读（由 BEFORE UPDATE 触发器强制锁定）。
--   · 岗位主人与管理者的原有权限一行不改；管理员业务数据仍全局只读。
--   · 依赖 hb_is_admin()（来自 fn_*.sql）与 hb_candidates/hb_interviews。
--   幂等：可重复执行。
-- ═══════════════════════════════════════════════════════════════

-- 1) 授权表 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS hb_job_shares (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL,
  job_title TEXT,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  grantee_uid TEXT NOT NULL,
  grantee_name TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, grantee_uid)
);

CREATE INDEX IF NOT EXISTS hb_job_shares_grantee_idx ON hb_job_shares (grantee_uid);
COMMENT ON TABLE hb_job_shares IS '岗位协作授权：管理员把某岗位整包授权给某用户，被授权人可查看并协作处理该岗位下的数据（按岗位整包）';
ALTER TABLE hb_job_shares ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hb_job_shares TO authenticated, anon;

-- 管理员：分配/解除授权（授权表可写，这是管理动作，不动业务数据）
DROP POLICY IF EXISTS admin_all_hb_job_shares ON hb_job_shares;
CREATE POLICY admin_all_hb_job_shares ON hb_job_shares FOR ALL
  TO authenticated, anon USING (hb_is_admin()) WITH CHECK (hb_is_admin());

-- 被授权人：只读「授给自己」的条目，不能自己给自己授权
DROP POLICY IF EXISTS grantee_read_hb_job_shares ON hb_job_shares;
CREATE POLICY grantee_read_hb_job_shares ON hb_job_shares FOR SELECT
  TO authenticated, anon USING (grantee_uid = auth.uid());

-- 岗位主人：可看自己岗位授权给了谁
DROP POLICY IF EXISTS owner_read_hb_job_shares ON hb_job_shares;
CREATE POLICY owner_read_hb_job_shares ON hb_job_shares FOR SELECT
  TO authenticated, anon USING (owner_id = auth.uid());

-- 2) 协作判定辅助函数 ---------------------------------------------
-- 当前用户被授权协作的岗位 id 数组
CREATE OR REPLACE FUNCTION hb_collab_job_ids()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(array_agg(job_id), '{}'::bigint[])
  FROM hb_job_shares
  WHERE grantee_uid = auth.uid()
$fn$;

-- 当前用户可协作的候选人 id 数组（按岗位整包推导）
CREATE OR REPLACE FUNCTION hb_collab_candidate_ids()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(array_agg(c.id), '{}'::bigint[])
  FROM hb_candidates c
  WHERE c.job_id = ANY (hb_collab_job_ids())
$fn$;

-- 3) 候选人写保护：协作者只能改日常字段，敏感列强制保留原值 -------
-- 例外：服务端 SECURITY DEFINER 可信写路径（问卷提交 hb_submit_survey、
-- 综合分重算 hb_compute_composite）会在事务内设置会话标记 hb.internal_write='on'，
-- 此时直接放行。该标记用 set_config(..., is_local=true) 设置，仅当前事务有效，
-- 客户端直连 update hb_candidates 无法伪造，协作越权防护不受影响。
CREATE OR REPLACE FUNCTION hb_collab_guard_candidate_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('hb.internal_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF hb_is_admin() THEN RETURN NEW; END IF;
  IF NEW.owner_id = auth.uid() THEN RETURN NEW; END IF;
  IF NOT (NEW.job_id = ANY (hb_collab_job_ids())) THEN
    RAISE EXCEPTION 'no collaboration grant for this job';
  END IF;
  NEW.owner_id := OLD.owner_id;
  NEW.owner_name := OLD.owner_name;
  NEW.score := OLD.score;
  NEW.band := OLD.band;
  NEW.resume_raw := OLD.resume_raw;
  NEW.composite_score := OLD.composite_score;
  NEW.composite_complete := OLD.composite_complete;
  NEW.composite_detail := OLD.composite_detail;
  NEW.evaluation := OLD.evaluation;
  NEW.reason_detail := OLD.reason_detail;
  NEW.person_id := OLD.person_id;
  NEW.person_no := OLD.person_no;
  NEW.survey_status := OLD.survey_status;
  NEW.horilla_employee_id := OLD.horilla_employee_id;
  NEW.attachments := OLD.attachments;
  NEW.resume_path := OLD.resume_path;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS hb_collab_guard_candidate_trg ON hb_candidates;
CREATE TRIGGER hb_collab_guard_candidate_trg BEFORE UPDATE ON hb_candidates
  FOR EACH ROW EXECUTE FUNCTION hb_collab_guard_candidate_write();

-- 候选人：协作 SELECT + UPDATE（不给 DELETE / INSERT）
DROP POLICY IF EXISTS collab_read_hb_candidates ON hb_candidates;
CREATE POLICY collab_read_hb_candidates ON hb_candidates FOR SELECT
  TO authenticated, anon USING (job_id = ANY (hb_collab_job_ids()));
DROP POLICY IF EXISTS collab_update_hb_candidates ON hb_candidates;
CREATE POLICY collab_update_hb_candidates ON hb_candidates FOR UPDATE
  TO authenticated, anon
  USING (job_id = ANY (hb_collab_job_ids()))
  WITH CHECK (job_id = ANY (hb_collab_job_ids()));

-- 4) 面试记录：协作者可增删改面试日常字段 ------------------------
-- 更新时锁定归属，防止把记录改到别人名下
CREATE OR REPLACE FUNCTION hb_collab_guard_interview_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF hb_is_admin() THEN RETURN NEW; END IF;
  IF NEW.owner_id = auth.uid() THEN RETURN NEW; END IF;
  IF NOT (NEW.candidate_id = ANY (hb_collab_candidate_ids())) THEN
    RAISE EXCEPTION 'no collaboration grant for this candidate';
  END IF;
  NEW.owner_id := OLD.owner_id;
  NEW.owner_name := OLD.owner_name;
  RETURN NEW;
END; $$;

-- 新增面试记录时归属设为候选人真正的主人（否则会记成协作者自己）
CREATE OR REPLACE FUNCTION hb_collab_set_interview_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF hb_is_admin() OR NEW.owner_id = auth.uid() THEN RETURN NEW; END IF;
  IF NOT (NEW.candidate_id = ANY (hb_collab_candidate_ids())) THEN
    RAISE EXCEPTION 'no collaboration grant for this candidate';
  END IF;
  SELECT owner_id, owner_name INTO NEW.owner_id, NEW.owner_name
  FROM hb_candidates WHERE id = NEW.candidate_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS hb_collab_guard_interview_trg ON hb_interviews;
CREATE TRIGGER hb_collab_guard_interview_trg BEFORE UPDATE ON hb_interviews
  FOR EACH ROW EXECUTE FUNCTION hb_collab_guard_interview_write();
DROP TRIGGER IF EXISTS hb_collab_set_interview_owner_trg ON hb_interviews;
CREATE TRIGGER hb_collab_set_interview_owner_trg BEFORE INSERT ON hb_interviews
  FOR EACH ROW EXECUTE FUNCTION hb_collab_set_interview_owner();

-- 面试：协作 SELECT / INSERT / UPDATE（不给 DELETE，删除只留给岗位主人）
DROP POLICY IF EXISTS collab_select_hb_interviews ON hb_interviews;
CREATE POLICY collab_select_hb_interviews ON hb_interviews FOR SELECT
  TO authenticated, anon USING (candidate_id = ANY (hb_collab_candidate_ids()));
DROP POLICY IF EXISTS collab_insert_hb_interviews ON hb_interviews;
CREATE POLICY collab_insert_hb_interviews ON hb_interviews FOR INSERT
  TO authenticated, anon WITH CHECK (candidate_id = ANY (hb_collab_candidate_ids()));
DROP POLICY IF EXISTS collab_update_hb_interviews ON hb_interviews;
CREATE POLICY collab_update_hb_interviews ON hb_interviews FOR UPDATE
  TO authenticated, anon
  USING (candidate_id = ANY (hb_collab_candidate_ids()))
  WITH CHECK (candidate_id = ANY (hb_collab_candidate_ids()));

-- 5) 其余关联表：协作者只读 --------------------------------------
DROP POLICY IF EXISTS collab_read_hb_jobs ON hb_jobs;
CREATE POLICY collab_read_hb_jobs ON hb_jobs FOR SELECT
  TO authenticated, anon USING (id = ANY (hb_collab_job_ids()));
DROP POLICY IF EXISTS collab_read_hb_survey_responses ON hb_survey_responses;
CREATE POLICY collab_read_hb_survey_responses ON hb_survey_responses FOR SELECT
  TO authenticated, anon USING (candidate_id = ANY (hb_collab_candidate_ids()));
DROP POLICY IF EXISTS collab_read_hb_scoring ON hb_scoring_history;
CREATE POLICY collab_read_hb_scoring ON hb_scoring_history FOR SELECT
  TO authenticated, anon USING (candidate_id = ANY (hb_collab_candidate_ids()));
DROP POLICY IF EXISTS collab_read_hb_events ON hb_events;
CREATE POLICY collab_read_hb_events ON hb_events FOR SELECT
  TO authenticated, anon USING (candidate_id = ANY (hb_collab_candidate_ids()));
DROP POLICY IF EXISTS collab_read_hb_funnel ON hb_funnel_events;
CREATE POLICY collab_read_hb_funnel ON hb_funnel_events FOR SELECT
  TO authenticated, anon USING (candidate_id = ANY (hb_collab_candidate_ids()));
