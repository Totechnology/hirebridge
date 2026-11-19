-- ═══════════════════════════════════════════════════════════════
-- 增量脚本：面试记录表 hb_interviews
-- 执行顺序：00_schema.sql → 01_interviews.sql → fn_*.sql
-- 说明：本表在平台迭代中新增，未并入 00_schema.sql，单独成脚本。
--       一名候选人一面/二面各一条，按账号隔离，管理员只读。
--       幂等：可重复执行。
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hb_interviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  candidate_id BIGINT NOT NULL,
  round TEXT NOT NULL DEFAULT '一面',
  accepted TEXT,
  attended TEXT,
  interview_at TIMESTAMPTZ,
  format TEXT,
  result TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE hb_interviews IS '面试记录：一名候选人一面/二面各一条，按账号隔离，管理员只读';

-- 一人一轮唯一，便于 upsert
CREATE UNIQUE INDEX IF NOT EXISTS hb_interviews_candidate_round
  ON hb_interviews (candidate_id, round);

ALTER TABLE hb_interviews ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hb_interviews TO authenticated, anon;

-- 管理员只读：通过 hb_is_admin() 判定（管理员身份来自 hb_admins 表）
DROP POLICY IF EXISTS admin_read_hb_interviews ON hb_interviews;
CREATE POLICY admin_read_hb_interviews ON hb_interviews FOR SELECT
  TO authenticated, anon USING (hb_is_admin());

-- 账号隔离：owner 对自己的记录拥有全部权限
DROP POLICY IF EXISTS owner_hb_interviews ON hb_interviews;
CREATE POLICY owner_hb_interviews ON hb_interviews FOR ALL
  TO authenticated, anon
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
