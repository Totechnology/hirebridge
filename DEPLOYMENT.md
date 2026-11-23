# 聘桥 HireBridge · 招聘工作流交付说明

## 一、架构概览

本应用为纯前端（React 19 + Vite 7），数据与业务逻辑运行在 **WorkBuddy Cloud 托管后端**（PostgreSQL + RLS + Storage + LLM，对标 Supabase）。没有自建 Node 服务端。

- 前端：`src/App.jsx`（视图与交互）、`src/services.js`（数据访问与模型调用）、`src/styles.css`（样式）。
- 数据库：PostgreSQL + 行级安全（RLS）。
- 可信计算：问卷客观分、综合加权、身份关联、防重复、漏斗记录全部下沉到 `SECURITY DEFINER` plpgsql 函数（`scripts/fn_01~fn_05.sql`），模型只负责产出「证据 + 原始分」，最终加权由确定性代码完成。

## 二、数据模型

新增 5 张表：`hb_projects`（招聘项目）、`hb_persons`（自然人）、`hb_survey_invites`（一人一码邀请）、`hb_scoring_history`（评分历史）、`hb_funnel_events`（漏斗历史事件）。

扩展 4 张表：

| 表 | 扩展列 |
| --- | --- |
| hb_jobs | company_name、recruit_reasons、market_type/market_score、salary_budget、reason_rules、rule_version、reason_notes、survey_version_id、need_by |
| hb_candidates | person_id/person_no、channel、survey_status、resume_raw、reason_detail、composite_score/composite_complete/composite_detail、expected_salary、available_at |
| hb_surveys | job_id（问卷↔岗位绑定）、version、base_survey_id、is_current、business_type |
| hb_survey_responses | invite_id、person_id、candidate_id、survey_version、rule_version、phone_verified、wechat_user_id |
| hb_app_meta | owner_id、meta_key/meta_value（初始化标记，防止岗位删光后重新播种） |

> 遗留列：`hb_jobs.project_id / project_name` 为旧版「招聘项目」字段，**界面已删除该字段**，仅保留列以兼容历史数据。

完整 DDL 见 `scripts/00_schema.sql`。

## 三、统一综合评分公式

```
综合分 = AI评估(简历匹配)×0.50 + 问卷得分×0.50
```

- 总分上限 100，保留 1 位小数，**不设及格线、不自动淘汰**。
- `complete` 标志区分「已完成评分」与「资料待补全」；缺失模块保留已得分并显示已覆盖权重。
- 每次计算写入 `hb_scoring_history`（版本自增），保存原始分 + 权重 + 加权贡献 + 证据 + 规则版本 + 模型版本 + 计算时间。
- 招聘原因/市场背景配置界面保留但**不参与综合分**。
- **市场分**：由数据库触发器 `hb_jobs_market_score_trg` 根据 `market_type` 写死（人的市场 = 7、岗位的市场 = 3），前端不提交也不展示。

验证示例：AI评估 76 + 问卷 90 = 76×0.50 + 90×0.50 = 38 + 45 = **83**。

## 三之二、岗位向导与问卷绑定（2026-11-16 变更）

- 岗位向导 3 步：**JD 与评分规则 → 基础信息（公司名称在前、岗位名称在后）→ 招聘原因与市场**；已删除「招聘项目」与向导内的「绑定问卷」步骤。
- 问卷↔岗位绑定改在「测评问卷」页：`bindSurveyToJob(surveyId, jobId)` 双写 `hb_surveys.job_id` 与 `hb_jobs.survey_version_id`，并互斥清理。
- 问卷**每人每份限填一次**（`hb_submit_survey` 双重拦截）；需修改时由招聘方调 `hb_reset_candidate_survey(bigint)` 刷新（清答卷 + 得分、邀请恢复 active、综合分变待补全、评分历史保留）。
- 招聘阶段**线性推进**：简历筛选 → 推面试 → 面试中 → 发 Offer → Offer → 确认入职 → 已入职，按钮与拖拽都只前进一格。

## 四、部署步骤

1. 安装依赖：`npm install`。
2. 数据库迁移：在自己的 WorkBuddy Cloud 环境执行 `scripts/00_schema.sql`、`01_interviews.sql`，再依次执行 `fn_01` 至 `fn_08`，最后执行 `02_collaboration.sql`（函数创建 + 权限收紧）。新增函数后执行 `NOTIFY pgrst, 'reload schema'` 刷新网关 schema cache。`fn_08_profile_backfill.sql` 定义档案题（pf_*）回填函数并对存量答卷补写台账，可重复执行；已有答卷的环境应先备份，并用有回填权限的管理员身份执行。
3. 按 [README 配置](README.md#配置) 填写自己的 WorkBuddy Cloud 应用配置。本地预览：`npm run dev`（绑定 127.0.0.1）。
4. 构建：`npm run build`。
5. 发布上线：用 WorkBuddy「发布为应用」发布为线上链接。
6. 在应用后台开启「微信登录」，否则扫码后无法授权回调。

## 五、安全要点（已修复的既往问题）

1. **简历解析与 OCR**：PDF 可检索文本由 `pdfjs-dist` 抽取；扫描件通过所配置的 WorkBuddy Cloud 视觉模型提取文字，后续文本评分仍执行脱敏。
2. **问卷前端算分不可信**：改为 `hb_submit_survey` 服务端计分，客户端不再传 owner_id。
3. **问卷公开读取策略过宽**：删除 `status='open'` 公开读与 `WITH CHECK(true)` 写入策略，改为 `SECURITY DEFINER` 函数 + 收回客户端直写权限。
4. **C 端登录触发管理端初始化**：问卷填写页通过 `?invite=token` 全屏接管，不影响管理端。
5. **旧 score 不冒充新综合分**：综合分存 `composite_score`，简历匹配存 `resume_raw`，二者分离。
6. **招聘问卷取消及格线**：`pass_score` 默认空，综合分不设及格线。
7. **本地配置与线上库隔离**：演示模式走 sample 数据，登录后走云端 RLS 隔离库。
8. **协作写保护触发器 vs 问卷提交（2026-11-20 修复）**：`hb_collab_guard_candidate_trg` 会拦下一切非主人/管理员/协作者的 UPDATE，包括候选人本人填问卷的服务端写入。`hb_submit_survey` / `hb_compute_composite` 已在函数体内 `set_config('hb.internal_write','on',true)`（事务级 GUC），触发器检测到该标记即放行；客户端直改候选人表无法伪造此标记，防护不受影响。新增会 UPDATE hb_candidates 的 SECURITY DEFINER 函数时，必须照此办理。
9. **SECURITY DEFINER 函数越权防护（2026-11-20 P0 修复）**：`hb_compute_composite` / `hb_record_funnel` / `hb_apply_survey_profile` 曾对 anon/PUBLIC 开放 EXECUTE 且无 owner 校验，匿名可重算任意人综合分、篡改档案。`hb_submit_survey` 核验 token 与身份后设置事务级标记 `hb.trusted_candidate=<candidate_id>`，三个被调函数校验「标记==目标 id 或 调用者是 owner/管理员」，否则拒绝；同时已 REVOKE anon/PUBLIC 执行权，仅 authenticated 保留。新增 SECURITY DEFINER 写函数必须做同样的 owner 校验 + 权限收紧。

## 六、回滚方案

- 表结构回滚：删除扩展列与新增表（`DROP TABLE IF EXISTS hb_*` 五张新表；`ALTER TABLE ... DROP COLUMN` 回退扩展列）。
- 函数回滚：`DROP FUNCTION IF EXISTS hb_score_survey_answers(jsonb,jsonb) CASCADE;` 等五个函数。
- 代码回滚：`git revert` 或恢复上一版 `src/` 快照；前端无破坏性数据结构依赖，回退后旧逻辑仍可运行。

## 七、验收清单

- [x] 综合分满分 = 100，示例 = 83
- [x] AI 简历评估 50% + 问卷 50%
- [x] 缺失简历评估 / 缺失问卷 / 真实零分三者区分（`complete` / `missing` 数组）
- [x] 单选未答不误算第一项（服务端校验必答）
- [x] 多选去重（`hb_score_survey_answers` 内 `SELECT DISTINCT`）
- [x] 必填校验（`hb_submit_survey` 逐题校验）
- [x] 防重复提交（同 candidate + survey 唯一）
- [x] 跨岗位：同一自然人多条应聘记录分别评分
- [x] 防篡改：C 端只看到题面，拿不到答案/分值/规则
- [x] 候选人无法读答案（`hb_get_survey_for_fill` 剥离分值）
- [x] 问卷版本化：修改生成新版本，保留旧答卷，同时刻仅一个生效版本
- [x] 移动端可完成填写
- [x] 构建通过（`npm run build`）
