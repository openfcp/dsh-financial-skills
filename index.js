/**
 * dsh-financial-skills（金融技能）—— DeepSeek Harness 双半区插件的 Host 半区入口
 *
 * Host 半区只做一件事：把上游金融行业技能目录变成六条本机 JSON 路由，供浏览器
 * 半区读取目录、识别已安装技能、安装与卸载。它不碰 DSH 源码，也不把技能正文
 * 打进包里——运行时按 format 3 的 resolve 规则取回：skillhub 来源下载 zip 解压，
 * github 来源按 source 坐标逐文件读取（见 lib/skillhub.js 与 lib/github.js）。
 *
 *   GET  /api/financial-skills/catalog     目录（?refresh=1 强制刷新）
 *   GET  /api/financial-skills/installed   本机已安装技能
 *   GET  /api/financial-skills/detail      单个技能详情（?id=）
 *   POST /api/financial-skills/install     安装（{ id }）
 *   POST /api/financial-skills/uninstall   卸载（{ id }）
 *   GET  /api/financial-skills/health      健康检查
 *
 * 所有路由都只服务 loopback，且只在客户端传 id 的前提下工作：URL 与路径由
 * 服务端自己重建（CONTRACT §3）。
 *
 * @module dsh-financial-skills
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCatalog, cacheFileFor, DEFAULT_CACHE_TTL_MS, DEFAULT_TIMEOUT_MS, normalizeIndexUrls, SNAPSHOT_FILE } from './lib/catalog.js'
import { createSource, DEFAULT_MAX_TARBALL_BYTES, DEFAULT_TARBALL_TIMEOUT_MS, DEFAULT_TREE_TTL_MS } from './lib/github.js'
import { createSkillhub } from './lib/skillhub.js'
import { createRoutes } from './lib/routes.js'
import { createStore, DEFAULT_LIMITS, resolveDshHome, resolveInstallRoot } from './lib/store.js'

/** 稳定 cordis 插件名。 */
export const name = 'financial-skills'

/** 需要的宿主服务：只有 web 路由注册表。 */
export const inject = ['webServer']

/** 默认日志实现（ctx.logger 不可用时兜底）。 */
function createLogger(ctx) {
  return {
    warn(message) {
      try {
        if (ctx !== undefined && ctx !== null && ctx.logger !== undefined && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn(message)
          return
        }
      } catch {
        /* 落到 console */
      }
      // eslint-disable-next-line no-console
      console.warn('[financial-skills]', message)
    },
  }
}

/** 正数回落。 */
function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** 读本包 package.json 的 version；读不到返回空串。 */
export function readPackageVersion() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : ''
  } catch {
    return ''
  }
}

/**
 * 把插件配置与进程环境收敛成一份已解析配置。
 *
 * 所有字段都有默认值，非法值回落默认，绝不因为配置写错抛错到 boot
 * （CONTRACT §3）。优先级：显式配置 > 专用环境变量 > 通用默认。
 *
 * @param {unknown} [config] 插件配置。
 * @param {NodeJS.ProcessEnv} [env] 环境变量。
 * @param {string} [packageRoot] 包根（测试可覆盖）。
 * @returns {object} 已解析配置。
 */
export function resolveConfig(config, env = process.env, packageRoot = undefined) {
  const options = config !== undefined && config !== null && typeof config === 'object' ? config : {}
  const environment = env !== undefined && env !== null ? env : {}

  const dshHome = resolveDshHome(options.dshHome, environment)
  const installRoot = resolveInstallRoot(options.installRoot, dshHome, environment)

  const configuredUrls = Array.isArray(options.indexUrls) ? options.indexUrls : []
  const singleUrl = typeof options.indexUrl === 'string' && options.indexUrl.trim() !== '' ? [options.indexUrl] : []
  const indexUrls = normalizeIndexUrls([...configuredUrls, ...singleUrl])

  const cacheTtlMs = positiveNumber(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS)
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const treeTtlMs = positiveNumber(options.treeTtlMs, DEFAULT_TREE_TTL_MS)

  const offline = options.offline === true || environment.DSH_FINANCIAL_SKILLS_OFFLINE === '1'

  const fixtureDir =
    typeof options.fixtureDir === 'string' && options.fixtureDir.trim() !== ''
      ? resolve(options.fixtureDir.trim())
      : typeof environment.DSH_FINANCIAL_SKILLS_FIXTURE === 'string' && environment.DSH_FINANCIAL_SKILLS_FIXTURE.trim() !== ''
        ? resolve(environment.DSH_FINANCIAL_SKILLS_FIXTURE.trim())
        : undefined

  const cacheFile =
    typeof options.cacheFile === 'string' && options.cacheFile.trim() !== ''
      ? resolve(options.cacheFile.trim())
      : cacheFileFor(dshHome)

  const snapshotFile =
    typeof options.snapshotFile === 'string' && options.snapshotFile.trim() !== ''
      ? resolve(options.snapshotFile.trim())
      : packageRoot !== undefined
        ? join(packageRoot, 'catalog.snapshot.json')
        : SNAPSHOT_FILE

  const tarballTimeoutMs = positiveNumber(options.tarballTimeoutMs, DEFAULT_TARBALL_TIMEOUT_MS)
  const maxTarballBytes = positiveNumber(options.maxTarballBytes, DEFAULT_MAX_TARBALL_BYTES)

  const limits = {
    maxFiles: Math.floor(positiveNumber(options.maxFiles, DEFAULT_LIMITS.maxFiles)),
    maxFileBytes: Math.floor(positiveNumber(options.maxFileBytes, DEFAULT_LIMITS.maxFileBytes)),
    maxTotalBytes: Math.floor(positiveNumber(options.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes)),
  }

  return {
    dshHome,
    installRoot,
    indexUrls,
    cacheTtlMs,
    timeoutMs,
    treeTtlMs,
    tarballTimeoutMs,
    maxTarballBytes,
    offline,
    fixtureDir,
    cacheFile,
    snapshotFile,
    limits,
    fetch: typeof options.fetch === 'function' ? options.fetch : undefined,
  }
}

/**
 * 按已解析配置装配目录 / 上游 / 安装目录 / 路由。
 *
 * @param {object} config 已解析配置（resolveConfig 的返回值）。
 * @param {object} ctx cordis 上下文。
 * @returns {{ routes: Array<object>, catalog: object, store: object, source: object }} 装配结果。
 */
export function createDeps(config, ctx) {
  const logger = createLogger(ctx)
  const source = createSource({
    fetchImpl: config.fetch,
    fixtureDir: config.fixtureDir,
    timeoutMs: config.timeoutMs,
    treeTtlMs: config.treeTtlMs,
    tarballTimeoutMs: config.tarballTimeoutMs,
    maxTarballBytes: config.maxTarballBytes,
    maxFileBytes: config.limits.maxFileBytes,
    logger,
  })
  const catalog = createCatalog({
    indexUrls: config.indexUrls,
    cacheTtlMs: config.cacheTtlMs,
    timeoutMs: config.timeoutMs,
    cacheFile: config.cacheFile,
    snapshotFile: config.snapshotFile,
    offline: config.offline,
    fetchImpl: config.fetch,
    logger,
  })
  const skillhub = createSkillhub({
    fetchImpl: config.fetch,
    fixtureDir: config.fixtureDir,
    timeoutMs: config.timeoutMs,
    limits: config.limits,
    logger,
  })
  const store = createStore({
    dshHome: config.dshHome,
    installRoot: config.installRoot,
    source,
    skillhub,
    limits: config.limits,
    logger,
  })
  const getSkills = () => {
    try {
      if (ctx === undefined || ctx === null) return undefined
      // ctx.skills 是最常见的形状；某些宿主只暴露 ctx.get(name) 或根上下文。
      if (ctx.skills !== undefined && ctx.skills !== null) return ctx.skills
      if (typeof ctx.get === 'function') {
        const viaGet = ctx.get('skills')
        if (viaGet !== undefined && viaGet !== null) return viaGet
      }
      const root = ctx.root
      if (root !== undefined && root !== null && root.skills !== undefined) return root.skills
      return undefined
    } catch {
      // 服务还没就绪时读它会抛，装/卸载不能因此失败。
      return undefined
    }
  }
  /**
   * 安装 / 卸载后让技能立刻生效。
   *
   * 主通道是技能注册表的 `invalidateCache()`（每个 provider 的 control.invalidate
   * 最终都落到它）：bump revision、清空采集缓存、派发 `skills/change`。次级通道是
   * 像内置 write 工具那样广播 `fs/observed`，让其他观察者也收到变更。两条都不通时
   * 只能靠宿主自己的 chokidar 兜底（下一次扫描才生效），因此只告警、不抛错。
   *
   * @param {string[]} paths 发生变更的绝对路径。
   * @returns {Promise<{ invalidated: boolean, announced: boolean }>} 两条通道的结果。
   */
  const notifyMutation = async (paths) => {
    const list = Array.isArray(paths) ? paths.filter((entry) => typeof entry === 'string' && entry !== '') : []
    let invalidated = false
    try {
      const skills = getSkills()
      if (skills !== undefined && skills !== null && typeof skills.invalidateCache === 'function') {
        skills.invalidateCache()
        invalidated = true
      } else {
        logger.warn('[financial-skills] 技能注册表不可用（没有 invalidateCache），新装的技能要等宿主自己重扫')
      }
    } catch (error) {
      logger.warn(`[financial-skills] 技能缓存失效失败：${error instanceof Error ? error.message : String(error)}`)
    }

    let announced = false
    try {
      if (ctx !== undefined && ctx !== null && typeof ctx.emit === 'function') {
        for (const path of list) {
          let target = path
          if (ctx.fs !== undefined && ctx.fs !== null && typeof ctx.fs.resolve === 'function') {
            const resolved = await ctx.fs.resolve(path)
            if (typeof resolved === 'string' && resolved !== '') target = resolved
          }
          ctx.emit('fs/observed', target, { kind: 'present', version: String(Date.now()) }, { name: 'write' })
          announced = true
        }
      }
    } catch (error) {
      logger.warn(`[financial-skills] fs/observed 广播失败：${error instanceof Error ? error.message : String(error)}`)
    }
    return { invalidated, announced }
  }
  const routes = createRoutes({
    catalog,
    store,
    config,
    getSkills,
    notifyMutation,
    logger,
    version: readPackageVersion(),
  })
  return { routes, catalog, store, source, skillhub }
}

/** 释放一个 disposer，隔离它的异常。 */
function safeDispose(dispose) {
  try {
    if (typeof dispose === 'function') dispose()
  } catch {
    /* 释放失败不能影响其他路由 */
  }
}

/**
 * 插件挂载入口。
 *
 * 路由注册整体包在 ctx.effect 里，disposer 全部释放；配置非法或注册失败只告警，
 * 不把异常抛到 boot。
 *
 * @param {object} ctx cordis 上下文。
 * @param {unknown} [config] 插件配置。
 */
export function apply(ctx, config) {
  const logger = createLogger(ctx)
  let built
  try {
    built = createDeps(resolveConfig(config), ctx)
  } catch (error) {
    logger.warn(`[financial-skills] 初始化失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  try {
    ctx.effect(() => {
      const disposers = []
      try {
        for (const route of built.routes) disposers.push(ctx.webServer.register(route))
      } catch (error) {
        for (const dispose of disposers) safeDispose(dispose)
        throw error
      }
      return () => {
        for (const dispose of disposers) safeDispose(dispose)
      }
    }, 'financial-skills: routes')
  } catch (error) {
    logger.warn(`[financial-skills] 路由注册失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
