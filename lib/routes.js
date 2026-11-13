/**
 * dsh-financial-skills —— /api/financial-skills/* 路由表
 *
 * 六个 exact 路由：catalog / installed / detail / install / uninstall / health。
 * 每个请求先过 loopback 围栏，再校验方法，最后才进入业务逻辑；响应一律使用
 * { ok: true, value } / { ok: false, error } 信封（CONTRACT §3.1）。
 *
 * 安全模型：
 *   - 客户端只传技能 id，从不传 URL 或路径；
 *   - id 文法在路由层先挡一遍（400），安装 / 卸载在 store 层再挡一遍；
 *   - 目录 / 详情 / 安装需要的元信息只从上游目录（或本地缓存 / 快照）取。
 *
 * @module dsh-financial-skills/routes
 */

import { isValidId } from './catalog.js'
import { errorMessage, isLoopback, queryParam, readJson, sendError, sendOk, truncateToBytes } from './http.js'
import { StoreError, stripFrontmatter } from './store.js'

/** 路由路径（客户端按这些字面量拼请求，两边必须一致）。 */
export const ROUTES = Object.freeze({
  catalog: '/api/financial-skills/catalog',
  installed: '/api/financial-skills/installed',
  detail: '/api/financial-skills/detail',
  install: '/api/financial-skills/install',
  uninstall: '/api/financial-skills/uninstall',
  health: '/api/financial-skills/health',
})

/** 路由路径数组（测试与注册顺序用）。 */
export const ROUTE_PATHS = Object.freeze(Object.values(ROUTES))

/** 详情正文截断上限：64 KiB。 */
export const DETAIL_MARKDOWN_LIMIT = 64 * 1024

/**
 * 把错误映射成 HTTP 状态码。
 *
 * StoreError 自带状态码；上游 SourceError 用稳定错误码映射；其余按 500 处理。
 *
 * @param {unknown} error 抛出的错误。
 * @returns {number} 状态码。
 */
function statusOf(error) {
  if (error instanceof StoreError) return error.status
  if (error !== null && typeof error === 'object') {
    if (error.code === 'not-found') return 404
    if (error.code === 'network') return 502
    if (error.code === 'unsafe-path' || error.code === 'file-too-large' || error.code === 'too-many-files' || error.code === 'total-too-large') {
      return 400
    }
    if (error.code === 'invalid-package' || error.code === 'zip-unsupported' || error.code === 'unsupported-source') return 502
  }
  return 500
}

/**
 * 创建路由表。
 *
 * @param {object} deps 依赖。
 * @param {object} deps.catalog 目录服务（createCatalog）。
 * @param {object} deps.store 安装目录服务（createStore）。
 * @param {object} deps.config 已解析配置（offline / indexUrls 等）。
 * @param {() => object | undefined} [deps.getSkills] 取 skills 服务（装完刷新用）。
 * @param {{ warn: Function }} [deps.logger] 日志。
 * @param {string} deps.version 插件版本（health 用）。
 * @returns {Array<{ kind: 'exact', path: string, handler: Function }>} 路由列表。
 */
export function createRoutes(deps) {
  const { catalog, store, config } = deps
  const logger = deps.logger
  const version = typeof deps.version === 'string' ? deps.version : ''
  const getSkills = typeof deps.getSkills === 'function' ? deps.getSkills : () => undefined

  /** 统一告警：日志失败不能影响响应。 */
  const warnLog = (error) => {
    try {
      if (logger && typeof logger.warn === 'function') logger.warn(error)
    } catch {
      /* 忽略 */
    }
  }

  /** 失败响应：按错误映射状态码并保留可读文案。 */
  const fail = (res, error) => {
    warnLog(error)
    sendError(res, statusOf(error), error)
  }

  /**
   * 围栏 + 方法检查。
   *
   * @param {import('node:http').IncomingMessage} req 请求。
   * @param {import('node:http').ServerResponse} res 响应。
   * @param {'GET' | 'POST'} method 要求的方法。
   * @returns {boolean} 是否继续处理。
   */
  const guard = (req, res, method) => {
    if (!isLoopback(req)) {
      sendError(res, 403, 'loopback access required')
      return false
    }
    if (req.method !== method) {
      sendError(res, 405, `method not allowed: ${String(req.method)}`)
      return false
    }
    return true
  }

  /** 解析请求 URL（无需真实 host）。 */
  const urlOf = (req) => new URL(req.url || '/', 'http://127.0.0.1')

  /**
   * 在目录里找一条技能元信息与顶层 resolve 模板。
   *
   * 先只读本地（缓存 / 快照），找不到且不在 offline 时才联网刷新一次；
   * 详情 / 安装只需要 version、license、source 与 resolve，不该为了它们干等镜像。
   *
   * @param {string} id 技能 id。
   * @returns {Promise<{ entry: object, resolve: object } | undefined>} 目录条目与取回规则。
   */
  async function findCatalogSkill(id) {
    const local = await catalog.loadLocal()
    const found = local.catalog.skills.find((skill) => skill.id === id)
    if (found !== undefined) return { entry: found, resolve: local.catalog.resolve }
    if (config !== undefined && config.offline === true) return undefined
    const fresh = await catalog.load({ installed: new Map() })
    const refreshed = fresh.catalog.skills.find((skill) => skill.id === id)
    return refreshed !== undefined ? { entry: refreshed, resolve: fresh.catalog.resolve } : undefined
  }

  /** 装完 / 卸载后让技能注册表立刻看到变化；失败只告警。 */
  function invalidateSkills() {
    try {
      const skills = getSkills()
      if (skills !== undefined && skills !== null && typeof skills.invalidateCache === 'function') {
        skills.invalidateCache()
      }
    } catch (error) {
      warnLog(error)
    }
  }

  return [
    {
      kind: 'exact',
      path: ROUTES.catalog,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = urlOf(req)
          const refresh = queryParam(url, 'refresh') === '1'
          const installed = await store.installedMap()
          sendOk(res, await catalog.load({ refresh, installed }))
        } catch (error) {
          warnLog(error)
          sendError(res, 503, error)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.installed,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          sendOk(res, await store.list())
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.detail,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const id = queryParam(urlOf(req), 'id')
          if (id === undefined || id === '' || !isValidId(id)) {
            sendError(res, 400, 'invalid skill id')
            return
          }
          const found = await findCatalogSkill(id)
          if (found === undefined) {
            sendError(res, 404, `unknown skill id: ${id}`)
            return
          }
          const entry = found.entry
          const descriptor = { version: entry.version, license: entry.license, source: entry.source, resolve: found.resolve }
          const manifest = await store.manifest(id, descriptor)
          const markdown = await store.readSkillFile(id, descriptor, 'SKILL.md')
          sendOk(res, {
            id,
            markdown: truncateToBytes(stripFrontmatter(markdown.toString('utf8')).trim(), DETAIL_MARKDOWN_LIMIT),
            files: manifest.files,
            totalBytes: manifest.totalBytes,
            license: entry.license,
            version: entry.version,
            source: entry.source,
          })
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.install,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          let body
          try {
            body = await readJson(req)
          } catch (error) {
            sendError(res, 400, errorMessage(error))
            return
          }
          const id = body !== null && typeof body === 'object' && typeof body.id === 'string' ? body.id.trim() : ''
          if (id === '' || !isValidId(id)) {
            sendError(res, 400, 'invalid skill id')
            return
          }
          const found = await findCatalogSkill(id)
          if (found === undefined) {
            sendError(res, 404, `unknown skill id: ${id}`)
            return
          }
          const entry = found.entry
          const result = await store.install(id, {
            version: entry.version,
            license: entry.license,
            source: entry.source,
            resolve: found.resolve,
          })
          invalidateSkills()
          sendOk(res, result)
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.uninstall,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          let body
          try {
            body = await readJson(req)
          } catch (error) {
            sendError(res, 400, errorMessage(error))
            return
          }
          const id = body !== null && typeof body === 'object' && typeof body.id === 'string' ? body.id.trim() : ''
          if (id === '' || !isValidId(id)) {
            sendError(res, 400, 'invalid skill id')
            return
          }
          const result = await store.uninstall(id)
          invalidateSkills()
          sendOk(res, result)
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const cached = typeof catalog.peekCache === 'function' ? await catalog.peekCache() : undefined
          const cacheAt = cached !== undefined && cached !== null && Number.isFinite(cached.fetchedAt) ? cached.fetchedAt : null
          sendOk(res, {
            version,
            upstream: config !== undefined && Array.isArray(config.indexUrls) && config.indexUrls.length > 0 ? config.indexUrls[0] : '',
            cacheAt,
            offline: config !== undefined && config.offline === true,
            skillRoot: store.installRoot,
            dshHome: store.dshHome,
          })
        } catch (error) {
          fail(res, error)
        }
      },
    },
  ]
}
