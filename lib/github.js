/**
 * dsh-financial-skills —— 上游 GitHub 引用读取（contents API + raw 镜像降级 + 本地 fixture）
 *
 * 上游 catalog 自 format 3 起“只存引用，不存正文”：每条 github 技能带
 * `{ repo, path, ref }` 坐标，顶层 `resolve.github` 给出取回模板：
 *   - 目录清单：优先 codeload 整仓 tarball（一个请求拿到全部文件），失败才退回
 *     `api` 模板（contents API，30 分钟进程内缓存）；
 *   - 文件正文：tarball 缓存里直接取；没有 tarball 时走 `raw` 模板
 *     （raw.githubusercontent.com），不可达再回落
 *     `https://fastly.jsdelivr.net/gh/{repo}@{ref}/{path}/{file}`。
 *
 * 为什么优先 tarball：逐文件 raw 是 N 次请求（一个技能几十次），既慢又容易在
 * 国内网络下个别失败；而 contents API 会把 `.gitignore` 忽略掉、raw 取不到的文件
 * 也列出来（幽灵条目），一个 404 就能让整次安装失败。tarball 里只有真实存在的
 * 文件，一次请求解决这两个问题。
 *
 * 旧 format 2 的 `plugins/<id>/` 布局继续可用（随包快照 / 旧 fixture / 打包 E2E）。
 * 断网或内网环境用 `DSH_FINANCIAL_SKILLS_FIXTURE=<dir>` 把本地仓库根当上游，
 * 依次尝试 `<dir>/<source.path>`、`<dir>/plugins/<id>`、`<dir>/skills/<id>`。
 *
 * @module dsh-financial-skills/github
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { DEFAULT_RESOLVE, normalizeExclude } from './catalog.js'

/** 上游仓库坐标（兼容旧 format 2 用）。 */
export const SOURCE_REPO = Object.freeze({
  owner: 'openfcp',
  repo: 'awesome-financial-skills',
  ref: 'main',
})

/** 上游仓库展示名（写进 provenance 的 sourceRepo）。 */
export const SOURCE_REPO_LABEL = 'openfcp/awesome-financial-skills'

/** 旧 format 2 的技能目录根。 */
export const PLUGIN_DIR = 'plugins'

/** GitHub 目录清单的进程内缓存有效期：30 分钟。 */
export const DEFAULT_TREE_TTL_MS = 30 * 60 * 1000

/** 单次网络请求超时：10 秒。 */
export const DEFAULT_TIMEOUT_MS = 10 * 1000

/** 单个文件默认上限：2 MiB（与安装上限一致）。 */
export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024

/** 整仓 tarball 的压缩体积上限：24 MiB，超了就不走 tarball、退回逐文件。 */
export const DEFAULT_MAX_TARBALL_BYTES = 24 * 1024 * 1024

/**
 * 整仓 tarball 的单次等待上限：15 秒。
 *
 * 大仓（几百 MB 源码 / 图片）在慢网下拉一个 tarball 可能比逐文件还慢，所以宁可
 * 早点放弃转逐文件；失败的仓库在树缓存 TTL 内不会再试。
 */
export const DEFAULT_TARBALL_TIMEOUT_MS = 15 * 1000

/** tarball 解压后的体积上限：防压缩炸弹。 */
export const DEFAULT_MAX_TARBALL_EXPANDED_BYTES = 256 * 1024 * 1024

/** tarball 内存缓存的总预算（超了按插入顺序淘汰）。 */
export const TARBALL_CACHE_BUDGET_BYTES = 96 * 1024 * 1024

/** jsDelivr 的包文件清单 API（contents API 不可达时的兜底）。 */
const JSDELIVR_DATA_URL = 'https://data.jsdelivr.com/v1/packages/gh'

/** 相对路径文法：拒绝控制字符、Windows 保留字符与空段，但允许 Unicode（中文文件名）。 */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/
const WINDOWS_RESERVED_RE = /[:*?"<>|]/

/** 上游读取失败。code 供路由映射状态码：not-found → 404，network → 502，校验类 → 400。 */
export class SourceError extends Error {
  /**
   * @param {'not-found' | 'network' | 'unsafe-path' | 'file-too-large'} code 稳定错误码。
   * @param {string} message 可读文案。
   */
  constructor(code, message) {
    super(message)
    this.name = 'SourceError'
    this.code = code
  }
}

/**
 * 判断一个相对路径能否安全地落到技能目录下。
 *
 * 使用黑名单而不是 ASCII 白名单：目的是挡路径逃逸（绝对路径、反斜杠、空段、
 * `.` / `..`、控制字符、Windows 保留字符与尾点 / 尾空格），**不限制字符集**。
 * 中文与 emoji 文件名是上游的常见布局，白名单会让它们被静默丢弃，装出缺文件的
 * 空壳技能。写盘边界另有 `isWithinRoot` / 暂存目录兜底，放宽字符集不会削弱它。
 *
 * @param {unknown} relPath 相对路径。
 * @returns {boolean} 是否可安全写入。
 */
export function isSafeRelativePath(relPath) {
  if (typeof relPath !== 'string' || relPath === '' || relPath.length > 512) return false
  if (relPath.includes('\\') || relPath.includes('\0')) return false
  return relPath.split('/').every((segment) => {
    if (segment === '' || segment === '.' || segment === '..') return false
    if (CONTROL_CHARS_RE.test(segment)) return false
    if (WINDOWS_RESERVED_RE.test(segment)) return false
    if (/[. ]$/.test(segment)) return false
    return true
  })
}

/**
 * 模板替换：把 `{name}` 换成变量值，未提供的变量原样保留。
 *
 * resolve 模板来自上游 catalog，变量来自 skill 的 source 坐标（服务端数据），
 * 客户端永远碰不到模板与 URL。空串也是有效值——`source.path` 为空表示技能在仓库根，
 * 这时 `{path}` 必须真的被拿掉，不能留下字面量 `{path}`。
 *
 * @param {string} template 模板。
 * @param {Record<string, string>} variables 变量。
 * @returns {string} 替换结果。
 */
export function applyTemplate(template, variables) {
  return String(template).replace(/\{([a-zA-Z]+)\}/g, (match, key) => {
    const value = variables[key]
    return typeof value === 'string' ? value : match
  })
}

/** 规整仓库坐标：字符串 `owner/repo` 或 `{owner,repo}` 都接受；非法回落官方仓库。 */
export function normalizeRepo(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim().replace(/^\/+|\/+$/g, '')
  if (value !== null && typeof value === 'object' && typeof value.owner === 'string' && typeof value.repo === 'string') {
    return `${value.owner}/${value.repo}`
  }
  return SOURCE_REPO_LABEL
}

/** 规整 ref；缺省 main。 */
export function normalizeRef(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'main'
}

/** 规整目录路径：去掉首尾斜杠与 `./` 前缀；空串表示仓库根。 */
export function normalizeRepoPath(value) {
  return typeof value === 'string' ? value.trim().replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '') : ''
}

/** 把坐标收敛成 {repo, path, ref}。 */
export function normalizeCoords(coords = {}) {
  return {
    repo: normalizeRepo(coords.repo),
    path: normalizeRepoPath(coords.path),
    ref: normalizeRef(coords.ref),
  }
}

/** 逐段 URL 编码，保留 `/` 分隔符（中文目录 / 文件名必须编码后再拼 URL）。 */
function encodePathSegments(value) {
  return String(value)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** 拼 GitHub contents API 的目录清单 URL。 */
export function buildGithubApiUrl(resolveGithub, coords) {
  const normalized = normalizeCoords(coords)
  return applyTemplate(resolveGithub.api, {
    repo: normalized.repo,
    path: encodePathSegments(normalized.path),
    ref: encodePathSegments(normalized.ref),
  })
}

/**
 * 合并 URL 里的重复斜杠（保留协议里的 `://`）。
 *
 * `source.path` 为空表示技能在仓库根，raw 模板 `{repo}/{ref}/{path}/{file}` 会拼出
 * `.../main//SKILL.md`；虽然多数 CDN 能容忍，但 jsDelivr 与部分代理会 404。
 *
 * @param {string} url 拼好的地址。
 * @returns {string} 合并后的地址。
 */
export function collapseSlashes(url) {
  return String(url).replace(/([^:]\/)\/+/g, '$1')
}

/**
 * 按 `source.exclude` 前缀过滤文件清单。
 *
 * 与上游取件脚本一致：命中 `examples` 时连带 `examples/**` 一起跳过。
 *
 * @param {Array<{ path: string, size: number }>} files 文件清单。
 * @param {string[]} exclude 排除前缀。
 * @returns {Array<{ path: string, size: number }>} 过滤后的清单。
 */
function applyExclude(files, exclude) {
  if (exclude.length === 0) return files
  return files.filter(
    (file) => !exclude.some((prefix) => file.path === prefix || file.path.startsWith(`${prefix}/`)),
  )
}

/**
 * 构造一个文件的镜像链：raw 模板在前，jsDelivr 兜底在后。
 *
 * @param {{ raw: string, api: string }} resolveGithub resolve.github 模板。
 * @param {{ repo: string, path: string, ref: string }} coords 技能坐标。
 * @param {string} relPath 技能目录内的相对路径。
 * @returns {string[]} 按优先级排列的 URL。
 */
export function buildGithubRawUrls(resolveGithub, coords, relPath) {
  const normalized = normalizeCoords(coords)
  const path = encodePathSegments(normalized.path)
  const ref = encodePathSegments(normalized.ref)
  const file = encodePathSegments(relPath)
  const raw = collapseSlashes(applyTemplate(resolveGithub.raw, { repo: normalized.repo, path, ref, file }))
  const jsdelivr = `https://fastly.jsdelivr.net/gh/${normalized.repo}@${ref}/${[path, file].filter((part) => part !== '').join('/')}`
  return raw === jsdelivr ? [raw] : [raw, jsdelivr]
}

/**
 * 旧 format 2 的 raw 镜像链（保留给兼容测试与旧调用方）。
 *
 * @param {string} relPath 仓库根下的相对路径。
 * @param {{ owner: string, repo: string, ref: string }} [repo] 仓库坐标。
 * @returns {string[]} 按优先级排列的 URL。
 */
export function buildRawUrls(relPath, repo = SOURCE_REPO) {
  const encoded = relPath.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const owner = repo.owner
  const name = repo.repo
  const ref = encodeURIComponent(repo.ref)
  return [
    `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${encoded}`,
    `https://fastly.jsdelivr.net/gh/${owner}/${name}@${ref}/${encoded}`,
    `https://gcore.jsdelivr.net/gh/${owner}/${name}@${ref}/${encoded}`,
    `https://cdn.jsdelivr.net/gh/${owner}/${name}@${ref}/${encoded}`,
  ]
}

/** 正数回落。 */
function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 整仓 tarball 地址（codeload 是 GitHub 的归档主机，与 raw / api 不是同一条线）。
 *
 * @param {string} repo `owner/repo`。
 * @param {string} ref 分支 / 标签 / commit。
 * @returns {string} 下载地址。
 */
export function codeloadUrl(repo, ref) {
  return `https://codeload.github.com/${normalizeRepo(repo)}/tar.gz/${encodePathSegments(normalizeRef(ref))}`
}

/** 读 C 风格字符串字段（tar 头里全是 NUL 结尾的定长字段）。 */
function cString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8')
}

/** 读八进制数字字段；非法返回 0。 */
function octal(buffer, offset, length) {
  const text = cString(buffer, offset, length).trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** pax 扩展头里的 `key=value` 记录（目前只关心 path）。 */
function parsePax(content) {
  const out = {}
  let cursor = 0
  while (cursor < content.length) {
    const space = content.indexOf(0x20, cursor)
    if (space === -1) break
    const length = Number.parseInt(content.subarray(cursor, space).toString('utf8'), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = content.subarray(space + 1, cursor + length - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals > 0) out[record.slice(0, equals)] = record.slice(equals + 1)
    cursor += length
  }
  return out
}

/**
 * 进程内解 tar.gz：返回「仓库内相对路径 → 文件字节」。
 *
 * 只支持 GitHub 归档实际会用的几种块：普通文件（`0` / NUL）、目录（`5`，跳过）、
 * GNU 长文件名（`L`）与 pax 扩展头（`x`）。软链 / 硬链 / 设备节点一律忽略——
 * 我们只要技能正文，不需要它们。
 *
 * @param {Buffer} archive tar.gz 字节。
 * @param {{ maxExpandedBytes?: number }} [options] 解压体积上限。
 * @returns {Map<string, Buffer>} 相对路径 → 内容。
 */
export function parseTarGz(archive, options = {}) {
  const maxExpanded = positiveNumber(options.maxExpandedBytes, DEFAULT_MAX_TARBALL_EXPANDED_BYTES)
  const raw = gunzipSync(archive)
  const files = new Map()
  let offset = 0
  let pendingLongName = ''
  let pendingPax
  let expanded = 0

  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    const name = cString(header, 0, 100)
    if (name === '') break // 结束块（全零）
    const size = octal(header, 124, 12)
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const prefix = cString(header, 345, 155)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > raw.length) break
    const content = raw.subarray(dataStart, dataEnd)
    offset = dataStart + Math.ceil(size / 512) * 512

    if (typeFlag === 'L') {
      pendingLongName = cString(content, 0, content.length)
      continue
    }
    if (typeFlag === 'x') {
      pendingPax = parsePax(content)
      continue
    }
    if (typeFlag !== '0') continue // 目录 / 链接 / 设备节点都跳过

    let path = name
    if (prefix !== '') path = `${prefix}/${name}`
    if (pendingPax !== undefined && typeof pendingPax.path === 'string' && pendingPax.path !== '') path = pendingPax.path
    if (pendingLongName !== '') path = pendingLongName
    pendingPax = undefined
    pendingLongName = ''

    expanded += size
    if (expanded > maxExpanded) throw new Error(`tarball 解压体积超过上限 ${maxExpanded} 字节`)
    const normalized = normalizeRepoPath(path)
    if (normalized !== '') files.set(normalized, Buffer.from(content))
  }
  return files
}

/** 去掉归档顶层目录（`repo-ref/`），得到仓库内相对路径。 */
export function stripArchiveRoot(files) {
  const keys = [...files.keys()]
  if (keys.length === 0) return files
  const firstSlash = keys[0].indexOf('/')
  if (firstSlash <= 0) return files
  const root = keys[0].slice(0, firstSlash)
  if (!keys.every((key) => key === root || key.startsWith(`${root}/`))) return files
  const out = new Map()
  for (const [key, value] of files) {
    if (key === root) continue
    out.set(key.slice(root.length + 1), value)
  }
  return out
}

/** 调一次 logger（没有 logger 时静默）。 */
function warn(logger, message) {
  try {
    if (logger && typeof logger.warn === 'function') logger.warn(message)
  } catch {
    /* 日志本身不能影响主流程 */
  }
}

/** stat 包装：不存在返回 undefined。 */
async function statOrUndefined(path) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * 递归列出一个本地目录下的文件（相对路径 + 字节数）。
 *
 * fixture 模式与 skillhub 本地目录共用；跳过符号链接，保证结果稳定排序。
 *
 * @param {string} root 目录绝对路径。
 * @returns {Promise<Array<{ path: string, size: number }>>} 文件清单。
 */
export async function walkDirectory(root) {
  const files = []
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const relative = `${prefix}${entry.name}`
      if (entry.isDirectory()) {
        await walk(absolute, `${relative}/`)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(absolute)
      files.push({ path: relative, size: info.size })
    }
  }
  await walk(root, '')
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** 去重并按相对路径排序；遇到不安全路径时调用 onDrop 告警，而不是静默丢弃。 */
function normalizeFileList(files, onDrop) {
  const seen = new Set()
  const result = []
  for (const file of files) {
    if (file === null || typeof file !== 'object') continue
    if (!isSafeRelativePath(file.path)) {
      if (typeof onDrop === 'function') onDrop(`[financial-skills] 丢弃不安全的文件路径：${String(file.path)}`)
      continue
    }
    if (seen.has(file.path)) continue
    seen.add(file.path)
    result.push({ path: file.path, size: Number.isFinite(file.size) ? file.size : 0 })
  }
  return result.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/**
 * 从 tarball 文件表里截出某个目录下的文件（路径相对该目录）。
 *
 * @param {Map<string, Buffer>} files 仓库内相对路径 → 内容。
 * @param {string} dirPath 技能目录（空串表示仓库根）。
 * @returns {Array<{ path: string, size: number }>} 文件清单。
 */
function collectFromTarball(files, dirPath) {
  const prefix = dirPath === '' ? '' : `${dirPath}/`
  const out = []
  for (const [path, buffer] of files) {
    if (prefix !== '' && !path.startsWith(prefix)) continue
    out.push({ path: path.slice(prefix.length), size: buffer.length })
  }
  return out
}

/**
 * 创建上游 GitHub 引用读取源。
 *
 * @param {object} [options] 配置。
 * @param {Function} [options.fetchImpl] fetch 实现（测试注入）。
 * @param {string} [options.fixtureDir] 本地 fixture 仓库根；设置后不联网。
 * @param {number} [options.timeoutMs] 单次请求超时。
 * @param {number} [options.treeTtlMs] 目录清单缓存有效期。
 * @param {number} [options.maxFileBytes] 单文件字节上限。
 * @param {boolean} [options.tarball] 是否用整仓 tarball 取回（默认 true）。
 * @param {number} [options.maxTarballBytes] 整仓 tarball 压缩体积上限。
 * @param {number} [options.tarballTimeoutMs] 整仓 tarball 的单次等待上限。
 * @param {{ warn: Function }} [options.logger] 日志。
 * @returns {object} 上游读取源。
 */
export function createSource(options = {}) {
  const fetchImpl =
    typeof options.fetchImpl === 'function' ? options.fetchImpl : typeof options.fetch === 'function' ? options.fetch : undefined
  const fixtureDir = typeof options.fixtureDir === 'string' && options.fixtureDir !== '' ? resolve(options.fixtureDir) : undefined
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const treeTtlMs = positiveNumber(options.treeTtlMs, DEFAULT_TREE_TTL_MS)
  const maxFileBytes = positiveNumber(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
  const tarballEnabled = options.tarball !== false
  const maxTarballBytes = positiveNumber(options.maxTarballBytes, DEFAULT_MAX_TARBALL_BYTES)
  const tarballTimeoutMs = positiveNumber(options.tarballTimeoutMs, DEFAULT_TARBALL_TIMEOUT_MS)
  const logger = options.logger

  /** 目录清单缓存：key = repo@ref|path。 */
  const treeCache = new Map()

  /** 整仓文件表缓存：key = repo@ref → { at, files, totalBytes }。 */
  const tarballCache = new Map()

  /** 取 tarball 失败过的仓库（同 TTL 内不再重试，避免每次都等一轮超时）。 */
  const tarballFailures = new Map()

  /** tarball 缓存占用（字节），用于按预算淘汰。 */
  let tarballBytes = 0

  /** 默认 resolve（旧调用方 / 旧快照没有 resolve 时）。 */
  const defaultResolve = DEFAULT_RESOLVE.github

  /** 拉一次 JSON。 */
  async function fetchJson(url, accept) {
    const impl = fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') throw new Error('fetch is unavailable')
    const init = { headers: { accept, 'accept-encoding': 'identity' }, cache: 'no-store' }
    if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs)
    const response = await impl(url, init)
    if (response === undefined || response === null || response.ok !== true) {
      throw new Error(`HTTP ${response === undefined || response === null ? 'unknown' : response.status}`)
    }
    return JSON.parse(await response.text())
  }

  /** 拉一次二进制正文。 */
  async function fetchBuffer(url, signal) {
    const impl = fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') throw new Error('fetch is unavailable')
    const init = { headers: { accept: '*/*', 'accept-encoding': 'identity' }, cache: 'no-store' }
    if (signal !== undefined) init.signal = signal
    else if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs)
    const response = await impl(url, init)
    if (response === undefined || response === null || response.ok !== true) {
      throw new Error(`HTTP ${response === undefined || response === null ? 'unknown' : response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  /** fixture 下该技能的候选目录（source.path 优先，其次旧格式 plugins/<id>、skills/<id>）。 */
  function fixtureCandidates(coords, id) {
    const candidates = []
    if (fixtureDir === undefined) return candidates
    if (coords.path !== '') candidates.push(join(fixtureDir, ...coords.path.split('/')))
    if (typeof id === 'string' && id !== '') {
      candidates.push(join(fixtureDir, PLUGIN_DIR, id))
      candidates.push(join(fixtureDir, 'skills', id))
    }
    return [...new Set(candidates)]
  }

  /** 找到第一个存在的 fixture 目录。 */
  async function findFixtureDirectory(coords, id) {
    for (const candidate of fixtureCandidates(coords, id)) {
      const info = await statOrUndefined(candidate)
      if (info !== undefined && info.isDirectory()) return candidate
    }
    return undefined
  }

  /**
   * 网络目录清单：contents API 逐层递归。
   *
   * @param {{ repo: string, path: string, ref: string }} coords 坐标。
   * @param {{ api: string }} resolveGithub resolve 模板。
   * @returns {Promise<Array<{ path: string, size: number }>>} 相对清单。
   */
  async function listViaApi(coords, resolveGithub) {
    const files = []
    async function walk(dirPath, prefix, depth) {
      if (depth > 8) throw new Error('目录层级过深')
      const payload = await fetchJson(buildGithubApiUrl(resolveGithub, { ...coords, path: dirPath }), 'application/vnd.github+json')
      if (!Array.isArray(payload)) throw new Error('contents API 返回形状异常')
      for (const item of payload) {
        if (item === null || typeof item !== 'object' || typeof item.name !== 'string') continue
        const relative = `${prefix}${item.name}`
        if (item.type === 'file') {
          files.push({ path: relative, size: Number.isFinite(item.size) ? item.size : 0 })
          continue
        }
        if (item.type === 'dir') {
          await walk(`${dirPath}/${item.name}`, `${relative}/`, depth + 1)
        }
      }
    }
    await walk(coords.path, '', 0)
    return files
  }

  /** 目录清单兜底：jsDelivr 的包文件清单 API。 */
  async function listViaJsdelivr(coords) {
    const url = `${JSDELIVR_DATA_URL}/${coords.repo}@${coords.ref}?structure=flat`
    const payload = await fetchJson(url, 'application/json')
    const prefix = coords.path === '' ? '/' : `/${coords.path}/`
    const files = []
    const entries = Array.isArray(payload.files) ? payload.files : []
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') continue
      if (!entry.name.startsWith(prefix)) continue
      files.push({ path: entry.name.slice(prefix.length), size: Number.isFinite(entry.size) ? entry.size : 0 })
    }
    return files
  }

  /** 按预算淘汰旧的 tarball（Map 插入序即 LRU 近似）。 */
  function evictTarballs() {
    while (tarballBytes > TARBALL_CACHE_BUDGET_BYTES && tarballCache.size > 1) {
      const oldest = tarballCache.keys().next()
      if (oldest.done === true) break
      const entry = tarballCache.get(oldest.value)
      tarballCache.delete(oldest.value)
      tarballBytes -= entry !== undefined ? entry.totalBytes : 0
    }
  }

  /**
   * 取整仓 tarball 并解析成内存文件表（repo@ref 级别缓存）。
   *
   * 先问 codeload（归档主机，与 raw/api 不同线路），失败再问 api 的 tarball 端点。
   * 体积超限、解析失败、目标仓库不存在都返回 undefined，调用方退回原有逐文件路径。
   *
   * @param {{ repo: string, ref: string }} coords 仓库坐标。
   * @returns {Promise<{ files: Map<string, Buffer>, totalBytes: number } | undefined>} 文件表。
   */
  async function loadTarball(coords) {
    if (!tarballEnabled) return undefined
    const key = `${coords.repo}@${coords.ref}`
    const now = Date.now()
    const cached = tarballCache.get(key)
    if (cached !== undefined && now - cached.at < treeTtlMs) return cached
    const failedAt = tarballFailures.get(key)
    if (failedAt !== undefined && now - failedAt < treeTtlMs) return undefined

    const urls = [codeloadUrl(coords.repo, coords.ref), `https://api.github.com/repos/${coords.repo}/tarball/${coords.ref}`]
    const budget = tarballTimeoutMs
    for (const url of urls) {
      let buffer
      try {
        buffer = await fetchBuffer(url, AbortSignal.timeout(budget))
      } catch (error) {
        warn(logger, `[financial-skills] tarball 下载失败 ${url}：${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (buffer.length > maxTarballBytes) {
        warn(logger, `[financial-skills] ${key} 的 tarball 有 ${buffer.length} 字节，超过上限 ${maxTarballBytes}，改走逐文件`)
        tarballFailures.set(key, now)
        return undefined
      }
      try {
        const files = stripArchiveRoot(parseTarGz(buffer))
        let totalBytes = 0
        for (const value of files.values()) totalBytes += value.length
        const entry = { at: now, files, totalBytes }
        tarballCache.set(key, entry)
        tarballBytes += totalBytes
        evictTarballs()
        return entry
      } catch (error) {
        warn(logger, `[financial-skills] tarball 解析失败 ${url}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    tarballFailures.set(key, now)
    return undefined
  }

/**
 * 读取技能目录下某个文件的正文。
 *
 * 优先 tarball 缓存（内存直读），退回 raw 模板 → jsDelivr 镜像；单文件超限立刻失败。
 *
 * @param {{ repo: string, path: string, ref: string }} coords 技能坐标。
 * @param {{ api: string, raw: string }} [resolveGithub] resolve.github 模板。
 * @param {string} relPath 技能目录内的相对路径。
 * @param {{ id?: string }} [options] 兼容旧布局用的技能 id。
 * @returns {Promise<Buffer>} 文件字节。
 */
async function readOneFile(coords, resolveGithub, relPath, options = {}) {
  const normalized = normalizeCoords(coords)
  const templates = resolveGithub !== undefined && resolveGithub !== null ? resolveGithub : defaultResolve
  const id = options !== undefined && options !== null && typeof options.id === 'string' ? options.id : undefined
  if (!isSafeRelativePath(relPath)) {
    throw new SourceError('unsafe-path', `不安全的文件路径：${String(relPath)}`)
  }

  if (fixtureDir !== undefined) {
    for (const candidate of fixtureCandidates(normalized, id)) {
      const base = resolve(candidate)
      const file = resolve(base, ...relPath.split('/'))
      if (file !== base && !file.startsWith(base + sep)) {
        throw new SourceError('unsafe-path', `文件路径逃出了技能目录：${relPath}`)
      }
      let buffer
      try {
        buffer = await readFile(file)
      } catch {
        continue
      }
      if (buffer.length > maxFileBytes) {
        throw new SourceError('file-too-large', `${relPath} 有 ${buffer.length} 字节，超过单文件上限 ${maxFileBytes}`)
      }
      return buffer
    }
    throw new SourceError('not-found', `fixture 里没有 ${normalized.path}/${relPath}`)
  }

  // 1) tarball 缓存里直接取（一次请求换 N 次读取，且没有幽灵文件）。
  const tarball = await loadTarball(normalized)
  if (tarball !== undefined) {
    const inRepoPath = normalized.path === '' ? relPath : `${normalized.path}/${relPath}`
    const hit = tarball.files.get(inRepoPath)
    if (hit !== undefined) {
      if (hit.length > maxFileBytes) {
        throw new SourceError('file-too-large', `${relPath} 有 ${hit.length} 字节，超过单文件上限 ${maxFileBytes}`)
      }
      return hit
    }
  }

  // 2) raw 模板 → jsDelivr 镜像。
  const urls = buildGithubRawUrls(templates, normalized, relPath)
  let lastError
  for (const url of urls) {
    let buffer
    try {
      buffer = await fetchBuffer(url)
    } catch (error) {
      lastError = error
      warn(logger, `[financial-skills] 正文下载失败 ${url}：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (buffer.length > maxFileBytes) {
      throw new SourceError('file-too-large', `${relPath} 有 ${buffer.length} 字节，超过单文件上限 ${maxFileBytes}`)
    }
    return buffer
  }
  throw new SourceError(
    'network',
    `下载 ${normalized.repo}/${normalized.path}/${relPath} 失败：${lastError !== undefined ? (lastError instanceof Error ? lastError.message : String(lastError)) : '没有可用镜像'}`,
  )
}

  return {
    fixtureDir,

    /**
     * 列出技能目录下的文件（路径相对技能目录）。
     *
     * @param {{ repo: string, path: string, ref: string }} coords 技能坐标。
     * @param {{ api: string, raw: string }} [resolveGithub] resolve.github 模板。
     * @param {{ id?: string, exclude?: string[] }} [options] 兼容旧布局用的技能 id 与 source.exclude。
     * @returns {Promise<Array<{ path: string, size: number }>>} 文件清单。
     */
    async listFiles(coords, resolveGithub, options = {}) {
      const normalized = normalizeCoords(coords)
      const templates = resolveGithub !== undefined && resolveGithub !== null ? resolveGithub : defaultResolve
      const id = options !== undefined && options !== null && typeof options.id === 'string' ? options.id : undefined
      const exclude = normalizeExclude(options !== undefined && options !== null ? options.exclude : undefined)

      if (fixtureDir !== undefined) {
        const directory = await findFixtureDirectory(normalized, id)
        if (directory === undefined) {
          throw new SourceError('not-found', `fixture 里没有 ${normalized.path || normalized.repo} 对应的技能目录`)
        }
        const files = applyExclude(normalizeFileList(await walkDirectory(directory), (message) => warn(logger, message)), exclude)
        if (files.length === 0) throw new SourceError('not-found', `fixture 技能目录是空的：${directory}`)
        return files
      }

      const key = `${normalized.repo}@${normalized.ref}|${normalized.path}|${exclude.join(',')}`
      const now = Date.now()
      const cached = treeCache.get(key)
      if (cached !== undefined && now - cached.at < treeTtlMs) return cached.files

      // 1) 整仓 tarball：一个请求拿到全部文件，且只含真实存在的文件（没有幽灵条目）。
      const tarball = await loadTarball(normalized)
      if (tarball !== undefined) {
        const files = collectFromTarball(tarball.files, normalized.path)
        if (files.length > 0) {
          const normalizedFiles = applyExclude(normalizeFileList(files, (message) => warn(logger, message)), exclude)
          if (normalizedFiles.length > 0) {
            treeCache.set(key, { at: now, files: normalizedFiles })
            return normalizedFiles
          }
        }
        warn(logger, `[financial-skills] tarball 里没有 ${normalized.repo}/${normalized.path}，退回 contents API`)
      }

      // 2) contents API → jsDelivr 清单（旧路径，作为兜底保留）。
      let files
      let lastError
      try {
        files = await listViaApi(normalized, templates)
      } catch (error) {
        lastError = error
        warn(logger, `[financial-skills] contents API 失败，改用 jsDelivr 清单：${error instanceof Error ? error.message : String(error)}`)
        try {
          files = await listViaJsdelivr(normalized)
        } catch (fallbackError) {
          lastError = fallbackError
          files = undefined
        }
      }
      if (files === undefined) {
        throw new SourceError('network', `读取 ${normalized.repo}/${normalized.path} 目录失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
      }

      const normalizedFiles = applyExclude(normalizeFileList(files, (message) => warn(logger, message)), exclude)
      if (normalizedFiles.length === 0) {
        throw new SourceError('not-found', `上游仓库里没有 ${normalized.repo}/${normalized.path}/`)
      }
      treeCache.set(key, { at: now, files: normalizedFiles })
      return normalizedFiles
    },

    /** 读取技能目录下某个文件的正文（实现见 readOneFile）。 */
    readFile: readOneFile,

    /**
     * 批量读取多个文件（安装时用）。
     *
     * 命中 tarball 时全部是内存读取，并发度没有意义；退回逐文件下载时才靠并发
     * 把 N 次往返压成几轮。任一文件失败会带上失败原因整体失败——安装是原子的，
     * 不能装出缺文件的空壳。
     *
     * @param {{ repo: string, path: string, ref: string }} coords 技能坐标。
     * @param {{ api: string, raw: string }} [resolveGithub] resolve.github 模板。
     * @param {string[]} paths 技能目录内的相对路径。
     * @param {{ id?: string, concurrency?: number }} [options] 兼容旧布局用的技能 id 与并发度。
     * @returns {Promise<Map<string, Buffer>>} 相对路径 → 内容。
     */
    async readFiles(coords, resolveGithub, paths, options = {}) {
      const list = Array.isArray(paths) ? paths : []
      const concurrency = Math.max(1, Math.min(8, Math.floor(positiveNumber(options.concurrency, 6))))
      const out = new Map()
      let cursor = 0
      const workers = new Array(Math.min(concurrency, list.length)).fill(0).map(async () => {
        while (cursor < list.length) {
          const index = cursor
          cursor += 1
          const path = list[index]
          out.set(path, await readOneFile(coords, resolveGithub, path, options))
        }
      })
      await Promise.all(workers)
      return out
    },

    /**
     * 兼容旧 format 2：列 `plugins/<id>/`。
     *
     * @param {string} id 技能 id。
     * @returns {Promise<Array<{ path: string, size: number }>>} 文件清单。
     */
    listPluginFiles(id) {
      return this.listFiles({ repo: SOURCE_REPO_LABEL, path: `${PLUGIN_DIR}/${id}`, ref: SOURCE_REPO.ref }, defaultResolve, { id })
    },

    /**
     * 兼容旧 format 2：读 `plugins/<id>/<relPath>`。
     *
     * @param {string} id 技能 id。
     * @param {string} relPath 技能目录内的相对路径。
     * @returns {Promise<Buffer>} 文件字节。
     */
    readPluginFile(id, relPath) {
      return this.readFile({ repo: SOURCE_REPO_LABEL, path: `${PLUGIN_DIR}/${id}`, ref: SOURCE_REPO.ref }, defaultResolve, relPath, { id })
    },

    /** 清空目录清单缓存（测试或上游刷新用）。 */
    invalidateTree() {
      treeCache.clear()
      tarballCache.clear()
      tarballFailures.clear()
      tarballBytes = 0
    },
  }
}
