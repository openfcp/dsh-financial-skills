/**
 * dsh-financial-skills —— Host 半区单元测试
 *
 * 全部离线：网络层一律注入假 fetch（或 fixture 目录），本文件不发起任何真实请求。
 * 覆盖契约 §2-§3 的关键行为：归一化、镜像降级、磁盘缓存 / 快照兜底、安装根扫描、
 * 安装（暂存 / 限额 / 409 / 路径逃逸）、卸载归档、路由信封与 loopback 围栏。
 *
 * 运行：node --test test/host.test.mjs
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { deflateRawSync, gzipSync } from 'node:zlib'

import { apply, inject, name, resolveConfig } from '../index.js'
import {
  DEFAULT_INDEX_URLS,
  DEFAULT_RESOLVE,
  ID_PATTERN,
  createCatalog,
  isValidId,
  normalizeCatalog,
  SNAPSHOT_FILE,
} from '../lib/catalog.js'
import { buildGithubApiUrl, buildGithubRawUrls, buildRawUrls, createSource, isSafeRelativePath, SOURCE_REPO_LABEL, SourceError } from '../lib/github.js'
import { SkillhubError, createSkillhub, extractZip } from '../lib/skillhub.js'
import { hostnameOf, isLoopback, isLoopbackHost, readJson, sendJson, truncateToBytes } from '../lib/http.js'
import { DETAIL_MARKDOWN_LIMIT, ROUTE_PATHS, ROUTES, createRoutes } from '../lib/routes.js'
import {
  DEFAULT_LIMITS,
  createStore,
  isWithinRoot,
  normalizeSkillFrontmatter,
  parseFrontmatter,
  resolveDshHome,
  resolveInstallRoot,
  scanInstalled,
  StoreError,
} from '../lib/store.js'

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------

/** 任何真实网络请求都视为测试失败。 */
const mustNotFetch = async () => {
  throw new Error('测试不允许发起真实网络请求')
}

/** 建一个自动清理的临时目录。 */
async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-financial-skills-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 递归写文件（自动建目录）。 */
async function writeFileDeep(root, relPath, content) {
  const target = join(root, ...relPath.split('/'))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  return target
}

/** 造一个最小 fixture 仓库：{ id: { 'SKILL.md': '...' } }。 */
async function makeFixtureRepo(t, skills) {
  const dir = await tempDir(t)
  for (const [id, files] of Object.entries(skills)) {
    for (const [relPath, content] of Object.entries(files)) {
      await writeFileDeep(dir, `plugins/${id}/${relPath}`, content)
    }
  }
  return dir
}

/**
 * 手工构造一个最小 ZIP（测试用）。
 *
 * 支持 method 0 / 8、目录条目、加密标志、zip64 标志，便于逐项验证解压器的拒绝分支。
 * CRC 不参与解压校验，这里统一写 0。
 *
 * @param {Array<{ name: string, data?: string | Buffer, method?: 0 | 8, encrypted?: boolean }>} entries 条目。
 * @returns {Buffer} zip 字节。
 */
function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const isDirectory = entry.name.endsWith('/')
    const raw = isDirectory ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8')
    const method = isDirectory ? 0 : entry.method === 0 ? 0 : 8
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const flags = (entry.encrypted ? 0x0001 : 0) | 0x0800
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    localParts.push(local, name, payload)
    centralParts.push(central, name)
    offset += local.length + name.length + payload.length
  }
  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([...localParts, ...centralParts, eocd])
}

/** 把 EOCD 的条目数改成 0xFFFF，构造一个 zip64 标志字节流。 */
function patchZip64Eocd(zip) {
  const copy = Buffer.from(zip)
  for (let offset = copy.length - 22; offset >= 0; offset -= 1) {
    if (copy.readUInt32LE(offset) === 0x06054b50) {
      copy.writeUInt16LE(0xffff, offset + 8)
      copy.writeUInt16LE(0xffff, offset + 10)
      return copy
    }
  }
  throw new Error('EOCD not found')
}

/** 读随包快照（真实上游数据，条数随上游刷新变化）。 */
let snapshotRawCache
async function snapshotRaw() {
  if (snapshotRawCache === undefined) snapshotRawCache = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8'))
  return snapshotRawCache
}

/** 造一个 fetch 假响应（JSON）。 */
function jsonResponse(body, options = {}) {
  const status = options.status ?? 200
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    async text() {
      return text
    },
    async arrayBuffer() {
      const buffer = Buffer.from(text, 'utf8')
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    },
  }
}

/** 造一个 fetch 假响应（二进制）。 */
function bufferResponse(buffer) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    async text() {
      return buffer.toString('utf8')
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    },
  }
}

/** 造一个 ustar 头（够 GitHub 归档的普通文件用）。 */
function tarHeader(name, size, typeFlag) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100, 'utf8')
  header.write('0001750\0', 108, 'utf8')
  header.write('0001750\0', 116, 'utf8')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'utf8')
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 'utf8')
  header.write('        ', 148, 'utf8')
  header.write(typeFlag, 156, 'utf8')
  header.write('ustar\0', 257, 'utf8')
  header.write('00', 263, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8')
  return header
}

/**
 * 造一个 tar.gz（`{ 'repo-main/SKILL.md': '正文' }` 这种 repo 根带前缀的形状）。
 *
 * @param {Record<string, string>} entries 路径 → 文本内容；值以 '/' 结尾视为目录。
 * @returns {Buffer} tar.gz 字节。
 */
function buildTarGz(entries) {
  const blocks = []
  for (const [path, content] of Object.entries(entries)) {
    const isDir = path.endsWith('/')
    const body = isDir ? Buffer.alloc(0) : Buffer.from(content, 'utf8')
    blocks.push(tarHeader(path, body.length, isDir ? '5' : '0'))
    if (!isDir) {
      blocks.push(body)
      const pad = (512 - (body.length % 512)) % 512
      if (pad > 0) blocks.push(Buffer.alloc(pad))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

/** 造一个可迭代的假请求。 */
function requestWithBody(options = {}) {
  const body = options.body
  const method = options.method ?? 'GET'
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')]
  const headers = { host: options.host ?? '127.0.0.1:5173', ...(options.headers ?? {}) }
  if (method === 'POST' && options.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json'
  }
  return {
    method,
    url: options.url ?? '/',
    headers,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
    destroy() {},
  }
}

/** 造一个记录响应的假 res。 */
function responseRecorder() {
  return {
    statusCode: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(body) {
      this.body = body || ''
    },
  }
}

/** 调一条路由并解析信封。 */
async function callRoute(routes, path, options = {}) {
  const route = routes.find((candidate) => candidate.path === path)
  assert.ok(route !== undefined, `缺少路由 ${path}`)
  const res = responseRecorder()
  await route.handler(requestWithBody({ ...options, url: options.url ?? path }), res)
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) }
}

// ---------------------------------------------------------------------------
// http：信封、loopback、请求体、截断
// ---------------------------------------------------------------------------

test('http: isLoopback 接受 127/8、::1 与 IPv4 映射，拒绝其他来源', () => {
  const allowed = ['127.0.0.1', '127.5.6.7', '::1', '::ffff:127.0.0.1', '::FFFF:127.1.2.3']
  for (const remoteAddress of allowed) {
    assert.equal(isLoopback({ socket: { remoteAddress } }), true, remoteAddress)
  }
  const denied = ['10.0.0.1', '192.168.1.2', '8.8.8.8', '::2', '127.0.0.999', 'localhost', '']
  for (const remoteAddress of denied) {
    assert.equal(isLoopback({ socket: { remoteAddress } }), false, remoteAddress)
  }
  assert.equal(isLoopback({}), false)
})

test('http: isLoopbackHost 只接受 loopback 名字，hostnameOf 正确去端口', () => {
  assert.equal(hostnameOf('127.0.0.1:5173'), '127.0.0.1')
  assert.equal(hostnameOf('LOCALHOST:5173'), 'localhost')
  assert.equal(hostnameOf('[::1]:5173'), '[::1]')
  assert.equal(hostnameOf('evil.com:443'), 'evil.com')
  assert.equal(hostnameOf('127.0.0.1:not-a-port'), '')
  assert.equal(hostnameOf(''), '')

  for (const host of ['127.0.0.1', '127.0.0.1:5173', '127.5.6.7:80', 'localhost', 'localhost:3000', '[::1]', '[::1]:5173']) {
    assert.equal(isLoopbackHost(host), true, host)
  }
  for (const host of ['evil.com', 'evil.com:5173', '127.0.0.1.evil.com', 'localhost.evil.com', '10.0.0.1:80', '[::1]evil.com', '[::1]:x', '', undefined]) {
    assert.equal(isLoopbackHost(host), false, String(host))
  }
})

test('http: sendJson 写 JSON 信封头，truncateToBytes 不切坏多字节字符', () => {
  const res = responseRecorder()
  sendJson(res, 200, { ok: true, value: { text: '你好' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), { ok: true, value: { text: '你好' } })

  const text = '中'.repeat(10) // 每字 3 字节
  const truncated = truncateToBytes(text, 7)
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= 7)
  assert.equal(truncated, '中中')
  assert.equal(truncateToBytes('short', 64), 'short')
})

test('http: readJson 解析对象、空体按 {} 处理、超限抛错', async () => {
  assert.deepEqual(await readJson(requestWithBody({ body: { id: 'alpha' } })), { id: 'alpha' })
  assert.deepEqual(await readJson(requestWithBody({})), {})
  await assert.rejects(readJson(requestWithBody({ body: { id: 'x'.repeat(200) } }), 10), /payload too large/)
  await assert.rejects(readJson(requestWithBody({ body: '[1,2]' })), /expected a JSON object/)
})

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

test('catalog: normalizeCatalog 归一化快照并保留 format 3 来源坐标', async () => {
  const raw = await snapshotRaw()
  const installed = new Map([
    ['compliance-sales', { version: '9.9.9', installedAt: 1700000000000, path: '/tmp/skills/compliance-sales' }],
  ])
  const catalog = normalizeCatalog(raw, installed)

  assert.equal(catalog.id, 'awesome-financial-skills')
  assert.equal(catalog.updated, raw.updated)
  assert.equal(catalog.upstreamSite, 'https://openfcp.github.io/awesome-financial-skills/')
  assert.equal(catalog.categories.length, 9)
  assert.equal(catalog.skills.length, raw.skills.length)

  // format 3：顶层 resolve 归一化（快照里带完整模板）
  assert.equal(catalog.resolve.skillhub.kind, 'zip')
  assert.match(catalog.resolve.skillhub.url, /^https:\/\/api\.skillhub\.cn\/api\/v1\/download\?slug=\{slug\}$/)
  assert.equal(catalog.resolve.github.kind, 'files')
  assert.match(catalog.resolve.github.raw, /^https:\/\/raw\.githubusercontent\.com\/\{repo\}\/\{ref\}\/\{path\}\/\{file\}$/)
  assert.match(catalog.resolve.github.api, /^https:\/\/api\.github\.com\/repos\/\{repo\}\/contents\/\{path\}\?ref=\{ref\}$/)

  // 结构性断言：分类齐全、计数与技能总数一致、每条都能归一化（不写死上游条数）
  assert.equal(catalog.categories.every((category) => Number.isInteger(category.count) && category.count >= 0), true)
  assert.equal(
    catalog.categories.reduce((sum, category) => sum + category.count, 0),
    catalog.skills.length,
  )
  assert.equal(catalog.skills.every((skill) => isValidId(skill.id) && typeof skill.name.zh === 'string' && skill.name.zh !== ''), true)

  const sales = catalog.skills.find((skill) => skill.id === 'compliance-sales')
  assert.equal(sales.installed, true)
  assert.equal(sales.installedVersion, '9.9.9')
  assert.equal(sales.installedAt, 1700000000000)
  assert.equal(sales.installedPath, '/tmp/skills/compliance-sales')
  assert.equal(sales.pluginPath, undefined) // skillhub 没有仓库内路径
  assert.deepEqual(sales.source, {
    type: 'skillhub',
    slug: 'compliance-sales',
    namespace: 'user_e3180ba3',
    skillhubCommand: 'skillhub install compliance-sales --namespace user_e3180ba3',
  })

  // 仓库根来源（source.path: ""）必须原样保留，不能再被改写成 plugins/<id>
  const rootEntry = raw.skills.find((skill) => skill.source?.type === 'github' && skill.source.path === '')
  assert.ok(rootEntry !== undefined, '快照里应至少有一条仓库根来源')
  const rootSkill = catalog.skills.find((skill) => skill.id === rootEntry.id)
  assert.equal(rootSkill.source.path, '')
  assert.equal(rootSkill.pluginPath, undefined) // 仓库根没有子目录前缀

  // source.exclude 必须透传
  const excludeEntry = raw.skills.find(
    (skill) => skill.source?.type === 'github' && Array.isArray(skill.source.exclude) && skill.source.exclude.length > 0,
  )
  assert.ok(excludeEntry !== undefined, '快照里应至少有一条带 exclude 的技能')
  const excludeSkill = catalog.skills.find((skill) => skill.id === excludeEntry.id)
  assert.deepEqual(excludeSkill.source.exclude, excludeEntry.source.exclude)

  const review = catalog.skills.find((skill) => skill.id === 'consumer-protection-review')
  assert.equal(review.name.zh, '消保审查')
  assert.equal(typeof review.name.en, 'string')
  assert.ok(review.name.en.length > 0)
  assert.equal(review.pluginPath, undefined)
  assert.equal(review.source.slug, 'consumer-protection-review')
})

test('catalog: normalizeCatalog 丢弃非法条目并补齐双语字段', () => {
  const raw = {
    id: 'toy',
    title: { zh: '玩具目录' },
    categories: [{ id: 'alpha', title: { zh: '甲类' }, description: { en: 'Alpha' } }],
    skills: [
      { id: 'Bad Id' },
      { id: 'ok-one', name: { zh: '好技能' }, summary: '纯字符串摘要', category: 'alpha', source: { type: 'skillhub' }, install: { skillhub: 'skillhub install ok-one' } },
      { id: 'orphan', category: 'missing-category' },
    ],
  }
  const catalog = normalizeCatalog(raw)
  assert.deepEqual(
    catalog.skills.map((skill) => skill.id),
    ['ok-one', 'orphan'],
  )
  const ok = catalog.skills[0]
  assert.equal(ok.name.zh, '好技能')
  assert.equal(ok.name.en, '好技能') // 单侧缺失时补另一侧
  assert.equal(ok.summary.zh, '纯字符串摘要')
  assert.equal(ok.source.type, 'skillhub')
  assert.equal(ok.source.slug, 'ok-one')
  assert.equal(ok.source.skillhubCommand, 'skillhub install ok-one')
  assert.equal(ok.pluginPath, undefined)
  assert.equal(catalog.categories[0].count, 1)
  assert.equal(catalog.title.en, '玩具目录')
  assert.equal(catalog.skills[1].category, 'missing-category')
  assert.equal(isValidId('ok-one'), true)
  assert.equal(isValidId('Bad Id'), false)
  assert.equal(ID_PATTERN.test('a'.repeat(64)), true)
  assert.equal(ID_PATTERN.test('a'.repeat(65)), false)
})

test('catalog: normalizeCatalog 兼容 format 2（plugins/<id> 与旧 skillhub 坐标）', () => {
  const raw = {
    format: 2,
    id: 'legacy-catalog',
    categories: [{ id: 'alpha', title: { zh: '甲类' }, description: { zh: '甲' } }],
    skills: [
      {
        id: 'legacy-github',
        name: { zh: '旧 github 技能' },
        category: 'alpha',
        source: { type: 'github', repo: 'openfcp/awesome-financial-skills' },
        install: { plugin: './plugins/legacy-github' },
      },
      {
        id: 'legacy-skillhub',
        name: { zh: '旧 skillhub 技能' },
        category: 'alpha',
        source: { type: 'skillhub', namespace: 'ns-legacy', slug: 'legacy-skillhub' },
        install: { skillhub: 'skillhub install legacy-skillhub --namespace ns-legacy' },
      },
    ],
  }
  const catalog = normalizeCatalog(raw)
  // 缺 resolve 时回落默认模板
  assert.equal(catalog.resolve.skillhub.kind, 'zip')
  assert.match(catalog.resolve.skillhub.url, /api\.skillhub\.cn/)
  assert.match(catalog.resolve.github.api, /contents/)

  const gh = catalog.skills[0]
  assert.deepEqual(gh.source, {
    type: 'github',
    repo: 'openfcp/awesome-financial-skills',
    path: 'plugins/legacy-github',
    ref: 'main',
    vendored: true,
  })
  assert.equal(gh.pluginPath, './plugins/legacy-github')

  const sh = catalog.skills[1]
  assert.deepEqual(sh.source, {
    type: 'skillhub',
    slug: 'legacy-skillhub',
    namespace: 'ns-legacy',
    skillhubCommand: 'skillhub install legacy-skillhub --namespace ns-legacy',
  })
  assert.equal(sh.pluginPath, undefined)
})

test('catalog: github 根目录来源保留空 path，并透传 exclude', () => {
  const raw = {
    id: 'toy-root',
    categories: [{ id: 'alpha', title: { zh: '甲类' } }],
    skills: [
      {
        id: 'root-skill',
        name: { zh: '根目录技能' },
        category: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        source: {
          type: 'github',
          repo: 'acme/root-skill',
          path: '',
          ref: 'main',
          exclude: ['examples', './docs/', 'examples', '..', ''],
        },
      },
    ],
  }
  const catalog = normalizeCatalog(raw)
  const skill = catalog.skills[0]
  // path 显式为 "" 是「技能在仓库根」，不能改写成 plugins/<id>
  assert.deepEqual(skill.source, {
    type: 'github',
    repo: 'acme/root-skill',
    path: '',
    ref: 'main',
    vendored: false,
    exclude: ['examples', 'docs'],
  })
  assert.equal(skill.pluginPath, undefined)
})

// ---------------------------------------------------------------------------
// 目录抓取：镜像降级、缓存、快照、offline
// ---------------------------------------------------------------------------

test('catalog: 镜像并行竞速，首个有效载荷胜出并写磁盘缓存', async (t) => {
  const dir = await tempDir(t)
  const cacheFile = join(dir, 'catalog.cache.json')
  const raw = await snapshotRaw()
  const calls = []
  const respond = (url) => {
    calls.push(url)
    if (url === DEFAULT_INDEX_URLS[0]) throw new Error('raw 不可达')
    if (url === DEFAULT_INDEX_URLS[1]) return jsonResponse({ error: 'bad gateway' }, { status: 500 })
    return jsonResponse(raw)
  }
  const catalog = createCatalog({
    indexUrls: DEFAULT_INDEX_URLS,
    cacheFile,
    snapshotFile: SNAPSHOT_FILE,
    fetchImpl: async (url) => respond(url),
    timeoutMs: 1000,
    hedgeDelayMs: 0,
  })
  const result = await catalog.load()
  assert.equal(result.meta.source, 'network')
  assert.equal(result.meta.stale, false)
  assert.equal(result.meta.offline, false)
  // 竞速 = 四条镜像同时问，谁先给出有效载荷用谁；失败的镜像不会拖住整体。
  assert.deepEqual([...calls].sort(), [...DEFAULT_INDEX_URLS].sort())
  assert.equal(result.catalog.categories.length, 9)
  assert.equal(result.catalog.skills.length, raw.skills.length)

  assert.equal(existsSync(cacheFile), true)
  const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
  assert.equal(cached.fetchedAt, result.meta.fetchedAt)
  assert.equal(cached.data.skills.length, raw.skills.length)

  const peeked = await catalog.peekCache()
  assert.equal(peeked.fetchedAt, result.meta.fetchedAt)
})

test('catalog: 首跳够快时不惊动后面的镜像（错峰 300ms 内不分叉）', async (t) => {
  const dir = await tempDir(t)
  const raw = await snapshotRaw()
  const calls = []
  const catalog = createCatalog({
    indexUrls: DEFAULT_INDEX_URLS,
    cacheFile: join(dir, 'catalog.cache.json'),
    snapshotFile: SNAPSHOT_FILE,
    timeoutMs: 5000,
    fetchImpl: async (url) => {
      calls.push(url)
      return jsonResponse(raw)
    },
  })
  const result = await catalog.load()
  assert.equal(result.meta.source, 'network')
  assert.equal(result.meta.url, DEFAULT_INDEX_URLS[0])
  await new Promise((done) => setTimeout(done, 400))
  assert.deepEqual(calls, [DEFAULT_INDEX_URLS[0]], '首跳成功就 abort 掉其余镜像，不再发请求')
})

test('catalog: 慢镜像不拖住后一跳——竞速总耗时接近最快那条', async (t) => {
  const dir = await tempDir(t)
  const raw = await snapshotRaw()
  const catalog = createCatalog({
    indexUrls: ['https://slow.invalid/catalog.json', 'https://fast.invalid/catalog.json'],
    cacheFile: join(dir, 'catalog.cache.json'),
    snapshotFile: SNAPSHOT_FILE,
    timeoutMs: 5000,
    hedgeDelayMs: 20,
    fetchImpl: async (url) => {
      if (url.includes('slow')) {
        await new Promise((done) => setTimeout(done, 3000))
        throw new Error('慢镜像超时')
      }
      return jsonResponse(raw)
    },
  })
  const started = Date.now()
  const result = await catalog.load()
  const elapsed = Date.now() - started
  assert.equal(result.meta.source, 'network')
  assert.equal(result.meta.url, 'https://fast.invalid/catalog.json')
  // 顺序降级要等 3s；竞速只等多一跳的错峰（20ms）+ 快镜像的往返。
  assert.ok(elapsed < 1500, `耗时 ${elapsed}ms，应远小于慢镜像的 3000ms`)
})

test('catalog: 带 ETag 时 304 复用缓存正文，不重写数据', async (t) => {
  const dir = await tempDir(t)
  const cacheFile = join(dir, 'catalog.cache.json')
  const raw = await snapshotRaw()
  await writeFile(cacheFile, JSON.stringify({ version: 1, fetchedAt: Date.now() - 7 * 60 * 60 * 1000, etag: 'W/"abc"', data: raw }))
  const seen = []
  const catalog = createCatalog({
    indexUrls: ['https://mirror.invalid/catalog.json'],
    cacheFile,
    snapshotFile: SNAPSHOT_FILE,
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      seen.push(init.headers['if-none-match'])
      return {
        ok: false,
        status: 304,
        headers: { get: () => null },
        text: async () => '',
      }
    },
  })
  const before = Date.now()
  const result = await catalog.load({ refresh: true })
  assert.deepEqual(seen, ['W/"abc"'])
  assert.equal(result.meta.source, 'network')
  assert.equal(result.catalog.skills.length, raw.skills.length)
  const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
  assert.ok(cached.fetchedAt >= before, '304 只把 fetchedAt 推到当下')
  assert.equal(cached.data.skills.length, raw.skills.length)
})

test('catalog: 新鲜缓存直接命中；过期缓存先返回再后台重同步；offline 绝不联网', async (t) => {
  const dir = await tempDir(t)
  const cacheFile = join(dir, 'catalog.cache.json')
  const raw = await snapshotRaw()

  await writeFile(cacheFile, JSON.stringify({ version: 1, fetchedAt: Date.now(), data: raw }))
  let calls = 0
  const fresh = createCatalog({
    cacheFile,
    snapshotFile: SNAPSHOT_FILE,
    fetchImpl: async () => {
      calls += 1
      return jsonResponse(raw)
    },
    timeoutMs: 1000,
  })
  const freshResult = await fresh.load()
  assert.equal(freshResult.meta.source, 'cache')
  assert.equal(freshResult.meta.stale, false)
  assert.equal(calls, 0)

  // refresh=1 跳过新鲜缓存
  const refreshed = await fresh.load({ refresh: true })
  assert.equal(refreshed.meta.source, 'network')
  assert.equal(calls, 1)

  // 过期缓存：立即返回（stale），网络在后台单飞重同步
  await writeFile(cacheFile, JSON.stringify({ version: 1, fetchedAt: Date.now() - 7 * 60 * 60 * 1000, data: raw }))
  calls = 0
  const stale = createCatalog({
    indexUrls: ['https://mirror.invalid/catalog.json'],
    cacheFile,
    snapshotFile: SNAPSHOT_FILE,
    fetchImpl: async () => {
      calls += 1
      throw new Error('网络中断')
    },
    timeoutMs: 1000,
  })
  const staleResult = await stale.load()
  assert.equal(staleResult.meta.source, 'cache')
  assert.equal(staleResult.meta.stale, true)
  assert.equal(staleResult.meta.revalidating, true)
  assert.equal(staleResult.meta.error, undefined, '后台同步还没结束，不应把错误当成这次响应的结论')
  const synced = await stale.revalidateInBackground()
  assert.equal(synced, false, '网络挂了，后台同步应当失败')
  assert.equal(calls, 1, '后台同步只发一次')
  const afterFailure = JSON.parse(await readFile(cacheFile, 'utf8'))
  assert.equal(afterFailure.data.skills.length, raw.skills.length, '同步失败不动缓存')

  // refresh=1 且网络失败：回退过期缓存并且把错误讲清楚
  const forced = await stale.load({ refresh: true })
  assert.equal(forced.meta.source, 'cache')
  assert.equal(forced.meta.stale, true)
  assert.match(forced.meta.error, /网络中断/)

  await writeFile(cacheFile, JSON.stringify({ version: 1, fetchedAt: Date.now() - 7 * 60 * 60 * 1000, data: raw }))
  calls = 0
  const offlineCatalog = createCatalog({
    cacheFile,
    snapshotFile: SNAPSHOT_FILE,
    offline: true,
    fetchImpl: async () => {
      calls += 1
      return jsonResponse(raw)
    },
  })
  const offlineResult = await offlineCatalog.load()
  assert.equal(offlineResult.meta.source, 'cache')
  assert.equal(offlineResult.meta.offline, true)
  assert.equal(offlineResult.meta.stale, true)
  assert.equal(calls, 0)
})

test('catalog: 镜像全挂且无缓存时回退随包快照；损坏缓存视为不存在', async (t) => {
  const dir = await tempDir(t)
  const cacheFile = join(dir, 'catalog.cache.json')
  const raw = await snapshotRaw()
  await writeFile(cacheFile, 'not-json')

  const catalog = createCatalog({
    indexUrls: ['https://mirror.invalid/a.json'],
    cacheFile,
    snapshotFile: SNAPSHOT_FILE,
    fetchImpl: async () => {
      throw new Error('network down')
    },
    timeoutMs: 1000,
  })
  const result = await catalog.load()
  assert.equal(result.meta.source, 'snapshot')
  assert.equal(result.meta.stale, true)
  assert.match(result.meta.error, /network down/)
  assert.equal(result.catalog.categories.length, 9)
  assert.equal(result.catalog.skills.length, raw.skills.length)

  // loadLocal 只读本地：有快照就不联网
  const local = await catalog.loadLocal()
  assert.equal(local.meta.source, 'snapshot')
  assert.equal(local.catalog.skills.length, raw.skills.length)
})

// ---------------------------------------------------------------------------
// 上游读取：raw 镜像链、tree 缓存、fixture 模式
// ---------------------------------------------------------------------------

test('github: buildRawUrls 顺序为 raw → fastly → gcore → cdn', () => {
  const urls = buildRawUrls('plugins/official-source-qa/SKILL.md')
  assert.equal(urls.length, 4)
  assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/openfcp\/awesome-financial-skills\/main\/plugins\/official-source-qa\/SKILL\.md$/)
  assert.match(urls[1], /^https:\/\/fastly\.jsdelivr\.net\/gh\/openfcp\/awesome-financial-skills@main\//)
  assert.match(urls[2], /^https:\/\/gcore\.jsdelivr\.net\/gh\//)
  assert.match(urls[3], /^https:\/\/cdn\.jsdelivr\.net\/gh\//)
})

test('github: fixture 保留中文目录 / 文件名，不静默丢弃', async (t) => {
  const repo = await tempDir(t)
  await writeFileDeep(repo, 'skills/lieflat-gongwen/SKILL.md', '---\nname: lieflat-gongwen\n---\n正文')
  await writeFileDeep(repo, 'skills/lieflat-gongwen/参考/公文常用句式.md', '句式')
  await writeFileDeep(repo, 'skills/lieflat-gongwen/党建语料/二十大报告 摘编.txt', '语料')
  await writeFileDeep(repo, 'skills/lieflat-gongwen/示例（一）/demo.md', '示例')

  const source = createSource({ fixtureDir: repo, fetchImpl: mustNotFetch })
  const files = await source.listFiles({ repo: 'o/r', path: 'skills/lieflat-gongwen', ref: 'main' }, undefined, { id: 'lieflat-gongwen' })
  assert.deepEqual(
    files.map((file) => file.path),
    ['SKILL.md', '党建语料/二十大报告 摘编.txt', '参考/公文常用句式.md', '示例（一）/demo.md'],
  )
  assert.equal(
    (await source.readFile({ repo: 'o/r', path: 'skills/lieflat-gongwen', ref: 'main' }, undefined, '参考/公文常用句式.md', { id: 'lieflat-gongwen' })).toString('utf8'),
    '句式',
  )
})

test('github: 不安全路径被丢弃时调用 logger 告警', async (t) => {
  const repo = await tempDir(t)
  await writeFileDeep(repo, 'skills/demo/SKILL.md', '# demo')
  await writeFileDeep(repo, 'skills/demo/a:b.md', '非法文件名')
  const warnings = []
  const source = createSource({
    fixtureDir: repo,
    fetchImpl: mustNotFetch,
    logger: { warn: (message) => warnings.push(String(message)) },
  })
  const files = await source.listFiles({ repo: 'o/r', path: 'skills/demo', ref: 'main' }, undefined, { id: 'demo' })
  assert.deepEqual(files.map((file) => file.path), ['SKILL.md'])
  assert.equal(warnings.some((message) => message.includes('a:b.md')), true, warnings.join('\n'))
})

test('github: 中文路径在 raw / api URL 里逐段编码', () => {
  const resolveGithub = {
    raw: 'https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}',
    api: 'https://api.github.com/repos/{repo}/contents/{path}?ref={ref}',
  }
  const coords = { repo: 'o/r', path: '技能/公文', ref: 'main' }
  const urls = buildGithubRawUrls(resolveGithub, coords, '参考/句式.md')
  assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/o\/r\/main\/%E6%8A%80%E8%83%BD\/%E5%85%AC%E6%96%87\/%E5%8F%82%E8%80%83\/%E5%8F%A5%E5%BC%8F\.md$/)
  const api = buildGithubApiUrl(resolveGithub, coords)
  assert.equal(api, 'https://api.github.com/repos/o/r/contents/%E6%8A%80%E8%83%BD/%E5%85%AC%E6%96%87?ref=main')
})

test('github: readPluginFile 第一条镜像失败后换下一条，全部失败报 network', async () => {
  const calls = []
  const source = createSource({
    timeoutMs: 1000,
    tarball: false,
    fetchImpl: async (url) => {
      calls.push(url)
      if (calls.length === 1) throw new Error('raw down')
      return bufferResponse(Buffer.from('# 标题'))
    },
  })
  const buffer = await source.readPluginFile('official-source-qa', 'SKILL.md')
  assert.equal(buffer.toString('utf8'), '# 标题')
  assert.equal(calls.length, 2)
  assert.match(calls[0], /raw\.githubusercontent\.com/)
  assert.match(calls[1], /fastly\.jsdelivr\.net/)

  const dead = createSource({
    timeoutMs: 1000,
    tarball: false,
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  await assert.rejects(dead.readPluginFile('official-source-qa', 'SKILL.md'), (error) => error instanceof SourceError && error.code === 'network')
})

test('github: readPluginFile 先拒绝不安全相对路径，绝不发请求', async () => {
  let calls = 0
  const source = createSource({
    fetchImpl: async () => {
      calls += 1
      return bufferResponse(Buffer.from('x'))
    },
  })
  for (const unsafe of ['../escape.md', '/etc/passwd', 'a\\b.md', './x.md', '']) {
    await assert.rejects(source.readPluginFile('official-source-qa', unsafe), (error) => error instanceof SourceError && error.code === 'unsafe-path')
  }
  assert.equal(calls, 0)
  assert.equal(isSafeRelativePath('SKILL.md'), true)
  assert.equal(isSafeRelativePath('.codebuddy-plugin/plugin.json'), true)
  assert.equal(isSafeRelativePath('references/a-b_c.md'), true)
  assert.equal(isSafeRelativePath('../x'), false)
  assert.equal(isSafeRelativePath('/abs'), false)
  // 非 ASCII（中文 / 空格 / 括号）是合法的上游布局，必须放行
  assert.equal(isSafeRelativePath('参考/指南.md'), true)
  assert.equal(isSafeRelativePath('党建语料/二十大报告 摘编.txt'), true)
  assert.equal(isSafeRelativePath('示例（一）/demo.md'), true)
  assert.equal(isSafeRelativePath('emoji/🎯.md'), true)
  // 仍然挡住路径逃逸与 Windows 非法字符
  for (const unsafe of ['a//b.md', 'a/./b.md', 'a/../b.md', 'C:/x.md', 'a\\b.md', 'a:b.md', 'a*b.md', 'a?b.md', 'a"b.md', 'a<b.md', 'a>b.md', 'a|b.md', 'trail./x.md', 'trail /x.md', 'a\u0000b.md', 'a\u001fb.md']) {
    assert.equal(isSafeRelativePath(unsafe), false, JSON.stringify(unsafe))
  }
})

test('github: 目录清单走 contents API 并缓存 30 分钟', async () => {
  const calls = []
  const source = createSource({
    timeoutMs: 1000,
    tarball: false,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url === 'https://api.github.com/repos/openfcp/awesome-financial-skills/contents/plugins/missing-skill?ref=main') {
        return jsonResponse([])
      }
      assert.equal(url, 'https://api.github.com/repos/openfcp/awesome-financial-skills/contents/plugins/official-source-qa?ref=main')
      return jsonResponse([{ name: 'SKILL.md', type: 'file', size: 10, path: 'plugins/official-source-qa/SKILL.md' }])
    },
  })
  const first = await source.listPluginFiles('official-source-qa')
  const second = await source.listPluginFiles('official-source-qa')
  assert.deepEqual(first, [{ path: 'SKILL.md', size: 10 }])
  assert.deepEqual(second, first)
  assert.equal(calls.length, 1)
  // 不同目录不共享缓存；空目录映射为 not-found
  await assert.rejects(source.listPluginFiles('missing-skill'), (error) => error instanceof SourceError && error.code === 'not-found')
  assert.equal(calls.length, 2)
})

test('github: tarball 一次请求拿到整目录，读取不再发请求', async () => {
  const archive = buildTarGz({
    'repo-main/': '',
    'repo-main/SKILL.md': '---\nname: demo\n---\n正文',
    'repo-main/references/参考.md': '# 参考',
    'repo-main/other-skill/SKILL.md': '不该出现',
  })
  const calls = []
  const source = createSource({
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      calls.push(url)
      if (!url.startsWith('https://codeload.github.com/')) throw new Error(`不该请求 ${url}`)
      return bufferResponse(archive)
    },
  })
  const coords = { repo: 'acme/demo', path: '', ref: 'main' }
  const files = await source.listFiles(coords, DEFAULT_RESOLVE.github)
  assert.deepEqual(
    files.map((file) => file.path).sort(),
    ['SKILL.md', 'other-skill/SKILL.md', 'references/参考.md'],
  )
  // 只看技能目录：把 path 指向 references 之外的那个技能
  const skillFiles = await source.listFiles({ repo: 'acme/demo', path: 'other-skill', ref: 'main' }, DEFAULT_RESOLVE.github)
  assert.deepEqual(skillFiles, [{ path: 'SKILL.md', size: Buffer.byteLength('不该出现') }])
  const buffer = await source.readFile(coords, DEFAULT_RESOLVE.github, 'references/参考.md')
  assert.equal(buffer.toString('utf8'), '# 参考')
  assert.equal(calls.length, 1, '清单与正文共用同一次 tarball 下载')
})

test('github: tarball 里的中文路径与 exclude 一起生效', async () => {
  const archive = buildTarGz({
    'repo-main/SKILL.md': '# 正文',
    'repo-main/examples/a.png': 'x',
    'repo-main/参考/指南.md': '# 指南',
  })
  const source = createSource({
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      if (!url.startsWith('https://codeload.github.com/')) throw new Error(`不该请求 ${url}`)
      return bufferResponse(archive)
    },
  })
  const files = await source.listFiles(
    { repo: 'acme/demo', path: '', ref: 'main' },
    DEFAULT_RESOLVE.github,
    { exclude: ['examples'] },
  )
  assert.deepEqual(files.map((file) => file.path).sort(), ['SKILL.md', '参考/指南.md'])
})

test('github: tarball 不可用时退回 contents API，且失败会被记住不再重试', async () => {
  const calls = []
  const source = createSource({
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.includes('codeload') || url.includes('/tarball/')) throw new Error('tarball 挂了')
      return jsonResponse([{ name: 'SKILL.md', type: 'file', size: 10 }])
    },
  })
  const coords = { repo: 'acme/demo', path: 'skills/demo', ref: 'main' }
  const files = await source.listFiles(coords, DEFAULT_RESOLVE.github)
  assert.deepEqual(files, [{ path: 'SKILL.md', size: 10 }])
  const tarballCalls = calls.filter((url) => url.includes('codeload') || url.includes('/tarball/')).length
  assert.equal(tarballCalls, 2, 'codeload 与 api tarball 各试一次')
  const before = calls.length
  await source.listFiles({ repo: 'acme/other', path: 'skills/demo', ref: 'main' }, DEFAULT_RESOLVE.github)
  const added = calls.slice(before)
  assert.equal(added.filter((url) => url.includes('codeload') || url.includes('/tarball/')).length, 2, '另一个仓库仍然会试 tarball')
  await source.listFiles(coords, DEFAULT_RESOLVE.github)
  assert.equal(calls.filter((url) => url.includes('codeload')).length, 2, '同仓库失败只试一次，不会每次都等超时')
})

test('github: fixture 模式从磁盘读写，不引用 fetch', async (t) => {
  const repo = await makeFixtureRepo(t, {
    'official-source-qa': {
      'SKILL.md': '---\nname: qa\n---\n正文',
      'package.json': '{"name":"official-source-qa"}',
    },
  })
  let calls = 0
  const source = createSource({
    fixtureDir: repo,
    fetchImpl: async () => {
      calls += 1
      throw new Error('fixture 模式不允许联网')
    },
  })
  const files = await source.listPluginFiles('official-source-qa')
  assert.deepEqual(
    files.map((file) => file.path),
    ['SKILL.md', 'package.json'],
  )
  assert.ok(files.every((file) => file.size > 0))
  assert.match((await source.readPluginFile('official-source-qa', 'SKILL.md')).toString('utf8'), /正文/)
  await assert.rejects(source.listPluginFiles('nope'), (error) => error instanceof SourceError && error.code === 'not-found')
  await assert.rejects(source.readPluginFile('official-source-qa', 'missing.md'), (error) => error instanceof SourceError && error.code === 'not-found')
  assert.equal(calls, 0)
})

// ---------------------------------------------------------------------------
// GitHub 任意坐标（format 3）
// ---------------------------------------------------------------------------

test('github: 任意坐标按 resolve 模板列清单，raw 500 时回落 jsDelivr', async () => {
  const calls = []
  const resolveGithub = {
    raw: 'https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}',
    api: 'https://api.github.com/repos/{repo}/contents/{path}?ref={ref}',
  }
  const coords = { repo: 'acme/skills', path: 'skills/demo', ref: 'dev' }
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url === 'https://api.github.com/repos/acme/skills/contents/skills/demo?ref=dev') {
      return jsonResponse([
        { name: 'SKILL.md', type: 'file', size: 20 },
        { name: 'references', type: 'dir' },
      ])
    }
    if (url === 'https://api.github.com/repos/acme/skills/contents/skills/demo/references?ref=dev') {
      return jsonResponse([{ name: 'guide.md', type: 'file', size: 7 }])
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) return jsonResponse({ error: 'boom' }, { status: 500 })
    if (url === 'https://fastly.jsdelivr.net/gh/acme/skills@dev/skills/demo/SKILL.md') return bufferResponse(Buffer.from('# demo'))
    if (url === 'https://fastly.jsdelivr.net/gh/acme/skills@dev/skills/demo/references/guide.md') {
      return bufferResponse(Buffer.from('guide'))
    }
    throw new Error(`unexpected url: ${url}`)
  }
  const source = createSource({ fetchImpl, timeoutMs: 1000 })
  const files = await source.listFiles(coords, resolveGithub, { id: 'demo' })
  assert.deepEqual(files, [
    { path: 'SKILL.md', size: 20 },
    { path: 'references/guide.md', size: 7 },
  ])
  const markdown = await source.readFile(coords, resolveGithub, 'SKILL.md', { id: 'demo' })
  assert.equal(markdown.toString('utf8'), '# demo')
  assert.ok(calls.some((url) => url.startsWith('https://raw.githubusercontent.com/acme/skills/dev/skills/demo/SKILL.md')))
  assert.ok(calls.some((url) => url === 'https://fastly.jsdelivr.net/gh/acme/skills@dev/skills/demo/SKILL.md'))
})

test('github: contents API 不可达时用 jsDelivr 包清单兜底', async () => {
  const calls = []
  const resolveGithub = {
    raw: 'https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}',
    api: 'https://api.github.com/repos/{repo}/contents/{path}?ref={ref}',
  }
  const source = createSource({
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.startsWith('https://api.github.com/')) throw new Error('api 不可达')
      if (url === 'https://data.jsdelivr.com/v1/packages/gh/acme/skills@main?structure=flat') {
        return jsonResponse({
          files: [
            { name: '/skills/demo/SKILL.md', size: 12 },
            { name: '/skills/other/SKILL.md', size: 9 },
          ],
        })
      }
      throw new Error(`unexpected url: ${url}`)
    },
  })
  const files = await source.listFiles({ repo: 'acme/skills', path: 'skills/demo', ref: 'main' }, resolveGithub)
  assert.deepEqual(files, [{ path: 'SKILL.md', size: 12 }])
  assert.ok(calls.some((url) => url.startsWith('https://data.jsdelivr.com/')))
})

test('github: path 为空表示仓库根，exclude 前缀跳过，raw 地址不出现双斜杠', async () => {
  const calls = []
  const resolveGithub = {
    raw: 'https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}',
    api: 'https://api.github.com/repos/{repo}/contents/{path}?ref={ref}',
  }
  const coords = { repo: 'acme/root-skill', path: '', ref: 'main' }
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url === 'https://api.github.com/repos/acme/root-skill/contents/?ref=main') {
      return jsonResponse([
        { name: 'SKILL.md', type: 'file', size: 10 },
        { name: 'examples', type: 'dir' },
        { name: 'references', type: 'dir' },
      ])
    }
    if (url === 'https://api.github.com/repos/acme/root-skill/contents/examples?ref=main') {
      return jsonResponse([{ name: 'poster.png', type: 'file', size: 999 }])
    }
    if (url === 'https://api.github.com/repos/acme/root-skill/contents/references?ref=main') {
      return jsonResponse([{ name: 'guide.md', type: 'file', size: 7 }])
    }
    if (url === 'https://raw.githubusercontent.com/acme/root-skill/main/SKILL.md') return bufferResponse(Buffer.from('# root'))
    throw new Error(`unexpected url: ${url}`)
  }
  const source = createSource({ fetchImpl, timeoutMs: 1000 })
  const files = await source.listFiles(coords, resolveGithub, { id: 'root-skill', exclude: ['examples'] })
  assert.deepEqual(files, [
    { path: 'SKILL.md', size: 10 },
    { path: 'references/guide.md', size: 7 },
  ])

  assert.equal((await source.readFile(coords, resolveGithub, 'SKILL.md', { id: 'root-skill' })).toString('utf8'), '# root')
  assert.ok(calls.includes('https://raw.githubusercontent.com/acme/root-skill/main/SKILL.md'))
  assert.equal(calls.some((url) => url.includes('//SKILL.md')), false)
  assert.equal(buildGithubRawUrls(resolveGithub, coords, 'SKILL.md')[0], 'https://raw.githubusercontent.com/acme/root-skill/main/SKILL.md')
})

test('github: fixture 兼容 plugins/<id> 与 skills/<id> 两种布局', async (t) => {
  const repo = await makeFixtureRepo(t, { legacy: { 'SKILL.md': '# 旧布局' } })
  await writeFileDeep(repo, 'skills/demo/SKILL.md', '# 新布局')
  const source = createSource({ fixtureDir: repo, fetchImpl: mustNotFetch })

  const byPath = await source.listFiles({ repo: 'o/r', path: 'skills/demo', ref: 'main' }, undefined, { id: 'demo' })
  assert.deepEqual(byPath.map((file) => file.path), ['SKILL.md'])
  assert.equal((await source.readFile({ repo: 'o/r', path: 'skills/demo', ref: 'main' }, undefined, 'SKILL.md', { id: 'demo' })).toString('utf8'), '# 新布局')

  // source.path 在 fixture 里不存在时回落 plugins/<id>
  const fallback = await source.listFiles({ repo: 'o/r', path: 'skills/not-there', ref: 'main' }, undefined, { id: 'legacy' })
  assert.deepEqual(fallback.map((file) => file.path), ['SKILL.md'])
})

// ---------------------------------------------------------------------------
// SkillHub zip 解压与下载
// ---------------------------------------------------------------------------

test('skillhub: extractZip 支持 store/deflate、目录条目、嵌套文件与单层顶层目录剥离', () => {
  const zip = buildZip([
    { name: 'pkg/' },
    { name: 'pkg/SKILL.md', data: '---\nname: demo\n---\n# 正文' },
    { name: 'pkg/references/guide.md', data: '指南', method: 0 },
    { name: 'pkg/nested/deep.txt', data: '深层文件' },
  ])
  const extracted = extractZip(zip)
  assert.deepEqual(extracted.files.map((file) => file.path), ['SKILL.md', 'nested/deep.txt', 'references/guide.md'])
  assert.equal(extracted.files[0].buffer.toString('utf8'), '---\nname: demo\n---\n# 正文')
  assert.equal(extracted.files[2].buffer.toString('utf8'), '指南')
  assert.ok(extracted.totalBytes > 0)
  assert.equal(
    extracted.totalBytes,
    extracted.files.reduce((sum, file) => sum + file.buffer.length, 0),
  )

  // SKILL.md 直接在 zip 根时不做剥离
  const rooted = extractZip(buildZip([{ name: 'SKILL.md', data: '# 根' }, { name: 'a.md', data: 'a' }]))
  assert.deepEqual(rooted.files.map((file) => file.path), ['SKILL.md', 'a.md'])
})

test('skillhub: extractZip 接受中文 / 非 ASCII 条目，但仍拒绝逃逸路径', () => {
  const zip = buildZip([
    { name: '技能/SKILL.md', data: '# 中文包' },
    { name: '技能/参考/句式.md', data: '句式' },
    { name: '技能/示例（一）/demo.md', data: '示例' },
    { name: '技能/党建语料/报告 摘编.txt', data: '语料' },
  ])
  const extracted = extractZip(zip)
  assert.deepEqual(
    extracted.files.map((file) => file.path),
    ['SKILL.md', '党建语料/报告 摘编.txt', '参考/句式.md', '示例（一）/demo.md'],
  )
  assert.equal(extracted.files[2].buffer.toString('utf8'), '句式')
})

test('skillhub: extractZip 拒绝加密 / zip64 / 逃逸路径 / 缺 SKILL.md / 未知压缩方法', () => {
  assert.throws(
    () => extractZip(buildZip([{ name: 'SKILL.md', data: 'x', encrypted: true }])),
    (error) => error instanceof SkillhubError && error.code === 'zip-unsupported',
  )
  assert.throws(
    () => extractZip(patchZip64Eocd(buildZip([{ name: 'SKILL.md', data: 'x' }]))),
    (error) => error instanceof SkillhubError && error.code === 'zip-unsupported',
  )
  assert.throws(
    () => extractZip(buildZip([{ name: 'SKILL.md', data: 'x' }, { name: '../escape.md', data: 'y' }])),
    (error) => error instanceof SkillhubError && error.code === 'unsafe-path',
  )
  assert.throws(
    () => extractZip(buildZip([{ name: 'a/SKILL.md', data: 'x' }, { name: 'b/other.md', data: 'y' }])),
    (error) => error instanceof SkillhubError && error.code === 'invalid-package',
  )
  assert.throws(
    () => extractZip(buildZip([{ name: 'readme.md', data: 'x' }])),
    (error) => error instanceof SkillhubError && error.code === 'invalid-package',
  )
  assert.throws(
    () => extractZip(Buffer.from('not a zip at all')),
    (error) => error instanceof SkillhubError && error.code === 'invalid-package',
  )
  // 未知压缩方法：手工把中央目录与 local header 的 method 改成 12
  const unsupported = buildZip([{ name: 'SKILL.md', data: 'x', method: 0 }])
  for (let offset = 0; offset + 30 <= unsupported.length; offset += 1) {
    if (unsupported.readUInt32LE(offset) === 0x04034b50) unsupported.writeUInt16LE(12, offset + 8)
    if (unsupported.readUInt32LE(offset) === 0x02014b50) unsupported.writeUInt16LE(12, offset + 10)
  }
  assert.throws(
    () => extractZip(unsupported),
    (error) => error instanceof SkillhubError && error.code === 'zip-unsupported',
  )
})

test('skillhub: extractZip 强制文件数 / 单文件 / 总量上限', () => {
  const three = buildZip([
    { name: 'SKILL.md', data: 'aaa' },
    { name: 'a.md', data: 'bbb' },
    { name: 'b.md', data: 'ccc' },
  ])
  assert.throws(
    () => extractZip(three, { maxFiles: 2 }),
    (error) => error instanceof SkillhubError && error.code === 'too-many-files',
  )
  assert.throws(
    () => extractZip(three, { maxFileBytes: 2 }),
    (error) => error instanceof SkillhubError && error.code === 'file-too-large',
  )
  assert.throws(
    () => extractZip(three, { maxTotalBytes: 4 }),
    (error) => error instanceof SkillhubError && error.code === 'total-too-large',
  )
})

test('skillhub: listSkillFiles 按 resolve 模板下载 zip，10 分钟内只下载一次', async () => {
  const zip = buildZip([
    { name: 'SKILL.md', data: '# hub' },
    { name: 'refs/a.md', data: 'a' },
  ])
  const calls = []
  let clock = 1000
  const skillhub = createSkillhub({
    timeoutMs: 1000,
    now: () => clock,
    fetchImpl: async (url) => {
      calls.push(url)
      return bufferResponse(zip)
    },
  })
  const skill = { id: 'compliance-sales', source: { slug: 'compliance-sales', namespace: 'ns' } }
  const first = await skillhub.listSkillFiles(skill, DEFAULT_RESOLVE.skillhub)
  const second = await skillhub.listSkillFiles(skill, DEFAULT_RESOLVE.skillhub)
  assert.equal(calls.length, 1)
  assert.equal(calls[0], 'https://api.skillhub.cn/api/v1/download?slug=compliance-sales')
  assert.deepEqual(first.files.map((file) => file.path), ['SKILL.md', 'refs/a.md'])
  assert.deepEqual(second.files.map((file) => file.path), first.files.map((file) => file.path))

  // 超过 10 分钟 TTL 后重新下载
  clock += 10 * 60 * 1000 + 1
  await skillhub.listSkillFiles(skill, DEFAULT_RESOLVE.skillhub)
  assert.equal(calls.length, 2)
})

test('skillhub: fixture 目录 skillhub/<slug> 直接读取，不发网络请求', async (t) => {
  const repo = await tempDir(t)
  await writeFileDeep(repo, 'skillhub/compliance-sales/SKILL.md', '# fixture hub')
  await writeFileDeep(repo, 'skillhub/compliance-sales/refs/a.md', 'a')
  const skillhub = createSkillhub({ fixtureDir: repo, fetchImpl: mustNotFetch })
  const result = await skillhub.listSkillFiles({ id: 'whatever', source: { slug: 'compliance-sales' } })
  assert.deepEqual(result.files.map((file) => file.path), ['SKILL.md', 'refs/a.md'])
  assert.equal(result.files[0].buffer.toString('utf8'), '# fixture hub')
})

// ---------------------------------------------------------------------------
// 安装根扫描
// ---------------------------------------------------------------------------

test('store: scanInstalled 识别目录 / 平铺形态并读出来源记录', async (t) => {
  const dir = await tempDir(t)
  const root = join(dir, 'skills')
  await writeFileDeep(root, 'alpha/SKILL.md', '---\nname: alpha-skill\ndescription: |\n  第一行\n  第二行\n---\n正文')
  await writeFileDeep(root, 'alpha/.financial-skills.json', JSON.stringify({ id: 'alpha', version: '2.0.0', installedAt: 1700000000000 }))
  await writeFileDeep(root, 'beta/SKILL.md', '---\nname: beta-skill\n---\n')
  await writeFileDeep(root, 'gamma.md', '---\nname: gamma-skill\ndescription: 平铺技能\n---\n')
  await writeFileDeep(root, 'no-skill/readme.txt', '不是技能')
  await writeFileDeep(root, '.hidden/SKILL.md', '---\nname: hidden\n---\n')
  await writeFileDeep(root, 'Bad_Name/SKILL.md', '---\nname: bad\n---\n')

  const skills = await scanInstalled(root)
  assert.deepEqual(
    skills.map((skill) => skill.id),
    ['alpha', 'beta', 'gamma'],
  )
  const alpha = skills[0]
  assert.equal(alpha.name, 'alpha-skill')
  assert.equal(alpha.description, '第一行 第二行')
  assert.equal(alpha.version, '2.0.0')
  assert.equal(alpha.installedAt, 1700000000000)
  assert.equal(alpha.managed, true)
  assert.equal(alpha.path, join(root, 'alpha'))

  assert.equal(skills[1].managed, false)
  assert.equal(skills[1].version, undefined)
  assert.equal(skills[2].path, join(root, 'gamma.md'))
  assert.equal(skills[2].description, '平铺技能')
  assert.equal(skills[2].managed, false)
})

test('store: parseFrontmatter 支持行内值与块标量，isWithinRoot 拒绝根外路径', () => {
  const frontmatter = parseFrontmatter('---\nname: "引号名称"\ndescription: 一句话\nversion: 1.2.3\n---\n正文')
  assert.deepEqual(frontmatter, { name: '引号名称', description: '一句话', version: '1.2.3' })
  assert.deepEqual(parseFrontmatter('没有 frontmatter'), {})
  assert.deepEqual(parseFrontmatter('---\ndescription: >\n  折行\n  描述\n---\n'), { description: '折行 描述' })

  const root = join(tmpdir(), 'dsh-fs-root')
  assert.equal(isWithinRoot(root, join(root, 'alpha')), true)
  assert.equal(isWithinRoot(root, join(root, '..', 'escape')), false)
  assert.equal(isWithinRoot(root, root), false)
})

test('store: 环境变量与配置优先级正确解析 dshHome / installRoot', () => {
  assert.equal(resolveDshHome('/explicit', { DSH_FINANCIAL_SKILLS_HOME: '/own', DSH_HOME: '/shared' }), '/explicit')
  assert.equal(resolveDshHome(undefined, { DSH_FINANCIAL_SKILLS_HOME: '/own', DSH_HOME: '/shared' }), '/own')
  assert.equal(resolveDshHome(undefined, { DSH_HOME: '/shared' }), '/shared')
  assert.equal(resolveInstallRoot('/explicit-skills', '/home'), '/explicit-skills')
  assert.equal(resolveInstallRoot(undefined, '/home', { DSH_FINANCIAL_SKILLS_INSTALL_ROOT: '/env-skills' }), '/env-skills')
  assert.equal(resolveInstallRoot(undefined, '/home'), '/home/skills')
})

// ---------------------------------------------------------------------------
// 安装
// ---------------------------------------------------------------------------

/** 造一个安装目录 store（fixture 源，绝不联网）。 */
async function makeStore(t, fixture, options = {}) {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  const store = createStore({
    dshHome: options.dshHome ?? dir,
    installRoot,
    source: options.source ?? createSource({ fixtureDir: fixture, fetchImpl: mustNotFetch }),
    limits: options.limits ?? DEFAULT_LIMITS,
    now: options.now,
  })
  return { dir, installRoot, store }
}

test('store: install 暂存 → 校验 → rename，写入 provenance 并清空暂存区', async (t) => {
  const fixture = await makeFixtureRepo(t, {
    'official-source-qa': {
      'SKILL.md': '---\nname: official-source-qa\ndescription: 官方口径问答\n---\n# 正文\n\n真实内容',
      'references/guide.md': '指南',
    },
  })
  const { dir, installRoot, store } = await makeStore(t, fixture)

  const result = await store.install('official-source-qa', { version: '1.0.0', license: 'proprietary', sourceRepo: SOURCE_REPO_LABEL })
  assert.equal(result.id, 'official-source-qa')
  assert.equal(result.path, join(installRoot, 'official-source-qa'))
  assert.equal(result.files, 2)
  assert.equal(typeof result.files, 'number')
  assert.ok(result.bytes > 0)
  assert.equal(result.version, '1.0.0')
  assert.equal(result.license, 'proprietary')

  assert.equal(
    await readFile(join(installRoot, 'official-source-qa', 'SKILL.md'), 'utf8'),
    '---\nname: official-source-qa\ndescription: 官方口径问答\n---\n# 正文\n\n真实内容',
  )
  assert.equal(existsSync(join(installRoot, 'official-source-qa', 'references', 'guide.md')), true)

  const provenance = JSON.parse(await readFile(join(installRoot, 'official-source-qa', '.financial-skills.json'), 'utf8'))
  assert.equal(provenance.id, 'official-source-qa')
  assert.equal(provenance.version, '1.0.0')
  assert.equal(provenance.license, 'proprietary')
  assert.equal(provenance.sourceRepo, SOURCE_REPO_LABEL)
  assert.ok(Number.isFinite(provenance.installedAt))
  assert.deepEqual(provenance.files, ['SKILL.md', 'references/guide.md'])
  assert.equal(provenance.fileCount, 2)
  assert.ok(provenance.bytes > 0)
  assert.equal(provenance.sourceType, 'github')
  assert.equal(provenance.sourcePath, 'plugins/official-source-qa')
  assert.equal(provenance.sourceRef, 'main')

  assert.deepEqual((await readdir(installRoot)).sort(), ['official-source-qa'])
  assert.equal((await readdir(dir)).filter((entry) => entry.startsWith('.staging-')).length, 0)

  const map = await store.installedMap()
  assert.equal(map.get('official-source-qa').managed, true)
  assert.equal(map.get('official-source-qa').version, '1.0.0')
  assert.equal(map.get('official-source-qa').description, '官方口径问答')
})

test('store: github 来源按坐标走 contents API + raw（raw 500 后回落 jsDelivr）', async (t) => {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url === 'https://api.github.com/repos/openfcp/awesome-financial-skills/contents/skills/official-source-qa?ref=main') {
      return jsonResponse([
        { name: 'SKILL.md', type: 'file', size: 100 },
        { name: 'package.json', type: 'file', size: 2 },
      ])
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) return jsonResponse({ error: 'boom' }, { status: 500 })
    if (url.startsWith('https://fastly.jsdelivr.net/gh/openfcp/awesome-financial-skills@main/skills/official-source-qa/')) {
      return bufferResponse(Buffer.from(url.endsWith('SKILL.md') ? '# 正文' : '{}'))
    }
    throw new Error(`unexpected url: ${url}`)
  }
  const source = createSource({ fetchImpl, timeoutMs: 1000 })
  const store = createStore({ dshHome: dir, installRoot, source, limits: DEFAULT_LIMITS })
  const descriptor = {
    version: '1.0.0',
    license: 'proprietary',
    source: { type: 'github', repo: 'openfcp/awesome-financial-skills', path: 'skills/official-source-qa', ref: 'main', vendored: true },
    resolve: {
      skillhub: { kind: 'zip', url: 'https://api.skillhub.cn/api/v1/download?slug={slug}' },
      github: {
        kind: 'files',
        raw: 'https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}',
        api: 'https://api.github.com/repos/{repo}/contents/{path}?ref={ref}',
      },
    },
  }

  const result = await store.install('official-source-qa', descriptor)
  assert.equal(result.files, 2)
  assert.equal(result.version, '1.0.0')
  // 上游没写 frontmatter：安装时补 name/description，否则宿主发现不了这条技能
  assert.equal(
    await readFile(join(installRoot, 'official-source-qa', 'SKILL.md'), 'utf8'),
    '---\nname: official-source-qa\ndescription: official-source-qa\n---\n\n# 正文',
  )
  assert.equal(await readFile(join(installRoot, 'official-source-qa', 'package.json'), 'utf8'), '{}')

  const provenance = JSON.parse(await readFile(join(installRoot, 'official-source-qa', '.financial-skills.json'), 'utf8'))
  assert.equal(provenance.sourceType, 'github')
  assert.equal(provenance.sourceRepo, 'openfcp/awesome-financial-skills')
  assert.equal(provenance.sourcePath, 'skills/official-source-qa')
  assert.equal(provenance.sourceRef, 'main')

  // 目录只拉一次；两个文件都是 raw 直连失败后落到 fastly jsDelivr
  assert.equal(calls.filter((url) => url.includes('contents/skills/official-source-qa')).length, 1)
  assert.equal(calls.filter((url) => url.startsWith('https://raw.githubusercontent.com/')).length, 2)
  assert.equal(calls.filter((url) => url.startsWith('https://fastly.jsdelivr.net/')).length, 2)
  assert.equal(calls.some((url) => url.includes('data.jsdelivr.com')), false)
})

test('store: github 根目录来源（path 为空）装到 <id>/，exclude 目录不落盘', async (t) => {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url === 'https://api.github.com/repos/acme/root-skill/contents/?ref=main') {
      return jsonResponse([
        { name: 'SKILL.md', type: 'file', size: 10 },
        { name: 'examples', type: 'dir' },
      ])
    }
    if (url === 'https://api.github.com/repos/acme/root-skill/contents/examples?ref=main') {
      return jsonResponse([{ name: 'poster.png', type: 'file', size: 999 }])
    }
    if (url === 'https://raw.githubusercontent.com/acme/root-skill/main/SKILL.md') return bufferResponse(Buffer.from('# 根目录'))
    throw new Error(`unexpected url: ${url}`)
  }
  const source = createSource({ fetchImpl, timeoutMs: 1000 })
  const store = createStore({ dshHome: dir, installRoot, source, limits: DEFAULT_LIMITS })
  const result = await store.install('root-skill', {
    version: '1.0.0',
    license: 'MIT',
    source: { type: 'github', repo: 'acme/root-skill', path: '', ref: 'main', vendored: false, exclude: ['examples'] },
    resolve: DEFAULT_RESOLVE,
  })

  assert.equal(result.files, 1)
  assert.equal(
    await readFile(join(installRoot, 'root-skill', 'SKILL.md'), 'utf8'),
    '---\nname: root-skill\ndescription: root-skill\n---\n\n# 根目录',
  )
  assert.equal(existsSync(join(installRoot, 'root-skill', 'examples')), false)
  assert.equal(calls.some((url) => url.includes('poster.png')), false)

  const provenance = JSON.parse(await readFile(join(installRoot, 'root-skill', '.financial-skills.json'), 'utf8'))
  assert.equal(provenance.sourceRepo, 'acme/root-skill')
  assert.equal(provenance.sourcePath, '')
})

test('store: 目标已存在时返回 409 语义，原目录不受影响', async (t) => {
  const fixture = await makeFixtureRepo(t, { 'official-source-qa': { 'SKILL.md': '# 新' } })
  const { installRoot, store } = await makeStore(t, fixture)
  await writeFileDeep(installRoot, 'official-source-qa/SKILL.md', '# 旧')

  await assert.rejects(store.install('official-source-qa'), (error) => error instanceof StoreError && error.code === 'conflict' && error.status === 409)
  assert.equal(await readFile(join(installRoot, 'official-source-qa', 'SKILL.md'), 'utf8'), '# 旧')
  assert.equal(existsSync(join(installRoot, 'official-source-qa', '.financial-skills.json')), false)
})

test('store: 文件数 / 单文件 / 总量限额失败时不留痕', async (t) => {
  const fixture = await makeFixtureRepo(t, {
    'official-source-qa': {
      'SKILL.md': 'aaaa',
      'a.md': 'bbbb',
      'b.md': 'cccc',
      'c.md': 'dddd',
    },
  })
  const { dir, store } = await makeStore(t, fixture)

  const expectFailure = async (limits, code) => {
    const installRoot = await mkdtemp(join(dir, 'skills-'))
    const limited = createStore({
      dshHome: dir,
      installRoot,
      source: createSource({ fixtureDir: fixture, fetchImpl: mustNotFetch }),
      limits,
    })
    await assert.rejects(limited.install('official-source-qa'), (error) => error instanceof StoreError && error.code === code)
    assert.equal(existsSync(join(installRoot, 'official-source-qa')), false)
    assert.deepEqual(await readdir(installRoot), [])
  }

  await expectFailure({ maxFiles: 2 }, 'too-many-files')
  await expectFailure({ maxFileBytes: 3 }, 'file-too-large')
  await expectFailure({ maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 10 }, 'total-too-large')

  // 非法 id 直接 400 语义
  await assert.rejects(store.install('../etc'), (error) => error instanceof StoreError && error.code === 'invalid-id')
  await assert.rejects(store.install('Bad_Id'), (error) => error instanceof StoreError && error.code === 'invalid-id')
})

test('store: 清单里的路径逃逸被拒绝，暂存区清理干净', async (t) => {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  const source = {
    async listFiles() {
      return [
        { path: 'SKILL.md', size: 4 },
        { path: '../escape.md', size: 4 },
      ]
    },
    async readFile() {
      return Buffer.from('test')
    },
  }
  const store = createStore({ dshHome: dir, installRoot, source, limits: DEFAULT_LIMITS })
  await assert.rejects(store.install('official-source-qa'), (error) => error instanceof StoreError && error.code === 'unsafe-path')
  assert.equal(existsSync(join(dir, 'escape.md')), false)
  assert.equal(existsSync(join(installRoot, 'official-source-qa')), false)
  assert.deepEqual(await readdir(installRoot).catch(() => []), [])
})

test('store: 下载中途失败清空暂存区，安装根保持原状', async (t) => {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  const source = {
    async listFiles() {
      return [
        { path: 'SKILL.md', size: 4 },
        { path: 'broken.md', size: 4 },
      ]
    },
    async readFile(coords, resolveGithub, relPath) {
      if (relPath === 'broken.md') throw new Error('下载失败')
      return Buffer.from('test')
    },
  }
  const store = createStore({ dshHome: dir, installRoot, source, limits: DEFAULT_LIMITS })
  await assert.rejects(store.install('official-source-qa'), /下载失败/)
  assert.equal(existsSync(join(installRoot, 'official-source-qa')), false)
  assert.deepEqual(await readdir(installRoot).catch(() => []), [])
})

test('store: skillhub 来源下载 zip 安装，provenance 带来源坐标', async (t) => {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  const zip = buildZip([
    { name: 'SKILL.md', data: '---\nname: compliance-sales\n---\n# 合规销售' },
    { name: 'package.json', data: '{}' },
  ])
  const calls = []
  const skillhub = createSkillhub({
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      calls.push(url)
      return bufferResponse(zip)
    },
  })
  const github = createSource({ fetchImpl: mustNotFetch })
  const store = createStore({ dshHome: dir, installRoot, source: github, skillhub, limits: DEFAULT_LIMITS })
  const descriptor = {
    version: '1.0.0',
    license: 'proprietary',
    source: {
      type: 'skillhub',
      slug: 'compliance-sales',
      namespace: 'user_e3180ba3',
      skillhubCommand: 'skillhub install compliance-sales --namespace user_e3180ba3',
    },
    resolve: DEFAULT_RESOLVE,
  }

  const result = await store.install('compliance-sales', descriptor)
  assert.equal(result.files, 2)
  assert.equal(result.version, '1.0.0')
  assert.equal(result.license, 'proprietary')
  assert.equal(calls.length, 1)
  assert.equal(calls[0], 'https://api.skillhub.cn/api/v1/download?slug=compliance-sales')
  // 原 frontmatter 只有 name、没有 description：安装时补上（否则宿主会丢弃整条技能）
  assert.equal(
    await readFile(join(installRoot, 'compliance-sales', 'SKILL.md'), 'utf8'),
    '---\nname: compliance-sales\ndescription: compliance-sales\n---\n# 合规销售',
  )

  const provenance = JSON.parse(await readFile(join(installRoot, 'compliance-sales', '.financial-skills.json'), 'utf8'))
  assert.equal(provenance.sourceType, 'skillhub')
  assert.equal(provenance.sourceSlug, 'compliance-sales')
  assert.equal(provenance.sourceNamespace, 'user_e3180ba3')
  assert.equal(provenance.skillhubCommand, 'skillhub install compliance-sales --namespace user_e3180ba3')
  assert.equal(provenance.sourceRepo, 'openfcp/awesome-financial-skills')
  assert.deepEqual(provenance.files, ['SKILL.md', 'package.json'])
  assert.equal(provenance.sourcePath, undefined)

  // 详情：zip 解压结果缓存后直接复用，不再下载
  const manifest = await store.manifest('compliance-sales', descriptor)
  assert.deepEqual(manifest.files.map((file) => file.path), ['SKILL.md', 'package.json'])
  const markdown = await store.readSkillFile('compliance-sales', descriptor, 'SKILL.md')
  assert.match(markdown.toString('utf8'), /合规销售/)
  assert.equal(calls.length, 1)

  // 再次安装命中 409
  await assert.rejects(store.install('compliance-sales', descriptor), (error) => error instanceof StoreError && error.code === 'conflict')
})

// ---------------------------------------------------------------------------
// 卸载
// ---------------------------------------------------------------------------

test('store: uninstall 把技能移入 .trash 而不是删除，二次卸载 404', async (t) => {
  const fixture = await makeFixtureRepo(t, { 'official-source-qa': { 'SKILL.md': '# 正文', 'package.json': '{}' } })
  const { installRoot, store } = await makeStore(t, fixture)
  await store.install('official-source-qa', { version: '1.0.0', license: 'proprietary' })

  const removed = await store.uninstall('official-source-qa')
  assert.equal(removed.id, 'official-source-qa')
  assert.equal(removed.trashedTo.startsWith(join(installRoot, '.trash')), true)
  assert.equal(existsSync(removed.trashedTo), true)
  assert.equal(existsSync(join(installRoot, 'official-source-qa')), false)
  const statInfo = await stat(join(removed.trashedTo, 'SKILL.md'))
  assert.equal(statInfo.isFile(), true)
  assert.match(await readFile(join(removed.trashedTo, 'SKILL.md'), 'utf8'), /^---\nname: official-source-qa\ndescription: official-source-qa\n---\n\n# 正文$/)

  await assert.rejects(store.uninstall('official-source-qa'), (error) => error instanceof StoreError && error.code === 'not-found' && error.status === 404)
  await assert.rejects(store.uninstall('Bad_Id'), (error) => error instanceof StoreError && error.code === 'invalid-id')
})

test('store: uninstall 处理平铺 <id>.md 形态', async (t) => {
  const dir = await tempDir(t)
  const installRoot = join(dir, 'skills')
  await writeFileDeep(installRoot, 'legacy.md', '---\nname: legacy\n---\n')
  const store = createStore({ dshHome: dir, installRoot, source: { listFiles: mustNotFetch, readFile: mustNotFetch }, limits: DEFAULT_LIMITS })

  const removed = await store.uninstall('legacy')
  assert.equal(existsSync(join(installRoot, 'legacy.md')), false)
  assert.equal(existsSync(join(removed.trashedTo, 'legacy.md')), true)
})

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

const SKILL_BODY = '# 官方口径问答\n\n把事实性问题变成可发送的答复。'
const SKILL_MARKDOWN = `---\nname: dyz-gongwen-skills\ndescription: 官方口径问答\n---\n${SKILL_BODY}`
const SKILL_PACKAGE = '{"name":"dyz-gongwen-skills"}'

/** 造一套路由依赖（offline + 快照目录 + fixture 安装源，全程零网络）。 */
// ---------------------------------------------------------------------------
// 技能发现契约：frontmatter 归一化 + 装完立刻生效
// ---------------------------------------------------------------------------

test('store: SKILL.md frontmatter 归一化——非法 name 改写、缺失 description 补齐', () => {
  const withBadName = normalizeSkillFrontmatter('---\nname: PPT Master\n---\n# 正文', { id: 'ai-ppt-skill', fallbackDescription: '做 PPT' })
  assert.equal(withBadName.invocationName, 'ai-ppt-skill')
  assert.equal(withBadName.changed, true)
  assert.match(withBadName.content, /^---\nname: ai-ppt-skill\n/)
  assert.match(withBadName.content, /description: 做 PPT/)
  assert.match(withBadName.content, /# 正文$/)

  const noHeader = normalizeSkillFrontmatter('# 只有正文', { id: 'plain-skill' })
  assert.equal(noHeader.invocationName, 'plain-skill')
  assert.equal(noHeader.content, '---\nname: plain-skill\ndescription: plain-skill\n---\n\n# 只有正文')

  const alreadyGood = normalizeSkillFrontmatter('---\nname: good-skill\ndescription: 没问题\n---\n# 正文', { id: 'good-skill' })
  assert.equal(alreadyGood.changed, false, '本来合法就不该动上游正文')
  assert.equal(alreadyGood.content, '---\nname: good-skill\ndescription: 没问题\n---\n# 正文')

  // 中文 name 也不合法（宿主按 kebab-case 校验），同样改写
  const chinese = normalizeSkillFrontmatter('---\nname: 白之\ndescription: 海报\n---\n# 正文', { id: 'shinora' })
  assert.equal(chinese.invocationName, 'shinora')
  assert.match(chinese.content, /name: shinora/)

  // 块标量 description 视为已填，不要覆盖
  const block = normalizeSkillFrontmatter('---\nname: demo\ndescription: |\n  第一行\n  第二行\n---\n# 正文', { id: 'demo' })
  assert.equal(block.changed, false)
})

test('store: 安装时把非法 frontmatter 归一化，并在 provenance 里记下调用名与修复项', async (t) => {
  const fixture = await makeFixtureRepo(t, {
    'demo-skill': {
      'SKILL.md': '---\nname: Demo Skill\n---\n# 正文',
    },
  })
  const { dir, installRoot, store } = await makeStore(t, fixture)
  const result = await store.install('demo-skill', {
    version: '1.0.0',
    license: 'MIT',
    summary: '演示技能',
    source: { type: 'github', repo: 'acme/demo', path: '', ref: 'main', vendored: false },
    resolve: DEFAULT_RESOLVE,
  })
  assert.equal(result.invocationName, 'demo-skill')
  const written = await readFile(join(installRoot, 'demo-skill', 'SKILL.md'), 'utf8')
  assert.match(written, /^---\nname: demo-skill\n/)
  assert.match(written, /description: 演示技能/)
  const provenance = JSON.parse(await readFile(join(installRoot, 'demo-skill', '.financial-skills.json'), 'utf8'))
  assert.equal(provenance.invocationName, 'demo-skill')
  assert.ok(Array.isArray(provenance.frontmatterRepairs) && provenance.frontmatterRepairs.length > 0)
  assert.equal(existsSync(join(dir, 'skills', 'demo-skill', 'SKILL.md')), true)
})

test('routes: 安装 / 卸载后通知技能注册表（带上落盘路径）', async (t) => {
  const seen = []
  const harness = await createHarness(t, {
    notifyMutation: async (paths) => {
      seen.push(paths)
      return { invalidated: true, announced: true }
    },
  })
  const install = await callRoute(harness.routes, ROUTES.install, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(install.status, 200)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].length, 1)
  assert.match(seen[0][0], /dyz-gongwen-skills$/)

  const uninstall = await callRoute(harness.routes, ROUTES.uninstall, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(uninstall.status, 200)
  assert.equal(seen.length, 2)
  assert.match(seen[1][0], /\.trash/)
})

test('routes: 没有 notifyMutation 时退回 getSkills().invalidateCache()', async (t) => {
  let invalidated = 0
  const harness = await createHarness(t, {
    getSkills: () => ({ invalidateCache: () => { invalidated += 1 } }),
  })
  await callRoute(harness.routes, ROUTES.install, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(invalidated, 1)
})

async function createHarness(t, options = {}) {
  const repo = await makeFixtureRepo(
    t,
    options.skills ?? {
      'dyz-gongwen-skills': {
        'SKILL.md': SKILL_MARKDOWN,
        'package.json': SKILL_PACKAGE,
      },
    },
  )
  if (options.fixtureSkills !== undefined) {
    for (const [relPath, content] of Object.entries(options.fixtureSkills)) await writeFileDeep(repo, relPath, content)
  }
  const dir = await tempDir(t)
  const dshHome = join(dir, 'dsh')
  const installRoot = join(dshHome, 'skills')
  const config = resolveConfig(
    {
      dshHome,
      installRoot,
      offline: true,
      indexUrls: ['https://mirror.invalid/catalog.json'],
      cacheFile: join(dshHome, 'storages', 'financial-skills', 'catalog.cache.json'),
      snapshotFile: SNAPSHOT_FILE,
      fixtureDir: repo,
      timeoutMs: 1000,
      fetch: mustNotFetch,
    },
    {},
  )
  const source = createSource({ fixtureDir: repo, fetchImpl: mustNotFetch, timeoutMs: 1000 })
  const skillhub = createSkillhub({ fixtureDir: repo, fetchImpl: mustNotFetch, timeoutMs: 1000, limits: config.limits })
  const store = createStore({ dshHome: config.dshHome, installRoot: config.installRoot, source, skillhub, limits: config.limits })
  const catalog = createCatalog({
    indexUrls: config.indexUrls,
    cacheFile: config.cacheFile,
    snapshotFile: config.snapshotFile,
    offline: config.offline,
    fetchImpl: mustNotFetch,
    timeoutMs: config.timeoutMs,
    logger: { warn() {} },
  })
  const routes = createRoutes({
    catalog,
    store,
    config,
    getSkills: options.getSkills ?? (() => undefined),
    notifyMutation: options.notifyMutation,
    logger: { warn() {} },
    version: '0.1.0-test',
  })
  return { dir, repo, dshHome, installRoot, config, source, skillhub, store, catalog, routes }
}

test('routes: 六条路由都对非 loopback 返回 403 信封', async (t) => {
  const harness = await createHarness(t)
  assert.equal(harness.routes.length, 6)
  for (const path of ROUTE_PATHS) {
    const method = path === ROUTES.install || path === ROUTES.uninstall ? 'POST' : 'GET'
    const result = await callRoute(harness.routes, path, { method, remoteAddress: '10.1.2.3' })
    assert.equal(result.status, 403, path)
    assert.deepEqual(result.body, { ok: false, error: 'loopback access required' })
  }
  // ::1 是本机，能进业务分支
  const allowed = await callRoute(harness.routes, ROUTES.health, { method: 'GET', remoteAddress: '::1' })
  assert.equal(allowed.status, 200)
})

test('routes: 非 loopback Host（DNS rebinding）返回 403', async (t) => {
  const harness = await createHarness(t)
  for (const path of ROUTE_PATHS) {
    const method = path === ROUTES.install || path === ROUTES.uninstall ? 'POST' : 'GET'
    const result = await callRoute(harness.routes, path, { method, host: 'evil.example:5173' })
    assert.equal(result.status, 403, path)
    assert.deepEqual(result.body, { ok: false, error: 'unexpected host' })
  }
  // 缺少 Host 头同样拒绝（HTTP/1.1 正常请求一定有 Host）
  const missing = await callRoute(harness.routes, ROUTES.health, { method: 'GET', host: '' })
  assert.equal(missing.status, 403)
  assert.deepEqual(missing.body, { ok: false, error: 'unexpected host' })
})

test('routes: POST 要求 application/json，跨站 Origin 返回 403', async (t) => {
  const harness = await createHarness(t)

  const textPlain = await callRoute(harness.routes, ROUTES.install, {
    method: 'POST',
    body: { id: 'dyz-gongwen-skills' },
    headers: { 'content-type': 'text/plain' },
  })
  assert.equal(textPlain.status, 415)
  assert.deepEqual(textPlain.body, { ok: false, error: 'expected application/json' })

  // application/jsonp 不能靠前缀蒙混过关
  const jsonp = await callRoute(harness.routes, ROUTES.install, {
    method: 'POST',
    body: { id: 'dyz-gongwen-skills' },
    headers: { 'content-type': 'application/jsonp' },
  })
  assert.equal(jsonp.status, 415)

  const crossOrigin = await callRoute(harness.routes, ROUTES.install, {
    method: 'POST',
    body: { id: 'dyz-gongwen-skills' },
    headers: { origin: 'http://evil.example:5173' },
  })
  assert.equal(crossOrigin.status, 403)
  assert.deepEqual(crossOrigin.body, { ok: false, error: 'cross-origin request' })

  const nullOrigin = await callRoute(harness.routes, ROUTES.uninstall, {
    method: 'POST',
    body: { id: 'dyz-gongwen-skills' },
    headers: { origin: 'null' },
  })
  assert.equal(nullOrigin.status, 403)
  assert.deepEqual(nullOrigin.body, { ok: false, error: 'cross-origin request' })

  const sameOrigin = await callRoute(harness.routes, ROUTES.install, {
    method: 'POST',
    body: { id: 'dyz-gongwen-skills' },
    headers: { origin: 'http://127.0.0.1:5173' },
  })
  assert.equal(sameOrigin.status, 200, JSON.stringify(sameOrigin.body))
})

test('routes: catalog 用快照返回完整分类与技能，信封与 meta 正确', async (t) => {
  const harness = await createHarness(t)
  const raw = await snapshotRaw()
  const result = await callRoute(harness.routes, ROUTES.catalog, { method: 'GET' })
  assert.equal(result.status, 200)
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.body.ok, true)
  assert.equal(result.body.value.catalog.categories.length, 9)
  assert.equal(result.body.value.catalog.skills.length, raw.skills.length)
  assert.equal(
    result.body.value.catalog.categories.reduce((sum, category) => sum + category.count, 0),
    raw.skills.length,
  )
  assert.equal(result.body.value.meta.source, 'snapshot')
  assert.equal(result.body.value.meta.offline, true)
  assert.equal(result.body.value.meta.stale, true)
})

test('routes: 方法不对返回 405 信封', async (t) => {
  const harness = await createHarness(t)
  const result = await callRoute(harness.routes, ROUTES.catalog, { method: 'POST' })
  assert.equal(result.status, 405)
  assert.equal(result.body.ok, false)
  assert.match(result.body.error, /method not allowed/)
})

test('routes: 非法 / 缺失 id 返回 400，未知 id 返回 404', async (t) => {
  const harness = await createHarness(t)

  const cases = [
    [ROUTES.detail, { method: 'GET', url: `${ROUTES.detail}?id=..%2Fescape` }],
    [ROUTES.detail, { method: 'GET' }],
    [ROUTES.install, { method: 'POST', body: {} }],
    [ROUTES.install, { method: 'POST', body: { id: 'Bad_Id' } }],
    [ROUTES.uninstall, { method: 'POST', body: {} }],
  ]
  for (const [path, options] of cases) {
    const result = await callRoute(harness.routes, path, options)
    assert.equal(result.status, 400, `${path} ${JSON.stringify(options)}`)
    assert.deepEqual(result.body, { ok: false, error: 'invalid skill id' })
  }

  const detail = await callRoute(harness.routes, ROUTES.detail, { method: 'GET', url: `${ROUTES.detail}?id=does-not-exist` })
  assert.equal(detail.status, 404)
  assert.equal(detail.body.ok, false)
  assert.match(detail.body.error, /unknown skill id/)

  const install = await callRoute(harness.routes, ROUTES.install, { method: 'POST', body: { id: 'does-not-exist' } })
  assert.equal(install.status, 404)

  const uninstall = await callRoute(harness.routes, ROUTES.uninstall, { method: 'POST', body: { id: 'does-not-exist' } })
  assert.equal(uninstall.status, 404)
})

test('routes: detail 返回正文、文件清单、总量、license/version/source', async (t) => {
  const harness = await createHarness(t)
  const result = await callRoute(harness.routes, ROUTES.detail, {
    method: 'GET',
    url: `${ROUTES.detail}?id=dyz-gongwen-skills`,
  })
  assert.equal(result.status, 200)
  const value = result.body.value
  assert.equal(value.id, 'dyz-gongwen-skills')
  assert.equal(value.markdown, SKILL_BODY)
  assert.deepEqual(
    value.files.map((file) => file.path),
    ['SKILL.md', 'package.json'],
  )
  assert.ok(value.files.every((file) => Number.isFinite(file.size)))
  assert.equal(value.totalBytes, Buffer.byteLength(SKILL_MARKDOWN) + Buffer.byteLength(SKILL_PACKAGE))
  assert.equal(value.license, 'PolyForm-Noncommercial-1.0.0')
  assert.equal(value.version, '1.1.0')
  assert.deepEqual(value.source, {
    type: 'github',
    repo: 'duyunzhoudyz/dyz-gongwen-skills',
    path: 'skills/gongwen',
    ref: 'main',
    vendored: false,
  })
})

test('routes: detail 正文按 64 KiB 截断', async (t) => {
  const big = `${'x'.repeat(DETAIL_MARKDOWN_LIMIT)}尾部`
  const harness = await createHarness(t, {
    skills: { 'dyz-gongwen-skills': { 'SKILL.md': big, 'package.json': '{}' } },
  })
  const result = await callRoute(harness.routes, ROUTES.detail, {
    method: 'GET',
    url: `${ROUTES.detail}?id=dyz-gongwen-skills`,
  })
  assert.equal(result.status, 200)
  const markdown = result.body.value.markdown
  assert.ok(Buffer.byteLength(markdown, 'utf8') <= DETAIL_MARKDOWN_LIMIT)
  assert.equal(markdown.endsWith('尾部'), false)
})

test('routes: skillhub 来源的 detail / install / uninstall（fixture，零网络）', async (t) => {
  const harness = await createHarness(t, {
    fixtureSkills: {
      'skillhub/compliance-sales/SKILL.md': '---\nname: compliance-sales\ndescription: 合规销售\n---\n# 合规销售正文',
      'skillhub/compliance-sales/references/a.md': '附录',
    },
  })

  const detail = await callRoute(harness.routes, ROUTES.detail, {
    method: 'GET',
    url: `${ROUTES.detail}?id=compliance-sales`,
  })
  assert.equal(detail.status, 200)
  assert.equal(detail.body.value.markdown, '# 合规销售正文')
  assert.deepEqual(detail.body.value.files, [
    { path: 'SKILL.md', size: Buffer.byteLength('---\nname: compliance-sales\ndescription: 合规销售\n---\n# 合规销售正文') },
    { path: 'references/a.md', size: Buffer.byteLength('附录') },
  ])
  assert.equal(
    detail.body.value.totalBytes,
    detail.body.value.files.reduce((sum, file) => sum + file.size, 0),
  )
  assert.equal(detail.body.value.license, 'proprietary')
  assert.equal(detail.body.value.version, '1.0.0')
  assert.deepEqual(detail.body.value.source, {
    type: 'skillhub',
    slug: 'compliance-sales',
    namespace: 'user_e3180ba3',
    skillhubCommand: 'skillhub install compliance-sales --namespace user_e3180ba3',
  })

  const installed = await callRoute(harness.routes, ROUTES.install, { method: 'POST', body: { id: 'compliance-sales' } })
  assert.equal(installed.status, 200)
  assert.equal(installed.body.value.files, 2)
  const provenance = JSON.parse(
    await readFile(join(harness.installRoot, 'compliance-sales', '.financial-skills.json'), 'utf8'),
  )
  assert.equal(provenance.sourceType, 'skillhub')
  assert.equal(provenance.sourceSlug, 'compliance-sales')
  assert.equal(provenance.sourceNamespace, 'user_e3180ba3')

  const listed = await callRoute(harness.routes, ROUTES.installed, { method: 'GET' })
  assert.deepEqual(
    listed.body.value.skills.map((skill) => skill.id),
    ['compliance-sales'],
  )
  assert.equal(listed.body.value.skills[0].managed, true)

  const removed = await callRoute(harness.routes, ROUTES.uninstall, { method: 'POST', body: { id: 'compliance-sales' } })
  assert.equal(removed.status, 200)
  assert.equal(existsSync(join(harness.installRoot, 'compliance-sales')), false)
  assert.equal(existsSync(removed.body.value.trashedTo), true)
})

test('routes: install → installed → 二次 install 409 → uninstall 归档 → 再卸载 404', async (t) => {
  const invalidations = []
  const harness = await createHarness(t, {
    getSkills: () => ({ invalidateCache: () => invalidations.push(Date.now()) }),
  })

  const before = await callRoute(harness.routes, ROUTES.installed, { method: 'GET' })
  assert.equal(before.status, 200)
  assert.deepEqual(before.body.value, { root: harness.installRoot, count: 0, skills: [] })

  const installed = await callRoute(harness.routes, ROUTES.install, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(installed.status, 200)
  assert.equal(installed.body.ok, true)
  assert.equal(installed.body.value.id, 'dyz-gongwen-skills')
  assert.equal(installed.body.value.files, 2)
  assert.equal(typeof installed.body.value.files, 'number')
  assert.ok(installed.body.value.bytes > 0)
  assert.equal(installed.body.value.version, '1.1.0')
  assert.equal(installed.body.value.license, 'PolyForm-Noncommercial-1.0.0')
  assert.equal(invalidations.length, 1)

  const listed = await callRoute(harness.routes, ROUTES.installed, { method: 'GET' })
  assert.equal(listed.body.value.root, harness.installRoot)
  assert.equal(listed.body.value.count, 1)
  const record = listed.body.value.skills[0]
  assert.equal(record.id, 'dyz-gongwen-skills')
  assert.equal(record.managed, true)
  assert.equal(record.version, '1.1.0')
  assert.ok(Number.isFinite(record.installedAt))

  const duplicate = await callRoute(harness.routes, ROUTES.install, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.ok, false)

  const removed = await callRoute(harness.routes, ROUTES.uninstall, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.value.id, 'dyz-gongwen-skills')
  assert.equal(removed.body.value.trashedTo.startsWith(join(harness.installRoot, '.trash')), true)
  assert.equal(existsSync(removed.body.value.trashedTo), true)
  assert.equal(existsSync(join(harness.installRoot, 'dyz-gongwen-skills')), false)
  assert.equal(invalidations.length, 2)

  const again = await callRoute(harness.routes, ROUTES.uninstall, { method: 'POST', body: { id: 'dyz-gongwen-skills' } })
  assert.equal(again.status, 404)

  const after = await callRoute(harness.routes, ROUTES.installed, { method: 'GET' })
  assert.equal(after.body.value.count, 0)
})

test('routes: health 返回版本、上游、缓存时间与根路径', async (t) => {
  const harness = await createHarness(t)
  const result = await callRoute(harness.routes, ROUTES.health, { method: 'GET' })
  assert.equal(result.status, 200)
  const value = result.body.value
  assert.equal(value.version, '0.1.0-test')
  assert.equal(value.upstream, 'https://mirror.invalid/catalog.json')
  assert.equal(value.cacheAt, null)
  assert.equal(value.offline, true)
  assert.equal(value.skillRoot, harness.installRoot)
  assert.equal(value.dshHome, harness.dshHome)
})

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

test('index: apply 通过 ctx.effect 注册六条 exact 路由并在销毁时释放', async (t) => {
  const dir = await tempDir(t)
  const registered = []
  const effects = []
  const ctx = {
    logger: { warn() {} },
    webServer: {
      register(route) {
        registered.push(route)
        return () => {
          route.disposed = true
        }
      },
    },
    effect(factory, label) {
      effects.push({ label, dispose: factory() })
    },
    get() {
      return undefined
    },
  }

  apply(ctx, { dshHome: join(dir, 'dsh'), offline: true, snapshotFile: SNAPSHOT_FILE, cacheFile: join(dir, 'cache.json') })

  assert.equal(name, 'financial-skills')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(registered.length, 6)
  assert.deepEqual(
    registered.map((route) => route.path),
    ROUTE_PATHS,
  )
  assert.ok(registered.every((route) => route.kind === 'exact'))
  assert.equal(effects.length, 1)
  assert.match(effects[0].label, /financial-skills/)

  effects[0].dispose()
  assert.ok(registered.every((route) => route.disposed === true))
})

test('index: resolveConfig 非法值回落默认，env 覆盖 dshHome / offline / fixture', () => {
  const config = resolveConfig(
    { indexUrls: ['not-a-url'], cacheTtlMs: -1, maxFiles: 'many', offline: 'yes' },
    {
      DSH_FINANCIAL_SKILLS_HOME: '/tmp/financial-skills-home',
      DSH_FINANCIAL_SKILLS_OFFLINE: '1',
      DSH_FINANCIAL_SKILLS_FIXTURE: '/tmp/financial-skills-fixture',
    },
  )
  assert.deepEqual(config.indexUrls, DEFAULT_INDEX_URLS)
  assert.equal(config.cacheTtlMs, 6 * 60 * 60 * 1000)
  assert.equal(config.limits.maxFiles, DEFAULT_LIMITS.maxFiles)
  assert.equal(config.offline, true)
  assert.equal(config.dshHome, '/tmp/financial-skills-home')
  assert.equal(config.installRoot, '/tmp/financial-skills-home/skills')
  assert.equal(config.fixtureDir, '/tmp/financial-skills-fixture')

  const single = resolveConfig({ indexUrl: 'https://example.com/catalog.json' }, {})
  assert.deepEqual(single.indexUrls, ['https://example.com/catalog.json'])
})
