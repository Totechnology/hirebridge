import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { extractAttachmentText } from '../src/services.js'

// 通用 zip 构造器：支持多条目、stored/deflate 两种压缩方式，
// 以及「本地文件头尺寸为 0」的数据描述符模式（部分 Office 生成器会这么写）。
function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const method = entry.method ?? 8
    const body = method === 0 ? raw : zlib.deflateRawSync(raw)
    const crc = crc32(raw)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.dataDescriptor ? 0 : body.length, 18)
    local.writeUInt32LE(entry.dataDescriptor ? 0 : raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, centralBuf, end]))
}

function crc32(buf) {
  let crc = ~0
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>姓名：李文静</w:t></w:r></w:p>
<w:p><w:r><w:t>手机号：13800001234</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>学历</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>本科</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>毕业院校</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>四川大学</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`

test('真实结构的 docx（多条目）能提取正文', async () => {
  const zip = buildZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0"?><Relationships/>' },
    { name: 'word/styles.xml', data: '<?xml version="1.0"?><w:styles><w:style w:styleId="Normal"/></w:styles>' },
    { name: 'word/document.xml', data: DOC_XML },
  ])
  const text = await extractAttachmentText(new File([zip], '李文静简历.docx'))
  assert.ok(text.includes('李文静'), `实际：${text.slice(0, 200)}`)
  assert.ok(text.includes('13800001234'))
  assert.ok(text.includes('本科'))
  assert.ok(text.includes('四川大学'))
  // 样式表里的内容不该混进正文
  assert.ok(!text.includes('Normal'))
})

test('本地文件头尺寸为 0（数据描述符模式）也能解出正文', async () => {
  const zip = buildZip([
    { name: 'word/styles.xml', data: '<w:styles/>' },
    { name: 'word/document.xml', data: DOC_XML, dataDescriptor: true },
  ])
  const text = await extractAttachmentText(new File([zip], '李文静简历.docx'))
  assert.ok(text.includes('李文静'), `实际：${text.slice(0, 200)}`)
  assert.ok(text.includes('四川大学'))
})

test('未压缩（stored）存放的 docx 也能解出正文', async () => {
  const zip = buildZip([{ name: 'word/document.xml', data: DOC_XML, method: 0 }])
  const text = await extractAttachmentText(new File([zip], '李文静简历.docx'))
  assert.ok(text.includes('李文静'))
})

test('段落与表格换行正确，<w:pPr> 不产生多余空行', async () => {
  const zip = buildZip([{ name: 'word/document.xml', data: DOC_XML }])
  const text = await extractAttachmentText(new File([zip], '李文静简历.docx'))
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // 正文段落：姓名、手机号 + 表格两行（表格单元格用制表符分隔）
  assert.ok(lines.length <= 6, `段落过多：${JSON.stringify(lines)}`)
  assert.ok(lines.some((l) => l.includes('姓名：李文静')))
  assert.ok(lines.some((l) => l.includes('学历\t本科')), `表格未按制表符分隔：${JSON.stringify(lines)}`)
  assert.ok(lines.some((l) => l.includes('毕业院校\t四川大学')))
})

test('不是 zip 的文件冒充 docx 时给出明确提示', async () => {
  const payload = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.from('旧版 doc 内容', 'utf16le')])
  await assert.rejects(
    () => extractAttachmentText(new File([payload], '其实是旧doc.docx')),
    /不是有效的 Word 文件|docx/,
  )
})

test('损坏的 docx（无 EOCD）给出明确提示', async () => {
  await assert.rejects(
    () => extractAttachmentText(new File([Buffer.from('PK\x03\x04乱码数据')], '坏文件.docx')),
    /不是有效的 Office 压缩包|结构损坏/,
  )
})

test('缺少正文的 docx 给出明确提示', async () => {
  const zip = buildZip([{ name: 'word/styles.xml', data: '<w:styles/>' }])
  await assert.rejects(
    () => extractAttachmentText(new File([zip], '没有正文.docx')),
    /没有找到正文/,
  )
})
