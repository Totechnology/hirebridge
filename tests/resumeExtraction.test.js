import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractContactFields,
  extractNameFromFilename,
  extractZhaopinProfileHints,
  mergeZhaopinHints,
  normalizeExtractedProfile,
  reconstructPdfPageText,
} from '../src/resumeExtraction.js'

const zhilianText = [
  '智联招聘',
  '徐子 点击此处联系候选人',
  '应聘职位：资金管理岗',
  '手机：158****3920',
  '男 | 30岁(1998年6月) | 6年 | 本科 | 离职-正在找工作',
  '现居住地：成都 | 户口：红河 | 政治面貌：群众',
].join('\n')

test('PDF 坐标重建：按视觉行和从左到右恢复，不把整页拼成一串', () => {
  const text = reconstructPdfPageText([
    { str: '男', transform: [1, 0, 0, 1, 120, 180], width: 16 },
    { str: '|', transform: [1, 0, 0, 1, 150, 180], width: 6 },
    { str: '30岁', transform: [1, 0, 0, 1, 170, 180], width: 34 },
    { str: '徐子', transform: [1, 0, 0, 1, 230, 300], width: 34 },
    { str: '点击此处联系候选人', transform: [1, 0, 0, 1, 290, 300], width: 110 },
  ])
  assert.equal(text, '徐子 点击此处联系候选人\n男 | 30岁')
})

test('智联招聘姓名提取：抓真实姓名，不把栏目文字当姓名', () => {
  const fields = extractContactFields(zhilianText, '徐子_智联招聘.pdf')
  assert.equal(fields.name, '徐子')
  assert.equal(fields.phone, '', '平台掩码手机号必须留空')
  assert.equal(fields.phoneMasked, true, '平台掩码手机号应标记为待问卷回填')
  assert.equal(fields.location, '成都')
})

test('智联招聘基本信息：性别、年龄、学历、现居城市按原文确定性提取', () => {
  const hints = extractZhaopinProfileHints(zhilianText)
  assert.deepEqual(hints, { gender: '男', age: 30, education: '本科', current_city: '成都' })
})

test('模型字段清洗：明显不属于字段的内容置空', () => {
  const cleaned = normalizeExtractedProfile({
    gender: '未知',
    age: 188,
    education: '硕士研究生',
    school: '工商管理',
    major: '客户经理',
    skill_certs: '会计工作、账务工作',
    current_salary: '期望 1.5万-3万/月',
    current_city: '天府法务产业大厦',
  })
  assert.equal(cleaned.gender, null)
  assert.equal(cleaned.age, null)
  assert.equal(cleaned.education, '硕士')
  assert.equal(cleaned.school, null, '专业不能写成学校')
  assert.equal(cleaned.current_salary, null, '期望薪资不能当作目前薪资')
  assert.equal(cleaned.current_city, null, '工作地点/大厦不能当作现居城市')
})

test('智联招聘确定性字段优先于模型结果', () => {
  const merged = mergeZhaopinHints(
    { gender: '女', age: 25, education: '大专', current_city: '上海' },
    { gender: '男', age: 30, education: '本科', current_city: '成都' },
  )
  assert.deepEqual(merged, { gender: '男', age: 30, education: '本科', current_city: '成都' })
})

test('文件名兜底只取姓名，不取平台词和岗位词', () => {
  assert.equal(extractNameFromFilename('徐子_智联招聘.pdf'), '徐子')
  assert.equal(extractNameFromFilename('应聘客户经理.pdf'), '')
  assert.equal(extractNameFromFilename('张三-个人简历.pdf'), '张三')
})
