/**
 * dsh-financial-skills —— Host 半区 HTTP 工具
 *
 * 六个 /api/financial-skills/* 路由共用这一层的约定：
 *   - 响应一律 JSON，且 `cache-control: no-store`（目录与安装状态都可能随时变）；
 *   - 客户端只看到统一信封 { ok: true, value } / { ok: false, error }；
 *   - 请求先过 loopback 围栏，非本机来源直接 403。
 *
 * 该文件只依赖 node: 内置能力，不引入任何 npm 依赖。
 *
 * @module dsh-financial-skills/http
 */

/** 统一响应头。 */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/** 默认请求体上限：64 KiB（安装 / 卸载只需要一个 id）。 */
export const DEFAULT_BODY_LIMIT = 64 * 1024

/**
 * 把任意错误压成一条可读字符串。
 *
 * @param {unknown} error 任意抛出的值。
 * @returns {string} 可直接放进 { ok:false, error } 的文案。
 */
export function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * 写一个 JSON 响应。
 *
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {unknown} payload 可 JSON 序列化的载荷。
 */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': Buffer.byteLength(body, 'utf8'),
  })
  res.end(body)
}

/**
 * 写成功信封。
 *
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {unknown} value 业务载荷。
 */
export function sendOk(res, value) {
  sendJson(res, 200, { ok: true, value })
}

/**
 * 写失败信封。
 *
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码（400/403/404/409/502/503）。
 * @param {unknown} error 错误对象或文案。
 */
export function sendError(res, status, error) {
  sendJson(res, status, { ok: false, error: errorMessage(error) })
}

/** 判断一个字符串是否是 127/8 里的 IPv4 地址。 */
function isLoopbackIPv4(host) {
  const parts = String(host).split('.')
  if (parts.length !== 4) return false
  if (parts[0] !== '127') return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 判断请求是否来自本机。
 *
 * 契约只认 socket 地址：127/8、`::1`，以及 IPv4 映射形态 `::ffff:127.0.0.1`。
 * 客户端只跑在桌面壳里，任何非本机来源都不该碰到安装 / 卸载这类写盘能力。
 *
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @returns {boolean} 是否放行。
 */
export function isLoopback(req) {
  const address = req && req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : ''
  if (address === '') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isLoopbackIPv4(normalized.slice(7))
  return isLoopbackIPv4(normalized)
}

/**
 * 读取并解析 JSON 请求体。
 *
 * 空请求体按 `{}` 处理；超过上限时立刻销毁请求并抛错，避免把大包读进内存。
 *
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @param {number} [limit] 字节上限，默认 64 KiB。
 * @returns {Promise<Record<string, unknown>>} 解析后的对象。
 */
export async function readJson(req, limit = DEFAULT_BODY_LIMIT) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) {
      if (typeof req.destroy === 'function') req.destroy()
      throw new Error('payload too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected a JSON object')
  }
  return parsed
}

/**
 * 取查询参数（第一个值）。
 *
 * @param {URL} url 已解析的请求地址。
 * @param {string} name 参数名。
 * @returns {string | undefined} 参数值；缺省时 undefined。
 */
export function queryParam(url, name) {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/**
 * 按 UTF-8 字节数截断文本，且不留下半个多字节字符。
 *
 * 详情接口只回传 SKILL.md 正文的前 64 KiB：客户端 Modal 不需要更多，
 * 也避免一次响应塞进整份技能正文。
 *
 * @param {string} text 原始文本。
 * @param {number} maxBytes 字节上限。
 * @returns {string} 截断后的文本（未超限时原样返回）。
 */
export function truncateToBytes(text, maxBytes) {
  const source = typeof text === 'string' ? text : String(text)
  const buffer = Buffer.from(source, 'utf8')
  if (buffer.length <= maxBytes) return source
  let truncated = buffer.subarray(0, maxBytes).toString('utf8')
  while (truncated.endsWith('\uFFFD')) truncated = truncated.slice(0, -1)
  return truncated
}
