# 聘桥 HireBridge

版本：v0.1.3 · [部署与迁移说明](DEPLOYMENT.md)

一套招聘工作流管理系统：岗位上架、简历解析与 AI 证据评估、一人一码测评问卷、候选人管道、面试记录、综合评分与招聘漏斗。

- 前端：React 19 + Vite 7（纯浏览器应用，**无自建 Node 服务端**）
- 后端：WorkBuddy Cloud 托管服务（PostgreSQL + RLS + Storage + LLM），对标 Supabase
- 数据/计分边界：身份关联、问卷计分、综合加权、防重复等可信计算下沉在数据库 `SECURITY DEFINER` 函数中；前端只展示结果，不算分、不做决策

> ⚠️ **许可声明**：本项目自有代码**禁止用于商业用途**，仅限个人学习与内部非商业试用。详见文末 [许可与商用限制](#许可与商用限制)。引用的第三方开源组件遵循各自许可证。

---

## 目录

- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [技术架构](#技术架构)
- [数据库](#数据库)
- [接口调用](#接口调用)
- [鉴权与数据隔离](#鉴权与数据隔离)
- [配置](#配置)
- [测试与构建](#测试与构建)
- [部署发布](#部署发布)
- [开源组件清单](#开源组件清单)
- [许可与商用限制](#许可与商用限制)

---

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 招聘工作流 | 总览待办与流程快捷入口 |
| 测评问卷 | 单选/多选/量表/开放题，题目权重，版本化，绑定岗位，一人一码，回收结果；8 道档案题不计分但自动回填台账 |
| 上架岗位 | JD 上传/粘贴，LLM 生成评分维度（人工确认），招聘原因/市场类型仅记录不打分，薪资预算，按岗位授权协作 |
| 人员管理 | 台账主表，筛选/搜索/排序，改岗位，勾选导出（按项目分 sheet），孤儿简历清理 |
| 候选人管道 | 四阶段看板（简历筛选→面试中→Offer→已入职），线性推进与逐格回撤，卡片可直接登记面试 |
| 面试安排 | 一面/二面面试记录表：接受、参面、时间、形式、结果、备注；拒绝标红；按轮次或整人删除 |
| 数据漏斗 | 各环节转化与跳步识别，基于真实事件时间戳 |
| 人才评分 | 按 JD 维度排名与导出 |
| 简历导入 | 单份 AI 评估、批量并行解析（PDF/DOC/DOCX/TXT/MD/CSV/Excel）、扫描件 PDF OCR、原件归档 |
| 用户中心 | 个人资料、管理员只读模式、账号切换、存储清理 |

**评分口径**：`综合分 = AI 评估 × 0.50 + 问卷 × 0.50`，满分 100、保留 1 位小数，不设及格线。招聘原因、市场类型不参与评分（市场分由触发器固定：人的市场=7、岗位的市场=3）。

---

## 快速开始

```bash
npm install       # 安装依赖
npm run dev       # 本地开发，127.0.0.1:5173
npm run build     # 构建到 dist/
npm test          # 纯逻辑单元测试（node --test）
npm run preview   # 预览构建产物
npm run check:cols # 校验本地代码引用的列与云库结构一致（需脚本配套）
```

**本地预览是演示模式**：未配置云端或未登录时，使用 `src/data.js` 中的演示数据，不写云端。配置并登录后使用自己的 WorkBuddy Cloud 环境。公开版本中的导入清单和种子数据为空。

> 注意：应用依赖云端数据库与登录，**不能只靠 `npm run dev` 完整跑通**。首次接入新环境需按下方 [数据库](#数据库) 与 [配置](#配置) 完成初始化。

---

## 技术架构

```
src/
├── App.jsx              全部视图、组件、交互与状态调度（单文件主界面）
├── services.js          数据访问层：云 SDK CRUD / RPC / LLM / 附件解析 / Excel 导出
├── cloud.js             WorkBuddy Cloud 客户端初始化（endpoint / publishableKey）
├── data.js              阶段定义、评分维度、演示数据
├── resumeExtraction.js  简历字段提取辅助
├── main.jsx             入口
└── styles.css           样式
scripts/
├── 00_schema.sql        参考 DDL：新增表 + RLS + 授权
├── 01_interviews.sql    面试记录表 hb_interviews + RLS
├── 02_collaboration.sql 岗位协作授权 hb_job_shares + RLS + 协作函数/触发器
├── fn_01_score.sql      问卷客观分 hb_score_survey_answers
├── fn_02_fill.sql       C 端取题面 hb_get_survey_for_fill（剥离答案与分值）
├── fn_03_submit.sql     提交+身份核验+防重复+计分 hb_submit_survey
├── fn_04_composite.sql  综合分 hb_compute_composite
├── fn_05_funnel.sql     漏斗记录 hb_record_funnel
├── fn_06_delete_candidate.sql  级联删除 hb_delete_candidate
├── fn_07_reset_survey.sql  刷新问卷 hb_reset_candidate_survey（含 schema cache 刷新）
├── fn_08_profile_backfill.sql  档案题 pf_* 回填台账 hb_apply_survey_profile（含存量补写）
└── check_db_columns.py  列一致性检查
docs/
└── 聘桥HireBridge-使用说明书.md
```

**视图调度**：无路由库，用 `view` 字符串状态切页（`VIEW_KEYS`：dashboard / jobs / surveys / people / pipeline / interviews / funnel / messages / integration / batch / account）。所有视图常驻挂载、以 CSS 隐藏非活动视图，从而切换栏目不丢失表单现场。候选人填问卷页通过 URL `?invite=<token>` 全屏接管，与管理端互不干扰。

---

## 数据库

数据库是 WorkBuddy Cloud 的 PostgreSQL，通过云 SDK 访问。**没有独立的数据库连接串**：`src/cloud.js` 用 `publishableKey` 初始化客户端，登录态决定 `auth.uid()`。

### 表清单

代码中实际读写的表（`src/services.js` 的 `.from('...')`）：

| 表 | 用途 |
| --- | --- |
| `hb_jobs` | 岗位：JD、评分维度、招聘原因、市场、薪资预算 |
| `hb_candidates` | 候选人（应聘记录）：档案字段、简历路径、综合分、阶段、面试时间 |
| `hb_interviews` | 面试记录：一人一面/二面各一条，接受/参面/时间/形式/结果/备注 |
| `hb_surveys` | 问卷：题目、权重、版本、与岗位绑定 |
| `hb_survey_responses` | 问卷答卷 |
| `hb_survey_invites` | 一人一码邀请（token 不含明文姓名/手机号） |
| `hb_persons` | 自然人身份（与应聘记录分离，同一人可应聘多岗） |
| `hb_projects` | 招聘项目（遗留字段，界面已不用） |
| `hb_scoring_history` | 评分历史（时间列是 `calculated_at`） |
| `hb_funnel_events` | 漏斗历史事件 |
| `hb_events` | 候选人动态/审计事件 |
| `hb_messages` | 通知消息 |
| `hb_employees` | 云聘员工档案（可选集成） |
| `hb_admins` | 管理员名单（管理员只读的数据边界） |
| `hb_job_shares` | 岗位协作授权（候选人和面试记录可按权限协作） |
| `hb_display_names` | 显示名/录入人 |
| `hb_team_members` | 团队成员（历史遗留，当前按账号隔离，岗位协作另由 `hb_job_shares` 授权） |
| `hb_app_meta` | 初始化标记（防止岗位删光后重新播种） |

### 建表与迁移

`scripts/00_schema.sql` 是**参考 DDL**（新增表 + RLS + 授权），仅供新环境重建/审计/回滚参考；部分脚本依赖 WorkBuddy Cloud 环境中已有的基础表、认证函数和角色。执行顺序：

```
00_schema.sql → 01_interviews.sql → fn_01_score.sql → fn_02_fill.sql → fn_03_submit.sql
              → fn_04_composite.sql → fn_05_funnel.sql → fn_06_delete_candidate.sql
              → fn_07_reset_survey.sql → fn_08_profile_backfill.sql → 02_collaboration.sql
```

> `01_interviews.sql`、`02_collaboration.sql` 是迭代中新增的表，单独成脚本（未并入 `00_schema.sql`），都要执行。
> 新增 RPC 函数后必须执行 `NOTIFY pgrst, 'reload schema'`，否则前端调用会报
> "Could not find the function ... in the schema cache"（`fn_07_reset_survey.sql` 末尾已含）。

面试表 `hb_interviews` 的建表范式（RLS：owner 全权、管理员只读，完整可执行版见 `scripts/01_interviews.sql`）：

```sql
CREATE TABLE IF NOT EXISTS hb_interviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  candidate_id BIGINT NOT NULL,
  round TEXT NOT NULL DEFAULT '一面',
  accepted TEXT, attended TEXT, interview_at TIMESTAMPTZ,
  format TEXT, result TEXT, note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hb_interviews_candidate_round
  ON hb_interviews (candidate_id, round);
ALTER TABLE hb_interviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hb_interviews TO authenticated, anon;

CREATE POLICY admin_read_hb_interviews ON hb_interviews FOR SELECT
  TO authenticated, anon USING (hb_is_admin());
CREATE POLICY owner_hb_interviews ON hb_interviews FOR ALL
  TO authenticated, anon
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
```

> 说明：云控制台的 `describe table` 可能显示 `RLSOn:false`，这与 `hb_candidates` 等既有表一致，是工具口径差异；以 RLS 策略列表为准。

### 设计红线

1. **不做旧数据迁移**：评分规则默认不重算历史分；`fn_08_profile_backfill.sql` 另有存量档案回填步骤。
2. **按账号严格隔离**：账号默认访问自己的数据；管理员可以按岗位授予协作，权限由数据库策略限制。管理员查看全员业务数据时为**只读**。
3. 前端不算分、不传 `owner_id`、不做身份合并、不设及格线、不自动淘汰。
4. 不新增性别/年龄/婚育/民族字段，也不基于这些做筛选或计算。

---

## 接口调用

所有后端交互统一封装在 `src/services.js`，组件只调用其导出函数。**不要绕过它直连数据库或在前端实现计分/身份逻辑。**

### 调用模式

```js
import { loadWorkspace, saveInterviewRecord, signIn } from './services.js'

// 会话由 signIn / restoreSession 得到，所有写操作都需要传入
const session = await signIn()
const { jobs, candidates, events } = await loadWorkspace(session)

// 读：云 SDK 风格查询
const rows = await fetchInterviews(session)

// 写：带 session 与 owner 隔离
await saveInterviewRecord(candidate, '一面', {
  accepted: '接受', attended: '已参面',
  interview_at: new Date().toISOString(),
  format: '视频', result: '通过', note: '重点核验渠道资源',
}, session)
```

### 主要接口分组

**会话**：`restoreSession()`、`signIn()`、`signInWithWechat()`、`signOut()`

**工作区/候选人**：`loadWorkspace(session)`、`moveCandidate(candidate, stage, session)`、`updateCandidateProfile`、`updateCandidateJob`、`bindCandidateSurvey`、`revokeCandidateInvites`、`deleteCandidate`、`fetchPersons`

**面试**：`fetchInterviews`、`saveInterviewRecord(candidate, round, patch, session)`、`setInterviewAt`、`deleteInterviewRecord`、`deleteCandidateInterviews(candidate, records, session)`；常量 `INTERVIEW_ROUNDS / INTERVIEW_ACCEPTED / INTERVIEW_ATTENDED / INTERVIEW_FORMATS / INTERVIEW_RESULTS`

**岗位/JD**：`addJob`、`saveJobFull`、`saveJobJd`、`deriveRubricFromJd`、`extractJobFileText`、`getJdUrl`、`deleteJob`

**简历/评估**：`evaluateResume({file,name,job,...}, session, onStep)`、`evaluateCandidateResume`、`parseResumeContacts`、`extractResumeProfile`、`extractAttachmentText`、`planResumeImport`、`importResumeFiles({matched,candidates,session,onProgress})`

**问卷/邀请**：`fetchSurveys`、`saveSurveyVersioned`、`deleteSurvey`、`bindSurveyToJob`、`fetchSurveyResponses`、`submitSurveyResponse`、`createInvite`、`fetchInvites`、`ensureCandidateInvite`、`resetCandidateSurvey`、`getSurveyForFill(token)`、`submitSurveyRpc({token,answers,name,phone})`

**计分/漏斗**：`computeComposite(candidateId)`、`fetchScoringHistory`、`recordFunnel`、`fetchFunnel`、`rankCandidates`

**台账导出**：`exportLedgerXlsx(rows, filename, opts)`、`exportLedgerByProjectXlsx(groups, filename, opts)`、`buildLedgerRows`（纯函数）、`ledgerSurveyData`、`exportSurveyResponsesXlsx`、`exportCandidateRankingXlsx`

**用户/管理员**：`fetchMyProfile`、`saveMyProfile`、`ensureDisplayName`、`fetchDisplayNames`、`fetchAdminStatus(session)`、`scanOrphanResumes`、`purgeOrphanResumes`

**员工/集成（可选）**：`fetchEmployees`、`syncCandidate`、`checkIntegration`、`configureHorilla`、`clearHorilla`

> 完整导出清单以 `grep '^export ' src/services.js` 为准。

### 后端 RPC 函数

通过 `cloud.database.rpc(...)` 调用，均带 `SECURITY DEFINER`：

| 函数 | 用途 |
| --- | --- |
| `hb_get_survey_for_fill(token)` | C 端取题面，剥离答案/分值/规则 |
| `hb_submit_survey(token, answers, name, phone)` | 提交：身份核验 + 防重复 + 服务端计分 + 漏斗 |
| `hb_compute_composite(candidate_id)` | 综合分（AI×0.5 + 问卷×0.5） |
| `hb_score_survey_answers(answers, survey)` | 问卷客观分 |
| `hb_record_funnel(candidate_id, stage, channel)` | 漏斗事件 |
| `hb_reset_candidate_survey(candidate_id)` | 刷新问卷：清答卷与得分、链接恢复可填、历史保留 |
| `hb_delete_candidate(candidate_id)` | 级联删除候选人及关联数据 |

### LLM 调用

统一经云 SDK，**不直接持有模型密钥**：

```js
const models = await cloud.llm.models.list()
const model = models.find(m => m.isDefault && !m.disabled)
for await (const chunk of cloud.llm.chat.completions.create({
  model: model.id,
  messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  stream: true,
  response_format: { type: 'json_object' },
  temperature: 0.2,
})) { /* 追加 chunk.choices[0].delta.content */ }
```

提示词内置防注入要求（简历/JD 中的指令一律视为不可信内容），且模型输入前会剔除邮箱、手机号、证件号。模型只产出「证据 + 原始分」，最终加权由 `hb_compute_composite` 确定性完成。

---

## 鉴权与数据隔离

- **登录**：WorkBuddy 账号 OAuth，`signIn()` 经 `oauthRelayBaseUrl` 跳转授权；`restoreSession()` 恢复会话。
- **身份**：数据库以 `auth.uid()` 作为 `owner_id`；所有业务表默认 `owner_id TEXT NOT NULL DEFAULT auth.uid()`。
- **RLS**：每表策略形如 `USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`；管理员通过 `hb_is_admin()` 获得 SELECT 只读。
- **管理员**：登录后由 `hb_admins` 和数据库策略识别管理员，无需输入单独的管理密码。
- **C 端问卷**：凭 token 匿名作答，无需登录；身份靠姓名或手机号任一吻合放行，都不符返回 `identity_mismatch`；手机号标注「未验证」（暂未接短信）。

---

## 配置

将 `.env.example` 复制为 `.env.local`，填入自己的 WorkBuddy Cloud 应用配置，然后重启开发服务或重新构建：

```dotenv
VITE_WORKBUDDY_ENDPOINT=https://<你的应用>.app.workbuddy.host
VITE_WORKBUDDY_PUBLISHABLE_KEY=<你的应用的公开客户端标识>
```

需要自定义 OAuth 中继地址时，设置 `VITE_WORKBUDDY_OAUTH_RELAY_BASE_URL`。

> `endpoint` 必须与应用保留域名完全一致，OAuth 做 Origin 精确匹配，对不上会导致登录失败。`publishableKey` 是公开客户端标识，不是密钥。

可选集成：`VITE_INTEGRATION_URL`（默认 `/integration`）指向云聘 HTTP 服务；`vite.config.js` 的 dev proxy 把 `/integration` 转发到 `http://127.0.0.1:8787`。

---

## 测试与构建

```bash
npm test       # 36 个用例：附件格式、DOCX 解析、台账列映射等
npm run build  # Vite 生产构建
```

测试文件位于 `tests/`，使用 Node 内置 `node:test`，无需额外测试框架。构建产物在 `dist/`。

---

## 部署发布

本项目通过 WorkBuddy 内置的应用发布能力上线（非通用服务器部署）：

1. 先 `npm run build` 产出 `dist/`；
2. 用 WorkBuddy「发布为应用」对**项目根目录**发布（发布目标由目录决定，重发会覆盖原链接、保持域名不变）；
3. 确认应用已开启对应登录方式；
4. 发布后按 `Ctrl + F5` 刷新验证。

---

## 开源组件清单

本项目使用了以下第三方开源组件，**版权归各自作者所有，并遵循其许可证**：

| 组件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [React](https://react.dev/) | 19.x | MIT | UI 框架 |
| [React DOM](https://react.dev/) | 19.x | MIT | DOM 渲染 |
| [Vite](https://vite.dev/) | 7.x | MIT | 构建工具 |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 5.x | MIT | React 构建插件 |
| [lucide-react](https://lucide.dev/) | 0.468 | ISC | 图标库 |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 5.x | Apache-2.0 | PDF 文本抽取 |
| [qrcode](https://github.com/soldair/node-qrcode) | 1.5 | MIT | 二维码生成 |
| [SheetJS](https://sheetjs.com/) (`xlsx`) | 0.18.5 | Apache-2.0 | Excel 读写与导出 |
| `@tencent-ai/workbuddy-cloud-sdk` | dev 版 | MIT | WorkBuddy 云服务 SDK（数据库/登录/存储/LLM） |

各组件的完整许可证文本见 `node_modules/<包名>/LICENSE*`。`package-lock.json` 记录了精确版本与依赖树。

> 字体与 WorMark 版式：界面使用系统字体栈，未引入需额外授权的商用字体或商业图库素材。

---

## 许可与商用限制

**本项目（聘桥 HireBridge）的自有源代码、设计、文档禁止用于任何商业用途。**

- 你可以：个人学习、研究、内部非商业试用，以及在此基础上做非商业的修改与实验。
- 你不可以：将本项目或其衍生版本用于商业经营、对外销售、收费服务、商业托管，或以任何形式从商业使用中获利。
- 上游开源组件（见上表）各自遵循其许可证；这些许可证大多允许商用，但**不代表本项目整体可商用**——本限制覆盖的是聘桥自身的原创代码与产品形态。
- 本软件按「现状」提供，不附带任何明示或暗示的担保；因使用、修改或部署产生的任何后果由使用者自行承担。

如需商业授权，请联系项目权利人另行协商。

---

*文档版本：v0.1.3*
