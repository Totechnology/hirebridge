// 简历文本提取的纯函数：不依赖云服务和浏览器，便于测试。
// 针对智联招聘等模板化 PDF，优先用版面坐标和明确标签提取；
// 找不到就留空，避免把栏目文字或推断值写进候选人档案。

const CJK = '\\u4e00-\\u9fa5'
const NAME_RE = `[${CJK}·]{2,4}`

export const NAME_STOPWORDS = new Set([
  '个人简历', '求职简历', '简历', '基本信息', '个人信息', '自我评价', '联系方式', '求职意向',
  '教育背景', '工作经历', '项目经历', '专业技能', '应聘职位', '应聘企业', '工作地点', '扫码获取',
  '人才最新', '最新简历', '点击此处', '联系候选人', '智联招聘', '招聘', '下载', '应聘', '应聘客户', '岗位', '职位', '经理',
])

const CITY_PATTERN = '北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|苏州|天津|长沙|郑州|青岛|南京|合肥|福州|厦门|昆明|贵阳|南宁|海口|兰州|银川|西宁|乌鲁木齐|沈阳|大连|哈尔滨|长春|石家庄|太原|济南|南昌'

function itemX(item) {
  return Number(item?.transform?.[4] ?? item?.x ?? 0) || 0
}

function itemY(item) {
  return Number(item?.transform?.[5] ?? item?.y ?? 0) || 0
}

function itemWidth(item) {
  return Number(item?.width ?? String(item?.str ?? '').length * 8) || 0
}

// pdf.js 的 content.items 保留坐标但通常已经失去“行”的关系。
// 这里按基线 y 坐标分行、同一行按 x 坐标排序；只有字间空隙足够大才补空格，
// 避免旧实现把整页文本机械 join 成一长串，导致栏目串行。
export function reconstructPdfPageText(items = []) {
  const rows = []
  for (const item of items) {
    const text = String(item?.str ?? '')
    if (!text.trim()) continue
    const y = itemY(item)
    let row = rows.find((entry) => Math.abs(entry.y - y) <= 2.5)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }

  rows.sort((a, b) => b.y - a.y)
  return rows.map((row) => {
    row.items.sort((a, b) => itemX(a) - itemX(b))
    let output = ''
    let previousEnd = null
    for (const item of row.items) {
      const text = String(item.str ?? '')
      const x = itemX(item)
      if (output && previousEnd !== null && x - previousEnd > 2) output += ' '
      output += text
      previousEnd = x + itemWidth(item)
    }
    return output.trim()
  }).filter(Boolean).join('\n')
}

function safeName(value) {
  const name = String(value || '').trim()
  if (!name || NAME_STOPWORDS.has(name)) return ''
  if (name.endsWith('的简历') || name.endsWith('个人简历')) return ''
  return name
}

// 文件名只作为兜底。候选人文件名可能叫“张三_智联招聘.pdf”，
// 也可能叫“应聘客户经理.pdf”；因此必须剔除岗位/平台词。
export function extractNameFromFilename(filename = '') {
  const base = String(filename).replace(/\.[^.]+$/, '')
  const candidates = base.match(new RegExp(NAME_RE, 'g')) || []
  for (const raw of candidates.reverse()) {
    const name = safeName(raw)
    if (name && !NAME_STOPWORDS.has(name)) return name
  }
  return ''
}

export function extractContactFields(text, filename = '') {
  const source = String(text || '')

  // 完整手机号才提取。平台导出的 158****3920 / 158****3920 这类掩码号必须留空，
  // 后续由候选人问卷提交完整手机号后自动回填。
  const phone = source.match(/(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d{9})(?!\d)/)?.[1] || ''
  const phoneMasked = !phone && /(?<!\d)1[3-9]\d[*＊]{4}\d{4}(?!\d)/.test(source)
  const email = source.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || ''

  let name = ''
  // 明确标签：姓名：张三 / 候选人姓名：张三
  const labeled = source.match(new RegExp(`(?:姓\\s*名|候选人姓\\s*名)\\s*[:：]\\s*(${NAME_RE})`))
  if (labeled) name = safeName(labeled[1])

  // 智联招聘模板：姓名在同一行，后面紧跟“点击此处联系候选人”。
  if (!name) {
    const zhilian = source.match(new RegExp(`(?:^|[\\s\\n])(${NAME_RE})(?=\\s*点击此处联系候选人)`))
    if (zhilian) name = safeName(zhilian[1])
  }

  // 通用模板：张三 的简历 / 张三 求职简历。
  if (!name) {
    const titled = source.match(new RegExp(`(?:^|[\\s\\n])(${NAME_RE})(?=\\s*(?:的)?(?:个人)?求职?简历)`))
    if (titled) name = safeName(titled[1])
  }

  // 不再从简历开头随手抓“前 2～4 个汉字”——那会把“扫码获取”“应聘职位”等误当姓名。
  if (!name) name = extractNameFromFilename(filename)

  let location = ''
  // 只把明确表达“目前居住地”的标签当现居地；不能把工作地点、期望城市混进去。
  const byLabel = source.match(new RegExp(`(?:现居地|现居住地|常住地|目前所在地|当前所在地)\\s*[:：]?\\s*([^\\s|｜,，;；]{2,12})`))
  if (byLabel) location = byLabel[1]
  if (!location) {
    const knownCity = source.match(new RegExp(`(?:^|[\\s|｜,，;；])(${CITY_PATTERN})(?:市)?(?=[\\s|｜,，;；]|$)`))
    if (knownCity) location = knownCity[1]
  }

  return { name, phone, phoneMasked, email, location }
}

// 智联招聘 PDF 的基本信息行有稳定版式：
//   男 | 30岁(1998年6月) | 6年 | 本科 | 离职-正在找工作
//   现居住地：成都 | 户口：红河 | 政治面貌：群众
// 这些字段不再交给模型猜，直接按原文提取；模型只补学校、专业等剩余字段。
export function extractZhaopinProfileHints(text) {
  const source = String(text || '')
  const hints = { gender: null, age: null, education: null, current_city: null }
  if (!source.includes('智联招聘')) return hints

  const basic = source.match(new RegExp(`(?:^|[\\s\\n])(男|女)\\s*[|｜]\\s*(\\d{1,2})岁[^\\n|｜]*[|｜][^\\n|｜]*[|｜]\\s*(博士|硕士研究生?|本科|大专|高中|中专|初中)\\s*[|｜]`))
  if (basic) {
    hints.gender = basic[1]
    hints.age = Number(basic[2])
    hints.education = basic[3] === '硕士研究生' ? '硕士' : basic[3]
  }

  const city = source.match(/现居住地\s*[:：]?\s*([^\s|｜,，;；]{2,12})/)
  if (city) hints.current_city = city[1]
  return hints
}

const EDUCATION_ALIASES = new Map([
  ['硕士研究生', '硕士'], ['研究生', '硕士'], ['大学专科', '大专'], ['专科', '大专'],
])

function normalizeEducation(value) {
  const education = String(value || '').trim()
  if (!education) return null
  return EDUCATION_ALIASES.get(education) || education
}

// 模型输出兜底清洗：宁可置空，也不要把明显不是该字段的内容写进台账。
export function normalizeExtractedProfile(profile = {}, sourceText = '') {
  const out = { ...profile }

  out.gender = ['男', '女'].includes(out.gender) ? out.gender : null
  const age = parseInt(String(out.age ?? '').replace(/[^0-9]/g, ''), 10)
  out.age = Number.isFinite(age) && age >= 16 && age <= 70 ? age : null
  out.education = normalizeEducation(out.education)

  const city = String(out.current_city || '').trim()
  out.current_city = city && city.length <= 10 && !/(大厦|公司|集团|学校|大学|学院|中心|职位|岗位)/.test(city) ? city : null

  const school = String(out.school || '').trim()
  out.school = school && /(大学|学院|学校|中学|职业技术学院|高等专科学校|University|College)/i.test(school) ? school : null

  const salary = String(out.current_salary || '').trim()
  // 目前薪资必须是原文明确值；模型不得用“期望薪资/求职意向薪资”顶替。
  if (!salary || /(期望|意向|面议)/.test(salary)) out.current_salary = null

  for (const key of ['major', 'skill_certs']) {
    const value = String(out[key] || '').trim()
    out[key] = value ? value.slice(0, 200) : null
  }

  return out
}

export function mergeZhaopinHints(profile, hints) {
  const out = { ...profile }
  for (const key of ['gender', 'age', 'education', 'current_city']) {
    if (hints?.[key] != null && hints[key] !== '') out[key] = hints[key]
  }
  return out
}
