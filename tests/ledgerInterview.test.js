import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLedgerRows } from '../src/services.js'

const stageLabel = (id) => ({ screening: '简历筛选', interview: '面试中', offer: 'Offer' }[id] || id || '')

const rows = [
  { id: 1, name: '张三', role_title: '前端', stage: 'interview' },
  { id: 2, name: '李四', role_title: '销售', stage: 'screening' },
]

test('台账面试列：按一面/二面分列，是否接受面试取已填值', () => {
  const records = [
    { candidate_id: 1, round: '一面', accepted: '接受', attended: '已参面', interview_at: '2026-11-19T10:30:00Z', format: '视频', result: '通过' },
    { candidate_id: 1, round: '二面', attended: '未参面', format: '现场', result: '未通过' },
    { candidate_id: 2, round: '一面', accepted: '拒绝', attended: '未参面', note: '候选人改期' },
  ]
  const data = buildLedgerRows(rows, [], new Map(), stageLabel, records)
  const a = data[0]
  assert.equal(a['是否接受面试'], '接受', '取一面的接受值')
  assert.equal(a['一面·是否参面'], '已参面')
  assert.equal(a['一面·形式'], '视频')
  assert.equal(a['一面·结果'], '通过')
  assert.ok(a['一面·面试时间'].startsWith('2026-11-19 10:30'), '时间转成可读格式')
  assert.equal(a['二面·是否参面'], '未参面')
  assert.equal(a['二面·形式'], '现场')
  assert.equal(a['二面·结果'], '未通过')
  assert.equal(a['二面·面试时间'], '', '二面没填时间则留空')

  const b = data[1]
  assert.equal(b['是否接受面试'], '拒绝')
  assert.equal(b['一面·是否参面'], '未参面')
  assert.equal(b['面试备注'], '一面：候选人改期')
  assert.equal(b['二面·结果'], '', '没有二面记录，二面列留空')
})

test('台账面试列：无面试记录时所有面试列留空', () => {
  const data = buildLedgerRows(rows, [], new Map(), stageLabel, [])
  assert.equal(data[0]['是否接受面试'], '')
  assert.equal(data[0]['一面·是否参面'], '')
  assert.equal(data[0]['二面·结果'], '')
  assert.ok(!('面试备注' in data[0]), '没有备注时不生成该列')
})

test('台账面试列：接受值只填在二面时也能带到是否接受面试列', () => {
  const records = [{ candidate_id: 1, round: '二面', accepted: '接受', result: '通过' }]
  const data = buildLedgerRows(rows, [], new Map(), stageLabel, records)
  assert.equal(data[0]['是否接受面试'], '接受')
  assert.equal(data[0]['二面·结果'], '通过')
})
