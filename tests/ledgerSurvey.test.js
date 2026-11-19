import test from 'node:test'
import assert from 'node:assert/strict'
import { ledgerSurveyData } from '../src/services.js'

// 模拟会计岗问卷：两道自定义题 + 末尾档案题
const surveys = [
  {
    id: 1,
    questions: [
      { id: 'q_marry', type: 'single', title: '婚育情况', options: [] },
      { id: 'q_travel', type: 'single', title: '对出差的接受程度', options: [] },
      { id: 'q_nobody', type: 'single', title: '无人作答的题', options: [] },
      { id: 'pf_consent', profile: true, title: '是否同意被系统留档', options: [] },
      { id: 'pf_id_number', profile: true, title: '身份证号码' },
    ],
  },
]

const detail = [
  { id: 'q_marry', title: '婚育情况', answer: '已婚已育' },
  { id: 'q_travel', title: '对出差的接受程度', answer: '可接受每月出差 1-2 周' },
  { id: 'pf_id_number', title: '身份证号码', answer: '510123199806010011' },
  { id: 'pf_consent', title: '是否同意被系统留档', answer: '同意' },
]

test('台账动态列：自定义问卷题生成列，档案题排除，未作答题不出列', () => {
  const responses = [{ candidate_id: 101, survey_id: 1, detail, submitted_at: '2026-11-18T10:00:00Z' }]
  const { columns, answersByCandidate } = ledgerSurveyData(responses, surveys)
  assert.deepEqual(columns, ['婚育情况', '对出差的接受程度'], '列按问卷题序，档案题与未作答题不出现')
  const answers = answersByCandidate.get('101')
  assert.equal(answers['婚育情况'], '已婚已育')
  assert.equal(answers['对出差的接受程度'], '可接受每月出差 1-2 周')
  assert.ok(!('身份证号码' in answers), '档案题答案已有固定列，不进动态列')
})

test('台账动态列：空答案不出列，未作答候选人查不到映射', () => {
  const responses = [
    { candidate_id: 201, survey_id: 1, detail: [{ id: 'q_marry', title: '婚育情况', answer: '  ' }], submitted_at: '2026-11-18T10:00:00Z' },
  ]
  const { columns, answersByCandidate } = ledgerSurveyData(responses, surveys)
  assert.deepEqual(columns, [], '只有空白答案的题不应生成列')
  assert.equal(answersByCandidate.size, 0)
})

test('台账动态列：同一候选人多次提交取最新一次', () => {
  const responses = [
    { candidate_id: 301, survey_id: 1, detail: [{ id: 'q_marry', title: '婚育情况', answer: '未婚' }], submitted_at: '2026-11-17T10:00:00Z' },
    { candidate_id: 301, survey_id: 1, detail, submitted_at: '2026-11-18T10:00:00Z' },
  ]
  const { answersByCandidate } = ledgerSurveyData(responses, surveys)
  assert.equal(answersByCandidate.get('301')['婚育情况'], '已婚已育', '应取最新一次提交的答案')
})

test('台账动态列：同一题名跨问卷合并为一列', () => {
  const salesSurvey = { id: 2, questions: [{ id: 'q2_marry', type: 'single', title: '婚育情况', options: [] }] }
  const responses = [
    { candidate_id: 101, survey_id: 1, detail, submitted_at: '2026-11-18T10:00:00Z' },
    { candidate_id: 401, survey_id: 2, detail: [{ id: 'q2_marry', title: '婚育情况', answer: '未婚未育' }], submitted_at: '2026-11-18T11:00:00Z' },
  ]
  const { columns, answersByCandidate } = ledgerSurveyData(responses, [...surveys, salesSurvey])
  assert.equal(columns.filter((t) => t === '婚育情况').length, 1, '同题名只保留一列')
  assert.equal(answersByCandidate.get('101')['婚育情况'], '已婚已育')
  assert.equal(answersByCandidate.get('401')['婚育情况'], '未婚未育')
})

test('台账动态列：问卷缺失时按作答出现顺序兜底', () => {
  const responses = [{ candidate_id: 501, survey_id: 9, detail, submitted_at: '2026-11-18T10:00:00Z' }]
  const { columns } = ledgerSurveyData(responses, [])
  assert.deepEqual(columns, ['婚育情况', '对出差的接受程度'], '无 surveys 时按 detail 顺序兜底')
})
