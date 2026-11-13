/**
 * dsh-financial-skills —— SkillHub 引用读取（zip 下载 + 进程内解压）
 *
 * format 3 的目录里，skillhub 来源只存 `{namespace, slug}` 坐标与顶层
 * `resolve.skillhub.url` 模板（默认 `https://api.skillhub.cn/api/v1/download?slug={slug}`）。
 * 取正文就是下载一次 zip 再解压；SkillHub 没有镜像链，一次 10 秒超时。
 *
 * 解压只支持普通 ZIP 的两种存储方式：method 0（store）与 method 8（deflate）。
 * 加密条目、zip64、未知压缩方法都给出明确错误，绝不猜测。解压出的路径必须满足
 * 严格相对路径文法，且 SKILL.md 必须在 zip 根目录或唯一的顶层目录里（那层目录会被
 * 剥掉）。同一 slug 的结果在进程内缓存 10 分钟，让详情与安装两次调用只下载一次。
 *
 * @module dsh-financial-skills/skillhub
 */

import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'

import { DEFAULT_RESOLVE } from './catalog.js'
import { applyTemplate, isSafeRelativePath, walkDirectory } from './github.js'

/** 解压结果缓存有效期：10 分钟。 */
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000

/** 单次网络请求超时：10 秒。 */
export const DEFAULT_TIMEOUT_MS = 10 * 1000

/** 单个 zip 的下载上限（压缩前总量上限的 2 倍，防压缩炸弹拖垮内存）。 */
const DEFAULT_MAX_ZIP_BYTES = 32 * 1024 * 1024

/** 默认安装上限（与 store 的默认值一致；调用方通常显式传入配置值）。 */
export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 200,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
})

/** ZIP 结构签名。 */
const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

/** SkillHub 读取失败；code 供路由映射状态码。 */
export class SkillhubError extends Error {
  /**
   * @param {string} code 稳定错误码（network / not-found / invalid-package / zip-unsupported / unsafe-path / file-too-large / too-many-files / total-too-large）。
   * @param {string} message 可读文案。
   */
  constructor(code, message) {
    super(message)
    this.name = 'SkillhubError'
    this.code = code
  }
}

/** 正数回落。 */
function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
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

/** 找到 EOCD（中央目录结束记录）；找不到返回 -1。 */
function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) return -1
  const earliest = Math.max(0, buffer.length - 65557) // EOCD 最大长度 = 22 + 65535 注释
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset
  }
  return -1
}

/**
 * 校验并归一化 zip 内的相对路径。
 *
 * @param {string} rawName zip 条目名。
 * @returns {string} 归一化路径。
 */
function assertZipPath(rawName) {
  const name = rawName.replace(/\\/g, '/')
  if (!isSafeRelativePath(name)) {
    throw new SkillhubError('unsafe-path', `zip 条目路径不安全：${rawName}`)
  }
  return name
}

/**
 * 归一化 zip 条目路径：SKILL.md 在根就原样返回；否则剥掉唯一的顶层目录。
 *
 * @param {Array<{ path: string, buffer: Buffer }>} files 解压结果。
 * @returns {Array<{ path: string, buffer: Buffer }>} 归一化后的文件。
 */
function stripCommonTopDirectory(files) {
  if (files.some((file) => file.path === 'SKILL.md')) return files
  const topSegments = new Set()
  for (const file of files) {
    const segment = file.path.split('/')[0]
    topSegments.add(segment)
  }
  if (topSegments.size !== 1) {
    throw new SkillhubError('invalid-package', 'zip 里没有 SKILL.md，且文件不在唯一顶层目录下')
  }
  const prefix = `${[...topSegments][0]}/`
  const stripped = []
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue
    stripped.push({ path: file.path.slice(prefix.length), buffer: file.buffer })
  }
  if (!stripped.some((file) => file.path === 'SKILL.md')) {
    throw new SkillhubError('invalid-package', 'zip 里没有 SKILL.md（根目录或唯一顶层目录）')
  }
  return stripped
}

/**
 * 在进程内解压一个 ZIP。
 *
 * 只做我们需要的程度：读中央目录拿条目清单，按 local header 定位数据，
 * method 0 直取、method 8 用 `inflateRawSync` 解压。不校验 CRC（正文内容由
 * 安装流程逐字节限长，CRC 只影响传输完整性，不影响安全边界）。
 *
 * @param {Buffer} buffer zip 字节。
 * @param {Partial<typeof DEFAULT_LIMITS>} [limits] 解压上限。
 * @returns {{ files: Array<{ path: string, buffer: Buffer }>, totalBytes: number }} 解压结果。
 */
export function extractZip(buffer, limits = DEFAULT_LIMITS) {
  const maxFiles = Math.floor(positiveNumber(limits.maxFiles, DEFAULT_LIMITS.maxFiles))
  const maxFileBytes = Math.floor(positiveNumber(limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes))
  const maxTotalBytes = Math.floor(positiveNumber(limits.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes))

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new SkillhubError('invalid-package', 'zip 数据为空')
  }
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new SkillhubError('invalid-package', '不是有效的 zip（找不到中央目录）')

  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SkillhubError('zip-unsupported', '不支持 zip64 格式')
  }

  const files = []
  const seen = new Set()
  let totalBytes = 0
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new SkillhubError('invalid-package', 'zip 中央目录损坏')
    }
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > buffer.length) throw new SkillhubError('invalid-package', 'zip 条目名越界')
    const rawName = buffer.subarray(nameStart, nameEnd).toString('utf8')
    offset = nameEnd + extraLength + commentLength
    if ((flags & 0x0001) === 0x0001) {
      throw new SkillhubError('zip-unsupported', 'zip 含加密条目，无法解压')
    }
    if (rawName.endsWith('/')) continue // 目录条目
    const path = assertZipPath(rawName)
    if (seen.has(path)) throw new SkillhubError('invalid-package', `zip 里重复的路径：${path}`)

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new SkillhubError('invalid-package', `zip 条目 ${path} 的 local header 损坏`)
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) throw new SkillhubError('invalid-package', `zip 条目 ${path} 数据越界`)
    const compressed = buffer.subarray(dataStart, dataEnd)

    let content
    if (method === 0) {
      content = Buffer.from(compressed)
    } else if (method === 8) {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: Math.min(maxFileBytes, maxTotalBytes) + 1 })
      } catch {
        throw new SkillhubError('zip-unsupported', `zip 条目 ${path} 的 deflate 数据损坏或超过单文件上限`)
      }
    } else {
      throw new SkillhubError('zip-unsupported', `不支持的 zip 压缩方法 ${method}（${path}）`)
    }
    if (content.length > maxFileBytes) {
      throw new SkillhubError('file-too-large', `${path} 有 ${content.length} 字节，超过单文件上限 ${maxFileBytes}`)
    }
    totalBytes += content.length
    if (totalBytes > maxTotalBytes) {
      throw new SkillhubError('total-too-large', `解压总量超过上限 ${maxTotalBytes} 字节`)
    }
    files.push({ path, buffer: content })
    seen.add(path)
    if (files.length > maxFiles) {
      throw new SkillhubError('too-many-files', `zip 里有超过 ${maxFiles} 个文件`)
    }
    // 读到 unconsumed 的条目就停：uncompressedSize 仅供参考，实际以解压结果为准
    void uncompressedSize
  }

  if (files.length === 0) throw new SkillhubError('invalid-package', 'zip 里没有文件')
  const normalized = stripCommonTopDirectory(files)
  normalized.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return { files: normalized, totalBytes }
}

/**
 * 创建 SkillHub 引用读取源。
 *
 * @param {object} [options] 配置。
 * @param {Function} [options.fetchImpl] fetch 实现（测试注入）。
 * @param {string} [options.fixtureDir] 本地 fixture 仓库根；设置后不联网，依次尝试
 *   `<dir>/skillhub/<slug>`、`<dir>/plugins/<id>`、`<dir>/skills/<id>`。
 * @param {number} [options.timeoutMs] 单次请求超时。
 * @param {number} [options.cacheTtlMs] 解压结果缓存有效期。
 * @param {Partial<typeof DEFAULT_LIMITS>} [options.limits] 安装上限。
 * @param {{ warn: Function }} [options.logger] 日志。
 * @param {() => number} [options.now] 时钟（测试注入）。
 * @returns {object} SkillHub 读取源。
 */
export function createSkillhub(options = {}) {
  const fetchImpl =
    typeof options.fetchImpl === 'function' ? options.fetchImpl : typeof options.fetch === 'function' ? options.fetch : undefined
  const fixtureDir = typeof options.fixtureDir === 'string' && options.fixtureDir !== '' ? resolve(options.fixtureDir) : undefined
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const cacheTtlMs = positiveNumber(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS)
  const limits = {
    maxFiles: Math.floor(positiveNumber(options.limits?.maxFiles, DEFAULT_LIMITS.maxFiles)),
    maxFileBytes: Math.floor(positiveNumber(options.limits?.maxFileBytes, DEFAULT_LIMITS.maxFileBytes)),
    maxTotalBytes: Math.floor(positiveNumber(options.limits?.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes)),
  }
  const maxZipBytes = positiveNumber(options.maxZipBytes, Math.max(DEFAULT_MAX_ZIP_BYTES, limits.maxTotalBytes * 2))
  const logger = options.logger
  const now = typeof options.now === 'function' ? options.now : Date.now

  /** slug → { at, files, totalBytes }；容量有上限，避免长期驻留大 zip。 */
  const cache = new Map()
  const MAX_CACHE_ENTRIES = 8

  /** 调一次 logger。 */
  const warnLog = (message) => warn(logger, message)

  /** 下载一次 zip。 */
  async function downloadZip(resolveSkillhub, slug) {
    const impl = fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') throw new SkillhubError('network', 'fetch is unavailable')
    const template = resolveSkillhub !== null && typeof resolveSkillhub === 'object' ? resolveSkillhub.url : undefined
    const url = applyTemplate(typeof template === 'string' && template !== '' ? template : DEFAULT_RESOLVE.skillhub.url, {
      slug: encodeURIComponent(slug),
    })
    const init = { headers: { accept: 'application/zip, application/octet-stream', 'accept-encoding': 'identity' }, cache: 'no-store' }
    if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs)
    let response
    try {
      response = await impl(url, init)
    } catch (error) {
      throw new SkillhubError('network', `SkillHub 下载失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (response === undefined || response === null || response.ok !== true) {
      throw new SkillhubError('network', `SkillHub 下载失败：HTTP ${response === undefined || response === null ? 'unknown' : response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxZipBytes) {
      throw new SkillhubError('total-too-large', `zip 有 ${buffer.length} 字节，超过下载上限 ${maxZipBytes}`)
    }
    return buffer
  }

  /** fixture 目录候选（skillhub/<slug> 优先，旧 plugins/<id> 与 skills/<id> 兼容）。 */
  async function findFixtureDirectory(id, slug) {
    if (fixtureDir === undefined) return undefined
    const candidates = [join(fixtureDir, 'skillhub', slug), join(fixtureDir, 'plugins', id), join(fixtureDir, 'skills', id)]
    for (const candidate of candidates) {
      const info = await statOrUndefined(candidate)
      if (info !== undefined && info.isDirectory()) return candidate
    }
    return undefined
  }

  /** 从本地 fixture 目录读一个技能（解压后目录形态）。 */
  async function readFixtureSkill(id, slug) {
    const directory = await findFixtureDirectory(id, slug)
    if (directory === undefined) {
      throw new SkillhubError('not-found', `fixture 里没有 skillhub/${slug}、plugins/${id} 或 skills/${id}`)
    }
    const listing = await walkDirectory(directory)
    const files = []
    let totalBytes = 0
    for (const entry of listing) {
      if (!isSafeRelativePath(entry.path)) throw new SkillhubError('unsafe-path', `fixture 条目路径不安全：${entry.path}`)
      const buffer = await readFile(join(directory, ...entry.path.split('/')))
      if (buffer.length > limits.maxFileBytes) {
        throw new SkillhubError('file-too-large', `${entry.path} 超过单文件上限 ${limits.maxFileBytes}`)
      }
      totalBytes += buffer.length
      if (totalBytes > limits.maxTotalBytes) throw new SkillhubError('total-too-large', `解压总量超过上限 ${limits.maxTotalBytes}`)
      files.push({ path: entry.path, buffer })
      if (files.length > limits.maxFiles) throw new SkillhubError('too-many-files', `文件数超过上限 ${limits.maxFiles}`)
    }
    if (!files.some((file) => file.path === 'SKILL.md')) {
      throw new SkillhubError('invalid-package', `fixture 技能目录 ${directory} 里没有 SKILL.md`)
    }
    return { files, totalBytes }
  }

  return {
    fixtureDir,
    limits,

    /**
     * 取一个 skillhub 技能的全部文件（zip 解压结果或 fixture 目录）。
     *
     * @param {{ id: string, source?: { slug?: string, namespace?: string } }} skill 技能信息。
     * @param {{ url?: string }} [resolveSkillhub] resolve.skillhub 模板。
     * @returns {Promise<{ files: Array<{ path: string, buffer: Buffer }>, totalBytes: number }>} 文件与总量。
     */
    async listSkillFiles(skill, resolveSkillhub) {
      const id = skill !== null && typeof skill === 'object' && typeof skill.id === 'string' ? skill.id : ''
      if (id === '') throw new SkillhubError('not-found', '缺少技能 id')
      const source = skill !== null && typeof skill === 'object' && skill.source !== null && typeof skill.source === 'object' ? skill.source : {}
      const slug = typeof source.slug === 'string' && source.slug !== '' ? source.slug : id

      if (fixtureDir !== undefined) return readFixtureSkill(id, slug)

      const cached = cache.get(slug)
      const at = now()
      if (cached !== undefined && at - cached.at < cacheTtlMs) {
        return { files: cached.files, totalBytes: cached.totalBytes }
      }
      const buffer = await downloadZip(resolveSkillhub, slug)
      const extracted = extractZip(buffer, limits)
      cache.delete(slug)
      cache.set(slug, { at, files: extracted.files, totalBytes: extracted.totalBytes })
      while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next()
        if (oldest.done === true) break
        cache.delete(oldest.value)
      }
      warnLog(`[financial-skills] 已解压 SkillHub 技能 ${slug}（${extracted.files.length} 个文件）`)
      return extracted
    },

    /** 清空解压缓存（测试用）。 */
    invalidateCache() {
      cache.clear()
    },
  }
}
