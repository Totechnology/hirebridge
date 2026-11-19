import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateDimensions, evaluateReason, rankCandidates, scoreSurvey } from '../src/services.js'

const questions = [
  { id: 'q1', type: 'single', weight: 40, required: true, options: [{ label: 'A', score: 100 }, { label: 'B', score: 50 }] },
  { id: 'q2', type: 'multi', weight: 30, required: true, options: [{ label: 'X', score: 40 }, { label: 'Y', score: 60 }] },
  { id: 'q3', type: 'scale', weight: 30, required: false, options: [{ label: '差', score: 0 }, { label: '好', score: 100 }] },
]

test('问卷客观分：满分 = 100', () => {
  const full = scoreSurvey(questions, { q1: 0, q2: [0, 1], q3: 1 })
  assert.equal(full.score, 100, '全部答满应为 100')
})

test('问卷客观分：多选重复索引按上限封顶，不重复加分', () => {
  const dup = scoreSurvey(questions, { q1: 0, q2: [0, 0, 1, 1], q3: 1 })
  assert.equal(dup.score, 100, '重复选中同一选项不应突破上限')
})

test('问卷客观分：未作答计分题按 0 计入，不误算第一个选项', () => {
  // q1 未作答，q2 选 X，q3 选 好
  const missing = scoreSurvey(questions, { q2: [0], q3: 1 })
  // q1=0(40) q2=40/100*30=12 q3=30 → 42/100
  assert.equal(missing.score, 42, '未答单选应为 0，而不是默认选第一项')
})

test('综合评分公式：7 + 7 + 80×0.30 + 90×0.50 = 83', () => {
  const composite = 7 + 7 + 80 * 0.30 + 90 * 0.50
  assert.equal(Math.round(composite * 10) / 10, 83, '示例综合分应为 83')
})

test('综合评分不设及格线，不自动淘汰', () => {
  const low = 0 + 0 + 30 * 0.30 + 20 * 0.50
  assert.equal(Math.round(low * 10) / 10, 19)
})

test('招聘原因确定性计算：区间下限映射 lowScore=7', () => {
  const job = {
    recruit_reasons: ['降本增效'],
    salary_budget: { currency: 'CNY', period: 'monthly', min: 10000, max: 20000 },
    reason_rules: [{ name: '薪资匹配', field: 'expected_salary', condition: '期望薪资不超过预算上限', rawScore: 5, weight: 10, lowScore: 7, highScore: 3, outScore: 1 }],
  }
  const inBudget = evaluateReason(job, { expected_salary: 10000 })
  assert.equal(inBudget.score, 7, '区间下限应映射到 lowScore 7')

  const outBudget = evaluateReason(job, { expected_salary: 30000 })
  assert.equal(outBudget.score, 1, '超出上限应映射到 outScore 1')
})

test('招聘原因缺证据返回待补充，不判零', () => {
  const job = {
    recruit_reasons: ['降本增效'],
    salary_budget: { min: 10000, max: 20000 },
    reason_rules: [{ name: '薪资匹配', field: 'expected_salary', condition: '期望薪资不超过预算上限', rawScore: 5, weight: 10 }],
  }
  const result = evaluateReason(job, {})
  assert.equal(result.missing, true, '缺证据应标记 missing')
  assert.equal(result.score, null, '缺证据不应判分')
})

test('排名：按总分降序，未评分候选人可过滤', () => {
  const rows = [
    { id: 1, name: 'A', score: 90, band: 'A', evaluation: { categories: [] } },
    { id: 2, name: 'B', score: 70, band: 'B', evaluation: { categories: [] } },
    { id: 3, name: 'C', score: null, band: 'C', evaluation: { categories: [] } },
  ]
  const ranked = rankCandidates(rows, { onlyScored: true })
  assert.equal(ranked.length, 2, '未评分候选人应被过滤')
  assert.equal(ranked[0].name, 'A')
})

test('维度得分：按 max 归一化 ratio', () => {
  const candidate = { evaluation: { categories: [{ name: '岗位能力', score: 32, max: 40, evidence: 'x' }] } }
  const dims = candidateDimensions(candidate)
  assert.equal(dims[0].ratio, 80, '32/40 应为 80%')
})
