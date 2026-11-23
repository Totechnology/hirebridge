import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Award, BarChart3, Bell, BellRing, BookOpen, Bot, BriefcaseBusiness,
  CalendarDays, CalendarPlus, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight,
  Circle, ClipboardCopy, ClipboardList, Clock3, Copy, Database, Download, FileText, Filter, GitBranch, IdCard, Inbox,
  Link2, Layers, ListChecks, LoaderCircle, LockKeyhole, LogOut, MapPin, Menu, MessageSquare, MoreHorizontal,
  PanelRightClose, Pencil, PlugZap, Plus, RefreshCw, Search, Send, Settings2, Table2,
  ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Undo2, UploadCloud, UserCheck, UserPlus, UserRound, UsersRound, Wallet, X,
} from 'lucide-react'
import { stages } from './data.js'
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_FORMAT_TEXT, isSupportedAttachment,
  candidateDimensions, checkIntegration, clearHorilla, computeComposite, configureHorilla,
  createProject, bindCandidateSurvey, deleteCandidate, deleteJob, deleteMessage, deleteSurvey, deriveRubricFromJd,
  displayError, downloadCandidateAttachment, downloadEmployeeAttachment, ensureCandidateInvite, evaluateCandidateResume, evaluateResume,
  exportCandidateRankingXlsx, exportEmployeesXlsx, exportLedgerByProjectXlsx, exportLedgerXlsx, exportSurveyResponsesXlsx, ledgerSurveyData,
  extractJobFileText, extractResumeProfile, fetchCandidateSurveyResponses, fetchEmployees, fetchFunnel, fetchInvites, fetchMessages, fetchPersons,
  fetchScoringHistory, fetchSurveyResponses, fetchSurveys, getJdUrl, getResumeUrl, getSurveyForFill, jobCurrentSurvey,
  fetchMyProfile, saveMyProfile, fetchAdminStatus, fetchDisplayNames, ensureDisplayName, scanOrphanResumes, purgeOrphanResumes,
  fetchJobShares, createJobShare, deleteJobShare,
  importResumeFiles, inviteUrl, loadWorkspace, MARKET_TYPES, markMessageRead, markMessagesRead, moveCandidate,
  planResumeImport, rankCandidates, PROFILE_QUESTIONS, RECRUIT_REASONS, recordFunnel, removeEmployeeAttachment, restoreSession,
  saveJobFull, saveJobJd, saveSurveyVersioned, signIn, parseResumeContacts, updateCandidateProfile, updateCandidateJob, revokeCandidateInvites, bindSurveyToJob, resetCandidateSurvey,
  fetchInterviews, saveInterviewRecord, deleteInterviewRecord, deleteCandidateInterviews, setInterviewAt, INTERVIEW_ROUNDS, INTERVIEW_ACCEPTED, INTERVIEW_ATTENDED, INTERVIEW_FORMATS, INTERVIEW_RESULTS,
  signOut, submitSurveyRpc, syncCandidate, syncDerivedMessages, updateEmployee, uploadEmployeeAttachment,
} from './services.js'

// ============================================================================
// 1. 导航与业务常量配置
// ============================================================================

const primaryNav = [
  { id: 'jobs', label: '上架岗位', icon: BriefcaseBusiness },
  { id: 'surveys', label: '测评问卷', icon: ClipboardList },
  { id: 'people', label: '人员管理', icon: IdCard },
  { id: 'pipeline', label: '候选人管道', icon: UsersRound },
  { id: 'interviews', label: '面试安排', icon: CalendarDays },
  { id: 'funnel', label: '数据漏斗', icon: BarChart3 },
]

const secondaryNav = [
  { id: 'ledger', label: '在线台账', icon: Table2 },
  { id: 'batch', label: '批量简历导入', icon: Layers },
  { id: 'messages', label: '消息', icon: MessageSquare },
  { id: 'integration', label: '云聘集成', icon: PlugZap },
  { id: 'account', label: '用户中心', icon: UserRound },
]

// 招聘阶段线性流程：简历筛选 → 推面试 → 面试中 → 发 Offer → Offer → 确认入职 → 已入职
// 每个阶段只有一个「下一步」动作，避免从筛选直接跳到 Offer。
const stageFlow = {
  screening: { next: 'interview', label: '推面试' },
  interview: { next: 'offer', label: '发 Offer' },
  offer: { next: 'hired', label: '确认入职' },
}
// 回撤映射：只能逐格往回退，不能跳步
const stageBack = { interview: 'screening', offer: 'interview', hired: 'offer' }

const messageCategories = [
  { id: 'all', label: '全部' },
  { id: 'task', label: '待办' },
  { id: 'risk', label: '风险' },
  { id: 'activity', label: '动态' },
  { id: 'system', label: '系统' },
]

const questionTypes = [
  { id: 'single', label: '单选' },
  { id: 'multi', label: '多选' },
  { id: 'scale', label: '量表 1-5' },
  { id: 'text', label: '开放题' },
]

const scaleOptions = [
  { label: '很差', score: 0 },
  { label: '较弱', score: 25 },
  { label: '一般', score: 50 },
  { label: '较好', score: 75 },
  { label: '优秀', score: 100 },
]

const viewTitles = {
  jobs: '上架岗位',
  people: '人员管理',
  pipeline: '候选人管道',
  surveys: '测评问卷',
  interviews: '面试安排',
  funnel: '数据漏斗',
  messages: '消息中心',
  integration: '云聘人事',
  batch: '批量简历导入',
  ledger: '在线台账',
  account: '用户中心',
}

// 当前可访问的视图。招聘工作流/人才评分/资料导入已下线，
// 历史消息里的旧跳转目标统一回落到人员管理，避免打开就是空白页。
const AVAILABLE_VIEWS = new Set([
  'dashboard', 'jobs', 'surveys', 'people', 'pipeline',
  'interviews', 'funnel', 'messages', 'integration', 'batch', 'account',
])

// 常驻挂载的视图顺序。所有视图同时渲染、非当前视图用 hidden 隐藏（不卸载），
// 切换栏目时组件内部状态（批量导入队列、表单草稿、筛选条件、滚动位置）全部保留，
// 切回来可以继续接着改。
const VIEW_KEYS = ['dashboard', 'jobs', 'surveys', 'people', 'pipeline', 'interviews', 'funnel', 'messages', 'integration', 'batch', 'ledger', 'account']


// 二维码统一低饱和墨色配置（与 styles.css 纸张/墨色令牌一致）
const QR_COLORS = { dark: '#2f2c29', light: '#fbfaf7' }

// ============================================================================
// 通用工具函数
// ============================================================================

function classNames(...items) {
  return items.filter(Boolean).join(' ')
}

function formatDate(value, withTime = false) {
  if (!value) return '待安排'
  return new Date(value).toLocaleString('zh-CN', withTime
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' })
}

function formatSize(size) {
  const bytes = Number(size) || 0
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ============================================================================
// 2. 基础 UI 组件
// ============================================================================

function BrandMark({ size = 'md' }) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <span className={classNames('brand-mark', size === 'lg' && 'brand-mark-lg')} aria-hidden="true">
      {!imgFailed ? (
        <img
          src="/brand-bridge.png"
          alt=""
          className="brand-mark-img"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <svg className="brand-bridge" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 24.5C11 14 29 14 35 24.5" />
          <path d="M9 24.5C13.5 18 26.5 18 31 24.5" />
          <path d="M5 24.5h30" />
          <path d="M13 18.2v6.3M20 16.5v8M27 18.2v6.3" strokeWidth="1.4" />
          <path d="M9 28.5c4.5-1.2 8.5-1.2 11 0s6.5 1.2 11 0" stroke="var(--accent)" strokeWidth="1.6" />
          <path d="M13 32c3.5-.8 10.5-.8 14 0" stroke="var(--accent)" strokeWidth="1.3" opacity="0.7" />
        </svg>
      )}
    </span>
  )
}

function Avatar({ name, size = 'md' }) {
  const palette = ['sage', 'orange', 'violet', 'blue']
  const index = (name?.charCodeAt(0) || 0) % palette.length
  return <span className={`avatar avatar-${size} avatar-${palette[index]}`}>{name?.slice(-2) || '候选人'}</span>
}

function ScoreBadge({ score, band, compact = false }) {
  const tone = score >= 85 ? 'high' : score >= 75 ? 'mid' : 'low'
  return (
    <span className={`score-badge score-${tone} ${compact ? 'score-compact' : ''}`}>
      <strong>{score ?? '—'}</strong><span>{band || '未评估'}</span>
    </span>
  )
}

function EmptyState({ icon: Icon = FileText, title, detail, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={22} /></span>
      <h3>{title}</h3><p>{detail}</p>{action}
    </div>
  )
}

// ============================================================================
// 3. 布局与导航组件（侧栏 / 顶栏）
// ============================================================================

function Sidebar({ view, onChange, session, onLogin, onLogout, adminMode, mobileOpen, onClose, unreadCount = 0 }) {
  // 昵称是纯 emoji/空白时当作无名字处理，回退显示账号 ID 尾部
  const rawName = (session?.user?.name || '').trim()
  const hasRealName = /[\u4e00-\u9fa5A-Za-z0-9]/.test(rawName)
  const uid = session?.user?.id || ''
  return (
    <aside className={classNames('sidebar', mobileOpen && 'sidebar-open')}>
      <div className="brand">
        <BrandMark />
        <div><strong>聘桥</strong><span>HireBridge</span></div>
        <button className="icon-btn sidebar-close" onClick={onClose} aria-label="关闭导航"><X size={18} /></button>
      </div>
      <nav className="main-nav" aria-label="主导航">
        <span className="nav-section-label">招聘业务</span>
        {primaryNav.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-current={view === id ? 'page' : undefined} className={classNames('nav-item', view === id && 'active')} onClick={() => { onChange(id); onClose() }}>
            <Icon size={18} /><span>{label}</span>
          </button>
        ))}
        <span className="nav-section-label nav-section-second">系统与工具</span>
        {secondaryNav.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-current={view === id ? 'page' : undefined} className={classNames('nav-item', view === id && 'active')} onClick={() => { onChange(id); onClose() }}>
            <Icon size={18} /><span>{label}</span>
            {id === 'messages' && unreadCount > 0 && <span className="nav-count nav-count-alert">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            {id === 'integration' && <span className="status-dot" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-user">
        {session ? (
          <>
            <button type="button" className="sidebar-user-main" onClick={() => { onChange('account'); onClose() }} title="打开用户中心">
              <span className={`user-avatar${adminMode ? ' user-avatar-admin' : ''}`}>{hasRealName ? rawName.slice(0, 1) : uid.slice(0, 2).toUpperCase() || 'HR'}</span>
              <span className="sidebar-user-text">
                <strong>{hasRealName ? rawName : `账号 …${uid.slice(-4)}`}</strong>
                <span>{adminMode ? '管理员模式' : '个人工作区'}</span>
              </span>
            </button>
            <button className="icon-btn sidebar-user-logout" onClick={onLogout} title="退出登录"><LogOut size={16} /></button>
          </>
        ) : (
          <button className="login-sidebar" onClick={onLogin}><LockKeyhole size={17} /><span>登录真实工作区</span><ArrowRight size={16} /></button>
        )}
      </div>
    </aside>
  )
}

function messageTone(message) {
  if (message.level === 'warn') return { className: 'msg-warn', Icon: AlertTriangle }
  if (message.category === 'task') return { className: 'msg-task', Icon: Clock3 }
  if (message.category === 'risk') return { className: 'msg-risk', Icon: ShieldCheck }
  if (message.category === 'activity') return { className: 'msg-activity', Icon: UserCheck }
  return { className: 'msg-system', Icon: Settings2 }
}

function Topbar({ title, onEvaluate, onMenu, session, messages = [], unreadCount = 0, onOpenMessage, onViewMessages, onMarkAllRead }) {
  const [open, setOpen] = useState(false)
  const latest = messages.slice(0, 6)
  const isWorkflow = title === viewTitles.workflow
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-btn mobile-menu" onClick={onMenu} aria-label="打开导航"><Menu size={20} /></button>
        <div className="topbar-breadcrumb">
          <h1 className="topbar-main-title">聘桥工作台</h1>
          <ChevronRight size={14} className="topbar-sep" aria-hidden="true" />
          <span className="topbar-subtitle">{title}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="topbar-date"><CalendarDays size={15} />{new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' })}</span>
        <div className="bell-wrap">
          <button className={classNames('icon-btn notification-btn', unreadCount > 0 && 'has-unread')} aria-label={`通知${unreadCount ? `，${unreadCount} 条未读` : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {unreadCount > 0 ? <BellRing size={19} /> : <Bell size={19} />}
            {unreadCount > 0 && <span className="bell-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          {open && (
            <>
              <button className="bell-backdrop" aria-label="关闭通知" onClick={() => setOpen(false)} />
              <div className="bell-panel">
                <div className="bell-head"><strong>通知</strong><span>{unreadCount ? `${unreadCount} 条未读` : '已全部读完'}</span>{unreadCount > 0 && <button className="text-btn" onClick={() => { setOpen(false); onMarkAllRead?.() }}>全部已读</button>}</div>
                <div className="bell-list">
                  {latest.map((message) => {
                    const { className, Icon } = messageTone(message)
                    return (
                      <button key={message.id} className={classNames('bell-item', !message.read_at && 'unread')} onClick={() => { setOpen(false); onOpenMessage?.(message) }}>
                        <span className={classNames('msg-icon', className)}><Icon size={15} /></span>
                        <div><strong>{message.title}</strong>{message.body && <p>{message.body}</p>}<time>{formatDate(message.created_at, true)}</time></div>
                        {!message.read_at && <i className="unread-dot" />}
                      </button>
                    )
                  })}
                  {!latest.length && <div className="bell-empty"><Inbox size={22} /><p>{session ? '暂无通知' : '登录后查看真实通知'}</p></div>}
                </div>
                <button className="bell-foot" onClick={() => { setOpen(false); onViewMessages?.() }}>查看全部消息<ArrowRight size={15} /></button>
              </div>
            </>
          )}
        </div>
        <button className={classNames('btn', isWorkflow ? 'btn-secondary' : 'btn-primary', 'topbar-evaluate')} onClick={onEvaluate}><Sparkles size={17} />AI 评估简历</button>
      </div>
    </header>
  )
}

function MetricCard({ label, value, note, icon: Icon, tone, trend }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-${tone}`}><Icon size={20} /></div>
      <div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      {trend && <span className="metric-trend"><ArrowUpRight size={14} />{trend}</span>}
    </article>
  )
}

function PipelinePreview({ candidates, onOpen, onViewAll }) {
  return (
    <section className="panel pipeline-preview">
      <div className="panel-heading"><div><h2>招聘漏斗</h2></div><button className="text-btn" onClick={onViewAll}>查看管道<ArrowRight size={15} /></button></div>
      <div className="funnel-list">
        {stages.map((stage) => {
          const people = candidates.filter((candidate) => candidate.stage === stage.id)
          const width = Math.max(8, (people.length / Math.max(candidates.length, 1)) * 100)
          return (
            <button className="funnel-row" key={stage.id} onClick={onViewAll}>
              <span className="funnel-label"><i style={{ background: stage.color }} />{stage.label}</span>
              <div className="funnel-track"><span style={{ width: `${width}%`, background: stage.color }} /></div>
              <strong>{people.length}</strong><span className="funnel-people">{people.slice(0, 2).map((p) => p.name).join('、') || '暂无候选人'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ============================================================================
// 4. 核心业务视图
// ============================================================================

function Dashboard({ jobs, candidates, events, integration, onOpen, onView, onEvaluate }) {
  const active = candidates.filter((c) => c.stage !== 'hired')
  const interviews = candidates.filter((c) => c.interview_at).sort((a, b) => new Date(a.interview_at) - new Date(b.interview_at))
  const hired = candidates.filter((c) => c.stage === 'hired')
  return (
    <div className="view-stack">
      <section className="welcome-row">
        <div><h2>招聘进展，一眼看清。</h2></div>
        <button className="btn btn-secondary" onClick={() => onView('interviews')}><CalendarDays size={17} />查看今日安排</button>
      </section>
      <div className="metrics-grid">
        <MetricCard label="在招职位" value={jobs.filter((j) => j.status === 'open').length} note={`共 ${jobs.reduce((sum, j) => sum + j.openings, 0)} 个招聘名额`} icon={BriefcaseBusiness} tone="green" trend="2" />
        <MetricCard label="活跃候选人" value={active.length} note={`${active.filter((c) => c.stage === 'screening').length} 人等待简历筛选`} icon={UsersRound} tone="blue" trend="12%" />
        <MetricCard label="已排面试" value={interviews.length} note="最近一场明天 10:30" icon={CalendarDays} tone="orange" />
        <MetricCard label="已入职" value={hired.length} note={`${hired.filter((c) => c.horilla_employee_id).length} 人已同步云聘`} icon={UserCheck} tone="violet" />
      </div>
      <div className="dashboard-main-grid">
        <PipelinePreview candidates={candidates} onOpen={onOpen} onViewAll={() => onView('pipeline')} />
      </div>
      <div className="dashboard-bottom-grid">
        <section className="panel interview-panel">
          <div className="panel-heading"><div><h2>接下来的面试</h2></div><button className="icon-btn"><MoreHorizontal size={19} /></button></div>
          <div className="interview-list">
            {interviews.slice(0, 3).map((candidate, index) => (
              <button className="interview-item" key={candidate.id} onClick={() => onOpen(candidate)}>
                <div className="interview-date"><strong>{new Date(candidate.interview_at).getDate()}</strong><span>{index === 0 ? '明天' : '周五'}</span></div>
                <Avatar name={candidate.name} size="sm" />
                <div className="interview-person"><strong>{candidate.name}</strong><span>{candidate.role_title}</span></div>
                <div className="interview-time"><Clock3 size={14} />{formatDate(candidate.interview_at, true).split(' ')[1] || formatDate(candidate.interview_at, true)}</div>
                <ChevronRight size={16} />
              </button>
            ))}
            {!interviews.length && <EmptyState icon={CalendarDays} title="暂无面试" detail="在候选人详情中即可安排面试。" />}
          </div>
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>最新动态</h2></div><Filter size={17} /></div>
          <div className="activity-list">
            {events.slice(0, 4).map((event) => (
              <div className="activity-item" key={event.id}><span className={`activity-dot activity-${event.event_type}`} /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{formatDate(event.created_at, true)}</small></div></div>
            ))}
          </div>
        </section>
        <section className={classNames('panel connection-panel', integration.online && 'connected')}>
          <div className="connection-head"><span className="connection-icon"><Database size={21} /></span><span className={classNames('connection-status', integration.configured && 'ok')}><Circle size={7} fill="currentColor" />{integration.configured ? '已连接' : '待配置'}</span></div>
          <h2>云聘 HRMS</h2><p>{integration.online ? '集成服务在线，员工同步按真实接口结果执行。' : '启动本地集成服务后，即可把录用候选人同步为员工。'}</p>
          <button className="text-btn" onClick={() => onView('integration')}>管理连接<ArrowUpRight size={15} /></button>
        </section>
      </div>
    </div>
  )
}

const isRoundRejected = (rec) => rec?.accepted === '拒绝'

function CandidateCard({ candidate, onOpen, onDragStart, onAdvance, onBack, records = [], onSchedule, readOnly }) {
  const flags = candidate.evaluation?.flags || []
  const flow = stageFlow[candidate.stage]
  const backTo = stageBack[candidate.stage]
  const inInterview = candidate.stage === 'interview'
  const primaryRound = records.find((r) => r.round === '一面') ? '一面' : records.find((r) => r.round === '二面') ? '二面' : '一面'
  const primaryRec = records.find((r) => r.round === primaryRound)
  const rejected = isRoundRejected(primaryRec)
  const interviewSummary = (round) => {
    const rec = records.find((r) => r.round === round)
    if (!rec) return null
    return [rec.attended, rec.format, rec.result].filter(Boolean).join(' · ')
  }
  const factLine = (label, value, danger = false) => <div className="if-line"><span>{label}</span><b className={danger ? 'if-danger' : (value && value !== '未填写' ? 'if-filled' : '')}>{value || '未填写'}</b></div>
  return (
    <article className="candidate-card" draggable onDragStart={(event) => onDragStart(event, candidate)} onClick={() => onOpen(candidate)}>
      <div className="candidate-card-top"><Avatar name={candidate.name} /><ScoreBadge score={candidate.score} band={candidate.band} compact /></div>
      <h3>
        <button type="button" className="candidate-card-open" aria-label={`查看 ${candidate.name} 的详情`} onClick={(event) => { event.stopPropagation(); onOpen(candidate) }}>
          {candidate.name}
        </button>
      </h3>
      <p className="candidate-role">{candidate.role_title}</p>
      {inInterview ? (
        <div className={classNames('interview-facts', rejected && 'facts-rejected')}>
          <div className="if-head">
            <span className="if-round">{primaryRound}</span>
            <span className={classNames('if-accepted', rejected && 'if-danger')}>{primaryRec?.accepted || '未填写'}</span>
            <button type="button" className="if-edit" title="编辑该轮面试记录" disabled={readOnly} onClick={(event) => { event.stopPropagation(); onSchedule?.(candidate, primaryRound) }}>{readOnly ? '只读' : <><Pencil size={12} />编辑</>}</button>
          </div>
          {factLine('参面', primaryRec?.attended)}
          {factLine('时间', primaryRec?.interview_at ? formatDate(primaryRec.interview_at, true) : '')}
          {factLine('形式', primaryRec?.format)}
          {factLine('结果', primaryRec?.result, ['未通过', '放弃'].includes(primaryRec?.result))}
          {!primaryRec && <span className="if-placeholder">点「编辑」登记 {primaryRound} 的面试信息</span>}
        </div>
      ) : (
        <>
          <div className="skill-list">{(candidate.evaluation?.skills || candidate.skills || []).slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}</div>
          {flags.length > 0 && <div className="candidate-risk"><AlertTriangle size={13} />{flags[0].label}</div>}
        </>
      )}
      <div className="candidate-card-foot"><span>{candidate.source}</span><span>{candidate.interview_at ? <><Clock3 size={13} />{formatDate(candidate.interview_at)}</> : <><MapPin size={13} />{candidate.location || '地点待确认'}</>}</span></div>
      {!inInterview && <div className="candidate-interview-strip" onClick={(event) => event.stopPropagation()}>
        {INTERVIEW_ROUNDS.map((round) => {
          const rec = records.find((r) => r.round === round)
          const text = interviewSummary(round)
          return <button key={round} className={classNames('cis-chip', text && 'cis-filled', text?.includes('已参面') && 'cis-attended', isRoundRejected(rec) && 'cis-rejected')} title={text || `登记${round}：参面 / 形式 / 结果`} onClick={() => onSchedule?.(candidate, round)} disabled={readOnly}>{round}<span>{text || (readOnly ? '只读' : '+备注')}</span></button>
        })}
      </div>}
      <div className="candidate-card-actions">
        {backTo && <button className="candidate-advance candidate-back" title={`回撤到上一阶段`} onClick={(event) => { event.stopPropagation(); onBack(candidate, backTo) }}><Undo2 size={13} />回撤</button>}
        {flow && <button className="candidate-advance" onClick={(event) => { event.stopPropagation(); onAdvance(candidate, flow.next) }}>{flow.label}<ArrowRight size={13} /></button>}
      </div>
    </article>
  )
}

function Pipeline({ jobs, candidates, recordsById, onOpen, onMove, onSchedule, readOnly, notify }) {
  const [query, setQuery] = useState('')
  const [jobFilter, setJobFilter] = useState('all')
  const filtered = candidates.filter((candidate) => {
    const matchesQuery = `${candidate.name}${candidate.role_title}${(candidate.evaluation?.skills || candidate.skills || []).join('')}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (jobFilter === 'all' || String(candidate.job_id) === jobFilter)
  })
  return (
    <div className="view-stack pipeline-view">
      <div className="toolbar">
        <div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名、职位或技能" /></div>
        <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}><option value="all">全部职位</option>{jobs.map((job) => <option value={job.id} key={job.id}>{job.title}</option>)}</select>
        <button className="btn btn-secondary"><Filter size={16} />更多筛选</button>
        <span className="toolbar-count">{filtered.length} 位候选人</span>
      </div>
      <div className="kanban-board">
        {stages.map((stage) => {
          const people = filtered.filter((candidate) => candidate.stage === stage.id)
          return (
            <section className="kanban-column" key={stage.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('candidate-id')
              const person = candidates.find((c) => String(c.id) === id)
              if (!person || person.stage === stage.id) return
              // 阶段线性推进 + 逐格回撤：只允许拖到当前阶段的上一格或下一格，不允许跳步
              const nextId = stageFlow[person.stage]?.next
              const backId = stageBack[person.stage]
              if (stage.id !== nextId && stage.id !== backId) {
                notify?.(
                  `${person.name}只能逐格推进或回撤：当前可去「${stageFlow[person.stage]?.label || '流程起点'}」${backId ? `或回撤到「${(stages.find((s) => s.id === backId) || {}).label}」` : ''}`,
                  'error',
                )
                return
              }
              onMove(person, stage.id)
            }}>
              <div className="kanban-heading"><span><i style={{ background: stage.color }} />{stage.label}</span><strong>{people.length}</strong><Plus size={16} /></div>
              <div className="kanban-cards">
                {people.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} records={recordsById.get(String(candidate.id)) || []} onSchedule={onSchedule} readOnly={readOnly} onOpen={onOpen} onDragStart={(event, person) => { event.dataTransfer.setData('candidate-id', String(person.id)); event.dataTransfer.effectAllowed = 'move' }} onAdvance={onMove} onBack={onMove} />)}
                {!people.length && <div className="kanban-empty">拖拽候选人到这里</div>}
              </div>
            </section>
          )
        })}
      </div>
      <div className="pipeline-legend"><ShieldCheck size={15} /><span>标准流程（线性推进 + 逐格回撤）：简历筛选 → 面试中 → Offer → 已入职。面试中的卡片直接展示一面/二面的接受、参面、时间、形式与结果（拒绝会标红），点「编辑」即可登记；按钮与拖拽每次只移动一格，回撤如实写入审计事件；AI 不会自动移动或淘汰候选人。</span></div>
    </div>
  )
}

function Jobs({ jobs, candidates, onAdd, onEditJd, onEditFull, onDelete }) {
  return (
    <div className="view-stack">
      <div className="section-action-row"><div><h2>职位与评估标准</h2></div><button className="btn btn-primary" onClick={onAdd}><Plus size={17} />新建职位</button></div>
      <div className="jobs-grid">
        {jobs.map((job) => {
          const people = candidates.filter((candidate) => candidate.job_id === job.id || candidate.role_title === job.title)
          const hasJd = Boolean(job.jd_text)
          return (
            <article className="job-card" key={job.id}>
              <div className="job-card-head">
                <span className="job-icon"><BriefcaseBusiness size={20} /></span>
                {job.project_name && <span className="lock-badge">{job.project_name}</span>}
                <span className={classNames('jd-pill', hasJd ? 'jd-pill-ok' : 'jd-pill-missing')}>{hasJd ? 'JD 已就绪' : '缺 JD'}</span>
                <button className="icon-btn" onClick={() => onEditJd(job)} title="JD 与评分标准"><MoreHorizontal size={18} /></button>
              </div>
              <h2>{job.title}</h2><p className="job-department">{job.company_name || job.department || '—'}</p>
              <div className="job-meta"><span><MapPin size={14} />{job.location}</span><span><UsersRound size={14} />{job.openings} 个名额</span><span><Clock3 size={14} />{job.employment_type}</span></div>
              <div className="job-stats"><div><strong>{people.length}</strong><span>候选人</span></div><div><strong>{people.filter((p) => p.stage === 'interview').length}</strong><span>面试中</span></div><div><strong>{job.hired}</strong><span>已录用</span></div></div>
              <div className="rubric-block">
                <div className="rubric-title"><span>{hasJd ? '按 JD 解析的评估维度' : '历史权重（未接 JD）'}</span><Settings2 size={14} /></div>
                {Object.entries(job.rubric || {}).map(([name, weight]) => <div className="rubric-row" key={name}><span>{name}</span><div><i style={{ width: `${weight}%` }} /></div><strong>{weight}%</strong></div>)}
                {!Object.keys(job.rubric || {}).length && <p className="rubric-empty">还没有评分维度，上传 JD 后自动生成。</p>}
              </div>
              <div className="job-card-actions">
                <button className="job-candidates-btn" onClick={() => onEditJd(job)}><BookOpen size={15} />{hasJd ? '查看 / 更新 JD' : '上传 JD'}</button>
                <button className="job-candidates-btn" onClick={() => onEditFull(job)}><Settings2 size={15} />配置</button>
                <button className="icon-btn job-delete-btn" title="删除岗位" onClick={(event) => { event.stopPropagation(); onDelete(job) }}><Trash2 size={15} /></button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// 5. 抽屉与详情面板
// ============================================================================

function JobJdDrawer({ job, session, notify, onClose, onSaved, onLogin }) {
  const [text, setText] = useState(job.jd_text || '')
  const [file, setFile] = useState(null)
  const [draftRubric, setDraftRubric] = useState(job.rubric || {})
  const [notes, setNotes] = useState(job.rubric_notes || {})
  const [summary, setSummary] = useState('')
  const [parsing, setParsing] = useState(false)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const total = Object.values(draftRubric).reduce((sum, v) => sum + Number(v || 0), 0)

  const handleFile = async (picked) => {
    if (!picked) return
    if (!session) return onLogin()
    setFile(picked); setError(''); setReading(true)
    try {
      const extracted = await extractJobFileText(picked)
      if (extracted.length < 60) throw new Error('文件里没有提取到足够的 JD 文本，试试直接粘贴 JD。')
      setText(extracted)
    } catch (err) { setError(displayError(err)) } finally { setReading(false) }
  }

  const handleParse = async () => {
    if (!session) return onLogin()
    if (text.trim().length < 60) { setError('JD 内容太短，至少 60 个字符。'); return }
    setParsing(true); setError('')
    try {
      const result = await deriveRubricFromJd(job, text, session)
      setDraftRubric(result.rubric)
      setNotes({ mustHave: result.mustHave, niceToHave: result.niceToHave })
      setSummary(result.summary)
      notify?.('已按 JD 生成评分维度，请确认后保存')
    } catch (err) { setError(displayError(err)) } finally { setParsing(false) }
  }

  const updateWeight = (name, value) => setDraftRubric((old) => ({ ...old, [name]: Math.max(0, Math.min(100, Number(value) || 0)) }))
  const removeDimension = (name) => setDraftRubric((old) => { const next = { ...old }; delete next[name]; return next })
  const addDimension = () => setDraftRubric((old) => ({ ...old, '新维度': 10 }))

  const handleSave = async () => {
    if (!session) return onLogin()
    if (total !== 100) { setError(`维度权重合计必须为 100%，当前 ${total}%。`); return }
    setSaving(true); setError('')
    try {
      const row = await saveJobJd(job, { file, text, rubric: draftRubric, mustHave: notes.mustHave, niceToHave: notes.niceToHave, source: summary ? 'jd-parsed' : (job.rubric_source || 'manual') }, session)
      onSaved(row)
      notify?.('JD 与评分标准已保存，后续评估按该岗位 JD 打分')
      onClose()
    } catch (err) { setError(displayError(err)) } finally { setSaving(false) }
  }

  const handleDownloadJd = async () => {
    try { const url = await getJdUrl(job); window.open(url, '_blank', 'noopener,noreferrer') } catch (err) { notify?.(displayError(err), 'error') }
  }

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true">
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭" />
      <aside className="candidate-drawer jd-drawer">
        <div className="drawer-top"><span>{job.title} · JD 与评分标准</span><button className="icon-btn" onClick={onClose}><X size={19} /></button></div>
        <div className="drawer-content">
          <div className="jd-meta-row">
            <div><span>部门</span><strong>{job.department || '未填写'}</strong></div>
            <div><span>JD 状态</span><strong>{job.jd_text ? '已就绪' : '未上传'}</strong></div>
            <div><span>更新时间</span><strong>{job.jd_updated_at ? formatDate(job.jd_updated_at) : '—'}</strong></div>
          </div>

          <section className="drawer-section">
            <div className="drawer-section-title"><h3>1. 上传或粘贴 JD</h3>{job.jd_file && <button className="text-btn" onClick={handleDownloadJd}>下载已存 JD<ArrowRight size={14} /></button>}</div>
            <label className={classNames('upload-zone upload-zone-compact', file && 'has-file')}>
              <input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => handleFile(e.target.files?.[0])} disabled={reading} />
              {reading ? <><LoaderCircle size={22} className="spin" /><strong>正在读取文件</strong><span>解析 PDF / DOCX 文本</span></>
                : file ? <><FileText size={22} /><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(0)} KB · 点击更换</span></>
                : <><UploadCloud size={24} /><strong>上传 JD 文件</strong><span>PDF / DOCX / TXT，或直接在下方粘贴</span></>}
            </label>
            <textarea className="jd-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="把岗位 JD 原文粘贴到这里。模型只依据这段文字拆解评分维度，不再套用统一模板。" rows={9} />
          </section>

          <section className="drawer-section">
            <div className="drawer-section-title"><h3>2. 按 JD 生成评分维度</h3><button className="btn btn-secondary btn-small" onClick={handleParse} disabled={parsing || reading}>{parsing ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{parsing ? '解析中' : '解析 JD'}</button></div>
            {summary && <p className="jd-summary">{summary}</p>}
            <div className="rubric-editor">
              {Object.entries(draftRubric).map(([name, weight]) => (
                <div className="rubric-edit-row" key={name}>
                  <span>{name}</span>
                  <input type="number" min="0" max="100" value={weight} onChange={(e) => updateWeight(name, e.target.value)} />
                  <em>%</em>
                  <button className="icon-btn" onClick={() => removeDimension(name)} title="删除维度"><Trash2 size={14} /></button>
                </div>
              ))}
              {!Object.keys(draftRubric).length && <p className="rubric-empty">还没有维度。上传 JD 后点「解析 JD」，或手动添加。</p>}
            </div>
            <div className="rubric-editor-foot">
              <button className="text-btn" onClick={addDimension}><Plus size={14} />添加维度</button>
              <span className={classNames('rubric-total', total !== 100 && 'rubric-total-bad')}>合计 {total}%</span>
            </div>
            {!!(notes.mustHave?.length || notes.niceToHave?.length) && (
              <div className="jd-notes">
                {!!notes.mustHave?.length && <div><strong>硬性门槛</strong><ul>{notes.mustHave.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                {!!notes.niceToHave?.length && <div><strong>加分项</strong><ul>{notes.niceToHave.map((item) => <li key={item}>{item}</li>)}</ul></div>}
              </div>
            )}
          </section>

          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="drawer-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || reading}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存 JD 与标准</button>
        </div>
      </aside>
    </div>
  )
}

function MessagesView({ messages, session, onOpenMessage, onMarkAll, onDelete, onClearRead }) {
  const [filter, setFilter] = useState('all')
  const [onlyUnread, setOnlyUnread] = useState(false)
  const rows = messages.filter((m) => (filter === 'all' || m.category === filter) && (!onlyUnread || !m.read_at))
  const unread = messages.filter((m) => !m.read_at).length
  return (
    <div className="view-stack">
      <div className="section-action-row">
        <div><h2>消息中心</h2><p className="section-hint">{messages.length} 条消息 · {unread} 条未读</p></div>
        <div className="panel-heading-actions">
          <button className="btn btn-secondary btn-small" onClick={() => setOnlyUnread((v) => !v)}>{onlyUnread ? '显示全部' : '只看未读'}</button>
          <button className="btn btn-secondary btn-small" onClick={onMarkAll} disabled={!unread}><CheckCheck size={15} />全部已读</button>
          <button className="btn btn-quiet btn-small" onClick={onClearRead} disabled={!messages.some((m) => m.read_at)}><Trash2 size={15} />清理已读</button>
        </div>
      </div>
      <div className="msg-filters">
        {messageCategories.map((item) => {
          const count = item.id === 'all' ? messages.length : messages.filter((m) => m.category === item.id).length
          return <button key={item.id} className={classNames('msg-filter', filter === item.id && 'active')} onClick={() => setFilter(item.id)}>{item.label}<span>{count}</span></button>
        })}
      </div>
      <section className="panel msg-panel">
        {!session && <div className="inline-notice"><LockKeyhole size={16} /><span>当前是演示工作区，消息来自演示数据。登录后读取你自己的真实消息。</span></div>}
        {rows.map((message) => {
          const { className, Icon } = messageTone(message)
          return (
            <article className={classNames('msg-row', !message.read_at && 'unread')} key={message.id}>
              <span className={classNames('msg-icon', className)}><Icon size={16} /></span>
              <button className="msg-main" onClick={() => onOpenMessage(message)}>
                <strong>{message.title}</strong>
                {message.body && <p>{message.body}</p>}
                <span className="msg-meta">{messageCategories.find((c) => c.id === message.category)?.label || '系统'} · {formatDate(message.created_at, true)}</span>
              </button>
              {!message.read_at && <span className="msg-unread-tag">未读</span>}
              <button className="icon-btn" onClick={() => onDelete(message)} title="删除"><X size={15} /></button>
            </article>
          )
        })}
        {!rows.length && <EmptyState icon={Inbox} title="没有符合条件的消息" detail="新的评估、排期、阶段变化和待办会自动出现在这里。" />}
      </section>
    </div>
  )
}

function InterviewRoundCell({ record, onEdit, onDelete, readOnly }) {
  if (!record) return <button className="interview-round-empty" onClick={onEdit} disabled={readOnly} title={readOnly ? '管理员模式只读' : '点此登记该轮面试'}><Plus size={14} />登记</button>
  const rejected = isRoundRejected(record)
  const chips = [
    record.accepted && { text: `接受 · ${record.accepted}`, tone: rejected ? 'danger' : 'info' },
    record.attended && { text: `参面 · ${record.attended}`, tone: record.attended === '已参面' ? 'ok' : 'muted' },
    record.format && { text: record.format, tone: 'info' },
    record.result && { text: `结果 · ${record.result}`, tone: record.result === '通过' ? 'ok' : record.result === '未通过' ? 'danger' : 'muted' },
  ].filter(Boolean)
  return (
    <div className={classNames('irc-wrap', rejected && 'irc-rejected')}>
      <button className="interview-round-cell" onClick={onEdit} title={record.note || '点击编辑该轮面试记录'}>
        {record.interview_at && <span className="irc-time"><Clock3 size={13} />{formatDate(record.interview_at, true)}</span>}
        <span className="irc-chips">{chips.length ? chips.map((c, i) => <em key={i} className={`irc-chip irc-${c.tone}`}>{c.text}</em>) : <em className="irc-chip irc-muted">待补充</em>}</span>
      </button>
      {!readOnly && <button type="button" className="irc-delete" title={`删除${record.round}记录`} aria-label={`删除${record.round}记录`} onClick={(event) => { event.stopPropagation(); onDelete?.(record) }}><Trash2 size={13} /></button>}
    </div>
  )
}

// ── 在线台账：类 Excel 的可编辑表格，单元格即改即存 ──
// 列分组：基础档案(profile) / 阶段岗位(flow) / 面试记录(interview) / 评分与问卷(score, 只读)
const LEDGER_GROUPS = [
  { id: 'all', label: '全部列' },
  { id: 'profile', label: '基础档案' },
  { id: 'flow', label: '阶段岗位' },
  { id: 'interview', label: '面试记录' },
  { id: 'score', label: '评分与问卷' },
]
const LEDGER_PROFILE_COLS = [
  { key: 'name', label: '姓名', kind: 'profile', field: 'name' },
  { key: 'phone', label: '电话', kind: 'profile', field: 'phone' },
  { key: 'id_number', label: '身份证号码', kind: 'profile', field: 'id_number' },
  { key: 'gender', label: '性别', kind: 'profile', field: 'gender' },
  { key: 'age', label: '年龄', kind: 'profile', field: 'age', type: 'number' },
  { key: 'education', label: '学历', kind: 'profile', field: 'education' },
  { key: 'school', label: '毕业院校', kind: 'profile', field: 'school' },
  { key: 'major', label: '专业', kind: 'profile', field: 'major' },
  { key: 'skill_certs', label: '技能/证书', kind: 'profile', field: 'skill_certs' },
  { key: 'career_plan', label: '职业规划', kind: 'profile', field: 'career_plan' },
  { key: 'leave_reason', label: '离职原因', kind: 'profile', field: 'leave_reason' },
  { key: 'expected_salary_note', label: '期望薪资', kind: 'profile', field: 'expected_salary_note' },
  { key: 'current_salary', label: '目前薪资', kind: 'profile', field: 'current_salary' },
  { key: 'available_note', label: '可入职时间', kind: 'profile', field: 'available_note' },
  { key: 'current_city', label: '目前居住地', kind: 'profile', field: 'current_city' },
  { key: 'acceptable_regions', label: '可接受区域', kind: 'profile', field: 'acceptable_regions' },
  { key: 'target_cities', label: '意向城市', kind: 'profile', field: 'target_cities' },
  { key: 'consent_archive', label: '同意留档', kind: 'profile', field: 'consent_archive' },
]

function LedgerView({ candidates, jobs, surveys, responses, recordsById, session, adminMode, onSave, onOpen, onLogin, notify, onExport }) {
  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState('all')
  const [editing, setEditing] = useState(null) // { candidate, col, orig }
  const [draft, setDraft] = useState('')

  const { columns: surveyColumns, answersByCandidate } = useMemo(() => ledgerSurveyData(responses, surveys), [responses, surveys])

  const columns = useMemo(() => {
    const flow = [
      { key: 'stage', label: '阶段', kind: 'stage', type: 'select', options: stages.map((s) => ({ value: s.id, label: s.label })), group: 'flow' },
      { key: 'job', label: '岗位', kind: 'job', type: 'select', options: jobs.map((j) => ({ value: String(j.id), label: j.title })), group: 'flow' },
    ]
    const interview = []
    for (const round of INTERVIEW_ROUNDS) {
      interview.push({ key: `${round}-accepted`, label: `${round}·接受`, kind: 'interview', round, field: 'accepted', type: 'select', options: INTERVIEW_ACCEPTED, group: 'interview' })
      interview.push({ key: `${round}-attended`, label: `${round}·参面`, kind: 'interview', round, field: 'attended', type: 'select', options: INTERVIEW_ATTENDED, group: 'interview' })
      interview.push({ key: `${round}-at`, label: `${round}·时间`, kind: 'interview', round, field: 'interview_at', type: 'datetime-local', group: 'interview' })
      interview.push({ key: `${round}-format`, label: `${round}·形式`, kind: 'interview', round, field: 'format', type: 'select', options: INTERVIEW_FORMATS, group: 'interview' })
      interview.push({ key: `${round}-result`, label: `${round}·结果`, kind: 'interview', round, field: 'result', type: 'select', options: INTERVIEW_RESULTS, group: 'interview' })
    }
    const readonly = [
      { key: 'band', label: '档位', kind: 'readonly', group: 'score', get: (c) => c.band || '' },
      { key: 'composite', label: '综合分', kind: 'readonly', group: 'score', get: (c) => c.composite_score ?? '' },
      { key: 'resumeState', label: '简历状态', kind: 'readonly', group: 'score', get: (c) => c.resume_raw != null ? '已评估' : '未评估' },
      { key: 'surveyState', label: '问卷状态', kind: 'readonly', group: 'score', get: (c) => c.survey_status === 'submitted' ? '已填写' : c.survey_status === 'invited' ? '已邀请' : '未填写' },
      { key: 'summary', label: '匹配评价', kind: 'readonly', group: 'score', get: (c) => c.summary || '' },
      { key: 'personality', label: '性格特征', kind: 'readonly', group: 'score', get: (c) => c.evaluation?.personality || '' },
      { key: 'owner', label: '负责人', kind: 'readonly', group: 'score', get: (c) => c.owner_name || '' },
      ...surveyColumns.map((title) => ({ key: `sv-${title}`, label: `问卷·${title}`, kind: 'readonly', group: 'score', get: (c) => answersByCandidate.get(String(c.id))?.[title] || '' })),
    ]
    return [
      ...LEDGER_PROFILE_COLS.map((c) => ({ ...c, group: 'profile' })),
      ...flow,
      ...interview,
      ...readonly,
    ]
  }, [jobs, surveyColumns, answersByCandidate])

  const shown = columns.filter((col) => activeGroup === 'all' || col.group === activeGroup)
  const people = candidates.filter((c) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [c.name, c.phone, c.role_title, c.id_number].some((v) => String(v || '').toLowerCase().includes(q))
  })

  const recordOf = (id, round) => (recordsById.get(String(id)) || []).find((r) => r.round === round)
  const readValue = (c, col) => {
    if (col.kind === 'profile') {
      if (col.field === 'expected_salary_note') return c.expected_salary_note || (c.expected_salary != null ? String(c.expected_salary) : '')
      if (col.field === 'current_city') return c.current_city || c.location || ''
      return c[col.field] ?? ''
    }
    if (col.kind === 'interview') {
      const v = recordOf(c.id, col.round)?.[col.field]
      if (col.field === 'interview_at') return v ? String(v).slice(0, 16) : ''
      return v ?? ''
    }
    if (col.kind === 'stage') return c.stage || ''
    if (col.kind === 'job') return String(c.job_id ?? '')
    return col.get ? col.get(c) : ''
  }
  const displayValue = (col, value) => {
    if (col.type === 'select' && col.options) {
      const opt = col.options.find((o) => String(typeof o === 'string' ? o : o.value) === String(value))
      return opt ? (typeof opt === 'string' ? opt : opt.label) : ''
    }
    if (col.kind === 'interview' && col.field === 'interview_at' && value) return String(value).replace('T', ' ')
    return value
  }
  const beginEdit = (c, col, value) => {
    if (adminMode) { notify('管理员模式为只读，不能修改台账', 'error'); return }
    if (!session) { onLogin?.(); return }
    setEditing({ candidate: c, col, orig: value })
    setDraft(String(value ?? ''))
  }
  const commitEdit = async (next) => {
    const cur = editing
    if (!cur) return
    setEditing(null)
    if (String(next ?? '') === String(cur.orig ?? '')) return
    await onSave(cur.candidate, cur.col, next)
  }

  return (
    <div className="view-stack">
      <div className="section-action-row">
        <div><h2>在线台账</h2><p className="section-hint">像表格一样直接改单元格，回车或离开即写回系统。综合分、档位、AI 评价与问卷答案按口径只读。</p></div>
        <div className="section-actions">
          {!session && <button className="btn btn-secondary btn-small" onClick={onLogin}><LockKeyhole size={15} />登录后可编辑</button>}
          {adminMode && <span className="read-only-badge"><ShieldCheck size={14} />管理员只读</span>}
          <button className="btn btn-secondary btn-small" onClick={onExport} disabled={!people.length}><Download size={15} />导出 Excel</button>
        </div>
      </div>
      <section className="panel ledger-panel">
        <div className="ledger-toolbar">
          <div className="people-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名 / 电话 / 岗位 / 身份证" /></div>
          <div className="ledger-group-tabs">{LEDGER_GROUPS.map((g) => <button key={g.id} className={activeGroup === g.id ? 'active' : ''} onClick={() => setActiveGroup(g.id)}>{g.label}</button>)}</div>
        </div>
        <div className="ledger-scroll">
          <table className="ledger-table">
            <thead><tr>
              <th className="ledger-idx">#</th>
              {shown.map((col) => <th key={col.key} className={`lg-${col.group}`}>{col.label}</th>)}
            </tr></thead>
            <tbody>
              {people.map((c, idx) => (
                <tr key={c.id}>
                  <td className="ledger-idx">{idx + 1}</td>
                  {shown.map((col) => {
                    const value = readValue(c, col)
                    const isEditing = editing?.candidate?.id === c.id && editing?.col?.key === col.key
                    const editable = col.kind !== 'readonly'
                    const text = displayValue(col, value)
                    return (
                      <td key={col.key} className={classNames('ledger-td', !editable && 'ledger-td-ro', isEditing && 'ledger-td-editing')} title={String(text ?? '')}>
                        {isEditing ? (
                          col.type === 'select' ? (
                            <select autoFocus value={draft} onChange={(e) => commitEdit(e.target.value)} onBlur={() => setEditing(null)}>
                              <option value="">—</option>
                              {col.options.map((o) => { const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label; return <option key={v} value={v}>{l}</option> })}
                            </select>
                          ) : (
                            <input autoFocus type={col.type === 'number' ? 'number' : col.type === 'datetime-local' ? 'datetime-local' : 'text'} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commitEdit(draft)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(draft) } else if (e.key === 'Escape') setEditing(null) }} />
                          )
                        ) : (
                          <button type="button" className="ledger-cell" onClick={() => beginEdit(c, col, value)} title={editable && !adminMode && session ? '点击编辑' : undefined}>
                            <span>{text || '—'}</span>{editable && !adminMode && session && <Pencil size={11} className="ledger-pencil" />}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!people.length && <EmptyState icon={Table2} title="没有可显示的候选人" detail="先在人员管理或批量导入里录入候选人，这里会自动同步。" />}
        </div>
      </section>
    </div>
  )
}

function Interviews({ candidates, recordsById, onOpen, onSchedule, onDeleteRecord, onDeleteAll, readOnly }) {
  const people = candidates.filter((c) => {
    const recs = recordsById.get(String(c.id)) || []
    return recs.length || c.interview_at
  }).sort((a, b) => {
    const at = (c) => (recordsById.get(String(c.id)) || [])[0]?.interview_at || c.interview_at
    return new Date(at(a) || 0) - new Date(at(b) || 0)
  })
  const firstCount = people.filter((c) => (recordsById.get(String(c.id)) || []).some((r) => r.round === '一面')).length
  const secondCount = people.filter((c) => (recordsById.get(String(c.id)) || []).some((r) => r.round === '二面')).length
  const attended = people.filter((c) => (recordsById.get(String(c.id)) || []).some((r) => r.attended === '已参面')).length
  return (
    <div className="view-stack">
      <div className="interview-summary">
        <div><h2>面试记录</h2><span className="section-hint">按候选人登记一面、二面：是否接受、是否参面、时间、形式、结果与备注。</span></div>
        <div className="interview-summary-stats">
          <div><strong>{people.length}</strong><span>涉及候选人</span></div>
          <div><strong>{firstCount}</strong><span>已记一面</span></div>
          <div><strong>{secondCount}</strong><span>已记二面</span></div>
          <div><strong>{attended}</strong><span>实际参面</span></div>
        </div>
      </div>
      <section className="panel interview-table-panel">
        <div className="panel-heading"><div><h2>面试安排表</h2></div><span className="section-hint">点任意轮次即可登记或编辑，行末「删除」可清空该人的全部面试记录，台账导出按一面/二面分列。</span></div>
        <div className="interview-table interview-table-records">
          {people.map((candidate) => {
            const recs = recordsById.get(String(candidate.id)) || []
            return (
              <article className="interview-record-row" key={candidate.id}>
                <button className="interview-record-person" onClick={() => onOpen(candidate)}><Avatar name={candidate.name} size="sm" /><span><strong>{candidate.name}</strong><em>{candidate.role_title}</em></span></button>
                <span className="interview-record-stage">{(stages.find((s) => s.id === candidate.stage) || {}).label || candidate.stage}</span>
                <div className="interview-record-round"><span className="irc-label">一面</span><InterviewRoundCell record={recs.find((r) => r.round === '一面')} onEdit={() => onSchedule(candidate, '一面')} onDelete={(record) => onDeleteRecord(candidate, record)} readOnly={readOnly} /></div>
                <div className="interview-record-round"><span className="irc-label">二面</span><InterviewRoundCell record={recs.find((r) => r.round === '二面')} onEdit={() => onSchedule(candidate, '二面')} onDelete={(record) => onDeleteRecord(candidate, record)} readOnly={readOnly} /></div>
                <button type="button" className="btn btn-danger btn-small irc-row-delete" title={`删除 ${candidate.name} 的全部面试记录`} disabled={readOnly} onClick={() => onDeleteAll(candidate, recs)}><Trash2 size={14} />删除</button>
              </article>
            )
          })}
          {!people.length && <EmptyState icon={CalendarDays} title="还没有面试记录" detail="在候选人详情或管道卡片点「安排面试」即可登记一面/二面。" />}
        </div>
      </section>
    </div>
  )
}

function IntegrationView({ integration, candidates, employees, onSync, onRefresh, loading, onConfigure, onClear, saving, onOpenEmployee, onExportAll }) {
  const ready = candidates.filter((c) => ['offer', 'hired'].includes(c.stage))
  return (
    <div className="view-stack">
      <div className="integration-content-grid">
        <section className="panel sync-panel">
          <div className="panel-heading"><div><h2>待同步员工</h2></div><span className="small-badge">{ready.length} 人</span></div>
          <div className="sync-list">
            {ready.map((candidate) => <div className="sync-row" key={candidate.id}><Avatar name={candidate.name} size="sm" /><div><strong>{candidate.name}</strong><span>{candidate.role_title}</span></div><span className="sync-stage">{candidate.stage === 'offer' ? 'Offer' : '已入职'}</span>{candidate.horilla_employee_id ? <span className="sync-success"><CheckCircle2 size={15} />{candidate.horilla_employee_id}</span> : <button className="btn btn-secondary btn-small" onClick={() => onSync(candidate)} disabled={!integration.connected}><Send size={14} />同步</button>}</div>)}
          </div>
          {!ready.length && <EmptyState icon={Send} title="暂无可同步的候选人" detail="把候选人推进到 Offer 或已入职阶段后，即可同步为云聘员工。" />}
        </section>
        <CloudConfigForm integration={integration} onConfigure={onConfigure} onClear={onClear} saving={saving} />
      </div>
      <section className="panel employee-archive-panel">
        <div className="panel-heading"><div><h2>云聘员工档案</h2></div><div className="panel-heading-actions"><span className="small-badge">{employees.length} 人</span><button className="icon-btn" onClick={onRefresh} disabled={loading} title="刷新员工档案"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button><button className="btn btn-secondary btn-small" onClick={onExportAll} disabled={!employees.length}><Download size={14} />导出 Excel</button></div></div>
        {employees.length ? <div className="sync-list employee-list">
          {employees.map((employee) => (
            <button className="sync-row employee-row" key={employee.id} onClick={() => onOpenEmployee(employee)}>
              <Avatar name={employee.first_name} size="sm" />
              <div><strong>{employee.first_name}{employee.last_name ? ` ${employee.last_name}` : ''}</strong><span>{employee.role_title || '—'} · {employee.department || '未分配部门'}</span></div>
              <span className="sync-stage">{employee.employee_no}</span>
              <span className="employee-pay">{(employee.base_salary != null) ? `¥${Number(employee.base_salary).toLocaleString('zh-CN')}` : '未定薪'}</span>
              <span className="sync-success"><CheckCircle2 size={15} />{employee.status === 'pending_onboarding' ? '待入职' : employee.status}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div> : <EmptyState icon={Database} title="还没有员工档案" detail="把 Offer 阶段的候选人同步后，员工会出现在这里，进入入职清单。" />}
      </section>
    </div>
  )
}

function CloudConfigForm({ integration, onConfigure, onClear, saving }) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [createPath, setCreatePath] = useState('/api/employee/employees/')
  const handleSubmit = (event) => { event.preventDefault(); onConfigure({ baseUrl, apiToken, employeeCreatePath: createPath }) }
  return (
    <section className="panel setup-panel">
      <div className="panel-heading"><div><h2>连接配置</h2></div></div>
      <div className="inline-notice"><CheckCircle2 size={16} /><span>内置云聘已运行，同步实时写入云端档案。下方用于可选接入自有 Horilla。</span></div>
      <form onSubmit={handleSubmit}>
        <label className="form-label">Horilla 服务地址（可选）<span><input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-horilla.example.com" /></span></label>
        <label className="form-label">API Token（可选）<span><input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="服务端只读/最小权限 token" /></span></label>
        <label className="form-label">员工创建接口路径<span><input type="text" value={createPath} onChange={(e) => setCreatePath(e.target.value)} placeholder="/api/employee/employees/" /></span></label>
        <div className="modal-actions">
          {integration.configured && <button type="button" className="btn btn-secondary" onClick={onClear} disabled={saving}>清除凭据</button>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <LoaderCircle size={17} className="spin" /> : <PlugZap size={17} />}保存连接信息</button>
        </div>
      </form>
    </section>
  )
}

// 批量简历导入：4 列并排，最多 4 份同时解析，完成一份补一份进队列。
// 每张卡片独立滚动、独立重试/剔除，互不影响。
const BATCH_LANES = 4
const STEP_LABELS = { extract: '读取 PDF 文本', profile: '提取台账字段', evaluate: '按 JD 评估证据', upload: '上传原简历', save: '写入候选人', done: '已完成' }
const PROFILE_LABELS = [
  ['gender', '性别'], ['age', '年龄'], ['education', '学历'], ['school', '毕业院校'],
  ['major', '专业'], ['skill_certs', '技能/证书'], ['current_salary', '目前薪资'], ['current_city', '目前居住地'],
]

// 批量导入卡片里的行内可编辑字段：点一下变成输入框，失焦即提交。
// 保存失败会回滚显示值并提示，避免界面上出现「改了但没存进去」的假象。
function EditableField({ label, value, placeholder = '—', disabled, onSave, notify }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value == null ? '' : String(value))

  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value))
  }, [value, editing])

  const commit = async () => {
    setEditing(false)
    const next = draft.trim()
    const current = value == null ? '' : String(value)
    if (next === current) return
    try {
      await onSave(next)
    } catch (error) {
      // 保存失败：回滚显示值并提示，避免界面出现「改了但没存进去」的假象
      setDraft(current)
      notify?.(`「${label}」保存失败：${error?.message || '未知错误'}`, 'error')
    }
  }

  if (!editing) {
    return (
      <div className="batch-field">
        <dt>{label}</dt>
        <dd>
          <button
            type="button"
            className="batch-field-edit"
            disabled={disabled}
            title={disabled ? '解析中，暂不可编辑' : '点击修改'}
            onClick={() => setEditing(true)}
          >
            {value || placeholder}
            {!disabled && <Pencil size={11} />}
          </button>
        </dd>
      </div>
    )
  }

  return (
    <div className="batch-field">
      <dt>{label}</dt>
      <dd>
        <input
          className="batch-field-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); setEditing(false) }
          }}
        />
      </dd>
    </div>
  )
}

function BatchImportView({ jobs, surveys, session, onLogin, onFinished, onBound, onSaveProfile, onChangeJob, notify }) {
  const inputRef = useRef(null)
  // 默认岗位：新增简历时自动继承；每张卡片可单独改（见「修改和绑定岗位」）
  const [defaultJobId, setDefaultJobId] = useState(() => (jobs[0]?.id ? String(jobs[0].id) : ''))
  const [items, setItems] = useState([])
  const [jobPickerFor, setJobPickerFor] = useState(null)
  const inflight = useRef(new Set())

  const defaultJob = jobs.find((j) => String(j.id) === String(defaultJobId))
  const jobById = useMemo(() => new Map(jobs.map((j) => [String(j.id), j])), [jobs])
  // patch 支持传对象或函数：函数形式拿到当前项，用于「保留人工修改」这类合并场景
  const patch = (id, next) => setItems((old) => old.map((it) => (
    it.id === id ? { ...it, ...(typeof next === 'function' ? next(it) : next) } : it
  )))

  const choose = () => { if (!session) return onLogin(); inputRef.current?.click() }

  const addFiles = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const unsupported = files.filter((f) => !isSupportedAttachment(f))
    const usable = files.filter((f) => isSupportedAttachment(f))
    const tooBig = usable.filter((f) => f.size > 10 * 1024 * 1024)
    const ok = usable.filter((f) => f.size <= 10 * 1024 * 1024)
    if (unsupported.length) notify(`${unsupported.length} 份格式不支持已跳过（仅支持 ${ATTACHMENT_FORMAT_TEXT}）`, 'error')
    if (tooBig.length) notify(`${tooBig.length} 份超过 10MB 已跳过`, 'error')
    if (!ok.length) { notify(`请选择 ${ATTACHMENT_FORMAT_TEXT} 格式的简历（单份 10MB 内）`, 'error'); return }
    setItems((old) => [...old, ...ok.map((f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
      file: f, name: '', phone: '', phoneMasked: false, status: 'queued', step: 'extract', profile: null, score: null, band: '', error: '',
      // 卡片绑定的岗位：默认取顶部「默认岗位」，之后每张卡片可单独改
      jobId: defaultJobId,
      // 人工改过的字段：模型提取结果不覆盖这些值（manual 里只有人工填过的键）
      manual: {},
    }))])
  }

  // 换岗位：未入库的只改本地绑定；已入库的写回数据库并按新岗位重绑问卷。
  const changeJob = async (item, job) => {
    if (!job) return
    if (item.status === 'running') { notify('该简历正在解析中，解析完成后才能改岗位', 'error'); return }
    if (String(item.jobId) === String(job.id)) return
    if (item.status === 'done' && item.candidateId) {
      try {
        const invite = await onChangeJob?.(item.candidateId, job)
        patch(item.id, { jobId: String(job.id), invite: invite || null, noSurvey: !invite })
        notify(invite ? `已改绑到「${job.title}」，问卷链接已按新岗位更新` : `已改绑到「${job.title}」`)
      } catch (error) {
        notify(`改绑岗位失败：${displayError(error)}`, 'error')
      }
      return
    }
    patch(item.id, { jobId: String(job.id) })
    notify(`已改绑到「${job.title}」`)
  }

  // 调度：并发上限 4，空位由排队项补上
  // 每张卡片按自己的绑定岗位评估；没绑岗位的先不跑，等用户「修改和绑定岗位」
  useEffect(() => {
    if (!session) return
    const running = items.filter((it) => it.status === 'running').length
    if (running >= BATCH_LANES) return
    const next = items.find((it) => it.status === 'queued' && !inflight.current.has(it.id) && jobById.get(String(it.jobId)))
    if (!next) return
    const job = jobById.get(String(next.jobId))
    inflight.current.add(next.id)
    patch(next.id, { status: 'running', step: 'extract' })
    ;(async () => {
      try {
        const contacts = await parseResumeContacts(next.file).catch(() => ({}))
        // 人工填过的手机号优先于模型提取（掩码号场景也允许人工补录完整号码）
        const manualPhone = next.manual?.phone
        patch(next.id, { step: 'profile', phone: manualPhone || contacts?.phone || '', phoneMasked: !manualPhone && !!contacts?.phoneMasked })
        const profile = await extractResumeProfile(next.file).catch(() => null)
        const fallback = next.file.name
          .replace(/\.(pdf|docx|doc|txt|md|markdown|csv|xlsx|xls|xlsm)$/i, '')
          .replace(/[_\-\s]+/g, ' ').replace(/\d{6,}.*$/, '').trim()
        const extractedName = (contacts?.name || fallback || '').trim()
        if (!extractedName && !next.manual?.name) throw new Error('未能识别姓名，请在「AI 评估」里单份录入')
        // 人工填过的字段优先：模型结果只填没被人工改过的键
        const manualProfile = next.manual?.profile || {}
        const mergedProfile = { ...(profile || {}), ...manualProfile }
        const name = (next.manual?.name || extractedName).trim()
        patch(next.id, { name, profile: mergedProfile })
        const candidate = await evaluateResume({
          file: next.file,
          name,
          job,
          phone: manualPhone || contacts?.phone || '',
          email: contacts?.email || '',
          location: contacts?.location || mergedProfile?.current_city || '',
          profile: mergedProfile,
        }, session, (step) => patch(next.id, { step }))
        // 入库后立即生成并绑定岗位问卷（一人一码），结果直接显示在卡片上
        const invite = onBound ? await onBound(candidate, job).catch(() => null) : null
        patch(next.id, {
          status: 'done',
          step: 'done',
          score: candidate.score ?? candidate.resume_raw ?? null,
          band: candidate.band || '',
          candidateId: candidate.id,
          invite,
          noSurvey: !invite,
        })
      } catch (error) {
        patch(next.id, { status: 'error', error: displayError(error) })
      } finally {
        inflight.current.delete(next.id)
        setItems((old) => [...old]) // 触发一次调度，让排队项补位
      }
    })()
  }, [items, session, jobById])

  const counts = {
    queued: items.filter((it) => it.status === 'queued').length,
    running: items.filter((it) => it.status === 'running').length,
    done: items.filter((it) => it.status === 'done').length,
    error: items.filter((it) => it.status === 'error').length,
  }

  const retry = (item) => patch(item.id, { status: 'queued', step: 'extract', error: '', score: null })
  const remove = (item) => setItems((old) => old.filter((it) => it.id !== item.id))
  const clearDone = () => setItems((old) => old.filter((it) => it.status !== 'done'))

  // 手动改字段：先改本地显示，并把「人工改过」记进 manual，
  // 后续模型提取结果不覆盖这些值；已入库的再同步写回数据库，保证台账里就是改后的值。
  const saveField = async (item, key, value) => {
    const next = typeof value === 'string' ? value.trim() : value
    if (key === 'name') {
      if (!next) { notify('姓名不能为空', 'error'); throw new Error('姓名不能为空') }
      patch(item.id, (cur) => ({ name: next, manual: { ...(cur.manual || {}), name: next } }))
    } else if (key === 'phone') {
      patch(item.id, (cur) => ({ phone: next, phoneMasked: false, manual: { ...(cur.manual || {}), phone: next } }))
    } else {
      patch(item.id, (cur) => ({
        profile: { ...(cur.profile || {}), [key]: next },
        manual: { ...(cur.manual || {}), profile: { ...((cur.manual || {}).profile || {}), [key]: next } },
      }))
    }
    // 已入库候选人：写回数据库
    if (item.status === 'done' && item.candidateId && onSaveProfile) {
      const patchPayload = key === 'name'
        ? { name: next }
        : key === 'phone'
          ? { phone: next }
          : { [key]: next }
      await onSaveProfile(item.candidateId, patchPayload)
    }
  }

  const finish = async () => { await onFinished(); notify(`已完成 ${counts.done} 份简历入库`) }

  return (
    <div className="view-stack">
      <div className="section-action-row">
        <div>
          <h2>批量简历导入</h2>
          <p className="section-hint">一次选择多份简历，最多 4 份同时解析（读取文本 → 提取台账字段 → 按岗位 JD 评估 → 入库）。支持 {ATTACHMENT_FORMAT_TEXT}；每列独立滚动、独立重试；平台掩码手机号会留空，候选人提交问卷后自动回填。</p>
        </div>
      </div>

      {/* 上传区：默认岗位 + 选择简历集中在这里，不再放在页面右上角 */}
      <section className="panel batch-upload-panel">
        <div className="batch-upload-main">
          <span className="batch-upload-icon"><UploadCloud size={22} /></span>
          <div className="batch-upload-copy">
            <strong>选择简历文件</strong>
            <span>支持 {ATTACHMENT_FORMAT_TEXT}，单份不超过 10 MB，可一次多选（最多 4 份并行解析）</span>
          </div>
          <button className="btn btn-primary" onClick={choose} disabled={!jobs.length}><UploadCloud size={16} />选择简历</button>
          <input ref={inputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} hidden onChange={addFiles} />
        </div>
        <div className="batch-upload-jobs">
          <label htmlFor="batch-default-job">默认岗位</label>
          <select id="batch-default-job" className="batch-job-select" value={defaultJobId} onChange={(e) => setDefaultJobId(e.target.value)} disabled={!jobs.length}>
            {!jobs.length && <option value="">先上架岗位</option>}
            {jobs.map((item) => <option key={item.id} value={item.id}>{item.project_name ? `${item.project_name} · ` : ''}{item.title}</option>)}
          </select>
          <span className="batch-upload-hint">新加入的简历默认按这个岗位评估；每张卡片可用「修改和绑定岗位」单独改。</span>
        </div>
      </section>

      <section className="panel batch-status">
        <span>队列 <strong>{counts.queued}</strong></span>
        <span>解析中 <strong>{counts.running}</strong></span>
        <span>成功 <strong>{counts.done}</strong></span>
        <span>失败 <strong>{counts.error}</strong></span>
        <span className="batch-status-hint">{defaultJob ? `默认岗位：${defaultJob.title}` : '请先上架岗位'}</span>
        {counts.done > 0 && <button className="btn btn-secondary btn-small" onClick={finish}>刷新列表</button>}
        {counts.done > 0 && <button className="btn btn-secondary btn-small" onClick={clearDone}>清空已完成</button>}
      </section>

      {!items.length && (
        <section className="panel batch-empty">
          <UploadCloud size={30} />
          <h3>一次最多并行 4 份</h3>
          <p>支持 {ATTACHMENT_FORMAT_TEXT}；姓名、电话、毕业院校、专业等由模型自动提取，识别有误可在候选人详情里改。超过 4 份会自动排队。</p>
          <button className="btn btn-primary" onClick={choose} disabled={!jobs.length}>{jobs.length ? '选择简历' : '先上架岗位'}</button>
        </section>
      )}

      {items.length > 0 && (
        <div className="batch-grid">
          {items.map((item) => {
            const boundJob = jobById.get(String(item.jobId))
            return (
            <article className={`batch-card batch-${item.status}`} key={item.id}>
              <header className="batch-card-head">
                <div>
                  <strong title={item.file.name}>{item.name || item.file.name}</strong>
                  <span>{item.file.name}</span>
                </div>
                <div className="batch-card-head-side">
                  {item.invite && (
                    <button className="icon-btn" title="复制问卷链接" onClick={() => { try { navigator.clipboard.writeText(inviteUrl(item.invite)); notify('问卷链接已复制，可直接发给候选人') } catch { notify('复制失败，请手动复制', 'error') } }}>
                      <ClipboardCopy size={15} />
                    </button>
                  )}
                  <span className={`batch-chip batch-chip-${item.status}`}>
                    {item.status === 'queued' ? '排队中' : item.status === 'running' ? STEP_LABELS[item.step] || '解析中' : item.status === 'done' ? '已入库' : '失败'}
                  </span>
                </div>
              </header>
              <div className="batch-card-body">
                {item.status === 'error' ? (
                  <p className="batch-error">{item.error}</p>
                ) : (
                  <>
                    <div className="batch-job-row">
                      <span className="batch-job-label">绑定岗位</span>
                      <button className="batch-job-chip" onClick={() => setJobPickerFor(item.id)} disabled={item.status === 'running'}>
                        {boundJob ? <>{boundJob.project_name ? `${boundJob.project_name} · ` : ''}{boundJob.title}</> : '未绑定岗位'}
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <dl className="batch-fields">
                      <EditableField
                        label="姓名"
                        value={item.name}
                        placeholder="识别中…"
                        disabled={item.status === 'running'}
                        onSave={(v) => saveField(item, 'name', v)}
                        notify={notify}
                      />
                      <EditableField
                        label="手机号"
                        value={item.phone}
                        placeholder={item.phoneMasked ? '掩码号，待问卷回填' : '待问卷回填'}
                        disabled={item.status === 'running'}
                        onSave={(v) => saveField(item, 'phone', v)}
                        notify={notify}
                      />
                      {PROFILE_LABELS.map(([key, label]) => (
                        <EditableField
                          key={key}
                          label={label}
                          value={item.profile?.[key]}
                          disabled={item.status === 'running'}
                          onSave={(v) => saveField(item, key, v)}
                          notify={notify}
                        />
                      ))}
                    </dl>
                    {item.status === 'done' && (
                      <div className="batch-score">
                        <span>AI 评分</span><strong>{item.score != null ? item.score : '—'}</strong>
                        {item.band && <em>{item.band}</em>}
                      </div>
                    )}
                    {item.status === 'running' && (
                      <ol className="batch-steps">
                        {Object.keys(STEP_LABELS).filter((key) => key !== 'done').map((key) => (
                          <li key={key} className={classNames(item.step === key && 'active', STEP_LABELS[item.step] && Object.keys(STEP_LABELS).indexOf(key) < Object.keys(STEP_LABELS).indexOf(item.step) && 'done')}>{STEP_LABELS[key]}</li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
              </div>
              <footer className="batch-card-foot">
                {item.status === 'error' && <button className="btn btn-secondary btn-small" onClick={() => retry(item)}><RefreshCw size={14} />重试</button>}
                {item.status === 'done' && <span className="batch-ok"><CheckCircle2 size={14} />已写入台账</span>}
                {item.status === 'done' && item.noSurvey && <span className="batch-survey-missing">该岗位未绑定问卷</span>}
                <button className="btn btn-secondary btn-small" onClick={() => setJobPickerFor(item.id)} disabled={item.status === 'running'} title="修改候选人信息并绑定到岗位">
                  <BriefcaseBusiness size={14} />修改和绑定岗位
                </button>
                {(item.status === 'error' || item.status === 'queued' || item.status === 'done') && (
                  <button className="text-btn" onClick={() => remove(item)}>移除</button>
                )}
              </footer>
            </article>
            )
          })}
          {Array.from({ length: Math.max(0, BATCH_LANES - items.length) }).map((_, index) => (
            <article className="batch-card batch-placeholder" key={`ph-${index}`}>
              <div><Plus size={18} /><span>空闲列</span></div>
            </article>
          ))}
        </div>
      )}

      {jobPickerFor && (() => {
        const target = items.find((it) => it.id === jobPickerFor)
        if (!target) return null
        return (
          <JobPickerModal
            jobs={jobs}
            current={jobById.get(String(target.jobId))}
            candidateName={target.name || target.file.name}
            onClose={() => setJobPickerFor(null)}
            onPick={async (job) => { setJobPickerFor(null); await changeJob(target, job) }}
          />
        )
      })()}
    </div>
  )
}

// 岗位选择弹窗：批量导入卡片与人员管理共用。
// 按项目分组展示，带搜索；确认后把候选人绑定到该岗位。
function JobPickerModal({ jobs, current, candidateName, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(current ? String(current.id) : '')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((j) => `${j.project_name || ''} ${j.title || ''} ${j.department || ''}`.toLowerCase().includes(q))
  }, [jobs, query])
  const groups = useMemo(() => {
    const map = new Map()
    for (const job of filtered) {
      const key = job.project_name || '未分组项目'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(job)
    }
    return [...map.entries()]
  }, [filtered])
  const chosen = jobs.find((j) => String(j.id) === picked)
  const unchanged = current && String(current.id) === picked
  return (
    <ModalShell title="修改和绑定岗位" subtitle={candidateName ? `${candidateName} · 换岗位后问卷会按新岗位的问卷重新生成` : '选择要绑定的岗位'} onClose={onClose}>
      <div className="modal-form job-picker">
        <div className="job-picker-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索岗位或项目" autoFocus /></div>
        <div className="job-picker-list">
          {groups.map(([group, list]) => (
            <div className="job-picker-group" key={group}>
              <span className="job-picker-group-title">{group}</span>
              {list.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={classNames('job-picker-item', String(job.id) === picked && 'active')}
                  onClick={() => setPicked(String(job.id))}
                >
                  <span><strong>{job.title}</strong>{job.department && <em>{job.department}</em>}</span>
                  {String(job.id) === current && <i className="job-picker-current">当前岗位</i>}
                  {String(job.id) === picked && String(job.id) !== current && <Check size={16} />}
                </button>
              ))}
            </div>
          ))}
          {!filtered.length && <p className="section-hint">没有匹配的岗位</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" disabled={!chosen || unchanged} onClick={() => onPick(chosen)}>
            <Check size={15} />确认绑定{chosen ? `到「${chosen.title}」` : ''}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function InviteEntryCard({ entry, onCopy, onReset, submitted, resetting }) {
  return (
    <section className="drawer-section invite-entry-card">
      <div className="drawer-section-title"><h3>专属测评链接</h3><span>一人一码 · 免扫码</span></div>
      {entry?.loading ? <p className="section-hint"><LoaderCircle className="spin" size={14} /> 正在生成专属测评链接</p>
        : entry?.error ? <p className="section-hint"><AlertTriangle size={14} /> {entry.error}</p>
        : entry?.submitted ? (<div className="invite-entry-body">
          <div className="invite-entry-info">
            <p className="section-hint"><Check size={14} /> 该候选人已提交问卷（一人一码，限填一次），不再显示填写链接。如需修改，点「刷新问卷」清除已填内容后重新发放。</p>
            <div className="invite-entry-actions">
              <button className="btn btn-secondary btn-small" onClick={() => onReset()} disabled={resetting}><RefreshCw size={14} />刷新问卷</button>
            </div>
          </div>
        </div>)
        : entry?.url ? (<div className="invite-entry-body">
          {entry.qr && <img className="invite-entry-qr" src={entry.qr} alt="专属测评二维码" />}
          <div className="invite-entry-info">
            <span className="invite-entry-url">{entry.url}</span>
            <p className="section-hint">直接点链接即可作答：候选人填姓名 + 手机号核对身份，不用扫码登录。每人限填一次。</p>
            <div className="invite-entry-actions">
              <button className="btn btn-secondary btn-small" onClick={() => onCopy(entry)}><Copy size={14} />复制链接</button>
              <button className="btn btn-secondary btn-small" onClick={() => onReset()} disabled={resetting}><RefreshCw size={14} />刷新问卷</button>
            </div>
          </div>
        </div>)
        : <p className="section-hint">该岗位暂未绑定问卷，请先在「测评问卷」中把问卷绑定到这个岗位。</p>}
    </section>
  )
}

function ConfirmDialog({ title, message, points = [], confirmText = '确认', danger = false, running, onConfirm, onClose }) {
  return (
    <ModalShell title={title} onClose={running ? () => {} : onClose}>
      <div className="modal-form">
        <div className={classNames('confirm-body', danger && 'danger')}>
          <AlertTriangle size={20} />
          <div>
            <p>{message}</p>
            {points.length > 0 && <ul>{points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={running}>取消</button>
          <button className={classNames('btn', danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm} disabled={running}>
            {running ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// 用户中心：改昵称/联系方式 + 账号信息 + 管理员入口。
// 管理员身份只认数据库 hb_admins 名单（RLS 保证只有本人能查到），不再使用前端明文密码。
function UserCenterView({ session, profile, onSaveProfile, saving, isAdminAccount, adminMode, onUnlockAdmin, onExitAdmin, onSwitchAccount, onLogout, notify, jobs = [], displayNames = {}, jobShares = [], onCreateShare, onDeleteShare, sharesBusy = false }) {
  const myUid = session?.user?.id || ''
  const [form, setForm] = useState(profile)
  const [scanning, setScanning] = useState(false)
  const [purging, setPurging] = useState(false)
  const [orphans, setOrphans] = useState(null)
  // 协作授权表单：选岗位 + 选用户（下拉已登录用户，或手动填 UID）
  const [shareJobId, setShareJobId] = useState('')
  const [shareMode, setShareMode] = useState('pick') // pick=下拉选用户, manual=手输 UID
  const [shareUid, setShareUid] = useState('')
  const [shareManualUid, setShareManualUid] = useState('')
  useEffect(() => { setForm(profile) }, [profile])
  const patch = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  const dirty = ['name', 'phone', 'email', 'title', 'note'].some((key) => String(form[key] ?? '') !== String(profile[key] ?? ''))

  const copyId = async () => {
    try { await navigator.clipboard.writeText(myUid); notify('已复制账号 ID') }
    catch { notify('复制失败，请手动选择复制', 'error') }
  }
  // 可选用户：昵称表里除自己以外的人（含昵称与 UID）。当前系统若只有管理员自己，下拉为空，可改用手输 UID。
  const shareUserOptions = Object.entries(displayNames)
    .filter(([uid]) => uid && uid !== myUid)
    .map(([uid, name]) => ({ uid, name: name || uid }))
  // 已被某岗位授权的 UID 集合，用于给出「已授权」提示
  const assignedByJob = useMemo(() => {
    const map = new Map()
    for (const s of jobShares) {
      if (!map.has(Number(s.job_id))) map.set(Number(s.job_id), new Set())
      map.get(Number(s.job_id)).add(s.grantee_uid)
    }
    return map
  }, [jobShares])
  const submitShare = async (event) => {
    event.preventDefault()
    const job = jobs.find((j) => String(j.id) === String(shareJobId))
    if (!job) { notify('请选择要共享的岗位', 'error'); return }
    const uid = (shareMode === 'pick' ? shareUid : shareManualUid).trim()
    if (!uid) { notify(shareMode === 'pick' ? '请选择被授权的用户' : '请填写被授权人的账号 ID', 'error'); return }
    if (uid === myUid) { notify('不能把岗位授权给自己', 'error'); return }
    const name = shareMode === 'pick' ? displayNames[uid] : ''
    try {
      await onCreateShare(job, uid, name)
      setShareUid(''); setShareManualUid(''); setShareJobId('')
    } catch (error) { notify(displayError(error), 'error') }
  }
  const scan = async () => {
    setScanning(true)
    try {
      const result = await scanOrphanResumes(session)
      setOrphans(result)
      notify(result.orphanCount ? `发现 ${result.orphanCount} 个未被引用的简历文件` : '没有发现残留文件')
    } catch (error) { notify(displayError(error), 'error') } finally { setScanning(false) }
  }

  const purge = async () => {
    if (!orphans?.orphanCount) return
    if (!window.confirm(`确定删除这 ${orphans.orphanCount} 个未被任何候选人引用的简历文件？\n\n它们对应的候选人记录已经被删除了，文件本身不可恢复。`)) return
    setPurging(true)
    try {
      const result = await purgeOrphanResumes(session, orphans.orphans)
      notify(`已清理 ${result.removed} 个文件${result.failed ? `，${result.failed} 个失败` : ''}`)
      await scan()
    } catch (error) { notify(displayError(error), 'error') } finally { setPurging(false) }
  }

  if (!session) {
    return (
      <div className="view-stack account-view">
        <section className="panel empty-panel">
          <EmptyState
            icon={UserRound}
            title="用户中心"
            detail="请先用 WorkBuddy 账号登录，登录后即可修改昵称、联系方式与管理权限。"
          />
        </section>
      </div>
    )
  }

  return (
    <div className="view-stack account-view">
      <div className="section-action-row">
        <div><h2>用户中心</h2><p className="section-hint">这里改的昵称会显示在左侧导航，并作为之后新录入数据的「负责人」名字。</p></div>
      </div>

      <section className="panel">
        <div className="drawer-section-title"><h3>个人资料</h3><span>{dirty ? '有未保存的修改' : '随时可改'}</span></div>
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); onSaveProfile(form) }}>
          <div className="profile-edit-grid">
            <label className="form-label">昵称 / 姓名<input value={form.name} onChange={(e) => patch('name', e.target.value)} placeholder="例如：龚宸宇" required /></label>
            <label className="form-label">手机号<input value={form.phone} onChange={(e) => patch('phone', e.target.value)} placeholder="选填" /></label>
            <label className="form-label">邮箱<input value={form.email} onChange={(e) => patch('email', e.target.value)} placeholder="选填" /></label>
            <label className="form-label">职务<input value={form.title} onChange={(e) => patch('title', e.target.value)} placeholder="例如：招聘负责人" /></label>
          </div>
          <label className="form-label">备注<input value={form.note} onChange={(e) => patch('note', e.target.value)} placeholder="选填，仅自己可见" /></label>
          <div className="profile-save-row">
            <button className="btn btn-primary btn-small" disabled={!dirty || saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存资料</button>
            {dirty && <button type="button" className="btn btn-secondary btn-small" onClick={() => setForm(profile)}>还原</button>}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="drawer-section-title"><h3>账号信息</h3><span>每个账号的数据只有自己能看见和修改</span></div>
        <div className="team-id-row"><code>{myUid}</code><button type="button" className="btn btn-secondary btn-small" onClick={copyId}><Copy size={14} />复制</button></div>
        <dl className="profile-list">
          <div><dt>账号角色</dt><dd>{isAdminAccount ? '管理员账号（可开启管理员模式查看全员数据）' : '普通账号（仅本人数据）'}</dd></div>
          <div><dt>管理员模式</dt><dd>{adminMode ? '已开启' : '未开启'}</dd></div>
        </dl>
        <div className="profile-save-row">
          <button type="button" className="btn btn-secondary btn-small" onClick={onSwitchAccount}><RefreshCw size={15} />切换账号</button>
          <button type="button" className="btn btn-secondary btn-small" onClick={onLogout}><LogOut size={15} />退出登录</button>
        </div>
        <p className="section-hint">切换账号会退出当前账号并重新授权；如果浏览器自动回到同一账号，请复制地址栏链接用无痕窗口打开后登录另一个账号。</p>
      </section>

      {isAdminAccount && <section className="panel">
        <div className="drawer-section-title"><h3>管理员入口</h3><span>仅管理员账号可见</span></div>
        {adminMode ? (
          <>
            <p className="section-hint">管理员模式已开启：人员管理、候选人管道、面试安排、数据漏斗里能看到全部账号的数据（只读，不能修改别人的记录）。</p>
            <div className="profile-save-row">
              <button className="btn btn-secondary btn-small" onClick={onExitAdmin}><LogOut size={15} />退出管理员模式</button>
            </div>
          </>
        ) : (
          <div className="profile-save-row">
            <button className="btn btn-primary btn-small" onClick={onUnlockAdmin}><ShieldCheck size={15} />进入管理员模式</button>
            <p className="section-hint">管理员身份由系统账号自动识别，无需输入密码。进入后可查看全员数据（只读）。</p>
          </div>
        )}
      </section>}

      {isAdminAccount && (
      <section className="panel collab-panel">
        <div className="drawer-section-title"><h3>协作授权</h3><span>仅管理员可分配 · 按岗位整包共享</span></div>
        <p className="section-hint">把某个岗位整包共享给指定同事，对方即可查看并协作处理该岗位下的候选人：可改资料、阶段、面试与台账；<b>不能删除</b>、不能改授权，AI 评分等派生字段始终只读。授权关系存于数据库，由行级安全策略真正把关。</p>

        <form className="collab-form" onSubmit={submitShare}>
          <label className="form-label">选择岗位
            <select value={shareJobId} onChange={(e) => setShareJobId(e.target.value)} required>
              <option value="">— 选择要共享的岗位 —</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title || j.role_title || `岗位 #${j.id}`}{j.owner_id && j.owner_id !== myUid ? `（${displayNames[j.owner_id] || '同事'}的岗位）` : ''}</option>)}
            </select>
          </label>
          <div className="collab-mode-switch">
            <button type="button" className={shareMode === 'pick' ? 'active' : ''} onClick={() => { setShareMode('pick'); setShareManualUid('') }}>选已登录用户</button>
            <button type="button" className={shareMode === 'manual' ? 'active' : ''} onClick={() => { setShareMode('manual'); setShareUid('') }}>手输账号 ID</button>
          </div>
          {shareMode === 'pick' ? (
            <label className="form-label">被授权人
              <select value={shareUid} onChange={(e) => setShareUid(e.target.value)} required>
                <option value="">— 选择用户 —</option>
                {shareUserOptions.length
                  ? shareUserOptions.map((u) => <option key={u.uid} value={u.uid}>{u.name} · {u.uid}</option>)
                  : <option value="" disabled>暂无其他登录用户，请改用手输账号 ID</option>}
              </select>
            </label>
          ) : (
            <label className="form-label">被授权人账号 ID
              <input value={shareManualUid} onChange={(e) => setShareManualUid(e.target.value)} placeholder="粘贴对方的账号 ID，例如 wb:xxxx" />
            </label>
          )}
          <button className="btn btn-primary btn-small" disabled={sharesBusy || !shareJobId}>
            {sharesBusy ? <LoaderCircle size={15} className="spin" /> : <UserPlus size={15} />}添加授权
          </button>
        </form>

        <div className="collab-list">
          <h4>已有授权（{jobShares.length}）</h4>
          {jobShares.length === 0 ? (
            <p className="section-hint">还没有任何授权。选择岗位与用户后点「添加授权」。</p>
          ) : (
            <div className="collab-rows">
              {jobShares.map((s) => (
                <div className="collab-row" key={s.id}>
                  <span className="collab-row-job"><BriefcaseBusiness size={14} />{s.job_title || `岗位 #${s.job_id}`}</span>
                  <span className="collab-row-arrow">→</span>
                  <span className="collab-row-user"><UserRound size={14} />{s.grantee_name || displayNames[s.grantee_uid] || '用户'} <code>{s.grantee_uid}</code></span>
                  <button type="button" className="btn btn-danger btn-small collab-row-del" onClick={() => onDeleteShare(s)} disabled={sharesBusy} title="解除授权"><Trash2 size={14} />解除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      <section className="panel">
        <div className="drawer-section-title"><h3>存储清理</h3><span>管理员可用</span></div>
        <p className="section-hint">删除候选人时系统已会自动清理简历原件；这里处理更早版本遗留的孤儿文件——云上还留着、但已经没有任何候选人引用的 PDF。</p>
        <div className="profile-save-row">
          <button type="button" className="btn btn-secondary btn-small" onClick={scan} disabled={!isAdminAccount || scanning || purging}>
            {scanning ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}扫描残留文件
          </button>
          {orphans?.orphanCount > 0 && (
            <button type="button" className="btn btn-danger btn-small" onClick={purge} disabled={purging}>
              {purging ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}删除这 {orphans.orphanCount} 个文件（{formatSize(orphans.orphanBytes)}）
            </button>
          )}
        </div>
        {!isAdminAccount && <p className="section-hint">当前账号不是管理员，无法执行存储清理。</p>}
        {orphans && (
          <p className="section-hint">
            {orphans.orphanCount
              ? `扫描结果：${orphans.orphanCount} 个未被引用的文件，共 ${formatSize(orphans.orphanBytes)}。`
              : '扫描结果：没有残留文件，存储与数据一致。'}
          </p>
        )}
      </section>
    </div>
  )
}

function CandidateProfileEditor({ candidate, onSave, saving }) {
  const resumeFields = [
    ['gender', '性别'], ['age', '年龄'], ['education', '学历'], ['school', '毕业院校'],
    ['major', '专业'], ['skill_certs', '技能/证书'], ['current_salary', '目前薪资'], ['current_city', '目前居住地'],
    ['id_number', '身份证号码'],
  ]
  const surveyFields = [
    ['career_plan', '职业规划'], ['leave_reason', '当前机会/离职原因'], ['acceptable_regions', '可接受区域'],
    ['target_cities', '意向工作城市'], ['expected_salary_note', '期望薪资'], ['available_note', '可入职时间'], ['consent_archive', '同意留档'],
  ]
  const build = (c) => ({
    name: c.name || '', phone: c.phone || '', email: c.email || '', location: c.location || '',
    ...Object.fromEntries([...resumeFields, ...surveyFields].map(([key]) => [key, c[key] ?? ''])),
  })
  const [form, setForm] = useState(() => build(candidate))
  useEffect(() => { setForm(build(candidate)) }, [candidate.id])
  const patch = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  const dirty = Object.keys(form).some((key) => String(form[key]) !== String(candidate[key] ?? ''))
  const fieldInput = ([key, label]) => (
    <label className="form-label" key={key}>{label}<input value={form[key] ?? ''} onChange={(e) => patch(key, e.target.value)} placeholder="未录入" /></label>
  )
  return (
    <section className="drawer-section">
      <div className="drawer-section-title"><h3>基本信息</h3><span>{dirty ? '有未保存的修改' : '可手动修正'}</span></div>
      <div className="profile-edit-grid">
        <label className="form-label">姓名<input value={form.name} onChange={(e) => patch('name', e.target.value)} /></label>
        <label className="form-label">电话<input value={form.phone} onChange={(e) => patch('phone', e.target.value)} placeholder="未录入" /></label>
        <label className="form-label">邮箱<input value={form.email} onChange={(e) => patch('email', e.target.value)} placeholder="未录入" /></label>
        <label className="form-label">所在城市<input value={form.location} onChange={(e) => patch('location', e.target.value)} placeholder="待确认" /></label>
      </div>
      <div className="drawer-section-title"><h3>台账字段 · 简历提取</h3><span>识别不准可直接改</span></div>
      <div className="profile-edit-grid">{resumeFields.map(fieldInput)}</div>
      <div className="drawer-section-title"><h3>台账字段 · 档案问卷回填</h3><span>候选人填问卷后自动写入</span></div>
      <div className="profile-edit-grid">{surveyFields.map(fieldInput)}</div>
      <dl className="profile-list">
        <div><dt>申请职位</dt><dd>{candidate.role_title || '—'}</dd></div>
        <div><dt>简历来源</dt><dd>{candidate.source || '—'}</dd></div>
        <div><dt>面试时间</dt><dd>{formatDate(candidate.interview_at, true)}</dd></div>
      </dl>
      <div className="profile-save-row">
        <button className="btn btn-primary btn-small" onClick={() => onSave(form)} disabled={!dirty || saving}>
          {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存修改
        </button>
        {dirty && <button className="btn btn-secondary btn-small" onClick={() => setForm(build(candidate))}>还原</button>}
      </div>
      <p className="section-hint">简历识别不准时，可直接在这里改，改完立即生效；档案问卷的字段候选人重新填写后会被覆盖，以问卷为准的字段请谨慎手改。</p>
    </section>
  )
}

function CandidateDrawer({ candidate, events, scoringHistory = [], evaluating, onEvaluate, inviteEntry, onCopyInvite, onResetSurvey, resettingSurvey, onDelete, onSaveProfile, savingProfile, onClose, onMove, onSchedule, onSync, onDownload, onDownloadAttachment, downloading, interviewRecords = [], readOnly = false }) {
  const [tab, setTab] = useState('evaluation')
  if (!candidate) return null
  const categories = candidate.evaluation?.categories || []
  const flags = candidate.evaluation?.flags || []
  const skills = candidate.evaluation?.skills || candidate.skills || []
  const confidence = candidate.evaluation?.confidence ?? candidate.confidence ?? 0
  const unevaluated = candidate.resume_raw == null && !categories.length
  const candidateEvents = events.filter((event) => event.candidate_id === candidate.id)
  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`${candidate.name}候选人详情`}>
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭详情" />
      <aside className="candidate-drawer candidate-detail-drawer">
        <div className="drawer-top"><span>候选人详情</span><button className="icon-btn" onClick={onClose}><PanelRightClose size={20} /></button></div>
        <div className="candidate-profile-head">
          <Avatar name={candidate.name} size="lg" />
          <div><h2>{candidate.name}</h2><p>{candidate.role_title}</p><span><MapPin size={13} />{candidate.location || '地点待确认'} · {candidate.source}</span></div>
          <ScoreBadge score={candidate.score} band={candidate.band} />
        </div>
        <div className="candidate-quick-actions">
          {stageBack[candidate.stage] && <button className="btn btn-secondary" onClick={() => onMove(candidate, stageBack[candidate.stage])} title="回撤到上一阶段"><Undo2 size={16} />回撤</button>}
          {candidate.stage !== 'hired' && <button className="btn btn-secondary" onClick={() => onSchedule(candidate)}><CalendarPlus size={16} />安排面试</button>}
          {candidate.resume_path && (candidate.resume_path.startsWith('local://')
            ? <span className="local-file-chip" title={candidate.resume_path.slice(8)}><FileText size={14} />本地原件</span>
            : <button className="btn btn-secondary" onClick={() => onDownload(candidate)} disabled={downloading}>{downloading ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}原简历</button>)}
          {unevaluated && !candidate.resume_path?.startsWith('local://') && <button className="btn btn-secondary" onClick={() => onEvaluate(candidate)} disabled={evaluating}>{evaluating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}AI 评估</button>}
          {stageFlow[candidate.stage]
            ? <button className="btn btn-primary" onClick={() => onMove(candidate, stageFlow[candidate.stage].next)}>{candidate.stage === 'offer' ? <UserCheck size={16} /> : candidate.stage === 'interview' ? <Send size={16} /> : <CalendarPlus size={16} />}{stageFlow[candidate.stage].label}</button>
            : <span className="stage-pill stage-pill-done"><CheckCircle2 size={15} />已入职</span>}
        </div>
        <div className="drawer-tabs"><button className={tab === 'evaluation' ? 'active' : ''} onClick={() => setTab('evaluation')}>AI 证据评估</button><button className={tab === 'composite' ? 'active' : ''} onClick={() => setTab('composite')}>综合评分</button><button className={tab === 'interview' ? 'active' : ''} onClick={() => setTab('interview')}>面试记录{interviewRecords.length ? ` ${interviewRecords.length}` : ''}</button><button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>候选人资料</button><button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>动态 {candidateEvents.length}</button></div>
        <div className="drawer-content">
          {tab === 'evaluation' && <>
            <div className="advisory-banner"><ShieldCheck size={18} /><div><strong>辅助排序，不是自动决策</strong><p>{candidate.evaluation?.model || 'Hiring Agent'} · {candidate.evaluation?.rubricVersion || 'rubric-v2.1'} · 证据充分度 {Math.round(confidence * 100)}%</p></div></div>
            <section className="drawer-section"><div className="drawer-section-title"><h3>评估摘要</h3><span className="small-badge">{candidate.band || '—'} 档</span></div><p className="candidate-summary">{candidate.summary || '尚未进行 AI 评估，点击上方「AI 评估」按岗位 JD 对照简历生成证据分析。'}</p><div className="skill-list skill-list-large">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div></section>
            {flags.length > 0 && <section className="risk-box"><div><AlertTriangle size={17} /><strong>需要人工复核</strong></div>{flags.map((flag, index) => <p key={index}>{flag.label}</p>)}</section>}
            <section className="drawer-section"><div className="drawer-section-title"><h3>维度得分与证据</h3><span>{categories.length} 个维度</span></div><div className="evaluation-list">{categories.map((category) => <article className="evaluation-item" key={category.name}><div className="evaluation-score-row"><strong>{category.name}</strong><span><b>{category.score}</b> / {category.max}</span></div><div className="score-track"><span style={{ width: `${Math.min(100, (category.score / category.max) * 100)}%` }} /></div><blockquote><FileText size={14} />{category.evidence}</blockquote></article>)}</div></section>
            {candidate.evaluation?.runs?.length > 1 && <section className="drawer-section"><div className="drawer-section-title"><h3>稳定性复验</h3><span>3 次运行</span></div><div className="run-scores">{candidate.evaluation.runs.map((score, i) => <span key={i}>Run {i + 1}<strong>{score}</strong></span>)}<div><small>区间</small><strong>{Math.min(...candidate.evaluation.runs)}–{Math.max(...candidate.evaluation.runs)}</strong></div></div></section>}
          </>}
          {tab === 'composite' && (() => {
            const d = candidate.composite_detail || {}
            const mods = [
              { key: 'resume', label: 'AI评估', weight: 50, data: d.resume },
              { key: 'survey', label: '问卷评估', weight: 50, data: d.survey },
            ]
            const missingLabels = { resume: 'AI评估', survey: '问卷评估' }
            const missing = Array.isArray(d.missing) ? d.missing : []
            return (<>
              <div className="advisory-banner"><ShieldCheck size={18} /><div><strong>统一综合评分</strong><p>{d.formula || 'AI评估×0.50 + 问卷×0.50'} · 满分 100，保留 1 位小数，不设及格线</p></div></div>
              <section className="drawer-section">
                <div className="composite-total">
                  <span className="composite-score">{candidate.composite_score != null ? candidate.composite_score : '—'}</span>
                  <div><strong>{candidate.composite_complete === true ? '已完成评分' : candidate.composite_complete === false ? '资料待补全' : '尚未评分'}</strong><p>{candidate.composite_complete === false ? `缺少：${missing.map((m) => missingLabels[m] || m).join('、') || '部分模块'}` : '两个模块按权重加权得出综合分，缺失模块保留已得分并标注'}</p></div>
                </div>
              </section>
              <section className="drawer-section"><div className="drawer-section-title"><h3>模块贡献</h3><span>原始分 + 加权贡献</span></div>
                <div className="composite-mods">
                  {mods.map((m) => (
                    <div className="composite-mod" key={m.key}>
                      <div className="composite-mod-head"><span>{m.label}</span><i>权重 {m.weight}%</i>{m.data?.present ? <b>{m.data.raw != null ? m.data.raw : '—'}</b> : <em>缺</em>}</div>
                      <div className="composite-mod-bar"><i style={{ width: `${Math.min(100, ((m.data?.contribution ?? 0) / m.weight) * 100)}%` }} /></div>
                      <small>{m.data?.present ? `贡献 ${m.data.contribution ?? '—'} 分` : '待补充'}</small>
                    </div>
                  ))}
                </div>
              </section>
              <section className="drawer-section"><div className="drawer-section-title"><h3>评分历史</h3><span>{scoringHistory.length} 次</span></div>
                <div className="composite-history">
                  {scoringHistory.map((h) => <div className="composite-history-row" key={h.id}><strong>v{h.version}</strong><span>{new Date(h.calculated_at || h.created_at || h.computed_at).toLocaleString('zh-CN')}</span><b>{h.composite_score}</b>{h.complete ? <i className="ok">完整</i> : <i className="miss">待补全</i>}</div>)}
                  {!scoringHistory.length && <EmptyState icon={Award} title="暂无评分记录" detail="AI 评估简历、提交问卷后，系统会自动生成综合评分历史。" />}
                </div>
              </section>
              <InviteEntryCard entry={inviteEntry} onCopy={onCopyInvite} onReset={onResetSurvey} submitted={candidate.survey_status === 'submitted'} resetting={resettingSurvey} />
            </>)
          })()}
          {tab === 'interview' && <section className="drawer-section">
            <div className="drawer-section-title"><h3>面试记录</h3><span>一面 / 二面分别登记</span></div>
            <div className="drawer-interview-list">
              {INTERVIEW_ROUNDS.map((round) => {
                const rec = interviewRecords.find((r) => r.round === round)
                return (
                  <div className={classNames('drawer-interview-card', isRoundRejected(rec) && 'dic-rejected')} key={round}>
                    <div className="dic-head"><strong>{round}</strong>{isRoundRejected(rec) ? <span className="small-badge dic-badge-danger">拒绝</span> : rec ? <span className="small-badge">已登记</span> : <span className="small-badge badge-muted">未登记</span>}<button className="btn btn-quiet btn-small" onClick={() => onSchedule(candidate, round)} disabled={readOnly}>{rec ? <Pencil size={13} /> : <Plus size={13} />}{readOnly ? '只读' : rec ? '编辑' : '登记'}</button></div>
                    {rec ? <dl className="dic-grid">
                      <div><dt>是否接受</dt><dd className={isRoundRejected(rec) ? 'dic-fail' : ''}>{rec.accepted || '—'}</dd></div>
                      <div><dt>是否参面</dt><dd>{rec.attended || '—'}</dd></div>
                      <div><dt>面试时间</dt><dd>{rec.interview_at ? formatDate(rec.interview_at, true) : '—'}</dd></div>
                      <div><dt>形式</dt><dd>{rec.format || '—'}</dd></div>
                      <div><dt>结果</dt><dd className={rec.result === '通过' ? 'dic-pass' : rec.result === '未通过' ? 'dic-fail' : ''}>{rec.result || '—'}</dd></div>
                      <div><dt>备注</dt><dd>{rec.note || '—'}</dd></div>
                    </dl> : <p className="section-hint">尚无{round}记录，点「登记」填写接受、参面、时间、形式与结果。</p>}
                  </div>
                )
              })}
            </div>
          </section>}
          {tab === 'profile' && <>
            <CandidateProfileEditor candidate={candidate} onSave={(form) => onSaveProfile(candidate, form)} saving={savingProfile} />
            {candidate.resume_path?.startsWith('local://') && <section className="drawer-section"><h3>原件位置</h3><p className="local-path">{candidate.resume_path.slice(8)}</p><p className="import-muted">该简历原件尚未上传，可在「批量简历导入」页批量入库。</p></section>}
            {candidate.attachments?.length > 0 && <section className="drawer-section"><div className="drawer-section-title"><h3>简历与个人资料</h3><span>{candidate.attachments.length} 份</span></div>
              <div className="attachment-list">
                {candidate.attachments.map((attachment) => (
                  <div className="attachment-item" key={attachment.path}>
                    <FileText size={16} />
                    <div className="attachment-meta">
                      <strong>{attachment.name}</strong>
                      <span>{attachment.kind === 'primary' ? '主简历' : '附件'} · {formatSize(attachment.size)}</span>
                    </div>
                    <button className="icon-btn" title="下载" onClick={() => onDownloadAttachment(attachment)}><Download size={15} /></button>
                  </div>
                ))}
              </div>
            </section>}
            <section className="drawer-section"><h3>云聘员工档案</h3>{candidate.horilla_employee_id ? <div className="employee-linked"><CheckCircle2 size={20} /><div><strong>{candidate.horilla_employee_id}</strong><p>已创建员工记录，可在云聘中继续办理入职。</p></div></div> : <div className="empty-inline"><Database size={20} /><p>尚未同步。进入 Offer 阶段后，可人工确认并创建员工。</p>{['offer', 'hired'].includes(candidate.stage) && <button className="btn btn-primary btn-small" onClick={() => onSync(candidate)}>同步到云聘</button>}</div>}</section>
            <section className="drawer-section drawer-danger"><h3>危险操作</h3><button className="btn btn-danger" onClick={() => onDelete(candidate)} disabled={evaluating}><Trash2 size={15} />删除该候选人</button><p className="section-hint">删除后有 8 秒可撤销；到期后候选人档案、评估与问卷记录一并清除。</p></section>
          </>}
          {tab === 'activity' && <section className="drawer-section"><h3>完整操作记录</h3><div className="candidate-timeline">{candidateEvents.map((event) => <div className="timeline-item" key={event.id}><span /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{formatDate(event.created_at, true)}</small></div></div>)}{!candidateEvents.length && <EmptyState icon={Clock3} title="暂无动态" detail="阶段变更、评估与同步会记录在这里。" />}</div></section>}
        </div>
      </aside>
    </div>
  )
}

function EmployeeDrawer({ employee, onClose, onSave, onUpload, onDownloadAttachment, onRemoveAttachment, onExport, saving }) {
  const [tab, setTab] = useState('profile')
  const [form, setForm] = useState(() => ({
    first_name: employee.first_name || '',
    last_name: employee.last_name || '',
    email: employee.email || '',
    phone: employee.phone || '',
    id_number: employee.id_number || '',
    department: employee.department || '',
    role_title: employee.role_title || '',
    employment_type: employee.employment_type || '全职',
    status: employee.status || 'pending_onboarding',
    hire_date: employee.hire_date || '',
    base_salary: employee.base_salary ?? '',
    social_insurance_base: employee.social_insurance_base ?? '',
    social_insurance_amount: employee.social_insurance_amount ?? '',
    medical_insurance_amount: employee.medical_insurance_amount ?? '',
    housing_fund: employee.housing_fund ?? '',
    contract_expiry: employee.contract_expiry || '',
  }))
  const [dirty, setDirty] = useState(false)
  const set = (key, value) => { setForm((old) => ({ ...old, [key]: value })); setDirty(true) }
  const fileRef = useRef(null)
  const attachments = employee.attachments || []

  const submit = async () => {
    await onSave(employee, form)
    setDirty(false)
  }

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="员工档案详情">
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭详情" />
      <aside className="candidate-drawer employee-drawer">
        <div className="drawer-top"><span>员工档案</span><button className="icon-btn" onClick={onClose}><PanelRightClose size={20} /></button></div>
        <div className="candidate-profile-head">
          <Avatar name={employee.first_name} size="lg" />
          <div><h2>{employee.first_name}{employee.last_name ? ` ${employee.last_name}` : ''}</h2><p>{employee.role_title || '—'}</p><span>{employee.employee_no} · {employee.department || '未分配部门'}</span></div>
          <span className="small-badge">{employee.status === 'pending_onboarding' ? '待入职' : employee.status}</span>
        </div>
        <div className="drawer-tabs">
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>个人信息</button>
          <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>薪资社保</button>
          <button className={tab === 'attachments' ? 'active' : ''} onClick={() => setTab('attachments')}>附件资料 {attachments.length}</button>
        </div>
        <div className="drawer-content employee-drawer-content">
          {tab === 'profile' && (
            <div className="employee-form">
              <section className="drawer-section"><h3>基本信息</h3>
                <div className="form-grid">
                  <label className="form-label">姓名<input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></label>
                  <label className="form-label">姓名(外文)<input value={form.last_name || ''} onChange={(e) => set('last_name', e.target.value)} placeholder="可选" /></label>
                  <label className="form-label">邮箱<input value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
                  <label className="form-label">电话<input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
                  <label className="form-label">身份证号<input value={form.id_number} onChange={(e) => set('id_number', e.target.value)} /></label>
                  <label className="form-label">入职日期<input type="date" value={form.hire_date} onChange={(e) => set('hire_date', e.target.value)} /></label>
                  <label className="form-label">部门<input value={form.department} onChange={(e) => set('department', e.target.value)} /></label>
                  <label className="form-label">职位<input value={form.role_title} onChange={(e) => set('role_title', e.target.value)} /></label>
                  <label className="form-label">用工类型<select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}><option>全职</option><option>兼职</option><option>实习</option><option>劳务</option></select></label>
                  <label className="form-label">状态<select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="pending_onboarding">待入职</option><option value="active">在职</option><option value="probation">试用期</option><option value="resigned">已离职</option></select></label>
                </div>
              </section>
            </div>
          )}
          {tab === 'payroll' && (
            <div className="employee-form">
              <section className="drawer-section"><h3>薪酬与社保</h3>
                <div className="form-grid">
                  <label className="form-label">基本薪资（元/月）<input type="number" step="0.01" value={form.base_salary} onChange={(e) => set('base_salary', e.target.value)} placeholder="0.00" /></label>
                  <label className="form-label">社保基数（元）<input type="number" step="0.01" value={form.social_insurance_base} onChange={(e) => set('social_insurance_base', e.target.value)} placeholder="0.00" /></label>
                  <label className="form-label">社保金额（元）<input type="number" step="0.01" value={form.social_insurance_amount} onChange={(e) => set('social_insurance_amount', e.target.value)} placeholder="0.00" /></label>
                  <label className="form-label">医保金额（元）<input type="number" step="0.01" value={form.medical_insurance_amount} onChange={(e) => set('medical_insurance_amount', e.target.value)} placeholder="0.00" /></label>
                  <label className="form-label">公积金（元）<input type="number" step="0.01" value={form.housing_fund} onChange={(e) => set('housing_fund', e.target.value)} placeholder="0.00" /></label>
                  <label className="form-label">合同到期日<input type="date" value={form.contract_expiry} onChange={(e) => set('contract_expiry', e.target.value)} /></label>
                </div>
              </section>
            </div>
          )}
          {tab === 'attachments' && (
            <div className="employee-form">
              <section className="drawer-section"><h3>附件资料</h3>
                <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}><UploadCloud size={16} />上传附件</button>
                <input ref={fileRef} type="file" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(employee, file); e.target.value = '' }} />
                <div className="attachment-list">
                  {attachments.map((att, index) => (
                    <div className="attachment-item" key={att.path}>
                      <FileText size={18} />
                      <div className="attachment-meta"><strong>{att.name}</strong><span>{(att.size / 1024).toFixed(1)} KB · {formatDate(att.uploaded_at, true)}</span></div>
                      <button className="icon-btn" onClick={() => onDownloadAttachment(employee, att)} title="下载"><Download size={16} /></button>
                      <button className="icon-btn" onClick={() => onRemoveAttachment(employee, att)} title="删除"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {!attachments.length && <EmptyState icon={FileText} title="暂无附件" detail="上传身份证、学历、合同等个人资料附件。" />}
                </div>
              </section>
            </div>
          )}
        </div>
        <div className="drawer-footer">
          <button className="btn btn-secondary" onClick={() => onExport(employee)}><Download size={16} />导出 Excel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!dirty || saving}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}保存修改</button>
        </div>
      </aside>
    </div>
  )
}

function SurveysView({ surveys, jobs, session, loading, onNew, onEdit, onResults, onDelete, onRefresh, notify, onLogin }) {
  const [bindingId, setBindingId] = useState(null)
  const handleBind = async (survey, jobId) => {
    if (!session) return onLogin()
    setBindingId(survey.id)
    try {
      await bindSurveyToJob(survey.id, jobId || null, session)
      await onRefresh()
      notify(jobId ? '问卷已绑定到岗位' : '已解除岗位绑定')
    } catch (error) { notify(displayError(error), 'error') } finally { setBindingId(null) }
  }
  return (
    <div className="view-stack">
      <div className="section-action-row">
        <div><h2>测评问卷</h2><p className="section-hint">自己出题、自己配权重；在这里把问卷绑定到岗位，候选人凭专属链接填姓名与手机号作答，服务端出分。</p></div>
        <button className="btn btn-primary" onClick={onNew}><Plus size={17} />新建问卷</button>
      </div>

      {!session && <div className="inline-notice"><LockKeyhole size={16} /><span>登录后才能设计问卷和查看回收结果。</span><button className="text-btn" onClick={onLogin}>去登录<ArrowRight size={14} /></button></div>}

      <div className="survey-grid">
        {surveys.map((survey) => {
          const questions = survey.questions || []
          const totalWeight = questions.reduce((sum, question) => sum + (Number(question.weight) || 0), 0)
          return (
            <article className="survey-card" key={survey.id}>
              <div className="survey-card-head">
                <span className={classNames('survey-status', survey.status === 'open' ? 'open' : 'closed')}>{survey.status === 'open' ? '收集中' : '已关闭'}</span>
                <span className="survey-job">{((jobs.find((job) => String(job.id) === String(survey.job_id))) || {}).title || '通用问卷'}</span>
              </div>
              <h2>{survey.title}</h2>
              {survey.description && <p className="survey-desc">{survey.description}</p>}
              <div className="survey-meta">
                <span><ListChecks size={14} />{questions.length} 题</span>
                <span><Award size={14} />权重合计 {totalWeight}%</span>
                {survey.version && <span><GitBranch size={14} />v{survey.version}</span>}
                {survey.is_current && <span><CheckCircle2 size={14} />生效中</span>}
              </div>
              <label className="form-label survey-bind-job">
                绑定岗位
                <select
                  value={survey.job_id || ''}
                  disabled={!session || bindingId === survey.id}
                  onChange={(e) => handleBind(survey, e.target.value)}
                >
                  <option value="">— 未绑定岗位 —</option>
                  {jobs.map((job) => <option key={job.id} value={job.id}>{job.company_name ? `${job.company_name} · ${job.title}` : job.title}</option>)}
                </select>
              </label>
              <p className="section-hint">绑定后，该岗位的候选人可凭专属测评链接作答，提交即计入综合分。</p>
              <div className="survey-actions">
                <button className="btn btn-secondary btn-small" onClick={() => onResults(survey)}><Inbox size={15} />回收结果</button>
                <button className="btn btn-quiet btn-small" onClick={() => onEdit(survey)}><Settings2 size={15} />编辑</button>
                <button className="icon-btn" onClick={() => onDelete(survey)} title="删除问卷"><Trash2 size={15} /></button>
              </div>
            </article>
          )
        })}
      </div>
      {!surveys.length && (
        <section className="panel empty-panel">
          <EmptyState
            icon={ClipboardList}
            title="还没有问卷"
            detail="新建一份问卷：加题目、给每题配权重，再绑定到岗位。"
            action={<button className="btn btn-primary" onClick={onNew}><Plus size={16} />新建问卷</button>}
          />
        </section>
      )}
    </div>
  )
}

function emptyQuestion(index) {
  return { id: `q${Date.now()}${index}`, type: 'single', title: '', weight: 20, required: true, options: [{ label: '选项一', score: 100 }, { label: '选项二', score: 50 }] }
}

function SurveyDesigner({ survey, jobs, saving, onSave, onClose, notify }) {
  const [form, setForm] = useState(() => survey
    ? { ...survey, questions: (survey.questions || []).filter((question) => question.profile !== true) }
    : { title: '', description: '', job_id: '', pass_score: '', status: 'open', questions: [emptyQuestion(0)] })
  const questions = form.questions || []
  const totalWeight = questions.reduce((sum, question) => sum + (Number(question.weight) || 0), 0)
  const scoredWeight = questions.filter((question) => question.type !== 'text').reduce((sum, question) => sum + (Number(question.weight) || 0), 0)

  const patch = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  const patchQuestion = (id, value) => setForm((old) => ({ ...old, questions: old.questions.map((question) => question.id === id ? { ...question, ...value } : question) }))
  const removeQuestion = (id) => setForm((old) => ({ ...old, questions: old.questions.filter((question) => question.id !== id) }))
  const addQuestion = () => setForm((old) => ({ ...old, questions: [...old.questions, emptyQuestion(old.questions.length)] }))
  const patchOption = (questionId, index, value) => setForm((old) => ({
    ...old,
    questions: old.questions.map((question) => question.id === questionId
      ? { ...question, options: (question.options || []).map((option, i) => i === index ? { ...option, ...value } : option) }
      : question),
  }))
  const addOption = (questionId) => setForm((old) => ({
    ...old,
    questions: old.questions.map((question) => question.id === questionId
      ? { ...question, options: [...(question.options || []), { label: '新选项', score: 50 }] }
      : question),
  }))
  const removeOption = (questionId, index) => setForm((old) => ({
    ...old,
    questions: old.questions.map((question) => question.id === questionId
      ? { ...question, options: (question.options || []).filter((_, i) => i !== index) }
      : question),
  }))
  const changeType = (question) => (event) => {
    const type = event.target.value
    const patchValue = { type }
    if (type === 'scale') patchValue.options = scaleOptions
    if (type === 'text') patchValue.options = []
    if (type === 'single' || type === 'multi') {
      if (!question.options?.length) patchValue.options = [{ label: '选项一', score: 100 }, { label: '选项二', score: 50 }]
    }
    patchQuestion(question.id, patchValue)
  }

  const handleSubmit = () => {
    if (!form.title.trim()) { notify('请填写问卷标题', 'error'); return }
    const cleaned = questions.filter((question) => question.title.trim())
    if (!cleaned.length) { notify('至少需要一道有题干的题目', 'error'); return }
    if (scoredWeight <= 0) { notify('至少有一道计分题需要有大于 0 的权重', 'error'); return }
    // 档案题固定叠加在最后：必填、不可删、不计分，答案由服务端回填台账
    onSave({ ...form, questions: [...cleaned.map((question) => ({ ...question, weight: Number(question.weight) || 0 })), ...PROFILE_QUESTIONS] })
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭" />
      <section className="modal modal-wide survey-designer">
        <div className="modal-head">
          <div><h2>{survey?.id ? '编辑问卷' : '新建测评问卷'}</h2><p>题目、选项分值、每题权重都由你定，评分只按你设定的权重加权。</p></div>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="designer-body">
          <div className="designer-base">
            <label className="form-label">问卷标题<input value={form.title} onChange={(e) => patch('title', e.target.value)} placeholder="例如：销售岗胜任力测评" /></label>
            <label className="form-label">绑定岗位<select value={form.job_id || ''} onChange={(e) => patch('job_id', e.target.value)}><option value="">通用（不限岗位）</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.company_name ? `${job.company_name} · ${job.title}` : job.title}</option>)}</select></label>
            <label className="form-label">状态<select value={form.status} onChange={(e) => patch('status', e.target.value)}><option value="open">收集中</option><option value="closed">已关闭</option></select></label>
          </div>
          <label className="form-label">说明<input value={form.description || ''} onChange={(e) => patch('description', e.target.value)} placeholder="给员工看的一句话说明" /></label>

          <div className="designer-questions-head">
            <h3>题目与权重</h3>
            <span className={classNames('rubric-total', scoredWeight !== 100 && 'rubric-total-bad')}>计分权重合计 {scoredWeight}%{scoredWeight !== 100 ? '（系统按实际合计归一化）' : ''}</span>
          </div>

          {questions.map((question, index) => (
            <article className="designer-question" key={question.id}>
              <div className="designer-question-head">
                <span className="question-index">Q{index + 1}</span>
                <select value={question.type} onChange={changeType(question)}>
                  {questionTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
                <label className="question-weight">权重<input type="number" min="0" max="100" value={question.weight} onChange={(e) => patchQuestion(question.id, { weight: e.target.value })} disabled={question.type === 'text'} />%</label>
                <button className="icon-btn" onClick={() => removeQuestion(question.id)} title="删除题目"><Trash2 size={15} /></button>
              </div>
              <input className="question-title-input" value={question.title} onChange={(e) => patchQuestion(question.id, { title: e.target.value })} placeholder="题干，例如：客户提出超出政策的要求时，你通常怎么做？" />
              {question.type !== 'text' && (
                <div className="option-editor">
                  {(question.options || []).map((option, optionIndex) => (
                    <div className="option-row" key={`${question.id}-${optionIndex}`}>
                      <input value={option.label} onChange={(e) => patchOption(question.id, optionIndex, { label: e.target.value })} placeholder="选项文字" disabled={question.type === 'scale'} />
                      <input type="number" min="0" max="100" value={option.score} onChange={(e) => patchOption(question.id, optionIndex, { score: Number(e.target.value) || 0 })} disabled={question.type === 'scale'} />
                      <em>分</em>
                      {question.type !== 'scale' && <button className="icon-btn" onClick={() => removeOption(question.id, optionIndex)} title="删除选项"><X size={13} /></button>}
                    </div>
                  ))}
                  {question.type !== 'scale' && <button className="text-btn" onClick={() => addOption(question.id)}><Plus size={13} />加选项</button>}
                  {question.type === 'scale' && <p className="option-hint">量表题固定 5 档：很差 / 较弱 / 一般 / 较好 / 优秀，对应 0 / 25 / 50 / 75 / 100 分。</p>}
                </div>
              )}
              {question.type === 'text' && <p className="option-hint">开放题不计分，只作为人工参考记录。</p>}
            </article>
          ))}
          <button className="btn btn-secondary btn-small" onClick={addQuestion}><Plus size={15} />加一道题</button>

          <div className="designer-profile-block">
            <div className="designer-questions-head">
              <h3>档案题（系统固定）</h3>
              <span className="rubric-total">必填 · 不可删 · 不计分 · 答案自动回填候选人台账</span>
            </div>
            {PROFILE_QUESTIONS.map((question, index) => (
              <article className="designer-question designer-question-locked" key={question.id}>
                <div className="designer-question-head">
                  <span className="question-index">Q{questions.length + index + 1}</span>
                  <select value={question.type} disabled>
                    <option value={question.type}>{question.type === 'text' ? '开放题' : '单选'}</option>
                  </select>
                  <label className="question-weight">权重<input value="0" disabled />%</label>
                  <span className="lock-badge"><LockKeyhole size={12} />固定不可删</span>
                </div>
                <input className="question-title-input" value={question.title} disabled />
                {question.type === 'single' && <p className="option-hint">选项：{(question.options || []).map((option) => option.label).join(' / ')}</p>}
              </article>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <span className="section-hint">共 {questions.length} 题 · 权重合计 {totalWeight}%</span>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存问卷</button>
        </div>
      </section>
    </div>
  )
}

function SurveyResultsDrawer({ survey, responses, loading, onExport, onClose }) {
  const [active, setActive] = useState(null)
  const scored = responses.filter((item) => Number.isFinite(Number(item.score)))
  const average = scored.length ? Math.round((scored.reduce((sum, item) => sum + Number(item.score), 0) / scored.length) * 10) / 10 : 0
  return (
    <div className="drawer-layer" role="dialog" aria-modal="true">
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭" />
      <aside className="candidate-drawer jd-drawer">
        <div className="drawer-top"><span>{survey.title} · 回收结果</span><button className="icon-btn" onClick={onClose}><X size={19} /></button></div>
        <div className="drawer-content">
          <div className="scoring-stats">
            <div><span>回收份数</span><strong>{responses.length}</strong></div>
            <div><span>平均分</span><strong>{average}</strong></div>
          </div>
          {loading && <p className="section-hint"><LoaderCircle className="spin" size={14} /> 正在读取提交记录</p>}
          <div className="response-list">
            {responses.map((response) => (
              <article className={classNames('response-row', active === response.id && 'active')} key={response.id}>
                <button className="response-main" onClick={() => setActive(active === response.id ? null : response.id)}>
                  <strong>{response.employee_name || response.employee_no || '未绑定员工'}</strong>
                  <span>工号 {response.employee_no || '—'} · {new Date(response.submitted_at).toLocaleString('zh-CN')}</span>
                </button>
                <span className="response-score">{response.score}</span>
              </article>
            ))}
            {!responses.length && !loading && <EmptyState icon={Inbox} title="还没有人提交" detail="把问卷链接发给候选人，提交后这里会实时出现。" />}
          </div>
          {active && (() => {
            const response = responses.find((item) => item.id === active)
            const detail = Array.isArray(response?.detail) ? response.detail : []
            return (
              <div className="response-detail">
                <h3>{response.employee_name || response.employee_no} 的作答明细</h3>
                {detail.map((item) => (
                  <div className="response-detail-row" key={item.id}>
                    <span>{item.title}</span>
                    <div className="response-detail-bar">{item.ratio != null && <i style={{ width: `${item.ratio}%` }} />}</div>
                    <strong>{item.ratio != null ? `${item.ratio}%` : '不计分'}</strong>
                    <em>{item.answer || '未作答'}</em>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
        <div className="drawer-footer">
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" onClick={onExport} disabled={!responses.length}><Download size={16} />导出 Excel</button>
        </div>
      </aside>
    </div>
  )
}

// 后台访问门禁拦截页：无关账号登录后看到，避免候选人/外部账号看到招聘后台外壳。
function NoAccessPage({ session, onLogout, onSwitchAccount }) {
  const name = (session?.user?.name || '').trim()
  return (
    <div className="survey-page">
      <div className="survey-card-panel no-access-panel">
        <div className="no-access-icon"><ShieldCheck size={32} /></div>
        <h1>这个账号没有招聘工作区</h1>
        <p>当前登录的账号（{name || '未命名账号'}）没有被开通聘桥的招聘权限。</p>
        <ul className="no-access-hints">
          <li>如果你只是填写测评问卷，直接关闭本页即可，答卷不受影响。</li>
          <li>如果你是招聘同事，请联系管理员为你的账号开通访问权限。</li>
        </ul>
        <div className="no-access-actions">
          <button type="button" className="btn btn-secondary" onClick={onSwitchAccount}>换一个账号登录</button>
          <button type="button" className="btn btn-primary" onClick={onLogout}>退出登录</button>
        </div>
      </div>
    </div>
  )
}

function SurveyFillPage({ inviteToken }) {
  const [survey, setSurvey] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!inviteToken) { setLoading(false); return }
    let alive = true
    ;(async () => {
      try { const row = await getSurveyForFill(inviteToken); if (alive) setSurvey(row) }
      catch (err) { if (alive) setError(displayError(err)) }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [inviteToken])

  const questions = survey?.questions || []

  const setAnswer = (id, value) => setAnswers((old) => ({ ...old, [id]: value }))
  const toggleMulti = (id, index) => setAnswers((old) => {
    const current = Array.isArray(old[id]) ? old[id] : []
    return { ...old, [id]: current.includes(index) ? current.filter((item) => item !== index) : [...current, index] }
  })

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!name.trim()) { setError('请填写姓名'); return }
    if (!phone.trim()) { setError('请填写手机号'); return }
    // 档案题多为开放题：必填开放题空白也要拦下，与服务端 required_missing 校验一致
    const missing = questions.filter((question) => {
      if (question.required === false) return false
      const value = answers[question.id]
      if (question.type === 'text') return !String(value ?? '').trim()
      if (question.type === 'multi') return !Array.isArray(value) || value.length === 0
      return value == null
    })
    if (missing.length) { setError(`还有 ${missing.length} 道必答题没有作答`); return }
    setSubmitting(true); setError('')
    try {
      const outcome = await submitSurveyRpc({ token: inviteToken, answers, name: name.trim(), phone: phone.trim() })
      setResult(outcome)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) { setError(displayError(err)) } finally { setSubmitting(false) }
  }

  if (loading) {
    return <div className="survey-page"><div className="survey-card-panel"><LoaderCircle className="spin" size={26} /><p>正在加载问卷</p></div></div>
  }

  if (result) {
    return (
      <div className="survey-page">
        <div className="survey-card-panel">
          <div className="survey-result-head">
            <CheckCircle2 size={34} />
            <div>
              <h1>感谢您的问卷填写</h1>
              <p>已提交成功，结果已同步给招聘负责人。可以关闭页面了，答卷已保存。</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error && !survey) {
    return <div className="survey-page"><div className="survey-card-panel"><AlertTriangle size={26} /><h1>问卷无法打开</h1><p>{error}</p></div></div>
  }

  return (
    <div className="survey-page">
      <form className="survey-card-panel survey-form" onSubmit={handleSubmit}>
        <header className="survey-form-head">
          <span className="survey-badge">聘桥 · 应聘问卷</span>
          <h1>{survey.title}</h1>
          {survey.description && <p>{survey.description}</p>}
          {survey.job_title && <p className="survey-job-line">应聘岗位：{survey.job_title}</p>}
        </header>
        <div className="survey-identity">
          <label className="form-label">姓名<input value={name} onChange={(e) => setName(e.target.value)} placeholder="与简历一致" required /></label>
          <label className="form-label">手机号<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="用于核对身份" required /></label>
        </div>
        <div className="survey-phone-note"><ShieldCheck size={13} />无需扫码登录：填写与档案一致的姓名和手机号即可核对身份，并自动关联到你的应聘记录。招聘平台导出的掩码手机号会先留空；你提交的完整手机号将用于更新招聘台账。</div>
        {questions.map((question, index) => (
          <fieldset className="survey-question" key={question.id}>
            <legend><span>Q{index + 1}</span>{question.title}{question.required !== false && <i>必答</i>}</legend>
            {question.type === 'text' && <textarea rows={3} value={answers[question.id] || ''} onChange={(e) => setAnswer(question.id, e.target.value)} placeholder="请输入你的回答" />}
            {(question.type === 'single' || question.type === 'scale') && (question.options || []).map((option, optionIndex) => (
              <label className={classNames('survey-option', Number(answers[question.id]) === optionIndex && 'checked')} key={optionIndex}>
                <input type="radio" name={question.id} checked={Number(answers[question.id]) === optionIndex} onChange={() => setAnswer(question.id, optionIndex)} />
                <span>{option.label}</span>
              </label>
            ))}
            {question.type === 'multi' && (question.options || []).map((option, optionIndex) => (
              <label className={classNames('survey-option', (answers[question.id] || []).includes(optionIndex) && 'checked')} key={optionIndex}>
                <input type="checkbox" checked={(answers[question.id] || []).includes(optionIndex)} onChange={() => toggleMulti(question.id, optionIndex)} />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-full" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{submitting ? '正在提交' : '提交问卷'}</button>
      </form>
    </div>
  )
}


function PeopleView({ jobs, candidates, surveys, session, interviewRecords = [], onOpen, onLogin, onDelete, onDeleteMany, onChangeJob, adminMode, ownerNames, notify }) {
  const ownerLabel = (c) => (c.owner_id ? ownerNames?.[c.owner_id] || c.owner_name || '未知账号' : c.owner_name || '—')
  const [jobId, setJobId] = useState('all')
  const [projectId, setProjectId] = useState('all')
  const [checked, setChecked] = useState([])
  const [surveyStatus, setSurveyStatus] = useState('all')
  const [completeness, setCompleteness] = useState('all')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('composite')

  const projects = useMemo(() => [...new Set(jobs.map((j) => j.project_name).filter(Boolean))], [jobs])
  const jobById = useMemo(() => new Map(jobs.map((j) => [String(j.id), j])), [jobs])

  const rows = useMemo(() => {
    // 可见范围已由上层按账号过滤（管理员模式才包含他人数据），这里只做筛选
    const scoped = candidates.filter((c) => {
      if (jobId !== 'all' && String(c.job_id) !== String(jobId)) return false
      if (projectId !== 'all' && String(jobById.get(String(c.job_id))?.project_name || '') !== projectId) return false
      return true
    })
    const filtered = scoped.filter((c) => {
      if (surveyStatus === 'submitted' && c.survey_status !== 'submitted') return false
      if (surveyStatus === 'none' && c.survey_status && c.survey_status !== 'none') return false
      if (completeness === 'complete' && c.composite_complete !== true) return false
      if (completeness === 'incomplete' && c.composite_complete !== false) return false
      if (query && !`${c.name} ${c.phone || ''} ${c.role_title || ''} ${c.person_no || ''}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    const score = (c) => (c.composite_score != null ? c.composite_score : -1)
    // 建档日期：优先用 created_at，解析失败退回 0（排到最末），避免脏数据打乱顺序
    const createdTime = (c) => {
      const t = new Date(c.created_at || '').getTime()
      return Number.isFinite(t) ? t : 0
    }
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'composite') return score(b) - score(a)
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'zh-CN')
      if (sortBy === 'survey') return (a.survey_status === 'submitted' ? 1 : 0) - (b.survey_status === 'submitted' ? 1 : 0)
      if (sortBy === 'date_desc') return createdTime(b) - createdTime(a)
      if (sortBy === 'date_asc') return createdTime(a) - createdTime(b)
      return 0
    })
    return sorted
  }, [candidates, jobId, projectId, surveyStatus, completeness, query, sortBy, jobById])

  // 台账导出：按勾选的人导出（没勾选则提示，不再默认导全部）。
  // 按项目分组，每个项目独立一个 sheet，问卷列按该项目自己的问卷题生成，
  // 因为不同项目设计的问卷字段不同（A 项目 abc…，B 项目 lfahjf…）。
  const handleExportLedger = async () => {
    if (!checked.length) {
      notify?.('请先在列表左侧勾选要导出的人员（可跨项目多选）', 'error')
      return
    }
    // 以勾选为准，从当前可见 rows 里取（rows 已按账号隔离 + 筛选）
    const selectedRows = rows.filter((c) => checked.includes(c.id)).map((c) => ({
      ...c,
      project_name: jobById.get(String(c.job_id))?.project_name || '',
    }))
    if (!selectedRows.length) return

    // 按项目分组（保持勾选顺序稳定：按项目首次出现顺序）
    const groups = []
    const groupIndex = new Map()
    for (const c of selectedRows) {
      const key = c.project_name || ''
      if (!groupIndex.has(key)) { groupIndex.set(key, groups.length); groups.push({ projectName: key, rows: [] }) }
      groups[groupIndex.get(key)].rows.push(c)
    }

    let responses = []
    if (session) {
      try {
        responses = await fetchCandidateSurveyResponses(selectedRows.map((c) => c.id), session)
      } catch (error) {
        notify?.(`问卷作答读取失败，本次仅导出固定列：${displayError(error)}`, 'error')
      }
    }

    // 只导勾选人的面试记录（一面/二面分列）
    const selectedIds = new Set(selectedRows.map((c) => String(c.id)))
    const selectedInterviews = interviewRecords.filter((r) => selectedIds.has(String(r.candidate_id)))

    // 单项目 → 单 sheet；多项目 → 每项目一个 sheet
    if (groups.length <= 1) {
      exportLedgerXlsx(selectedRows, `招聘台账${selectedRows[0].project_name ? `-${selectedRows[0].project_name}` : ''}`, { responses, surveys, interviewRecords: selectedInterviews })
    } else {
      exportLedgerByProjectXlsx(groups, '招聘台账', { responses, surveys, interviewRecords: selectedInterviews })
    }
    notify?.(`已导出 ${selectedRows.length} 人${groups.length > 1 ? `（${groups.length} 个项目分 sheet）` : ''}`)
  }

  const currentSurvey = (job) => surveys.find((s) => String(s.id) === String(job?.survey_version_id)) || surveys.find((s) => String(s.job_id) === String(job?.id) && s.is_current)

  const visible = rows.slice(0, 80)
  const allChecked = visible.length > 0 && visible.every((c) => checked.includes(c.id))
  const toggleAll = () => setChecked(allChecked ? [] : visible.map((c) => c.id))
  const toggleOne = (id) => setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="view-stack people-view">
      <div className="section-action-row">
        <div><h2>人员管理</h2><p className="section-hint">与候选人管道同一份数据。综合分 = AI评估×0.50 + 问卷×0.50，支持筛选搜索排序与导出台账。</p></div>
        <div className="panel-heading-actions">
          {adminMode && <span className="admin-scope-badge"><ShieldCheck size={13} />管理员模式 · 全部账号数据（只读）</span>}
          {checked.length > 0 && <span className="people-check-hint">已选 {checked.length} 人</span>}
          <button className="btn btn-secondary btn-small" onClick={handleExportLedger} disabled={!rows.length || !session}><Download size={15} />导出台账</button>
          <button className="btn btn-danger btn-small" onClick={() => onDeleteMany(checked)} disabled={!checked.length || !session}><Trash2 size={15} />批量删除</button>
        </div>
      </div>
      <section className="panel people-filters">
        <div className="people-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名、手机号、岗位、人员编号" /></div>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="all">全部项目</option>
          {projects.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="all">全部岗位</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.project_name ? `【${j.project_name}】` : ''}{j.title}</option>)}
        </select>
        <select value={surveyStatus} onChange={(e) => setSurveyStatus(e.target.value)}>
          <option value="all">问卷：全部</option>
          <option value="submitted">已填写</option>
          <option value="none">未填写</option>
        </select>
        <select value={completeness} onChange={(e) => setCompleteness(e.target.value)}>
          <option value="all">评分：全部</option>
          <option value="complete">已完整评分</option>
          <option value="incomplete">待补全</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="composite">按综合分排序</option>
          <option value="name">按姓名排序</option>
          <option value="survey">按问卷状态排序</option>
          <option value="date_desc">按日期排序 · 最新建档在前</option>
          <option value="date_asc">按日期排序 · 最早建档在前</option>
        </select>
      </section>
      <section className="panel people-table" tabIndex={0} aria-label="候选人台账">
        <div className="people-head">
          <span className="people-check"><input type="checkbox" aria-label="全选当前列表" checked={allChecked} onChange={toggleAll} disabled={!visible.length} /></span>
          <span>候选人</span><span>岗位</span><span>问卷</span><span>综合分</span><span>两模块</span><span>阶段</span><span />
        </div>
        {visible.map((c) => {
          const d = c.composite_detail || {}
          const dims = [
            { label: 'AI', v: d.resume?.raw, present: d.resume?.present },
            { label: '问卷', v: d.survey?.raw, present: d.survey?.present },
          ]
          return (
            <article className="people-row" key={c.id} onClick={() => onOpen(c)}>
              <span className="people-check" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" aria-label={`选择 ${c.name}`} checked={checked.includes(c.id)} onChange={() => toggleOne(c.id)} />
              </span>
              <div className="people-person"><Avatar name={c.name} size="sm" /><div><strong>{c.name}</strong><span>{c.person_no ? `编号 ${c.person_no}` : '未关联人员'} · {c.phone || '无手机号'}</span><em className="people-owner">录入人：{ownerLabel(c)}{c.created_at ? ` · ${formatDate(c.created_at)}` : ''}</em></div></div>
              <span className="people-job" onClick={(event) => event.stopPropagation()}>
                <select
                  className="people-job-select"
                  value={c.job_id != null ? String(c.job_id) : ''}
                  disabled={!session || adminMode}
                  title={adminMode ? '管理员模式为只读，不能改岗位' : '修改该候选人所属岗位'}
                  onChange={(event) => {
                    const job = jobs.find((j) => String(j.id) === event.target.value)
                    if (job) onChangeJob?.(c, job)
                  }}
                >
                  {!jobById.get(String(c.job_id)) && <option value={c.job_id != null ? String(c.job_id) : ''}>{c.role_title || '未绑定岗位'}</option>}
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.project_name ? `${j.project_name} · ` : ''}{j.title}</option>)}
                </select>
              </span>
              <span className={classNames('survey-chip', c.survey_status === 'submitted' && 'done', c.survey_status === 'invited' && 'invited')}>{c.survey_status === 'submitted' ? '已填写' : c.survey_status === 'invited' ? '已邀请' : '未填写'}</span>
              <span className="people-score">
                {c.composite_score != null ? <strong>{c.composite_score}</strong> : <em>{c.composite_complete === false ? '待补全' : '—'}</em>}
              </span>
              <div className="people-dims">{dims.map((item) => <span key={item.label} className={classNames(!item.present && 'dim-missing')}>{item.label}<i>{item.v != null ? item.v : '缺'}</i></span>)}</div>
              <span className="stage-pill">{(stages.find((s) => s.id === c.stage) || {}).label || c.stage}</span>
              <button className="icon-btn people-del-btn" title="删除该候选人" onClick={(event) => { event.stopPropagation(); onDelete(c) }}><Trash2 size={15} /></button>
              <button type="button" className="icon-btn" aria-label={`查看 ${c.name} 的详情`} onClick={(event) => { event.stopPropagation(); onOpen(c) }}><ChevronRight size={16} /></button>
            </article>
          )
        })}
        {!rows.length && <EmptyState icon={UsersRound} title="没有符合条件的候选人" detail="调整筛选条件，或先上架岗位、收集简历。" />}
      </section>
      {!session && <div className="inline-notice"><LockKeyhole size={16} /><span>登录后才能导出人员数据。</span><button className="text-btn" onClick={onLogin}>去登录<ArrowRight size={14} /></button></div>}
    </div>
  )
}

const FUNNEL_LABELS = { resume_in: '简历进入', survey_done: '问卷完成', scored: '评估完成', interview: '进入面试', offer: '发出 Offer', hired: '入职', onboarded: '进入台账' }

function FunnelView({ jobs, candidates, funnelEvents, onView }) {
  const [scope, setScope] = useState('all')
  const [mode, setMode] = useState('current')
  const job = jobs.find((j) => String(j.id) === String(scope))
  const scopedCandidates = scope === 'all' ? candidates : candidates.filter((c) => String(c.job_id) === String(scope))
  const scopedEvents = scope === 'all' ? funnelEvents : funnelEvents.filter((e) => String(e.job_id) === String(scope))

  const currentDistribution = stages.map((s) => ({ label: s.label, count: scopedCandidates.filter((c) => c.stage === s.id).length }))
  const currentTotal = scopedCandidates.length

  const historicStages = ['resume_in', 'survey_done', 'scored', 'interview', 'offer', 'hired', 'onboarded']
  const historic = historicStages.map((stage) => ({
    stage, label: FUNNEL_LABELS[stage],
    count: scopedEvents.filter((e) => e.stage === stage).length,
  }))
  const hasEvents = scopedEvents.length > 0
  const prevCount = (index) => (index === 0 ? currentTotal : historic[index - 1].count)
  const maxCount = Math.max(currentTotal, ...historic.map((h) => h.count), 1)

  const channels = [...new Set(scopedCandidates.map((c) => c.channel || c.source || '其他').filter(Boolean))]

  return (
    <div className="view-stack funnel-view">
      <div className="section-action-row">
        <div><h2>数据漏斗</h2><p className="section-hint">区分「当前状态分布」与「历史转化漏斗」。历史漏斗基于真实阶段事件时间戳，缺事件会标注数据不完整。</p></div>
        <div className="panel-heading-actions">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">全部岗位</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.company_name ? `${j.company_name} · ${j.title}` : j.title}</option>)}
          </select>
        </div>
      </div>
      <div className="funnel-tabs">
        <button className={classNames(mode === 'current' && 'active')} onClick={() => setMode('current')}>当前状态分布</button>
        <button className={classNames(mode === 'historic' && 'active')} onClick={() => setMode('historic')}>历史转化漏斗</button>
      </div>

      {mode === 'current' && (
        <section className="panel funnel-panel">
          <div className="funnel-rows">
            {currentDistribution.map((item, i) => (
              <div className="funnel-row" key={item.label}>
                <span className="funnel-label">{item.label}</span>
                <div className="funnel-bar"><i style={{ width: `${currentTotal ? Math.round((item.count / currentTotal) * 100) : 0}%` }} /></div>
                <strong>{item.count}<i>人</i></strong>
                <em>{currentTotal ? `${Math.round((item.count / currentTotal) * 100)}%` : '0%'}</em>
              </div>
            ))}
          </div>
          <div className="funnel-channels">
            <span className="funnel-label">渠道来源</span>
            {channels.map((ch) => <span className="channel-chip" key={ch}>{ch} <b>{scopedCandidates.filter((c) => (c.channel || c.source) === ch).length}</b></span>)}
          </div>
        </section>
      )}

      {mode === 'historic' && (
        <section className="panel funnel-panel">
          {!hasEvents && <div className="funnel-incomplete"><AlertTriangle size={16} /><span>还没有阶段事件记录，历史漏斗数据不完整。候选人推进、问卷提交、评估后会逐步生成。</span></div>}
          <div className="funnel-rows">
            {historic.map((item, i) => {
              const prev = prevCount(i)
              const conv = prev > 0 ? Math.round((item.count / prev) * 100) : 0
              const dropped = i > 0 && item.count > prev
              return (
                <div className="funnel-row" key={item.stage}>
                  <span className="funnel-label">{item.label}</span>
                  <div className="funnel-bar"><i style={{ width: `${Math.round((item.count / maxCount) * 100)}%` }} /></div>
                  <strong>{item.count}<i>人</i></strong>
                  <em>{i === 0 ? '进入' : `${conv}%`}</em>
                  {dropped && <span className="funnel-skip" title="存在跳步（如未填问卷直接面试），未虚构问卷记录">跳步</span>}
                </div>
              )
            })}
          </div>
          <p className="section-hint">历史漏斗记录「是否曾到达某阶段」，问卷不是进入面试的绝对前置，出现跳步会如实标注，不补造记录。</p>
        </section>
      )}
    </div>
  )
}

function JobWizard({ job, jobs = [], session, onClose, onSubmit, running, notify, onLogin }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(() => {
    const base = {
      company_name: '', project_name: '', title: '', department: '', location: '', employment_type: '全职', openings: 1,
      recruit_reasons: [], reason_notes: '',
      market_type: '', salary_budget: { currency: 'CNY', period: 'monthly', min: '', max: '' },
      need_by: '', jd_text: '', rubric: null, reason_rules: [], survey_version_id: '',
    }
    if (!job) return base
    return {
      ...base,
      ...job,
      company_name: job.company_name || '',
      project_name: job.project_name || '',
      salary_budget: { ...base.salary_budget, ...(job.salary_budget || {}) },
      recruit_reasons: Array.isArray(job.recruit_reasons) ? job.recruit_reasons : [],
      reason_rules: Array.isArray(job.reason_rules) ? job.reason_rules : [],
      market_type: job.market_type || '',
      survey_version_id: job.survey_version_id || '',
    }
  })
  const [jdFile, setJdFile] = useState(null)
  const [deriving, setDeriving] = useState(false)
  const [rubricReviewRequired, setRubricReviewRequired] = useState(!job)
  const [reviewedDimensions, setReviewedDimensions] = useState({})
  // 同名项目核对：别人已建过这个项目名时，先弹窗确认是否同一项目，避免建错导致数据串池
  const [dupProject, setDupProject] = useState(null)
  const pendingSubmitRef = useRef(null)

  const patch = (key, value) => {
    setForm((old) => ({ ...old, [key]: value }))
    if (key === 'jd_text' || key === 'rubric') {
      setRubricReviewRequired(true)
      setReviewedDimensions({})
    }
  }
  const patchBudget = (key, value) => setForm((old) => ({ ...old, salary_budget: { ...old.salary_budget, [key]: value } }))
  const toggleReason = (reason) => setForm((old) => ({ ...old, recruit_reasons: old.recruit_reasons.includes(reason) ? old.recruit_reasons.filter((r) => r !== reason) : [...old.recruit_reasons, reason] }))

  const handleDeriveRubric = async () => {
    if (!session) return onLogin()
    if (!form.jd_text.trim()) { notify('请先填写或上传 JD', 'error'); return }
    setDeriving(true)
    try {
      const result = await deriveRubricFromJd({ ...form, title: form.title || '岗位', department: form.department }, form.jd_text, session)
      patch('rubric', result.rubric)
      notify('已生成评分维度草稿，请逐条核对权重并确认')
    } catch (error) { notify(displayError(error), 'error') } finally { setDeriving(false) }
  }

  const handleJdFile = async (file) => {
    if (!file) return
    setJdFile(file)
    try {
      const text = await extractJobFileText(file)
      patch('jd_text', text)
      notify('已解析 JD 文本，可继续生成评分维度')
    } catch (error) { notify(displayError(error), 'error') }
  }

  const handleNext = () => {
    if (step === 0 && !job && !form.jd_text.trim()) {
      notify('请先填写或上传 JD，这是 AI 评估的依据', 'error')
      return
    }
    if (step === 1) {
      if (!form.company_name.trim()) { notify('请填写公司名称', 'error'); return }
      if (!form.title.trim()) { notify('请填写岗位名称', 'error'); return }
    }
    if (step === 2 && !job) {
      if (!form.recruit_reasons.length) { notify('请至少选择一个招聘原因', 'error'); return }
      if (!form.market_type) { notify('请选择市场类型', 'error'); return }
    }
    setStep(step + 1)
  }

  const handleSubmit = () => {
    if (!form.company_name.trim()) { notify('请填写公司名称', 'error'); setStep(1); return }
    if (!form.title.trim()) { notify('请填写岗位名称', 'error'); setStep(1); return }
    // 新建岗位要求完整配置；编辑历史岗位允许分步补齐，缺项在工作流首页显示「待完善」
    if (!job) {
      if (!form.jd_text.trim()) { notify('请先填写或上传 JD', 'error'); setStep(0); return }
      if (!form.recruit_reasons.length) { notify('请至少选择一个招聘原因', 'error'); setStep(2); return }
      if (!form.market_type) { notify('请选择市场类型', 'error'); setStep(2); return }
    }
    if (rubricReviewRequired && form.rubric) {
      const dimensions = Object.entries(form.rubric)
      if (dimensions.some(([, weight]) => !Number.isFinite(Number(weight)) || Number(weight) <= 0) || dimensions.reduce((total, [, weight]) => total + Number(weight), 0) !== 100) {
        notify('评分维度的权重须大于 0，合计为 100%', 'error'); setStep(0); return
      }
      if (dimensions.some(([name]) => !reviewedDimensions[name])) {
        notify('请逐条核对并确认 JD 评分维度后再保存', 'error'); setStep(0); return
      }
    }
    const projectName = (form.project_name || '').trim()
    if (projectName) {
      const existing = jobs.find((j) => (j.project_name || '').trim() === projectName
        && j.owner_id !== (session?.user?.id || '')
        && (!job || String(j.id) !== String(job.id)))
      if (existing) { setDupProject(existing); pendingSubmitRef.current = { ...form, jd_file: job?.jd_file }; return }
    }
    onSubmit({ ...form, jd_file: job?.jd_file })
  }

  const confirmDupProject = () => { const payload = pendingSubmitRef.current; setDupProject(null); pendingSubmitRef.current = null; if (payload) onSubmit(payload) }
  const cancelDupProject = () => { setDupProject(null); pendingSubmitRef.current = null }

  const steps = ['JD 与评分规则', '基础信息', '招聘原因与市场']

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭" />
      <section className="modal modal-wide job-wizard">
        <div className="modal-head">
          <div><h2>{job ? '编辑岗位' : '上架岗位'}</h2><p>按业务顺序配置：先定 JD 与评分规则 → 再填公司与岗位信息 → 最后记录招聘原因与市场背景。</p></div>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="wizard-steps">
          {steps.map((label, i) => <button type="button" key={label} className={classNames(i === step && 'active', i < step && 'done')} onClick={() => setStep(i)} title={`跳到第 ${i + 1} 步`}>{i < step ? <Check size={13} /> : <span>{i + 1}</span>}{label}</button>)}
        </div>
        <div className="wizard-body">
          {step === 0 && (
            <div className="wizard-stack">
              <div className="form-block"><h3>JD（职位描述）</h3>
                <label className={classNames('upload-zone upload-zone-compact', jdFile && 'has-file')}>
                  <input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => handleJdFile(e.target.files[0])} />
                  {jdFile ? <><FileText size={22} /><strong>{jdFile.name}</strong></> : <><UploadCloud size={24} /><strong>上传 JD 文件</strong><span>PDF / DOCX / TXT</span></>}
                </label>
                <textarea className="jd-textarea" rows={5} value={form.jd_text} onChange={(e) => patch('jd_text', e.target.value)} placeholder="或直接粘贴 JD 原文" />
                <button className="btn btn-secondary btn-small" onClick={handleDeriveRubric} disabled={deriving}>{deriving ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}按 JD 生成评分维度</button>
                {form.rubric && <div className="rubric-block">
                  <div className="rubric-title">简历匹配维度 · 人工确认</div>
                  <p className="section-hint">权重合计须为 100%。核对每个维度后逐条确认；修改 JD 或权重后，需要重新确认。</p>
                  {Object.entries(form.rubric).map(([name, weight]) => <div className="rubric-review-row" key={name}>
                    <label className="rubric-review-check"><input type="checkbox" checked={!!reviewedDimensions[name] || !rubricReviewRequired} onChange={(e) => {
                      if (!rubricReviewRequired) {
                        setRubricReviewRequired(true)
                        setReviewedDimensions({ ...Object.fromEntries(Object.keys(form.rubric).map((dimension) => [dimension, true])), [name]: e.target.checked })
                      } else setReviewedDimensions((old) => ({ ...old, [name]: e.target.checked }))
                    }} /><span>{name}</span></label>
                    <label className="rubric-review-weight">权重 <input type="number" min="0" max="100" step="1" value={weight} aria-label={`${name}权重`} onChange={(e) => patch('rubric', { ...form.rubric, [name]: e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))) })} />%</label>
                  </div>)}
                </div>}
                <p className="section-hint">综合分由 AI 评估与问卷评估各贡献 50%，由服务端计算；招聘原因和市场背景仅记录，不影响分数。</p>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="wizard-grid">
              <label className="form-label">所属项目<input value={form.project_name} onChange={(e) => patch('project_name', e.target.value)} list="project-suggestions" placeholder="例如：金松、五粮春、茅台" />
                <datalist id="project-suggestions">{[...new Set((jobs || []).map((item) => item.project_name).filter(Boolean))].map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <label className="form-label">公司名称<input value={form.company_name} onChange={(e) => patch('company_name', e.target.value)} placeholder="例如：金松营销有限公司" /></label>
              <label className="form-label">岗位名称<input value={form.title} onChange={(e) => patch('title', e.target.value)} placeholder="例如：客户经理" /></label>
              <label className="form-label">所属部门<input value={form.department} onChange={(e) => patch('department', e.target.value)} placeholder="例如：白酒事业部" /></label>
              <label className="form-label">工作地点<input value={form.location} onChange={(e) => patch('location', e.target.value)} placeholder="例如：杭州 · 混合办公" /></label>
              <label className="form-label">用工类型<select value={form.employment_type} onChange={(e) => patch('employment_type', e.target.value)}><option>全职</option><option>兼职</option><option>实习</option><option>外包</option></select></label>
              <label className="form-label">招聘人数<input type="number" min="1" max="99" value={form.openings} onChange={(e) => patch('openings', e.target.value)} /></label>
              <p className="section-hint wizard-grid-hint">问卷不再在此绑定。保存后到「测评问卷」中把问卷绑定到这个岗位即可。</p>
            </div>
          )}
          {step === 2 && (
            <div className="wizard-stack">
              <div className="form-block"><h3>招聘原因（可多选）</h3><p className="section-hint">仅记录，不参与评分。</p>
                <div className="reason-grid">
                  {RECRUIT_REASONS.map((reason) => <button key={reason} className={classNames('reason-chip', form.recruit_reasons.includes(reason) && 'active')} onClick={() => toggleReason(reason)}>{reason}</button>)}
                </div>
              </div>
              <label className="form-label">招聘原因与市场调整说明<textarea rows={2} value={form.reason_notes || ''} onChange={(e) => patch('reason_notes', e.target.value)} placeholder="记录招聘背景、市场类型调整原因等，仅供业务参考" /></label>
              <div className="form-block"><h3>市场类型</h3><p className="section-hint">仅记录，不参与评分；对应分值由系统在后台统一处理。</p>
                <div className="market-grid">
                  <button className={classNames('market-card', form.market_type === 'people' && 'active')} onClick={() => patch('market_type', 'people')}><strong>人的市场</strong><span>候选人稀缺，企业找人困难</span></button>
                  <button className={classNames('market-card', form.market_type === 'role' && 'active')} onClick={() => patch('market_type', 'role')}><strong>岗位的市场</strong><span>候选人充足，竞争较大</span></button>
                </div>
              </div>
              <div className="form-block"><h3>薪资预算（统一金额口径）</h3>
                <div className="budget-grid">
                  <label className="form-label">币种<select value={form.salary_budget.currency} onChange={(e) => patchBudget('currency', e.target.value)}><option value="CNY">人民币 ¥</option></select></label>
                  <label className="form-label">口径<select value={form.salary_budget.period} onChange={(e) => patchBudget('period', e.target.value)}><option value="monthly">税前月薪</option><option value="annual">税前年薪</option></select></label>
                  <label className="form-label">下限<input type="number" value={form.salary_budget.min} onChange={(e) => patchBudget('min', e.target.value)} placeholder="如 12000" /></label>
                  <label className="form-label">上限<input type="number" value={form.salary_budget.max} onChange={(e) => patchBudget('max', e.target.value)} placeholder="如 18000" /></label>
                </div>
                <label className="form-label inline-label">要求到岗时间<input type="date" value={form.need_by || ''} onChange={(e) => patch('need_by', e.target.value)} /></label>
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <span className="section-hint">第 {step + 1} / 3 步</span>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          {step > 0 && <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>上一步</button>}
          {step < 2 ? <button className="btn btn-primary" onClick={handleNext}>下一步</button> : <button className="btn btn-primary" onClick={handleSubmit} disabled={running}>{running ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存岗位</button>}
        </div>
      </section>
      {dupProject && (
        <ConfirmDialog
          title="发现同名项目"
          message={`项目「${dupProject.project_name}」已存在（创建人：${dupProject.owner_name || '团队成员'}）。请和对方核对：这是同一个项目吗？`}
          points={[
            '确认同一项目：两边的候选人、台账数据将共享互通（只读）',
            '不是同一项目：请取消后改用带区分后缀的项目名，如「五粮春-贵州」「五粮春-四川」',
          ]}
          confirmText="是同一项目，继续保存"
          onClose={cancelDupProject}
          onConfirm={confirmDupProject}
        />
      )}
    </div>
  )
}


// ============================================================================
// 6. 弹窗组件
// ============================================================================

function ModalShell({ title, subtitle, children, onClose, wide = false }) {
  const dialog = useRef(null)

  useEffect(() => {
    const trigger = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  const handleKeys = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(dialog.current.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
      .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length)
    const first = focusable[0]
    const last = focusable.at(-1)
    const active = document.activeElement
    if (event.shiftKey ? active === first || active === dialog.current : active === last) {
      event.preventDefault()
      const next = event.shiftKey ? last : first
      next?.focus()
    }
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title} onKeyDown={handleKeys}>
      <button type="button" className="modal-backdrop" tabIndex={-1} onClick={onClose} aria-label="关闭弹窗" />
      <section ref={dialog} tabIndex={-1} className={classNames('modal', wide && 'modal-wide')}>
        <div className="modal-head">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function EvaluateModal({ jobs, onClose, onSubmit, running, step, onEditJd }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [location, setLocation] = useState('')
  const [profile, setProfile] = useState({})
  const [parsing, setParsing] = useState(false)
  const [parseHint, setParseHint] = useState('')
  const [jobId, setJobId] = useState(jobs[0]?.id || '')
  const job = jobs.find((j) => String(j.id) === String(jobId))
  const steps = [['extract', '解析简历文本（扫描件自动识别）'], ['evaluate', '按岗位 JD 评估证据'], ['upload', '加密保存原简历'], ['save', '写入候选人与审计记录']]
  const patchProfile = (key, value) => setProfile((old) => ({ ...old, [key]: value }))

  // 上传后自动识别姓名/电话/邮箱/城市 + 台账字段（性别/年龄/学历/院校/专业/技能/薪资/居住地）
  // 全部落进可编辑表单，识别不准直接改
  const handleFile = async (picked) => {
    setFile(picked)
    setParseHint('')
    setProfile({})
    if (!picked) return
    setParsing(true)
    try {
      const fields = await parseResumeContacts(picked)
      if (fields.name) setName(fields.name)
      setPhone(fields.phone || '')
      setEmail(fields.email || '')
      setLocation(fields.location || '')
      const found = [fields.name && '姓名', fields.phone && '手机号', fields.email && '邮箱', fields.location && '城市'].filter(Boolean)
      if (fields.phoneMasked) {
        setParseHint('手机号被招聘平台掩码，已留空；候选人提交问卷后将自动回填。正在提取台账字段…')
      } else {
        setParseHint(found.length
          ? `已从简历识别出${found.join('、')}，正在提取台账字段…请核对后再提交`
          : '未能从这份简历识别出基本信息，正在提取台账字段…请手动填写')
      }
    } catch (err) {
      setParseHint('简历解析失败，请手动填写基本信息')
    }
    try {
      const extracted = await extractResumeProfile(picked)
      if (extracted) {
        setProfile(extracted)
        if (extracted.current_city && !location) setLocation(extracted.current_city)
        setParseHint('台账字段已按简历自动填充（性别/年龄/学历/院校/专业/技能/薪资/居住地），识别不准可直接修改')
      }
    } catch (err) {
      setParseHint('台账字段提取失败，可先提交评估再在候选人详情里补录')
    } finally { setParsing(false) }
  }

  return <ModalShell title="AI 评估新简历" subtitle="上传简历原件，按所选岗位的 JD 标准生成带证据的匹配分析。" onClose={running ? () => {} : onClose}>
    <form className="modal-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ file, name, job, phone, email, location, profile }) }}>
      <label className={classNames('upload-zone', file && 'has-file')}><input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => handleFile(e.target.files[0])} disabled={running} required />{file ? <><FileText size={28} /><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换</span></> : <><UploadCloud size={30} /><strong>上传简历</strong><span>支持 {ATTACHMENT_FORMAT_TEXT}，最大 10 MB；扫描件自动识别</span></>}</label>
      {parsing && <p className="section-hint parse-hint"><LoaderCircle size={14} className="spin" /> 正在识别简历中的姓名、电话、邮箱与城市…</p>}
      {!parsing && parseHint && <p className="section-hint parse-hint"><ShieldCheck size={14} /> {parseHint}</p>}
      <label className="form-label">候选人姓名<input value={name} onChange={(e) => setName(e.target.value)} placeholder="上传后自动识别，可修改" required disabled={running} /></label>
      <label className="form-label">申请职位<select value={jobId} onChange={(e) => setJobId(e.target.value)} required disabled={running}>{jobs.map((item) => <option value={item.id} key={item.id}>{item.project_name ? `【${item.project_name}】` : ''}{item.title} · {item.department}</option>)}</select></label>
      <div className="eval-field-grid">
        <label className="form-label">手机号<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="完整号码可识别；掩码号留空，问卷提交后回填" disabled={running} /></label>
        <label className="form-label">邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="自动识别，可修改" disabled={running} /></label>
        <label className="form-label">所在城市<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="自动识别，可修改" disabled={running} /></label>
      </div>
      <div className="eval-field-grid">
        <label className="form-label">性别<input value={profile.gender || ''} onChange={(e) => patchProfile('gender', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">年龄<input value={profile.age ?? ''} onChange={(e) => patchProfile('age', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">学历<input value={profile.education || ''} onChange={(e) => patchProfile('education', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">毕业院校<input value={profile.school || ''} onChange={(e) => patchProfile('school', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">专业<input value={profile.major || ''} onChange={(e) => patchProfile('major', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">技能/证书<input value={profile.skill_certs || ''} onChange={(e) => patchProfile('skill_certs', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">目前薪资<input value={profile.current_salary || ''} onChange={(e) => patchProfile('current_salary', e.target.value)} placeholder="自动识别" disabled={running} /></label>
        <label className="form-label">目前居住地<input value={profile.current_city || ''} onChange={(e) => patchProfile('current_city', e.target.value)} placeholder="自动识别" disabled={running} /></label>
      </div>
      <div className={classNames('jd-eval-card', job?.jd_text ? 'ready' : 'missing')}>
        <div className="jd-eval-head"><BookOpen size={15} /><strong>{job?.jd_text ? '将按该岗位 JD 评分' : '该岗位还没上传 JD'}</strong>{onEditJd && <button type="button" className="text-btn" onClick={() => onEditJd(job)}>{job?.jd_text ? '查看 JD' : '去上传'}<ArrowRight size={14} /></button>}</div>
        <div className="jd-eval-chips">{Object.entries(job?.rubric || {}).map(([key, value]) => <span key={key}>{key}<b>{value}%</b></span>)}</div>
        {!job?.jd_text && <p>没有 JD 时只能按历史权重粗评，结果会带「缺 JD」标记，仅供占位参考。</p>}
      </div>
      <div className="privacy-note"><LockKeyhole size={15} /><span>模型输入前会移除邮箱、手机号与证件号。原文件仅保存到当前账号的私有空间。</span></div>
      {running && <div className="evaluation-steps">{steps.map(([id, label]) => { const current = steps.findIndex(([s]) => s === step); const index = steps.findIndex(([s]) => s === id); return <div className={classNames(index < current && 'done', index === current && 'current')} key={id}>{index < current ? <Check size={15} /> : index === current ? <LoaderCircle size={15} className="spin" /> : <Circle size={12} />}<span>{label}</span></div> })}</div>}
      <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={running}>取消</button><button className="btn btn-primary" type="submit" disabled={running || !file || !name}>{running ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{running ? '正在评估' : '开始证据评估'}</button></div>
    </form>
  </ModalShell>
}

function JobModal({ onClose, onSubmit, running }) {
  const [form, setForm] = useState({ title: '', department: '', location: '', openings: 1 })
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  return <ModalShell title="新建招聘职位" subtitle="先定义岗位，再让 AI 按岗位标准工作。" onClose={onClose}><form className="modal-form" onSubmit={(e) => { e.preventDefault(); onSubmit(form) }}><label className="form-label">职位名称<input required value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="例如：渠道销售经理" /></label><label className="form-label">所属部门<input required value={form.department} onChange={(e) => update('department', e.target.value)} placeholder="例如：白酒事业部" /></label><label className="form-label">工作地点<input required value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="例如：杭州 · 混合办公" /></label><label className="form-label">招聘人数<input type="number" min="1" max="99" value={form.openings} onChange={(e) => update('openings', e.target.value)} /></label><div className="inline-notice"><Sparkles size={16} /><span>系统会创建一套通用初始 rubric，后续可按岗位调整权重。</span></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={running}>{running ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}创建职位</button></div></form></ModalShell>
}

function InterviewModal({ candidate, initialRound = '一面', records = [], readOnly = false, onClose, onSubmit, onDelete, running }) {
  const recordOf = (round) => records.find((r) => r.round === round) || null
  const [round, setRound] = useState(INTERVIEW_ROUNDS.includes(initialRound) ? initialRound : '一面')
  const current = recordOf(round)
  const buildForm = (rec) => ({
    accepted: rec?.accepted || '',
    attended: rec?.attended || '',
    interview_at: rec?.interview_at ? new Date(rec.interview_at).toISOString().slice(0, 16) : (candidate.interview_at ? new Date(candidate.interview_at).toISOString().slice(0, 16) : ''),
    format: rec?.format || '',
    result: rec?.result || '',
    note: rec?.note || '',
  })
  const [form, setForm] = useState(() => buildForm(current))
  // 切轮次时载入该轮已有记录，避免把一面内容带到二面
  const switchRound = (next) => { setRound(next); setForm(buildForm(recordOf(next))) }
  const patch = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  const select = (key, label, options) => (
    <label className="form-label">{label}<select value={form[key]} disabled={readOnly} onChange={(e) => patch(key, e.target.value)}><option value="">未填写</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
  )
  return (
    <ModalShell title={`${candidate.name} · 面试记录`} subtitle={`${candidate.role_title} · 一面二面分别记录`} onClose={onClose}>
      <form className="modal-form interview-record-form" onSubmit={(e) => {
        e.preventDefault()
        onSubmit(candidate, round, {
          ...form,
          interview_at: form.interview_at ? new Date(form.interview_at).toISOString() : null,
        })
      }}>
        {readOnly && <div className="inline-notice"><ShieldCheck size={16} /><span>管理员模式只读，不能修改面试记录。</span></div>}
        <div className="interview-round-tabs">
          {INTERVIEW_ROUNDS.map((r) => <button type="button" key={r} className={classNames(r === round && 'active', isRoundRejected(recordOf(r)) && 'round-rejected')} onClick={() => switchRound(r)}>{r}{isRoundRejected(recordOf(r)) ? <i className="round-rejected-mark">拒绝</i> : recordOf(r) ? <i className="round-dot" /> : null}</button>)}
        </div>
        {select('accepted', '是否接受面试', INTERVIEW_ACCEPTED)}
        {select('attended', '是否实际参面', INTERVIEW_ATTENDED)}
        <label className="form-label">面试日期与时间<input type="datetime-local" value={form.interview_at} disabled={readOnly} onChange={(e) => patch('interview_at', e.target.value)} /></label>
        {select('format', '面试形式', INTERVIEW_FORMATS)}
        {select('result', '面试结果', INTERVIEW_RESULTS)}
        <label className="form-label">备注<textarea rows={3} value={form.note} disabled={readOnly} onChange={(e) => patch('note', e.target.value)} placeholder="本场核验重点、面试官意见等" /></label>
        <div className="interview-suggestion"><Bot size={18} /><div><strong>建议本场重点核验</strong><p>{candidate.evaluation?.flags?.[0]?.label || candidate.summary || '项目经历与岗位匹配度'}</p></div></div>
        <div className="modal-actions">
          {current && !readOnly && <button type="button" className="btn btn-danger" onClick={() => onDelete(current)} disabled={running}><Trash2 size={15} />删除{round}记录</button>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={running || readOnly}>{running ? <LoaderCircle size={17} className="spin" /> : <CalendarPlus size={17} />}保存{round}记录</button>
        </div>
      </form>
    </ModalShell>
  )
}

function SyncModal({ candidate, integration, onClose, onConfirm, running }) {
  return <ModalShell title="同步到云聘" subtitle="系统将按真实 API 返回结果更新员工编号。" onClose={onClose}><div className="modal-form"><div className="sync-confirm-person"><Avatar name={candidate.name} /><div><strong>{candidate.name}</strong><span>{candidate.role_title} · {candidate.location}</span></div></div><dl className="profile-list sync-fields"><div><dt>员工姓名</dt><dd>{candidate.name}</dd></div><div><dt>邮箱</dt><dd>{candidate.email || '未填写（接口可能拒绝）'}</dd></div><div><dt>电话</dt><dd>{candidate.phone || '未填写（接口可能拒绝）'}</dd></div><div><dt>来源</dt><dd>HireBridge 招聘录用</dd></div></dl>{!integration.connected && <div className="risk-box"><div><AlertTriangle size={17} /><strong>真实连接未配置</strong></div><p>请先在系统连接页配置云聘。聘桥不会用演示员工编号冒充同步成功。</p></div>}<div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={!integration.connected || running} onClick={() => onConfirm(candidate)}>{running ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}确认创建员工</button></div></div></ModalShell>
}

function LoginModal({ onClose, onLogin, loading, error }) {
  return <ModalShell title="进入真实招聘工作区" subtitle="登录后才能保存数据、上传简历和调用模型。" onClose={loading ? () => {} : onClose}><div className="login-modal-body"><div className="login-shield"><LockKeyhole size={28} /></div><h3>你的招聘数据，只属于你的工作区</h3><p>使用 WorkBuddy 账号完成授权。职位、候选人、简历和评估记录均按账号隔离，演示模式不会写入任何数据。</p><ul><li><CheckCircle2 size={16} />行级权限隔离</li><li><CheckCircle2 size={16} />私有简历存储</li><li><CheckCircle2 size={16} />完整审计记录</li></ul>{error && <div className="form-error">{error}</div>}<button className="btn btn-primary btn-full" onClick={onLogin} disabled={loading}>{loading ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{loading ? '正在跳转授权…' : '使用 WorkBuddy 登录'}</button>{loading ? <small>正在打开授权页面，请勿关闭此窗口。</small> : <small>授权将在同标签页完成；想换一个账号登录，请用侧边栏的「切换账号」按钮（↻ 图标）。</small>}</div></ModalShell>
}

// ============================================================================
// 7. 根组件：全局状态调度与视图分发
// ============================================================================

export default function App() {
  const [session, setSession] = useState(null)
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [events, setEvents] = useState([])
  const [interviewRecords, setInterviewRecords] = useState([])
  const [ledgerResponses, setLedgerResponses] = useState([])
  const [view, setView] = useState('people')
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)
  // 用户中心：个人资料 + 管理员身份（名单在库里）+ 管理员模式开关
  const [profile, setProfile] = useState({ name: '', phone: '', email: '', title: '', note: '' })
  const [displayNames, setDisplayNames] = useState({})
  const [jobShares, setJobShares] = useState([]) // 协作授权关系：管理员看全部、岗位主人看自己的、被授权人看授给自己的
  const [isAdminAccount, setIsAdminAccount] = useState(false)
  const [adminMode, setAdminMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [evaluateStep, setEvaluateStep] = useState('extract')
  const [integration, setIntegration] = useState({ online: false, configured: false })
  const [integrationLoading, setIntegrationLoading] = useState(false)
  const [integrationSaving, setIntegrationSaving] = useState(false)
  const [employees, setEmployees] = useState([])
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [employeeSaving, setEmployeeSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [undoState, setUndoState] = useState(null) // { label, seconds, left } 撤销式删除倒计时
  const pendingDeleteRef = useRef(null) // { timer, tick, run } 挂起的删除任务
  const [mobileNav, setMobileNav] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [messages, setMessages] = useState([])
  const [jdJob, setJdJob] = useState(null)
  const [surveys, setSurveys] = useState([])
  const [surveyBusy, setSurveyBusy] = useState(false)
  const [surveyDraft, setSurveyDraft] = useState(null)
  const [surveyResult, setSurveyResult] = useState(null)
  const [responsesLoading, setResponsesLoading] = useState(false)
  const [funnelEvents, setFunnelEvents] = useState([])
  const [persons, setPersons] = useState([])
  const [invites, setInvites] = useState([])
  const [scoringHistory, setScoringHistory] = useState([])
  const [evaluatingId, setEvaluatingId] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [resetSurveyTarget, setResetSurveyTarget] = useState(null)
  const [resettingSurvey, setResettingSurvey] = useState(false)
  const [inviteEntries, setInviteEntries] = useState({})
  const [activeInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'))

  const unreadCount = messages.filter((message) => !message.read_at).length

  const notify = (message, tone = 'success') => setToast({ message, tone })

  // 撤销式删除：删除动作延迟 8 秒执行，期间可撤销，撤销则数据完全不动
  const UNDO_SECONDS = 8
  const clearPendingDelete = () => {
    const task = pendingDeleteRef.current
    if (!task) return
    clearTimeout(task.timer)
    clearInterval(task.tick)
    pendingDeleteRef.current = null
    setUndoState(null)
  }
  // 启动一个可撤销的删除；若上一条未执行完则先立即执行它，避免多个删除互相覆盖
  const scheduleDelete = (label, run) => {
    const prev = pendingDeleteRef.current
    if (prev) { clearTimeout(prev.timer); clearInterval(prev.tick); prev.run() }
    setUndoState({ label, left: UNDO_SECONDS, seconds: UNDO_SECONDS })
    const startedAt = Date.now()
    const tick = setInterval(() => {
      const left = Math.max(0, UNDO_SECONDS - Math.floor((Date.now() - startedAt) / 1000))
      setUndoState({ label, left, seconds: UNDO_SECONDS })
    }, 250)
    const timer = setTimeout(() => {
      clearInterval(tick)
      pendingDeleteRef.current = null
      setUndoState(null)
      run()
    }, UNDO_SECONDS * 1000)
    pendingDeleteRef.current = { timer, tick, run }
  }
  const cancelDelete = () => {
    const task = pendingDeleteRef.current
    if (task) { clearTimeout(task.timer); clearInterval(task.tick) }
    pendingDeleteRef.current = null
    setUndoState(null)
    notify('已撤销删除，数据保持不变')
  }
  // 组件卸载时清理，避免定时器泄漏
  useEffect(() => () => {
    const task = pendingDeleteRef.current
    if (task) { clearTimeout(task.timer); clearInterval(task.tick) }
  }, [])

  const refreshMessages = async (currentSession = session) => {
    if (!currentSession) { setMessages([]); return }
    try { setMessages(await fetchMessages(currentSession)) } catch (error) { console.warn('消息加载失败', error) }
  }
  const refreshIntegration = async (currentSession = session) => {
    setIntegrationLoading(true)
    setIntegration(await checkIntegration(currentSession))
    if (currentSession) {
      try { setEmployees(await fetchEmployees(currentSession)) } catch (error) { notify(displayError(error), 'error') }
    } else { setEmployees([]) }
    setIntegrationLoading(false)
  }
  const refreshWorkspaceExtras = async (currentSession) => {
    try { setSurveys(await fetchSurveys(currentSession)) } catch (error) { console.warn('问卷加载失败', error) }
    try { setFunnelEvents(await fetchFunnel(currentSession)) } catch (error) { console.warn('漏斗加载失败', error) }
    try { setPersons(await fetchPersons(currentSession)) } catch (error) { console.warn('人员加载失败', error) }
    try { setInvites(await fetchInvites(currentSession)) } catch (error) { console.warn('邀请加载失败', error) }
    try { setInterviewRecords(await fetchInterviews(currentSession)) } catch (error) { console.warn('面试记录加载失败', error) }
    try { setJobShares(await fetchJobShares(currentSession)) } catch (error) { console.warn('协作授权加载失败', error) }
  }
  const refresh = async (currentSession = session) => {
    const data = await loadWorkspace(currentSession)
    setJobs(data.jobs); setCandidates(data.candidates); setEvents(data.events)
    if (selected) setSelected(data.candidates.find((c) => c.id === selected.id) || null)
    if (currentSession) {
      try { await syncDerivedMessages(data, currentSession) } catch (error) { console.warn('待办推导失败', error) }
      await refreshMessages(currentSession)
      await refreshWorkspaceExtras(currentSession)
    } else {
      setFunnelEvents([]); setPersons([]); setInvites([]); setInterviewRecords([])
    }
    return data
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data: currentSession } = await restoreSession()
        const data = await loadWorkspace(currentSession)
        if (!mounted) return
        setSession(currentSession); setJobs(data.jobs); setCandidates(data.candidates); setEvents(data.events)
        setIntegration(await checkIntegration(currentSession))
        setEmployees(currentSession ? await fetchEmployees(currentSession) : [])
        if (currentSession) {
          try { await syncDerivedMessages(data, currentSession) } catch (error) { console.warn('待办推导失败', error) }
          setMessages(await fetchMessages(currentSession))
          try { setSurveys(await fetchSurveys(currentSession)) } catch (error) { console.warn('问卷加载失败', error) }
          try { setFunnelEvents(await fetchFunnel(currentSession)) } catch (error) { console.warn('漏斗加载失败', error) }
          try { setPersons(await fetchPersons(currentSession)) } catch (error) { console.warn('人员加载失败', error) }
          try { setInvites(await fetchInvites(currentSession)) } catch (error) { console.warn('邀请加载失败', error) }
          try { setInterviewRecords(await fetchInterviews(currentSession)) } catch (error) { console.warn('面试记录加载失败', error) }
          try { setJobShares(await fetchJobShares(currentSession)) } catch (error) { console.warn('协作授权加载失败', error) }
          try { await refreshProfile(currentSession) } catch (error) { console.warn('资料加载失败', error) }
        }
      } catch (error) { notify(displayError(error), 'error') } finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [])

  // 在线台账：进入该视图或候选人集合变化时，加载全部作答用于「问卷·题目」只读列。
  // 视图常驻挂载但内容隐藏，这里只在真正切到 ledger 时才拉取，避免无谓请求。
  const loadLedgerResponses = async (currentSession, ids) => {
    if (!currentSession || !ids?.length) { setLedgerResponses([]); return }
    try { setLedgerResponses(await fetchCandidateSurveyResponses(ids, currentSession)) } catch (error) { console.warn('台账作答加载失败', error) }
  }
  useEffect(() => {
    if (view !== 'ledger' || !session || loading) return
    loadLedgerResponses(session, candidates.map((c) => c.id))
    // 候选人集合用 id 串做依赖，避免对象引用变化导致重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session, loading, candidates.map((c) => c.id).join(',')])

  // C 端候选人提交问卷等远端变更自动同步进台账与列表，无需手动刷新浏览器
  useEffect(() => {
    if (!session || loading) return
    const timer = setInterval(async () => {
      if (document.hidden) return
      try {
        const data = await loadWorkspace(session)
        setJobs(data.jobs); setCandidates(data.candidates); setEvents(data.events)
        setSelected((current) => (current ? data.candidates.find((c) => c.id === current.id) || current : null))
      } catch (error) { console.warn('自动同步失败', error) }
    }, 15000)
    return () => clearInterval(timer)
  }, [session, loading])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const requireAuth = () => setModal({ type: 'login' })
  const guarded = (action) => session ? action() : requireAuth()
  const updateCandidateLocal = (row) => { setCandidates((old) => old.map((c) => c.id === row.id ? row : c)); setSelected((old) => old?.id === row.id ? row : old) }

  const handleMove = async (candidate, stage) => guarded(async () => {
    setActionLoading(true)
    try { const row = await moveCandidate(candidate, stage, session); updateCandidateLocal(row); notify(`${candidate.name}已更新招聘阶段`); await refresh() } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  })

  // ===== 用户中心：个人资料 + 管理员模式 =====
  const refreshProfile = async (currentSession = session) => {
    if (!currentSession) { setProfile({ name: '', phone: '', email: '', title: '', note: '' }); setIsAdminAccount(false); setDisplayNames({}); return }
    const next = await fetchMyProfile(currentSession)
    setProfile(next)
    setIsAdminAccount(await fetchAdminStatus(currentSession))
    // 把自定义昵称顶到 session 上：之后新录入的数据 owner_name 就用这个名字
    if (next.name) {
      setSession((old) => (old ? { ...old, user: { ...old.user, name: next.name } } : old))
      await ensureDisplayName(currentSession, next.name)
    }
    setDisplayNames(await fetchDisplayNames(currentSession))
  }
  const handleSaveProfile = async (form) => guarded(async () => {
    setSavingProfile(true)
    try {
      await saveMyProfile(session, form)
      await refreshProfile()
      notify('资料已保存')
    } catch (error) { notify(displayError(error), 'error') } finally { setSavingProfile(false) }
  })
  const handleUnlockAdmin = () => {
    setAdminMode(true)
    setView('people')
    notify('已进入管理员模式，可查看全部账号的数据（只读）')
  }
  const handleExitAdmin = () => {
    setAdminMode(false)
    setView('account')
    notify('已退出管理员模式，仅显示本人数据')
  }

  // ===== 岗位协作授权（管理员分配）=====
  const [sharesBusy, setSharesBusy] = useState(false)
  const handleCreateShare = async (job, granteeUid, granteeName) => {
    if (!isAdminAccount) { notify('只有管理员能分配协作授权', 'error'); return }
    setSharesBusy(true)
    try {
      await createJobShare(job, granteeUid, granteeName, session)
      setJobShares(await fetchJobShares(session))
      notify(`已把「${job.title || '岗位'}」授权给 ${granteeName || granteeUid}`)
    } catch (error) { notify(displayError(error), 'error') } finally { setSharesBusy(false) }
  }
  const handleDeleteShare = async (share) => {
    if (!isAdminAccount) { notify('只有管理员能解除协作授权', 'error'); return }
    if (!window.confirm(`确定解除「${share.job_title || `岗位 #${share.job_id}`}」对 ${share.grantee_name || share.grantee_uid} 的授权？对方将无法再看到该岗位下的协作数据。`)) return
    setSharesBusy(true)
    try {
      await deleteJobShare(share, session)
      setJobShares(await fetchJobShares(session))
      notify('授权已解除')
    } catch (error) { notify(displayError(error), 'error') } finally { setSharesBusy(false) }
  }

  // 数据可见范围：本人数据 + 被授权协作的岗位数据（服务端 RLS 同样放行，这里是前端一致性过滤）
  const myUid = session?.user?.id || ''
  // 授给「当前用户」的岗位 id 集合——只有 grantee_uid = 我 的授权才让我看到别人的数据
  const grantedJobIds = useMemo(
    () => new Set(jobShares.filter((s) => s.grantee_uid === myUid).map((s) => Number(s.job_id))),
    [jobShares, myUid],
  )
  // 后台访问门禁：挡住「填完问卷用自己账号登录进来、但在这个系统里什么都没有」的无关账号。
  // 放行条件（满足其一）：未登录演示 / 管理员 / 被授权协作 / 名下已有候选人或岗位数据。
  // RLS 本就按账号隔离数据，这一层只挡住无关账号看到后台外壳，不是数据安全的唯一防线。
  const hasWorkspaceAccess = useMemo(() => {
    if (!session || loading) return true // 演示模式放行；加载中先放行，避免闪烁误拦
    if (isAdminAccount) return true
    if (grantedJobIds.size > 0) return true
    if (candidates.some((c) => c.owner_id === myUid) || jobs.some((j) => j.owner_id === myUid)) return true
    return false
  }, [session, loading, isAdminAccount, grantedJobIds, candidates, jobs, myUid])
  // 是否是「同事共享给我」的数据（本人数据 owner_id = 我；协作数据 owner_id = 别人）。
  // 协作者只能改日常字段，删除类操作一律拒绝（数据库同样未放行协作 DELETE）。
  const isSharedRow = (row) => Boolean(session && row?.owner_id && row.owner_id !== myUid)
  // 一条候选人是否可见：本人的，或其所属岗位已授权给我协作
  const isMineCandidate = (row) => {
    if (!session) return true
    if (!row.owner_id || row.owner_id === myUid) return true
    return row.job_id != null && grantedJobIds.has(Number(row.job_id))
  }
  // 岗位是否可见：本人的，或授权给我的
  const isMineJob = (row) => {
    if (!session) return true
    if (!row.owner_id || row.owner_id === myUid) return true
    return grantedJobIds.has(Number(row.id))
  }
  const scopedCandidates = useMemo(
    () => (adminMode ? candidates : candidates.filter(isMineCandidate)),
    [candidates, adminMode, myUid, session, grantedJobIds],
  )
  const scopedJobs = useMemo(
    () => (adminMode ? jobs : jobs.filter(isMineJob)),
    [jobs, adminMode, myUid, session, grantedJobIds],
  )
  // 面试记录：本人候选人的 + 协作岗位候选人的（通过候选人 id 关联）；管理员模式看全部、只读。
  const scopedCandidateIdSet = useMemo(() => new Set(scopedCandidates.map((c) => Number(c.id))), [scopedCandidates])
  const scopedInterviewRecords = useMemo(
    () => (adminMode ? interviewRecords : interviewRecords.filter((r) => scopedCandidateIdSet.has(Number(r.candidate_id)))),
    [interviewRecords, adminMode, scopedCandidateIdSet],
  )
  // 按候选人 id 聚合，视图里直接按轮次取
  const interviewsByCandidate = useMemo(() => {
    const map = new Map()
    for (const r of scopedInterviewRecords) {
      const key = String(r.candidate_id)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return map
  }, [scopedInterviewRecords])

  const handleEvaluate = async (input) => {
    if (!session) { setModal({ type: 'login' }); return }
    if (!input?.job) { notify('请先选择申请职位', 'error'); return }
    setActionLoading(true); setEvaluateStep('extract')
    try { const candidate = await evaluateResume(input, session, setEvaluateStep); await bindSurveyFor(candidate, input.job); const data = await refresh(); setModal(null); setSelected(data.candidates.find((c) => c.id === candidate.id) || candidate); notify('评估完成，已保存候选人和证据记录') } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  // 简历入库后立即生成并绑定岗位问卷（一人一码），同时把「已邀请」状态同步进前端列表，
  // 不需要手动刷新页面就能看到问卷绑定。岗位未绑问卷时静默跳过。
  const bindSurveyFor = async (candidate, job) => {
    if (!session || !candidate?.id || !job?.id) return null
    try {
      const result = await bindCandidateSurvey({ candidate, job, surveys, session })
      if (!result?.invite) return null
      setInvites((old) => old.some((i) => i.token === result.invite.token) ? old : [{ ...result.invite, candidate_id: candidate.id }, ...old])
      if (result.candidate?.id) setCandidates((old) => old.map((c) => String(c.id) === String(candidate.id) ? { ...c, ...result.candidate } : c))
      return result.invite
    } catch (error) { console.warn('自动绑定问卷失败', error); return null }
  }

  const handleSaveJobFull = async (input) => {
    if (!session) return requireAuth()
    setActionLoading(true)
    try {
      await saveJobFull(input, session)
      await refresh()
      setModal(null)
      notify(input.id ? '岗位配置已更新' : '岗位已上架')
    } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  const handleOpenCandidate = async (candidate) => {
    setSelected(candidate)
    if (!session || !candidate?.id) { setScoringHistory([]); return }
    try { setScoringHistory(await fetchScoringHistory(candidate.id, session)) } catch (error) { setScoringHistory([]) }
  }

  const handleEvaluateCandidate = async (candidate) => {
    if (!session) return requireAuth()
    setEvaluatingId(candidate.id)
    try {
      const row = await evaluateCandidateResume(candidate, session)
      await refresh()
      setSelected((old) => (old && old.id === row.id ? { ...old, ...row } : row))
      notify('AI 评估完成，已对照岗位 JD 生成证据分析并重算综合分')
    } catch (error) { notify(displayError(error), 'error') } finally { setEvaluatingId(null) }
  }

  const handleUpdateProfile = async (candidate, patch) => {
    if (!session) return requireAuth()
    setSavingProfile(true)
    try {
      await updateCandidateProfile(candidate, patch, session)
      await refresh()
      notify(`已更新 ${patch.name || candidate.name} 的基本信息`)
    } catch (error) { notify(displayError(error), 'error') } finally { setSavingProfile(false) }
  }

  // 批量导入卡片里的行内修改：按候选人 id 写回数据库。
  // 注意不能只在 candidates 里找——刚导入完的候选人要等刷新才进列表，
  // 直接用 id 更新更稳妥。失败要往外抛，批量导入卡片据此回滚显示值。
  const handleBatchProfileSave = async (candidateId, patch) => {
    if (!session) throw new Error('请先登录。')
    await updateCandidateProfile({ id: candidateId }, patch, session)
    setCandidates((old) => old.map((c) => (String(c.id) === String(candidateId) ? { ...c, ...patch } : c)))
  }

  // 改候选人所属岗位：写库 → 作废旧岗位问卷入口 → 按新岗位问卷重新生成一人一码。
  // 批量导入卡片与人员管理共用这一个入口，保证两边行为一致。
  const handleChangeCandidateJob = async (candidateId, job) => {
    if (!session) throw new Error('请先登录。')
    const target = candidates.find((c) => String(c.id) === String(candidateId))
    if (!target) throw new Error('未找到该候选人记录')
    await updateCandidateJob(target, job, session)
    setCandidates((old) => old.map((c) => (String(c.id) === String(candidateId)
      ? { ...c, job_id: job.id, role_title: job.title }
      : c)))
    // 抽屉正开着这个候选人时同步岗位，避免详情/测评入口停留在旧岗位
    setSelected((old) => (old && String(old.id) === String(candidateId)
      ? { ...old, job_id: job.id, role_title: job.title }
      : old))
    const survey = jobCurrentSurvey(job, surveys)
    await revokeCandidateInvites(candidateId, survey?.id, session)
    if (survey) {
      const invite = await bindSurveyFor({ ...target, job_id: job.id, role_title: job.title }, job)
      return invite
    }
    return null
  }

  // 人员管理里改岗位：与批量导入共用同一套写库逻辑，管理员只读模式下不给改
  const handlePeopleChangeJob = async (candidate, job) => {
    if (!session) return requireAuth()
    if (adminMode) { notify('管理员模式为只读，不能修改岗位', 'error'); return }
    try {
      await handleChangeCandidateJob(candidate.id, job)
      await refresh()
      notify(`${candidate.name} 已改绑到「${job.title}」`)
    } catch (error) { notify(displayError(error), 'error') }
  }

  // 在线台账单元格写回：按列类型分派到既有写函数，保证与详情/管道里的修改同源。
  // 基础资料 → updateCandidateProfile；面试 → saveInterviewRecord；
  // 阶段 → moveCandidate；岗位 → updateCandidateJob（含问卷入口重绑）。
  const handleLedgerSave = async (candidate, col, value) => {
    if (!session) return requireAuth()
    if (adminMode) { notify('管理员模式为只读，不能修改台账', 'error'); return }
    setActionLoading(true)
    try {
      if (col.kind === 'profile') {
        await updateCandidateProfile(candidate, { [col.field]: value }, session)
      } else if (col.kind === 'interview') {
        const patch = col.field === 'interview_at'
          ? { interview_at: value ? new Date(value).toISOString() : null }
          : { [col.field]: value }
        await saveInterviewRecord(candidate, col.round, patch, session)
        if (patch.interview_at && candidate.stage === 'screening') await moveCandidate(candidate, 'interview', session)
        else if (patch.interview_at) await setInterviewAt(candidate, patch.interview_at, session)
      } else if (col.kind === 'stage') {
        await moveCandidate(candidate, value, session)
      } else if (col.kind === 'job') {
        const job = jobs.find((j) => String(j.id) === String(value))
        if (!job) throw new Error('岗位不存在或已下架')
        await handleChangeCandidateJob(candidate.id, job)
      }
      await refresh()
      if (col.kind === 'interview' && view === 'ledger') {
        loadLedgerResponses(session, scopedCandidates.map((c) => c.id))
      }
      notify(`${candidate.name} 的「${col.label}」已更新`)
    } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  // 在线台账导出：导出全部当前账号可见候选人的台账（含问卷列与面试分列）
  const handleLedgerExport = async () => {
    if (!scopedCandidates.length) return
    try {
      const allResponses = ledgerResponses.length ? ledgerResponses : await fetchCandidateSurveyResponses(scopedCandidates.map((c) => c.id), session)
      exportLedgerXlsx(scopedCandidates, '招聘台账-在线', { responses: allResponses, surveys, interviewRecords })
      notify('台账已导出')
    } catch (error) { notify(displayError(error), 'error') }
  }

  // 刷新问卷：二次确认后清除答卷与得分，链接恢复可再次填写
  const handleConfirmResetSurvey = async () => {
    if (!resetSurveyTarget) return
    setResettingSurvey(true)
    try {
      await resetCandidateSurvey(resetSurveyTarget, session)
      await refresh()
      setResetSurveyTarget(null)
      notify('问卷已刷新，候选人可重新填写')
    } catch (error) { notify(displayError(error), 'error') } finally { setResettingSurvey(false) }
  }

  const handleDeleteCandidate = (candidate) => {
    if (!session) return requireAuth()
    if (isSharedRow(candidate)) { notify('这是同事共享给你协作的候选人，只有本人能删除', 'error'); return }
    scheduleDelete(`候选人「${candidate.name}」`, async () => {
      setActionLoading(true)
      try {
        await deleteCandidate(candidate, session)
        setSelected(null)
        await refresh()
        notify(`已删除 ${candidate.name}`)
      } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
    })
  }

  const handleDeleteCandidates = (ids) => {
    if (!session) return requireAuth()
    const list = (Array.isArray(ids) ? ids : [ids]).map((id) => Number(id)).filter(Boolean)
    if (!list.length) return
    const targets = list.map((id) => candidates.find((c) => Number(c.id) === id)).filter(Boolean)
    if (!targets.length) return
    const shared = targets.filter(isSharedRow)
    if (shared.length) { notify(`选中的 ${shared.length} 位是同事共享协作的候选人，只有本人能删除`, 'error'); return }
    scheduleDelete(`${targets.length} 位候选人`, async () => {
      setActionLoading(true)
      try {
        let done = 0
        for (const candidate of targets) {
          await deleteCandidate(candidate, session)
          done += 1
        }
        await refresh()
        notify(`已删除 ${done} 位候选人`)
      } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
    })
  }

  const handleDeleteJob = (job) => {
    if (!session) return requireAuth()
    if (isSharedRow(job)) { notify('这是同事共享给你的协作岗位，只有本人能删除', 'error'); return }
    scheduleDelete(`岗位「${job.title}」`, async () => {
      setActionLoading(true)
      try {
        await deleteJob(job, session)
        await refresh()
        notify(`已删除岗位 ${job.title}`)
      } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
    })
  }

  // 候选人详情里的专属评测入口（始终提供，方便随时补填问卷）
  const inviteEntryState = useMemo(() => {
    if (!selected) return null
    return inviteEntries[selected.id] || { loading: true }
  }, [selected, inviteEntries])

  useEffect(() => {
    if (!selected || !session) return
    // 已提交的候选人不再自动发邀请：一人一码限填一次，再发新码只会让对方
    // 白填一遍后被 already_submitted 拒收。需要修改时走「刷新问卷」（重置后再生成）。
    if (selected.survey_status === 'submitted') {
      setInviteEntries((old) => (old[selected.id]?.submitted ? old : { ...old, [selected.id]: { submitted: true } }))
      return
    }
    const job = jobs.find((j) => String(j.id) === String(selected.job_id))
    const survey = jobCurrentSurvey(job, surveys)
    const cached = inviteEntries[selected.id]
    // 缓存命中条件：岗位与问卷都没变，且缓存的邀请在最新 invites 里仍是 active。
    // 错误状态永不缓存——问卷/岗位数据到位后（本 effect 依赖 invites/surveys/jobs）
    // 会自动重试，避免出现「该岗位暂未绑定问卷」卡死再也出不来。
    if (cached && !cached.error) {
      const stillValid = String(cached.jobId) === String(job?.id)
        && String(cached.surveyId) === String(survey?.id)
        && (!cached.token || invites.some((i) => i.token === cached.token && i.status === 'active'))
      if (stillValid) return
    }
    let alive = true
    ;(async () => {
      try {
        const urlRef = { url: '', qr: '' }
        const inv = await ensureCandidateInvite(selected, job, surveys, invites, session)
        if (!alive) return
        if (!inv) { setInviteEntries((old) => ({ ...old, [selected.id]: { error: '该岗位暂未绑定问卷' } })); return }
        const url = inviteUrl(inv)
        urlRef.url = url
        const qr = await QRCode.toDataURL(url, { width: 200, margin: 1, color: QR_COLORS })
        if (!alive) return
        urlRef.qr = qr
        setInviteEntries((old) => ({ ...old, [selected.id]: { url, qr, token: inv.token, jobId: job?.id, surveyId: survey?.id } }))
        setInvites((old) => old.some((i) => i.token === inv.token) ? old : [{ ...inv, candidate_id: selected.id }, ...old])
      } catch (error) {
        if (alive) setInviteEntries((old) => ({ ...old, [selected.id]: { error: displayError(error) } }))
      }
    })()
    return () => { alive = false }
    // invites/surveys/jobs 进入依赖：导入后立即绑定的邀请进入状态后，抽屉能直接复用，不会重复建码
  }, [selected?.id, selected?.job_id, session, invites, surveys, jobs])

  // 保存某一轮面试记录：管理员模式只读，直接拒绝写入。
  // 首次带面试时间且候选人还在筛选阶段时，顺带推进到面试阶段（沿用原来的漏斗事件口径）。
  const handleSaveInterview = async (candidate, round, patch) => {
    if (!session) return requireAuth()
    if (adminMode) { notify('管理员模式只读，不能修改面试记录', 'error'); return }
    setActionLoading(true)
    try {
      await saveInterviewRecord(candidate, round, patch, session)
      if (patch.interview_at && candidate.stage === 'screening') {
        const moved = await moveCandidate(candidate, 'interview', session)
        updateCandidateLocal(moved)
      } else if (patch.interview_at) {
        updateCandidateLocal(await setInterviewAt(candidate, patch.interview_at, session))
      }
      await refresh() // refresh 内已同步更新选中的候选人，无需再用旧闭包覆盖
      setModal(null)
      notify(`${candidate.name}的${round}面试记录已保存`)
    } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  const handleDeleteInterview = async (record) => {
    if (!session) return requireAuth()
    if (adminMode) { notify('管理员模式只读，不能删除面试记录', 'error'); return }
    if (isSharedRow(record)) { notify('这是同事共享协作的面试记录，只有本人能删除', 'error'); return }
    setActionLoading(true)
    try { await deleteInterviewRecord(record, session); await refresh(); notify('面试记录已删除') } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  const handleDeleteInterviewFromTable = async (candidate, record) => {
    if (!session) return requireAuth()
    if (adminMode) { notify('管理员模式只读，不能删除面试记录', 'error'); return }
    if (isSharedRow(candidate)) { notify('这是同事共享协作的数据，只有本人能删除面试记录', 'error'); return }
    if (!window.confirm(`确定删除 ${candidate.name} 的「${record.round}」面试记录？不可恢复。`)) return
    setActionLoading(true)
    try { await deleteInterviewRecord(record, session); await refresh(); notify(`${candidate.name}的${record.round}记录已删除`) } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  const handleDeleteAllInterviews = async (candidate, recs) => {
    if (!session) return requireAuth()
    if (adminMode) { notify('管理员模式只读，不能删除面试记录', 'error'); return }
    if (isSharedRow(candidate)) { notify('这是同事共享协作的数据，只有本人能删除面试记录', 'error'); return }
    if (!window.confirm(`确定清空 ${candidate.name} 的全部面试记录（一面、二面）？该候选人会从面试安排表移除，不可恢复。`)) return
    setActionLoading(true)
    try { await deleteCandidateInterviews(candidate, recs, session); await refresh(); notify(`${candidate.name}的面试记录已清空`) } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  const handleSync = async (candidate) => {
    setActionLoading(true)
    try { const result = await syncCandidate(candidate, session); await refresh(); setEmployees(await fetchEmployees(session)); setModal(null); setSelected(result.candidate); notify(`云聘已创建员工 ${result.employeeId}`) } catch (error) { notify(displayError(error), 'error') } finally { setActionLoading(false) }
  }

  const handleConfigureHorilla = async (config) => {
    setIntegrationSaving(true)
    try {
      await configureHorilla(config)
      await refreshIntegration()
      notify('云聘凭据已保存，正在校验连接')
    } catch (error) { notify(displayError(error), 'error') } finally { setIntegrationSaving(false) }
  }

  const handleClearHorilla = async () => {
    setIntegrationSaving(true)
    try { await clearHorilla(); await refreshIntegration(); notify('已清除云聘凭据') } catch (error) { notify(displayError(error), 'error') } finally { setIntegrationSaving(false) }
  }

  const handleDownload = async (candidate) => {
    if (candidate.resume_path?.startsWith('local://')) {
      notify(`原件在本地：${candidate.resume_path.slice(8)}`, 'error')
      return
    }
    setDownloading(true)
    try { const url = await getResumeUrl(candidate, session); window.open(url, '_blank', 'noopener,noreferrer') } catch (error) { notify(displayError(error), 'error') } finally { setDownloading(false) }
  }

  const handleDownloadCandidateAttachment = async (attachment) => {
    if (!session) return requireAuth()
    try {
      const url = await downloadCandidateAttachment(attachment, session)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) { notify(displayError(error), 'error') }
  }

  const openEmployee = (employee) => {
    if (!session) return requireAuth()
    setSelectedEmployee(employee)
  }

  const handleSaveEmployee = async (employee, patch) => {
    if (!session) return requireAuth()
    setEmployeeSaving(true)
    try {
      const row = await updateEmployee(employee, patch, session)
      setEmployees((old) => old.map((e) => e.id === row.id ? row : e))
      setSelectedEmployee(row)
      notify('员工档案已保存')
    } catch (error) { notify(displayError(error), 'error') } finally { setEmployeeSaving(false) }
  }

  const handleUploadAttachment = async (employee, file) => {
    if (!session) return requireAuth()
    setEmployeeSaving(true)
    try {
      const row = await uploadEmployeeAttachment(employee, file, session)
      setEmployees((old) => old.map((e) => e.id === row.id ? row : e))
      setSelectedEmployee(row)
      notify('附件已上传')
    } catch (error) { notify(displayError(error), 'error') } finally { setEmployeeSaving(false) }
  }

  const handleDownloadAttachment = async (employee, attachment) => {
    try { const url = await downloadEmployeeAttachment(employee, attachment, session); window.open(url, '_blank', 'noopener,noreferrer') } catch (error) { notify(displayError(error), 'error') }
  }

  const handleRemoveAttachment = async (employee, attachment) => {
    if (!session) return requireAuth()
    setEmployeeSaving(true)
    try {
      const row = await removeEmployeeAttachment(employee, attachment, session)
      setEmployees((old) => old.map((e) => e.id === row.id ? row : e))
      setSelectedEmployee(row)
      notify('附件已删除')
    } catch (error) { notify(displayError(error), 'error') } finally { setEmployeeSaving(false) }
  }

  const handleExportEmployee = (employee) => {
    exportEmployeesXlsx([employee], `${employee.first_name || '员工'}_档案`)
  }

  const handleExportAll = () => {
    if (!employees.length) return notify('暂无可导出的员工', 'error')
    exportEmployeesXlsx(employees, '云聘员工档案')
    notify('已导出员工档案 Excel')
  }

  const openMessageTarget = (message) => {
    if (!message) return
    if (message.link_kind === 'candidate' && message.link_id) {
      const target = candidates.find((c) => String(c.id) === String(message.link_id))
      if (target) { setSelected(target); return }
    }
    if (message.link_view) setView(AVAILABLE_VIEWS.has(message.link_view) ? message.link_view : 'people')
  }

  const handleOpenMessage = async (message) => {
    if (session && !message.read_at) {
      try {
        await markMessageRead(message, session)
        setMessages((old) => old.map((item) => item.id === message.id ? { ...item, read_at: new Date().toISOString() } : item))
      } catch (error) { notify(displayError(error), 'error') }
    }
    openMessageTarget(message)
  }

  const handleMarkAllRead = async () => {
    if (!session) return requireAuth()
    const ids = messages.filter((message) => !message.read_at).map((message) => message.id)
    if (!ids.length) return
    try {
      await markMessagesRead(ids, session)
      setMessages((old) => old.map((item) => ids.includes(item.id) ? { ...item, read_at: new Date().toISOString() } : item))
      notify('已全部标为已读')
    } catch (error) { notify(displayError(error), 'error') }
  }

  const handleDeleteMessage = async (message) => {
    if (!session) return requireAuth()
    try {
      await deleteMessage(message, session)
      setMessages((old) => old.filter((item) => item.id !== message.id))
    } catch (error) { notify(displayError(error), 'error') }
  }

  const handleClearRead = async () => {
    if (!session) return requireAuth()
    const read = messages.filter((message) => message.read_at)
    if (!read.length) return
    try {
      for (const message of read) await deleteMessage(message, session)
      setMessages((old) => old.filter((item) => !item.read_at))
      notify(`已清理 ${read.length} 条已读消息`)
    } catch (error) { notify(displayError(error), 'error') }
  }

  const handleJdSaved = (row) => {
    setJobs((old) => old.map((job) => job.id === row.id ? row : job))
    refreshMessages()
  }

  const openNewSurvey = () => guarded(() => setSurveyDraft({ title: '', description: '', job_id: '', pass_score: '', status: 'open', questions: [emptyQuestion(0)] }))

  const handleSaveSurvey = async (draft) => {
    if (!session) return requireAuth()
    setSurveyBusy(true)
    try {
      const row = await saveSurveyVersioned(draft, session)
      setSurveys((old) => {
        const exists = old.some((item) => item.id === row.id)
        return exists ? old.map((item) => item.id === row.id ? row : item) : [row, ...old]
      })
      setSurveyDraft(null)
      notify('问卷已保存，可以绑定岗位并分发问卷入口了')
      refreshMessages()
    } catch (error) { notify(displayError(error), 'error') } finally { setSurveyBusy(false) }
  }

  const handleDeleteSurvey = async (survey) => {
    if (!session) return requireAuth()
    try {
      await deleteSurvey(survey, session)
      setSurveys((old) => old.filter((item) => item.id !== survey.id))
      notify('问卷已删除')
    } catch (error) { notify(displayError(error), 'error') }
  }

  const openSurveyResults = async (survey) => {
    if (!session) return requireAuth()
    setSurveyResult({ survey, responses: [] })
    setResponsesLoading(true)
    try {
      const rows = await fetchSurveyResponses(survey.id, session)
      setSurveyResult({ survey, responses: rows })
    } catch (error) { notify(displayError(error), 'error') } finally { setResponsesLoading(false) }
  }

  const openEvaluate = () => session ? setModal({ type: 'evaluate' }) : setModal({ type: 'login' })
  const openSchedule = (candidate, round = '一面') => session
    ? setModal({ type: 'interview', candidate, round, records: interviewsByCandidate.get(String(candidate.id)) || [] })
    : requireAuth()
  const openSync = (candidate) => session ? setModal({ type: 'sync', candidate }) : requireAuth()
  const title = viewTitles[view]

  const clearLocalWorkspace = () => { setSession(null); setSelected(null); setSelectedEmployee(null); setMessages([]) }
  const handleLogout = async () => {
    try { await signOut() } catch { /* 会话可能已过期，照常清理本地 */ }
    setAdminMode(false)
    clearLocalWorkspace()
    await refresh(null)
    notify('已退出，返回演示工作区')
  }
  // 切换账号：退出当前会话后重新走一遍授权。
  // 注意：授权中继不支持强制重选账号的参数（加了会报 invalid state），
  // 如果授权页自动回到上一个账号，用无痕窗口打开本页登录即可换号。
  const handleSwitchAccount = async () => {
    const proceed = window.confirm('切换账号：将退出当前账号并重新登录。\n\n如果授权页面自动跳回当前账号，请复制浏览器地址栏链接，用无痕（隐私）窗口打开后登录另一个账号。')
    if (!proceed) return
    try { await signOut() } catch { /* 同上 */ }
    setAdminMode(false)
    clearLocalWorkspace()
    try { await signIn() } catch (error) { notify(displayError(error), 'error') }
  }

  // 渲染指定视图（不看当前 view）——所有视图常驻挂载，切栏目只隐藏不卸载，
  // 这样各视图内部的表单/筛选/队列状态都留在原地，切回来可以继续改。
  const renderView = (viewName) => {
    switch (viewName) {
      case 'dashboard':
        return <Dashboard jobs={scopedJobs} candidates={scopedCandidates} events={events} integration={integration} onOpen={handleOpenCandidate} onView={setView} onEvaluate={openEvaluate} />
      case 'pipeline':
        return <Pipeline jobs={scopedJobs} candidates={scopedCandidates} recordsById={interviewsByCandidate} onOpen={handleOpenCandidate} onMove={handleMove} onSchedule={openSchedule} readOnly={adminMode} notify={notify} />
      case 'people':
        return (
          <PeopleView
            jobs={scopedJobs}
            candidates={scopedCandidates}
            surveys={surveys}
            session={session}
            interviewRecords={interviewRecords}
            onOpen={handleOpenCandidate}
            onLogin={requireAuth}
            onDelete={handleDeleteCandidate}
            onDeleteMany={handleDeleteCandidates}
            onChangeJob={handlePeopleChangeJob}
            adminMode={adminMode}
            ownerNames={displayNames}
            notify={notify}
          />
        )
      case 'surveys':
        return <SurveysView surveys={surveys} jobs={scopedJobs} session={session} onNew={openNewSurvey} onEdit={(survey) => setSurveyDraft(survey)} onResults={openSurveyResults} onDelete={handleDeleteSurvey} onRefresh={refresh} notify={notify} onLogin={requireAuth} />
      case 'jobs':
        return <Jobs jobs={scopedJobs} candidates={scopedCandidates} onAdd={() => guarded(() => setModal({ type: 'job' }))} onEditJd={(job) => guarded(() => setJdJob(job))} onEditFull={(job) => guarded(() => setModal({ type: 'job', job }))} onDelete={handleDeleteJob} />
      case 'interviews':
        return <Interviews candidates={scopedCandidates} recordsById={interviewsByCandidate} readOnly={adminMode} onOpen={handleOpenCandidate} onSchedule={openSchedule} onDeleteRecord={handleDeleteInterviewFromTable} onDeleteAll={handleDeleteAllInterviews} />
      case 'funnel':
        return <FunnelView jobs={scopedJobs} candidates={scopedCandidates} funnelEvents={funnelEvents} onView={setView} />
      case 'messages':
        return <MessagesView messages={messages} session={session} onOpenMessage={handleOpenMessage} onMarkAll={handleMarkAllRead} onDelete={handleDeleteMessage} onClearRead={handleClearRead} />
      case 'integration':
        return <IntegrationView integration={integration} candidates={scopedCandidates} employees={employees} onSync={openSync} onRefresh={refreshIntegration} loading={integrationLoading} onConfigure={handleConfigureHorilla} onClear={handleClearHorilla} saving={integrationSaving} onOpenEmployee={openEmployee} onExportAll={handleExportAll} />
      case 'batch':
        return <BatchImportView jobs={scopedJobs} surveys={surveys} session={session} onLogin={requireAuth} onFinished={refresh} onBound={bindSurveyFor} onSaveProfile={handleBatchProfileSave} onChangeJob={handleChangeCandidateJob} notify={notify} />
      case 'ledger':
        return <LedgerView candidates={scopedCandidates} jobs={scopedJobs} surveys={surveys} responses={ledgerResponses} recordsById={interviewsByCandidate} session={session} adminMode={adminMode} onSave={handleLedgerSave} onOpen={handleOpenCandidate} onLogin={requireAuth} notify={notify} onExport={handleLedgerExport} />
      case 'account':
        return <UserCenterView session={session} profile={profile} onSaveProfile={handleSaveProfile} saving={savingProfile} isAdminAccount={isAdminAccount} adminMode={adminMode} onUnlockAdmin={handleUnlockAdmin} onExitAdmin={handleExitAdmin} onSwitchAccount={handleSwitchAccount} onLogout={handleLogout} notify={notify} jobs={jobs} displayNames={displayNames} jobShares={jobShares} sharesBusy={sharesBusy} onCreateShare={handleCreateShare} onDeleteShare={handleDeleteShare} />
      default:
        return null
    }
  }

  if (activeInviteToken) return <SurveyFillPage inviteToken={activeInviteToken} />

  if (loading) return <div className="app-loading"><BrandMark size="lg" /><LoaderCircle className="spin" size={24} /><p>正在准备聘桥工作区</p></div>

  // 无权限账号拦截：填问卷的人用自己的账号登录后台时会落到这里。
  if (!hasWorkspaceAccess) return <NoAccessPage session={session} onLogout={handleLogout} onSwitchAccount={handleSwitchAccount} />

  return (
    <div className="app-shell">
      <Sidebar view={view} onChange={setView} session={session} onLogin={() => setModal({ type: 'login' })} onLogout={handleLogout} adminMode={adminMode} mobileOpen={mobileNav} onClose={() => setMobileNav(false)} unreadCount={unreadCount} />
      {mobileNav && <button type="button" className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
      <main className="main-shell">
        <Topbar title={title} onEvaluate={openEvaluate} onMenu={() => setMobileNav(true)} session={session} messages={messages} unreadCount={unreadCount} onOpenMessage={handleOpenMessage} onViewMessages={() => setView('messages')} onMarkAllRead={handleMarkAllRead} />
        <div className="main-content">
          {VIEW_KEYS.map((viewName) => (
            <div key={viewName} className={classNames('view-pane', viewName === view && 'view-pane-active')} hidden={viewName !== view}>
              {renderView(viewName)}
            </div>
          ))}
        </div>
      </main>
      {jdJob && <JobJdDrawer job={scopedJobs.find((job) => job.id === jdJob.id) || jdJob} session={session} notify={notify} onClose={() => setJdJob(null)} onSaved={handleJdSaved} onLogin={requireAuth} />}
      {surveyDraft && <SurveyDesigner survey={surveyDraft.id ? surveyDraft : null} jobs={scopedJobs} saving={surveyBusy} onSave={handleSaveSurvey} onClose={() => setSurveyDraft(null)} notify={notify} />}
      {surveyResult && <SurveyResultsDrawer survey={surveyResult.survey} responses={surveyResult.responses} loading={responsesLoading} onClose={() => setSurveyResult(null)} onExport={() => exportSurveyResponsesXlsx(surveyResult.survey, surveyResult.responses)} />}
      {selected && <CandidateDrawer candidate={candidates.find((c) => c.id === selected.id) || selected} events={events} scoringHistory={scoringHistory} evaluating={evaluatingId === selected.id} onEvaluate={handleEvaluateCandidate} inviteEntry={inviteEntryState} onCopyInvite={async (entry) => { try { await navigator.clipboard.writeText(entry.url); notify('评测链接已复制') } catch (error) { notify(displayError(error), 'error') } }} onResetSurvey={() => setResetSurveyTarget(selected)} resettingSurvey={resettingSurvey} onDelete={handleDeleteCandidate} onSaveProfile={handleUpdateProfile} savingProfile={savingProfile} onClose={() => setSelected(null)} onMove={handleMove} onSchedule={openSchedule} onSync={openSync} onDownload={handleDownload} onDownloadAttachment={handleDownloadCandidateAttachment} downloading={downloading} interviewRecords={interviewsByCandidate.get(String(selected.id)) || []} readOnly={adminMode} />}
      {selectedEmployee && <EmployeeDrawer employee={employees.find((e) => e.id === selectedEmployee.id) || selectedEmployee} onClose={() => setSelectedEmployee(null)} onSave={handleSaveEmployee} onUpload={handleUploadAttachment} onDownloadAttachment={handleDownloadAttachment} onRemoveAttachment={handleRemoveAttachment} onExport={handleExportEmployee} saving={employeeSaving} />}
      {modal?.type === 'evaluate' && <EvaluateModal jobs={jobs} onClose={() => setModal(null)} onSubmit={handleEvaluate} running={actionLoading} step={evaluateStep} onEditJd={(job) => { setModal(null); setJdJob(job) }} />}
      {modal?.type === 'job' && <JobWizard job={modal.job || null} jobs={jobs} session={session} onClose={() => setModal(null)} onSubmit={handleSaveJobFull} running={actionLoading} notify={notify} onLogin={requireAuth} />}
      {modal?.type === 'interview' && <InterviewModal candidate={modal.candidate} initialRound={modal.round} records={modal.records || []} readOnly={adminMode} onClose={() => setModal(null)} onSubmit={handleSaveInterview} onDelete={handleDeleteInterview} running={actionLoading} />}
      {modal?.type === 'sync' && <SyncModal candidate={modal.candidate} integration={integration} onClose={() => setModal(null)} onConfirm={handleSync} running={actionLoading} />}
      {modal?.type === 'login' && <LoginModal onClose={() => { if (!actionLoading) setModal(null) }} loading={actionLoading} onLogin={async () => { setActionLoading(true); try { await signIn() } catch (error) { notify(displayError(error), 'error'); setActionLoading(false) } }} />}
      {resetSurveyTarget && <ConfirmDialog
        title="刷新问卷"
        message={`确认刷新「${resetSurveyTarget.name}」的问卷？`}
        points={[
          '该候选人已提交的问卷答案将被清除，问卷得分归零',
          '综合分中的问卷模块将变为「待补全」，只保留 AI 评估部分的得分',
          '专属测评链接恢复为可填写状态，候选人需重新提交一次',
          '评分历史会保留刷新前的记录，作为审计留痕',
        ]}
        confirmText="确认刷新"
        danger
        running={resettingSurvey}
        onConfirm={handleConfirmResetSurvey}
        onClose={() => { if (!resettingSurvey) setResetSurveyTarget(null) }}
      />}
      {toast && <div className={`toast toast-${toast.tone}`}>{toast.tone === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button onClick={() => setToast(null)}><X size={15} /></button></div>}
      {undoState && <div className="undo-bar" role="alertdialog" aria-live="assertive">
        <span className="undo-bar-icon"><Trash2 size={17} /></span>
        <div className="undo-bar-body"><strong>已安排删除：{undoState.label}</strong><span>{undoState.left} 秒后执行，届时评估与问卷记录一并清除</span></div>
        <div className="undo-bar-progress"><i style={{ width: `${(undoState.left / undoState.seconds) * 100}%` }} /></div>
        <button type="button" className="undo-bar-btn" onClick={cancelDelete}><Undo2 size={15} />撤销</button>
      </div>}
    </div>
  )
}
