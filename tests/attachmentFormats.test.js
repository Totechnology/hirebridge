import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import * as XLSX from 'xlsx'
import {
  ATTACHMENT_ACCEPT,
  attachmentContentType,
  extractAttachmentText,
  fileExtension,
  isSupportedAttachment,
} from '../src/services.js'

// 构造最小 zip：只放一个 word/document.xml，用来验证 docx 解析分支
function buildDocx(xml) {
  const name = Buffer.from('word/document.xml', 'utf8')
  const raw = Buffer.from(xml, 'utf8')
  const compressed = zlib.deflateRawSync(raw)
  const crc = zlib.crc32 ? zlib.crc32(raw) : crc32(raw)

  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)          // version needed
  local.writeUInt16LE(0, 6)           // flags
  local.writeUInt16LE(8, 8)           // method: deflate
  local.writeUInt16LE(0, 10)          // time
  local.writeUInt16LE(0, 12)          // date
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  name.copy(local, 30)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42)
  name.copy(central, 46)

  const centralOffset = local.length + compressed.length
  const body = Buffer.concat([local, compressed, central])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  return new Uint8Array(Buffer.concat([body, end]))
}

function crc32(buf) {
  let crc = ~0
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

const RESUME_TEXT = '姓名：李文静\n手机号：13800001234\n邮箱：liwenjing@example.com\n学历：本科\n毕业院校：四川大学'

test('扩展名与支持性判断', () => {
  assert.equal(fileExtension('简历.PDF'), '.pdf')
  assert.equal(fileExtension('a/b/张三简历.docx'), '.docx')
  assert.equal(fileExtension('没有扩展名'), '')

  for (const name of ['a.pdf', 'a.doc', 'a.docx', 'a.txt', 'a.xls', 'a.xlsx']) {
    assert.equal(isSupportedAttachment({ name }), true, name)
  }
  assert.equal(isSupportedAttachment({ name: 'a.zip' }), false)
  assert.equal(isSupportedAttachment({ name: 'a.pdf' }), true)

  assert.ok(ATTACHMENT_ACCEPT.includes('.xlsx'))
  assert.equal(attachmentContentType({ name: 'a.docx' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(attachmentContentType({ name: 'a.txt' }), 'text/plain')
  assert.equal(attachmentContentType({ name: 'a.pdf' }), 'application/pdf')
})

test('TXT 附件能提取出正文', async () => {
  const file = new File([RESUME_TEXT], '李文静简历.txt', { type: 'text/plain' })
  const text = await extractAttachmentText(file)
  assert.ok(text.includes('李文静'))
  assert.ok(text.includes('13800001234'))
})

test('EXCEL 附件按 sheet 转成文本', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['姓名', '手机号', '学历'],
    ['李文静', '13800001234', '本科'],
  ])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '候选人')
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  const file = new File([buffer], '简历表.xlsx')
  const text = await extractAttachmentText(file)
  assert.ok(text.includes('李文静'))
  assert.ok(text.includes('本科'))
})

test('DOCX 附件能提取出正文', async () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>姓名：李文静</w:t></w:r></w:p><w:p><w:r><w:t>学历：本科</w:t></w:r></w:p></w:body></w:document>'
  const file = new File([buildDocx(xml)], '李文静简历.docx')
  const text = await extractAttachmentText(file)
  assert.ok(text.includes('李文静'))
  assert.ok(text.includes('本科'))
})

test('旧版 DOC 走启发式扫描，不抛错并能捞到中文正文', async () => {
  const payload = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from('李文静 简历 学历本科 四川大学 13800001234', 'utf16le'),
  ])
  const file = new File([payload], '李文静简历.doc')
  const text = await extractAttachmentText(file)
  assert.ok(text.includes('李文静'), `实际提取：${text.slice(0, 120)}`)
})

test('不支持的格式给出明确报错', async () => {
  await assert.rejects(
    () => extractAttachmentText(new File(['x'], 'resume.zip')),
    /仅支持/,
  )
})
