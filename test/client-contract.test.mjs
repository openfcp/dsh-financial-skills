/**
 * dsh-financial-skills —— 浏览器半契约测试（node --test，无第三方依赖）。
 *
 * 测试策略：
 *   1. 静态：手写 bundle 的外壳/id/锚点、文档相对 API、无第三方请求、无写死颜色；
 *   2. 运行时：用 stub 的 window.__ModuleLoader__ 捕获 factory，用 stub require 提供
 *      react（含一个极小的 hooks 运行时，可以真正渲染一遍页面树）+ 官方原语 stub；
 *   3. 注册：侧栏行（id/order/label zh+en/图标）、主区 key/inject 面、apply 容错；
 *   4. 纯函数：filterSkills / categoryCounts / summarizeMeta / relativeTime / panelId / panelLabel；
 *   5. 页面结构：标题、搜索框、10 枚分类 Pill、17 行、已安装计数、空态/加载态/错误态、
 *      视图与分类切换、详情 Modal 与安装/卸载动作。
 *
 * 注意：stub 的 React 只实现页面真正用到的 hooks（useState/useEffect/useMemo/useRef），
 * 每次 render 手动触发；这足以把副作用（fetch）与状态回写验证清楚，且不需要 jsdom。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const BUNDLE_PATH = join(REPO_ROOT, 'client.js')
const SNAPSHOT_PATH = join(REPO_ROOT, 'catalog.snapshot.json')
const BUNDLE_SOURCE = readFileSync(BUNDLE_PATH, 'utf8')
const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
const NOW = Date.now()

const PANEL_ID = 'financial-skills'
const ZH_LABEL = '金融业技能'
const EN_LABEL = 'Financial Skills'
const UPSTREAM_SITE = 'https://openfcp.github.io/awesome-financial-skills/'

//#region 极简 React 运行时（只覆盖页面用到的 hooks）
/**
 * 每个组件函数一份状态槽；render() 重置 hook 游标、执行效果（effect），
 * 状态由 setter 直接写槽，测试再手动 render 一次即可看到更新后的树。
 */
function createMiniReact() {
  const stateByComponent = new Map()
  let current = null

  const element = (type, props, ...children) => ({
    type,
    props: props === undefined || props === null ? {} : props,
    children,
  })

  const requireCurrent = () => {
    if (current === null) throw new Error('hook 在组件渲染之外被调用')
    return current
  }

  const React = {
    createElement: element,
    Fragment: Symbol.for('dsh.financial-skills.fragment'),
    useState(initial) {
      const ctx = requireCurrent()
      const index = ctx.cursor++
      if (!(index in ctx.slots)) ctx.slots[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        ctx.slots[index] = typeof next === 'function' ? next(ctx.slots[index]) : next
      }
      return [ctx.slots[index], set]
    },
    useEffect(fn) {
      requireCurrent().effects.push(fn)
    },
    useMemo(fn) {
      return fn()
    },
    useRef(initial) {
      const ctx = requireCurrent()
      const index = ctx.cursor++
      if (!(index in ctx.refs)) ctx.refs[index] = { current: initial }
      return ctx.refs[index]
    },
    useCallback(fn) {
      return fn
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
    memo(component) {
      return component
    },
    forwardRef(component) {
      return component
    },
  }

  /** 渲染一个组件（同一组件的状态跨多次 render 保留），并同步执行本次收集的 effect。 */
  function render(component, props) {
    let ctx = stateByComponent.get(component)
    if (ctx === undefined) {
      ctx = { slots: [], refs: {}, effects: [], cleanups: [] }
      stateByComponent.set(component, ctx)
    }
    ctx.cursor = 0
    ctx.effects = []
    current = ctx
    let tree
    try {
      tree = component(props)
    } finally {
      current = null
    }
    for (const effect of ctx.effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') ctx.cleanups.push(cleanup)
    }
    return tree
  }

  /** 卸载所有组件（执行 effect 清理），避免跨用例串状态。 */
  function unmountAll() {
    for (const ctx of stateByComponent.values()) {
      for (const cleanup of ctx.cleanups) cleanup()
    }
    stateByComponent.clear()
  }

  return { React, render, unmountAll }
}
//#endregion

//#region 官方原语 stub：任意导出名都得到一个可识别、身份稳定的占位组件
function createPrimitivesStub(createElement) {
  const cache = new Map()
  return new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (key === '__esModule') return false
      if (key === 'useClipboardCopy') return () => ({ copy: async () => false, copied: false })
      if (cache.has(key)) return cache.get(key)
      const stub = (props) => createElement('#stub:' + key, props === undefined ? {} : props)
      cache.set(key, stub)
      return stub
    },
  })
}
//#endregion

//#region fake document（只为 CSS 注入守卫与 document.lang 服务）
function createFakeDocument(lang) {
  const appended = []
  const head = {
    appendChild(node) {
      node.parentNode = head
      appended.push(node)
      return node
    },
  }
  return {
    documentElement: { lang },
    head,
    appended,
    querySelector(selector) {
      const match = /data-plugin-css="([^"]+)"/.exec(selector)
      if (match === null) return null
      const found = appended.find((node) => node.dataset !== undefined && node.dataset.pluginCss === match[1])
      return found === undefined ? null : found
    },
    createElement(tagName) {
      return {
        tagName,
        dataset: {},
        textContent: '',
        setAttribute(name, value) { this[name] = value },
      }
    },
  }
}
//#endregion

//#region bundle 加载器
/**
 * 捕获 window.__ModuleLoader__.load 的登记项，并用 stub require 实例化 factory。
 * @param {{lang?:string, withDocument?:boolean}} [options]
 */
function loadClient(options) {
  const opts = options === undefined ? {} : options
  const withDocument = opts.withDocument !== false
  const doc = withDocument ? createFakeDocument(opts.lang === undefined ? 'zh-CN' : opts.lang) : undefined
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const entries = []

  globalThis.window = { __ModuleLoader__: { load: (entry) => { entries.push(entry) } } }
  if (doc === undefined) delete globalThis.document
  else globalThis.document = doc

  new Function('window', BUNDLE_SOURCE)(globalThis.window)

  const mini = createMiniReact()
  const primitives = createPrimitivesStub(mini.React.createElement)
  const requireStub = (id) => {
    if (id === 'react') return mini.React
    if (id === 'react/jsx-runtime') {
      return { jsx: mini.React.createElement, jsxs: mini.React.createElement, Fragment: mini.React.Fragment }
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('浏览器半 require 了未授权的模块：' + id)
  }

  const entry = entries[0]
  const exports = entry.factory(requireStub)

  return {
    entry,
    exports,
    document: doc,
    appended: doc === undefined ? [] : doc.appended,
    primitives,
    mini,
    /** 在同一 document 上再求值一次 bundle（验证 CSS 注入幂等）。 */
    evaluateAgain() {
      const more = []
      globalThis.window = { __ModuleLoader__: { load: (item) => { more.push(item) } } }
      new Function('window', BUNDLE_SOURCE)(globalThis.window)
      return { entry: more[0], exports: more[0].factory(requireStub) }
    },
    restore() {
      mini.unmountAll()
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
    },
  }
}

/** 跑一个用例并在结束时恢复全局 window/document。 */
async function withClient(options, run) {
  const client = loadClient(options)
  try {
    await run(client)
  } finally {
    client.restore()
  }
}
//#endregion

//#region 树遍历工具
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ kind: 'text', text: String(node) })
    return
  }
  if (typeof node !== 'object') return
  visit({ kind: 'node', node })
  if (node.children !== undefined) walk(node.children, visit)
  if (node.props !== undefined && node.props.children !== undefined) walk(node.props.children, visit)
  if (node.props !== undefined) {
    for (const value of Object.values(node.props)) {
      if (value !== null && typeof value === 'object') walk(value, visit)
    }
  }
}

function elements(tree, predicate) {
  const out = []
  walk(tree, (hit) => {
    if (hit.kind === 'node' && predicate(hit.node)) out.push(hit.node)
  })
  return out
}

function texts(tree) {
  const out = []
  walk(tree, (hit) => {
    if (hit.kind === 'text') out.push(hit.text)
  })
  return out
}

function textOf(node) {
  const out = []
  walk(node, (hit) => {
    if (hit.kind === 'text') out.push(hit.text)
  })
  return out.join('')
}

function byPart(tree, part) {
  return elements(tree, (node) => node.props !== undefined && node.props['data-dsh-part'] === part)
}

/** 等异步 fetch / 状态回写落定。 */
async function flush() {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
//#endregion

//#region 数据 fixture（基于随包快照：9 类 / 17 条）
function buildFixture() {
  const installedIndexes = new Set([0, 6])
  const categories = SNAPSHOT.categories.map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    count: SNAPSHOT.skills.filter((skill) => skill.category === entry.id).length,
  }))
  const skills = SNAPSHOT.skills.map((skill, index) => {
    const installed = installedIndexes.has(index)
    const normalized = {
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      category: skill.category,
      tags: skill.tags.slice(),
      version: skill.version,
      author: skill.author,
      license: skill.license,
      source: Object.assign({}, skill.source, skill.install !== undefined && typeof skill.install.skillhub === 'string'
        ? { skillhubCommand: skill.install.skillhub }
        : {}),
      pluginPath: './plugins/' + skill.id,
      installed,
    }
    if (installed) {
      normalized.installedVersion = skill.version
      normalized.installedAt = NOW - 60 * 60 * 1000
      normalized.installedPath = '/tmp/skills/' + skill.id
    }
    return normalized
  })
  return {
    catalog: {
      id: SNAPSHOT.id,
      updated: SNAPSHOT.updated,
      title: SNAPSHOT.title,
      description: SNAPSHOT.description,
      upstreamSite: UPSTREAM_SITE,
      categories,
      skills,
    },
    meta: { source: 'cache', fetchedAt: NOW - 2 * 60 * 1000, stale: false, offline: false },
  }
}

function createFakeApi(fixture, overrides) {
  const calls = []
  const catalog = fixture.catalog
  const base = {
    catalog: async (refresh) => {
      calls.push(['catalog', refresh === true])
      return fixture
    },
    installed: async () => ({
      root: '/tmp/skills',
      count: catalog.skills.filter((skill) => skill.installed).length,
      skills: catalog.skills.filter((skill) => skill.installed).map((skill) => ({
        id: skill.id,
        name: skill.name.zh,
        version: skill.version,
        description: skill.summary.zh,
        path: skill.installedPath,
        installedAt: skill.installedAt,
        managed: true,
      })),
    }),
    detail: async (id) => {
      const skill = catalog.skills.find((entry) => entry.id === id)
      return {
        id,
        markdown: '# ' + id + '\n\n这是技能正文 `SKILL.md`。\n\n- 第一项\n- 第二项',
        files: [{ path: 'SKILL.md', size: 120 }, { path: 'README.md', size: 40 }],
        totalBytes: 160,
        license: skill !== undefined ? skill.license : 'MIT',
        version: skill !== undefined ? skill.version : '1.0.0',
        source: skill !== undefined ? skill.source : { type: 'github' },
      }
    },
    install: async (id) => {
      calls.push(['install', id])
      return { id, path: '/tmp/skills/' + id, files: 2, bytes: 160 }
    },
    uninstall: async (id) => {
      calls.push(['uninstall', id])
      return { id, trashedTo: '/tmp/skills/.trash/' + id }
    },
  }
  return { api: Object.assign(base, overrides === undefined ? {} : overrides), calls }
}

/** 取出 apply() 实际注册的侧栏图标与主区页面组件。 */
function mountComponents(client, options) {
  const opts = options === undefined ? {} : options
  const registered = []
  const injected = []
  const disposed = []
  let effectCleanup = null
  const ctx = {
    slots: {
      inject(name, callback) {
        injected.push(name)
        return callback()
      },
      register(config, component) {
        registered.push({ config, component })
        return () => { disposed.push(config) }
      },
    },
    effect(fn) {
      if (opts.withEffect === false) return undefined
      effectCleanup = fn()
      return effectCleanup
    },
    get() {
      return undefined
    },
  }
  client.exports.apply(ctx)
  const sidebar = registered.find((entry) => entry.config.name === 'sidebar.panellist')
  const main = registered.find((entry) => entry.config.name === 'main')
  return { registered, injected, disposed, effectCleanup, sidebar, main }
}
//#endregion

//#region 1. 静态契约
test('静态：bundle 外壳、id、官方模块与语义锚点', () => {
  assert.ok(BUNDLE_SOURCE.includes('window.__ModuleLoader__.load('), '必须用手写 module-loader 外壳')
  assert.ok(/id:\s*'dsh-financial-skills'/.test(BUNDLE_SOURCE), 'bundle id 必须是 dsh-financial-skills')
  assert.ok(/factory:\s*\(require\)\s*=>/.test(BUNDLE_SOURCE), '必须暴露 factory(require)')
  assert.ok(BUNDLE_SOURCE.includes("require('react')"), '必须 require react')
  assert.ok(BUNDLE_SOURCE.includes("require('@deepseek-ai/dsh-client-ui-primitives')"), '必须 require 官方原语')
  assert.ok(BUNDLE_SOURCE.includes('data-dsh-financial-skills-view'), '页面根节点必须带 data-dsh-financial-skills-view 锚点')
  assert.ok(BUNDLE_SOURCE.includes('data-dsh-plugin'), '页面根节点必须带 data-dsh-plugin')
  assert.ok(BUNDLE_SOURCE.includes('金融行业skills精选'), '页面标题必须是「金融行业skills精选」')
  assert.ok(BUNDLE_SOURCE.includes('金融业技能'), '侧栏 label 必须是「金融业技能」')
})

test('静态：API 只用文档相对路径，无第三方请求、无 alert', () => {
  for (const path of [
    'api/financial-skills/catalog',
    'api/financial-skills/installed',
    'api/financial-skills/detail?id=',
    'api/financial-skills/install',
    'api/financial-skills/uninstall',
  ]) {
    assert.ok(BUNDLE_SOURCE.includes("'" + path + "'"), '缺少文档相对路径：' + path)
  }
  assert.equal(/["'`]\/api\//.test(BUNDLE_SOURCE), false, '不得使用根绝对 /api/ 路径（会逃出 <base href="./"> 前缀）')
  assert.equal(/https?:\/\//.test(BUNDLE_SOURCE), false, 'bundle 内不得出现任何 http(s) 地址（来源站 URL 由宿主目录下发）')
  assert.equal(/<img[\s>]/.test(BUNDLE_SOURCE), false, '不得加载任何图片（图标只用字形 / 官方 icon）')
  assert.equal(/\balert\s*\(/.test(BUNDLE_SOURCE), false, '不得使用 alert')
  assert.ok(BUNDLE_SOURCE.includes("cache: 'no-store'"), '所有请求必须 cache: no-store')
  assert.ok(BUNDLE_SOURCE.includes('encodeURIComponent'), 'detail 的 id 必须编码后再拼 query')
})

test('静态：颜色/圆角只走官方 token，支持暗色与 reduced-motion', () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(BUNDLE_SOURCE), false, '不得写死十六进制颜色')
  assert.equal(/\brgba?\(/.test(BUNDLE_SOURCE), false, '不得写死 rgb/rgba 颜色')
  assert.equal(/\bhsla?\(/.test(BUNDLE_SOURCE), false, '不得写死 hsl 颜色')
  assert.ok(BUNDLE_SOURCE.includes('var(--dsw-alias-'), '颜色必须走 --dsw-alias-* token')
  assert.ok(BUNDLE_SOURCE.includes('var(--dsw-radius-xl)'), '行圆角必须走 --dsw-radius-xl')
  assert.ok(BUNDLE_SOURCE.includes('var(--dsw-radius-lg)'), '图标盒圆角必须走 --dsw-radius-lg')
  assert.ok(BUNDLE_SOURCE.includes('prefers-reduced-motion'), '必须声明 prefers-reduced-motion 关闭动画')
  assert.ok(!/body\[data-ds-dark-theme\]/.test(BUNDLE_SOURCE), '不得手写暗色覆盖：暗色由宿主 token 自动适配')

  const allowedCoreTokens = new Set(['--ds-transition-duration', '--ds-ease-in-out', '--ds-font-family-code'])
  const varNames = [...BUNDLE_SOURCE.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1])
  assert.ok(varNames.length > 20, 'CSS 应大量使用设计 token')
  for (const name of varNames) {
    assert.ok(name.startsWith('--dsw-') || allowedCoreTokens.has(name), '非官方 token：' + name)
  }
})
//#endregion

//#region 2. bundle 导出 / CSS 注入
test('bundle：inject 只依赖 slots，导出 apply / inject / __test', async () => {
  await withClient({}, async (client) => {
    assert.equal(client.entry.id, 'dsh-financial-skills')
    assert.equal(typeof client.entry.factory, 'function')
    assert.deepEqual(client.exports.inject, ['slots'])
    assert.equal(typeof client.exports.apply, 'function')
    const testExports = client.exports.__test
    for (const name of ['filterSkills', 'categoryCounts', 'summarizeMeta', 'relativeTime', 'panelId', 'panelLabel']) {
      assert.equal(typeof testExports[name], 'function', '__test 缺少 ' + name)
    }
  })
})

test('CSS：注入一次、幂等、带 data-plugin / data-plugin-css 守卫属性', async () => {
  await withClient({}, async (client) => {
    assert.equal(client.appended.length, 1, '首次求值应向 head 注入一个 style')
    const style = client.appended[0]
    assert.equal(style.tagName, 'style')
    assert.equal(style.dataset.plugin, 'dsh-financial-skills')
    assert.equal(style.dataset.pluginCss, 'dsh-financial-skills/panel.css')
    assert.ok(style.textContent.includes('.fs-page'), 'CSS 必须含页面栅格类')
    assert.ok(style.textContent.includes('.fs-title'), 'CSS 必须含标题类')
    assert.ok(style.textContent.includes('var(--dsw-alias-label-secondary)'), 'CSS 必须用官方文字 token')

    client.evaluateAgain()
    assert.equal(client.appended.length, 1, '第二次求值不得重复注入 CSS')
  })
})

test('CSS：没有 document 时求值不抛错（Node 侧可加载）', async () => {
  await withClient({ withDocument: false }, async (client) => {
    assert.equal(client.appended.length, 0)
    assert.ok(client.exports.inject !== undefined)
  })
})
//#endregion

//#region 3. 侧栏与主区注册
test('侧栏行：id / order / zh label / 16×16 线稿图标', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    assert.deepEqual(mounted.injected, ['sidebar.panellist', 'main'], '两个 seat 都要用 ctx.slots.inject 包裹')
    assert.ok(mounted.sidebar !== undefined, '缺少 sidebar.panellist 注册')
    const config = mounted.sidebar.config
    assert.equal(config.name, 'sidebar.panellist')
    assert.equal(config.id, PANEL_ID)
    assert.equal(config.order, 25)
    assert.equal(typeof config.label, 'function')
    assert.equal(config.label(), ZH_LABEL)

    const icon = client.mini.render(mounted.sidebar.component, { size: 16, active: false })
    assert.equal(icon.type, 'svg')
    assert.equal(icon.props.viewBox, '0 0 16 16')
    assert.equal(icon.props.fill, 'none')
    assert.equal(icon.props.stroke, 'currentColor')
    assert.equal(icon.props['aria-hidden'], 'true')
    assert.equal(icon.props.width, 16)
    assert.equal(icon.props.height, 16)
    assert.equal(icon.props['data-dsh-panel-entry'], PANEL_ID)
    assert.equal(icon.children.length, 4, '银行柱廊字形：地面 + 檐口 + 山花 + 立柱')
    for (const child of icon.children) {
      assert.equal(child.type, 'path')
      assert.equal(typeof child.props.d, 'string')
    }
  })
})

test('侧栏 label：document.lang 为 en* 时取 Financial Skills', async () => {
  await withClient({ lang: 'en-US' }, async (client) => {
    const mounted = mountComponents(client)
    assert.equal(mounted.sidebar.config.label(), EN_LABEL)
  })
})

test('主区注册：key = financial-skills，inject 面提供 api', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    assert.ok(mounted.main !== undefined, '缺少 main 注册')
    const config = mounted.main.config
    assert.equal(config.name, 'main')
    assert.equal(config.key, PANEL_ID)
    assert.equal(typeof config.inject, 'function')
    const face = config.inject()
    assert.ok(face !== null && typeof face === 'object')
    for (const method of ['catalog', 'installed', 'detail', 'install', 'uninstall']) {
      assert.equal(typeof face.api[method], 'function', '注入面缺少 api.' + method)
    }
    assert.equal(typeof mounted.main.component, 'function')
  })
})

test('API 客户端：文档相对路径 / no-store / POST JSON / 宿主错误信封', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const api = mounted.main.config.inject().api
    const calls = []
    const previousFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { echo: url } }) }
    }
    try {
      assert.deepEqual(await api.catalog(false), { echo: 'api/financial-skills/catalog' })
      assert.equal(calls[0].url, 'api/financial-skills/catalog')
      assert.equal(calls[0].init.cache, 'no-store')
      assert.equal(calls[0].init.credentials, 'same-origin')
      assert.equal(calls[0].init.headers.accept, 'application/json')
      assert.equal(calls[0].init.method, undefined)

      await api.catalog(true)
      assert.equal(calls[1].url, 'api/financial-skills/catalog?refresh=1')

      await api.detail('consumer protection/review')
      assert.equal(calls[2].url, 'api/financial-skills/detail?id=consumer%20protection%2Freview')

      await api.install('consumer-protection-review')
      assert.equal(calls[3].url, 'api/financial-skills/install')
      assert.equal(calls[3].init.method, 'POST')
      assert.equal(calls[3].init.cache, 'no-store')
      assert.equal(calls[3].init.headers['content-type'], 'application/json')
      assert.equal(calls[3].init.body, '{"id":"consumer-protection-review"}')

      await api.uninstall('consumer-protection-review')
      assert.equal(calls[4].url, 'api/financial-skills/uninstall')
      assert.equal(calls[4].init.body, '{"id":"consumer-protection-review"}')

      // 宿主失败信封 → 抛出宿主 error 文案（403 安全围栏）
      globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'loopback access required' }) })
      await assert.rejects(() => api.uninstall('pilot'), /loopback access required/)

      // 非 JSON 响应也不能崩，应抛 HTTP 状态
      globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('bad json') } })
      await assert.rejects(() => api.catalog(false), /HTTP 502/)
    } finally {
      globalThis.fetch = previousFetch
    }
  })
})

test('apply：容忍缺失的可选服务，且 effect 能释放两处注册', async () => {
  await withClient({}, async (client) => {
    const fake = createFakeApi(buildFixture())
    // 只有 slots：没有 ctx.get / ctx.effect 也必须正常注册
    const registered = []
    const ctx = {
      slots: {
        inject: (_name, callback) => callback(),
        register: (config) => { registered.push(config); return () => {} },
      },
    }
    assert.doesNotThrow(() => client.exports.apply(ctx))
    assert.equal(registered.length, 2)

    // 完全没有 slots：只 warn，不抛错
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      assert.doesNotThrow(() => client.exports.apply({}))
      assert.doesNotThrow(() => client.exports.apply(undefined))
    } finally {
      console.warn = originalWarn
    }

    // 有 effect：卸载回调释放两处注册
    const mounted = mountComponents(client)
    assert.equal(typeof mounted.effectCleanup, 'function')
    assert.doesNotThrow(() => mounted.effectCleanup())
    assert.equal(mounted.disposed.length, 2)
    assert.equal(typeof fake.api.catalog, 'function')
  })
})
//#endregion

//#region 4. 纯函数
test('relativeTime：刚刚 / 分钟 / 小时 / 天 / 绝对日期 / 非法值', () => {
  const testExports = loadClient({ withDocument: false }).exports.__test
  const now = 1_800_000_000_000
  assert.equal(testExports.relativeTime(now - 10 * 1000, now, 'zh'), '刚刚')
  assert.equal(testExports.relativeTime(now - 59 * 1000, now, 'zh'), '刚刚')
  assert.equal(testExports.relativeTime(now - 60 * 1000, now, 'zh'), '1 分钟前')
  assert.equal(testExports.relativeTime(now - 5 * 60 * 1000, now, 'zh'), '5 分钟前')
  assert.equal(testExports.relativeTime(now - 2 * 60 * 60 * 1000, now, 'zh'), '2 小时前')
  assert.equal(testExports.relativeTime(now - 3 * 24 * 60 * 60 * 1000, now, 'zh'), '3 天前')
  assert.equal(testExports.relativeTime(now - 40 * 24 * 60 * 60 * 1000, now, 'zh'), '2026-12-06')
  assert.equal(testExports.relativeTime(now - 5 * 60 * 1000, now, 'en'), '5 min ago')
  assert.equal(testExports.relativeTime(now - 2 * 60 * 60 * 1000, now, 'en'), '2 h ago')
  assert.equal(testExports.relativeTime(now - 3 * 24 * 60 * 60 * 1000, now, 'en'), '3 d ago')
  assert.equal(testExports.relativeTime(undefined, now, 'zh'), '')
  assert.equal(testExports.relativeTime(0, now, 'zh'), '')
  assert.equal(testExports.relativeTime(now - 10 * 1000, now + 60 * 1000, 'zh'), '1 分钟前', '未来时间戳按 0 差值处理')
})

test('filterSkills：中英文名称 / 摘要 / 标签 / id 搜索，分类与已安装叠加', () => {
  const client = loadClient({ withDocument: false })
  const testExports = client.exports.__test
  const fixture = buildFixture()
  const skills = fixture.catalog.skills

  assert.equal(testExports.filterSkills(skills, { query: 'consumer-protection-review' }).length, 1)
  assert.equal(testExports.filterSkills(skills, { query: 'Consumer Protection Review' }).length, 1)
  assert.equal(testExports.filterSkills(skills, { query: '  消保审查  ' }).some((skill) => skill.id === 'consumer-protection-review'), true)
  assert.equal(testExports.filterSkills(skills, { query: '营销材料' }).every((skill) => (
    JSON.stringify(skill).includes('营销材料')
  )), true, '摘要/标签命中应保留')
  assert.equal(testExports.filterSkills(skills, { query: '八大权益' }).length >= 1, true, '作者也应参与搜索')
  assert.equal(testExports.filterSkills(skills, { query: 'zzz-not-exist' }).length, 0)
  assert.ok(testExports.filterSkills(skills, { query: 'CONSUMER' }).length >= 1, '大小写不敏感')

  const byCategory = testExports.filterSkills(skills, { category: 'consumer-protection' })
  assert.equal(byCategory.length, 6)
  assert.equal(byCategory.every((skill) => skill.category === 'consumer-protection'), true)

  const installedOnly = testExports.filterSkills(skills, { view: 'installed' })
  assert.equal(installedOnly.length, 2)
  assert.equal(installedOnly.every((skill) => skill.installed === true), true)

  const combined = testExports.filterSkills(skills, { view: 'installed', category: 'consumer-protection', query: '消保' })
  assert.equal(combined.length, 1)
  assert.equal(combined[0].id, 'consumer-protection-review')

  // 顺序稳定，且不修改入参
  assert.deepEqual(testExports.filterSkills(skills, {}).map((skill) => skill.id), skills.map((skill) => skill.id))
  assert.equal(skills.length, 17)
  client.restore()
})

test('categoryCounts：9 个分类、17 条、0 条分类保留、未归类单独计', () => {
  const client = loadClient({ withDocument: false })
  const testExports = client.exports.__test
  const fixture = buildFixture()
  const counts = testExports.categoryCounts(fixture.catalog.categories, fixture.catalog.skills)
  assert.equal(counts.all, 17)
  assert.equal(counts.unclassified, 0)
  assert.equal(counts.byCategory['consumer-protection'], 6)
  assert.equal(counts.byCategory['office-design'], 5)
  assert.equal(counts.byCategory['data-tech'], 5)
  assert.equal(counts.byCategory['compliance-legal'], 1)
  assert.equal(counts.byCategory['risk-management'], 0)
  assert.equal(counts.byCategory['invest-trading'], 0)
  assert.equal(counts.byCategory['product-business'], 0)
  assert.equal(counts.byCategory['other'], 0)
  assert.equal(Object.keys(counts.byCategory).length, 9)

  const withOrphan = counts
  const orphanCount = testExports.categoryCounts(fixture.catalog.categories, [{ category: 'not-declared' }])
  assert.equal(orphanCount.all, 1)
  assert.equal(orphanCount.unclassified, 1)
  assert.equal(withOrphan.all, 17)
  client.restore()
})

test('summarizeMeta：cache / snapshot / offline / network 标注诚实、不把快照说成实时', () => {
  const client = loadClient({ withDocument: false })
  const testExports = client.exports.__test
  const now = 1_800_000_000_000

  const network = testExports.summarizeMeta({ source: 'network', fetchedAt: now - 90 * 1000, stale: false, offline: false }, now, 'zh')
  assert.equal(network.live, true)
  assert.equal(network.labelKey, 'meta.source.network')
  assert.equal(network.tone, 'info')
  assert.equal(network.relative, '1 分钟前')

  const cache = testExports.summarizeMeta({ source: 'cache', fetchedAt: now - 120 * 1000, stale: false, offline: false }, now, 'zh')
  assert.equal(cache.live, false)
  assert.equal(cache.stale, true)
  assert.equal(cache.labelKey, 'meta.source.cache')
  assert.equal(cache.tone, 'neutral')

  const snapshot = testExports.summarizeMeta({ source: 'snapshot', fetchedAt: 0, stale: true, offline: false, error: 'ENOTFOUND' }, now, 'zh')
  assert.equal(snapshot.live, false)
  assert.equal(snapshot.labelKey, 'meta.source.snapshot')
  assert.equal(snapshot.tone, 'warning')
  assert.equal(snapshot.error, 'ENOTFOUND')
  assert.equal(snapshot.relative, '')

  const offline = testExports.summarizeMeta({ source: 'cache', fetchedAt: now, stale: false, offline: true }, now, 'en')
  assert.equal(offline.offline, true)
  assert.equal(offline.live, false)
  assert.equal(offline.tone, 'neutral')

  const unknown = testExports.summarizeMeta(undefined, now, 'zh')
  assert.equal(unknown.source, 'snapshot')
  assert.equal(unknown.live, false)
  client.restore()
})

test('panelId / panelLabel：id 固定、label 跟随 document.lang', async () => {
  await withClient({ lang: 'zh-CN' }, async (client) => {
    assert.equal(client.exports.__test.panelId(), PANEL_ID)
    assert.equal(client.exports.__test.panelLabel(), ZH_LABEL)
  })
  await withClient({ lang: 'en-US' }, async (client) => {
    assert.equal(client.exports.__test.panelLabel(), EN_LABEL)
  })
})
//#endregion

//#region 5. 渲染页面：结构
test('渲染：页头 / 搜索 / 视图切换 / 10 枚分类 Pill / 17 行 / 已安装计数', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const PanelPage = mounted.main.component
    const fixture = buildFixture()
    const fake = createFakeApi(fixture)

    client.mini.render(PanelPage, { api: fake.api })
    await flush()
    const tree = client.mini.render(PanelPage, { api: fake.api })
    const allText = texts(tree).join('\n')

    assert.ok(allText.includes('金融行业skills精选'), '页面标题')
    assert.ok(allText.includes('为金融从业者策展'), '副标题取目录 description')
    assert.ok(allText.includes('数据源 openfcp/awesome-financial-skills'), '页头数据源行')
    assert.ok(allText.includes('更新 ' + SNAPSHOT.updated), '页头更新日期')
    assert.ok(allText.includes('本地缓存（非实时）'), 'cache 来源必须显式标注非实时')
    assert.ok(allText.includes('当前展示本地缓存目录（非实时）'), 'cache 来源必须给出「非实时」说明行')

    const root = elements(tree, (node) => node.props !== undefined && node.props['data-dsh-financial-skills-view'] !== undefined)[0]
    assert.ok(root !== undefined, '缺少 data-dsh-financial-skills-view 根节点')
    assert.equal(root.props['data-dsh-plugin'], 'financial-skills')

    const inputs = elements(tree, (node) => node.type === client.primitives.Input)
    assert.equal(inputs.length, 1)
    assert.equal(inputs[0].props.type, 'search')
    assert.equal(inputs[0].props.placeholder, '搜索名称、摘要、标签或作者')
    assert.equal(inputs[0].props['aria-label'], '搜索插件')
    assert.equal(inputs[0].children.length, 0)
    assert.equal(inputs[0].props.icon.type, client.primitives.IconSearchOutlineRegular, '搜索框必须前置官方搜索图标')

    const segmented = elements(tree, (node) => node.type === client.primitives.SegmentedControl)
    assert.equal(segmented.length, 1)
    assert.equal(segmented[0].props.id, PANEL_ID + '-view')
    assert.deepEqual(segmented[0].props.options.map((option) => option.value), ['all', 'installed'])
    assert.equal(segmented[0].props.options[0].label, '全部插件')
    assert.equal(segmented[0].props.options[1].label, '已安装 (2)')
    assert.equal(segmented[0].props.value, 'all')
    assert.equal(segmented[0].props.label, '视图')

    // SegmentedControl 的 aria-controls 指向真正存在的 tabpanel
    const viewPanel = byPart(tree, 'view-panel')
    assert.equal(viewPanel.length, 1)
    assert.equal(viewPanel[0].props.id, PANEL_ID + '-view-all-panel')
    assert.equal(viewPanel[0].props.role, 'tabpanel')
    assert.equal(viewPanel[0].props['aria-labelledby'], PANEL_ID + '-view-all')

    const pills = elements(tree, (node) => node.type === client.primitives.Pill)
    assert.equal(pills.length, 10, '「全部」+ 9 个分类 Pill')
    const allPill = pills.find((pill) => pill.props['data-category'] === 'all')
    assert.ok(textOf(allPill).includes('全部'))
    assert.ok(textOf(allPill).includes('17'))
    const consumerPill = pills.find((pill) => pill.props['data-category'] === 'consumer-protection')
    assert.ok(textOf(consumerPill).includes('消费者保护'))
    assert.ok(textOf(consumerPill).includes('6'))
    const emptyCategoryPill = pills.find((pill) => pill.props['data-category'] === 'risk-management')
    assert.ok(emptyCategoryPill !== undefined, '0 条分类也要显示')
    assert.ok(textOf(emptyCategoryPill).includes('风险管理'))
    assert.ok(textOf(emptyCategoryPill).includes('0'))
    assert.equal(pills.filter((pill) => pill.props.active === true).length, 1, '同时只有一枚分类 Pill 选中')

    const rows = elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')
    assert.equal(rows.length, 17, '17 条技能行')
    assert.equal(elements(tree, (node) => node.props !== undefined && node.props['data-dsh-part'] === 'skill-row').length, 0, 'SkillRow 是组件节点，应由组件内部渲染 li')
    const installedRows = rows.filter((row) => row.props.skill.installed === true)
    assert.equal(installedRows.length, 2)
    const installedRowTree = client.mini.render(installedRows[0].type, installedRows[0].props)
    const successTags = elements(installedRowTree, (node) => node.type === client.primitives.Tag && node.props.tone === 'success')
    assert.equal(successTags.length, 1, '已安装行要带 success Tag')
    assert.equal(textOf(successTags[0]), '已安装')

    const list = byPart(tree, 'skill-list')
    assert.equal(list.length, 1)
    const footerCounts = byPart(tree, 'footer-counts')
    assert.equal(footerCounts.length, 1)
    assert.equal(textOf(footerCounts[0]), '共 17 个 · 已安装 2 个 · 显示 17 个')
    assert.equal(elements(tree, (node) => node.type === 'img').length, 0, '不得渲染任何 img')
  })
})

test('渲染：行内结构 = 48px 字形盒 + 14/500 名称 + 12/18 两行摘要 + Tag 元信息 + 官方 Button 动作', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const fixture = buildFixture()
    const fake = createFakeApi(fixture)
    client.mini.render(mounted.main.component, { api: fake.api })
    await flush()
    const tree = client.mini.render(mounted.main.component, { api: fake.api })
    const rows = elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')
    const pending = rows.find((row) => row.props.skill.installed !== true)
    const rowTree = client.mini.render(pending.type, pending.props)
    const skill = pending.props.skill

    // 48px 字形盒：首字，不加载任何图片
    const glyphBoxes = elements(rowTree, (node) => node.props !== undefined && node.props.className === 'fs-rowIcon')
    assert.equal(glyphBoxes.length, 1)
    assert.equal(glyphBoxes[0].props['aria-hidden'], 'true')
    assert.equal(textOf(glyphBoxes[0]), Array.from(skill.name.zh)[0].toUpperCase())
    assert.equal(elements(rowTree, (node) => node.type === 'img').length, 0)

    // 名称：14/500 的文本按钮，点它开详情
    const nameButton = elements(rowTree, (node) => node.type === 'button' && node.props.className === 'fs-rowOpen')[0]
    assert.ok(nameButton !== undefined)
    assert.equal(textOf(nameButton), skill.name.zh)
    assert.equal(nameButton.props['aria-label'], '查看 ' + skill.name.zh + ' 详情')
    assert.equal(typeof nameButton.props.onClick, 'function')

    // 摘要：两行截断（-webkit-line-clamp:2 的类），title 提供全文
    const summary = elements(rowTree, (node) => node.props !== undefined && node.props.className === 'fs-rowSummary')[0]
    assert.ok(summary !== undefined)
    assert.equal(textOf(summary), skill.summary.zh)
    assert.equal(summary.props.title, skill.summary.zh)

    // Tag 元信息：分类 / v<version> / 来源类型（license 不进列表行，只在详情里如实显示）
    const rowTags = elements(rowTree, (node) => node.type === client.primitives.Tag).map((node) => textOf(node))
    assert.ok(rowTags.includes('消费者保护'))
    assert.ok(rowTags.includes('v' + skill.version))
    assert.ok(rowTags.includes('SkillHub'))
    assert.ok(!rowTags.includes('专有'), '列表行不再显示 license 标签')
    assert.equal(elements(rowTree, (node) => node.type === client.primitives.Tag && node.props.tone === 'success').length, 0)

    // 动作：ghost 详情 + primary 安装
    const buttons = elements(rowTree, (node) => node.type === client.primitives.Button)
    const buttonInfo = buttons.map((node) => ({ text: textOf(node), variant: node.props.variant, size: node.props.size }))
    assert.deepEqual(buttonInfo, [
      { text: '详情', variant: 'ghost', size: 'sm' },
      { text: '安装', variant: 'primary', size: 'sm' },
    ])

    // 已安装行：success Tag + ghost 卸载 + ghost 详情
    const installed = rows.find((row) => row.props.skill.installed === true)
    const installedTree = client.mini.render(installed.type, installed.props)
    assert.equal(elements(installedTree, (node) => node.type === client.primitives.Tag && node.props.tone === 'success').length, 1)
    const installedButtons = elements(installedTree, (node) => node.type === client.primitives.Button)
      .map((node) => ({ text: textOf(node), variant: node.props.variant }))
    assert.deepEqual(installedButtons, [
      { text: '详情', variant: 'ghost' },
      { text: '卸载', variant: 'ghost' },
    ])
  })
})

test('渲染：视图切换 / 分类筛选 / 空分类 / 搜索 / Esc 清空 / 无结果', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const PanelPage = mounted.main.component
    const fixture = buildFixture()
    const fake = createFakeApi(fixture)
    let tree

    const rowsOf = () => elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')

    client.mini.render(PanelPage, { api: fake.api })
    await flush()
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 17)

    // 切到「已安装」
    let segmented = elements(tree, (node) => node.type === client.primitives.SegmentedControl)[0]
    segmented.props.onChange('installed')
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 2)
    assert.equal(rowsOf().every((row) => row.props.skill.installed === true), true)
    assert.equal(elements(tree, (node) => node.type === client.primitives.SegmentedControl)[0].props.value, 'installed')
    assert.equal(byPart(tree, 'view-panel')[0].props.id, PANEL_ID + '-view-installed-panel', '切视图后 tabpanel id 跟随')

    // 0 条分类：给「该分类暂无工具」而不是隐藏
    const riskPill = elements(tree, (node) => node.type === client.primitives.Pill && node.props['data-category'] === 'risk-management')[0]
    riskPill.props.onClick()
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 0)
    assert.ok(texts(tree).join('\n').includes('该分类暂无工具'))
    assert.equal(elements(tree, (node) => node.type === client.primitives.Pill && node.props['data-category'] === 'risk-management')[0].props.active, true)

    // 回全部分类 + 全部插件
    elements(tree, (node) => node.type === client.primitives.Pill && node.props['data-category'] === 'all')[0].props.onClick()
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(elements(tree, (node) => node.type === client.primitives.SegmentedControl)[0].props.value, 'installed')
    elements(tree, (node) => node.type === client.primitives.SegmentedControl)[0].props.onChange('all')
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 17)

    // 按分类叠加：消费者保护 6 条
    elements(tree, (node) => node.type === client.primitives.Pill && node.props['data-category'] === 'consumer-protection')[0].props.onClick()
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 6)
    elements(tree, (node) => node.type === client.primitives.Pill && node.props['data-category'] === 'all')[0].props.onClick()
    tree = client.mini.render(PanelPage, { api: fake.api })

    // 搜索：id 精确命中
    let input = elements(tree, (node) => node.type === client.primitives.Input)[0]
    input.props.onChange({ target: { value: 'consumer-protection-review' } })
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 1)
    assert.equal(rowsOf()[0].props.skill.id, 'consumer-protection-review')
    assert.equal(elements(tree, (node) => node.type === client.primitives.Input)[0].props.value, 'consumer-protection-review')

    // 搜索：中文子串，命中行必须真的包含该词
    input = elements(tree, (node) => node.type === client.primitives.Input)[0]
    input.props.onChange({ target: { value: ' 消保 ' } })
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.ok(rowsOf().length > 1)
    for (const row of rowsOf()) {
      const skill = row.props.skill
      const haystack = [skill.id, skill.name.zh, skill.name.en, skill.summary.zh, skill.summary.en, ...skill.tags].join(' ').toLowerCase()
      assert.ok(haystack.includes('消保'), '命中行必须包含搜索词：' + skill.id)
    }

    // Esc 清空搜索
    input = elements(tree, (node) => node.type === client.primitives.Input)[0]
    input.props.onKeyDown({ key: 'Escape' })
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 17)

    // 无结果空态
    input = elements(tree, (node) => node.type === client.primitives.Input)[0]
    input.props.onChange({ target: { value: 'zzz-not-exist' } })
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.equal(rowsOf().length, 0)
    const allText = texts(tree).join('\n')
    assert.ok(allText.includes('没有匹配「zzz-not-exist」的插件'))
    assert.ok(allText.includes('查看全部插件'), '空结果应提供一键清空筛选')
  })
})
//#endregion

//#region 6. 渲染页面：加载 / 错误 / 详情 / 安装卸载
test('渲染：刷新走 catalog?refresh=1，失败降级为错误行且保留内容', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const fixture = buildFixture()
    let seenRefresh = false
    const fake = createFakeApi(fixture, {
      catalog: async (refresh) => {
        if (refresh === true) {
          seenRefresh = true
          throw new Error('ETIMEDOUT')
        }
        return fixture
      },
    })
    client.mini.render(mounted.main.component, { api: fake.api })
    await flush()
    let tree = client.mini.render(mounted.main.component, { api: fake.api })
    const rowsOf = () => elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')
    assert.equal(rowsOf().length, 17)

    const refreshButton = elements(tree, (node) => node.type === client.primitives.Button && textOf(node) === '刷新')[0]
    assert.ok(refreshButton !== undefined, '页脚必须有刷新按钮')
    refreshButton.props.onClick()
    await flush()
    assert.equal(seenRefresh, true, '点刷新必须带 refresh=1')
    tree = client.mini.render(mounted.main.component, { api: fake.api })
    const allText = texts(tree).join('\n')
    assert.ok(allText.includes('刷新失败：ETIMEDOUT'), '刷新失败要有一条错误行（不弹 alert）')
    assert.equal(rowsOf().length, 17, '刷新失败不得清空已有目录')
    assert.ok(elements(tree, (node) => node.type === client.primitives.Button && textOf(node) === '刷新').length >= 1, '失败后按钮恢复可点')
  })
})

test('渲染：快照 / 离线模式明确标注，不得说成实时', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const snapshotFixture = buildFixture()
    snapshotFixture.meta = { source: 'snapshot', fetchedAt: NOW - 5 * 1000, stale: true, offline: false, error: 'ENOTFOUND upstream' }
    const fake = createFakeApi(snapshotFixture)
    client.mini.render(mounted.main.component, { api: fake.api })
    await flush()
    const tree = client.mini.render(mounted.main.component, { api: fake.api })
    const allText = texts(tree).join('\n')
    assert.ok(allText.includes('随包快照（非实时）'))
    assert.ok(allText.includes('上游目录获取失败，当前展示随包快照（非实时）'))
    assert.ok(allText.includes('目录抓取异常：ENOTFOUND upstream'))
    assert.equal(allText.includes('上游实时目录'), false, '快照不得标注为实时')
    assert.equal(allText.includes('刚刚刷新'), false, '快照不得说成「刚刚刷新」')
    assert.equal(elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow').length, 17, '快照模式仍可浏览')
  })

  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const offlineFixture = buildFixture()
    offlineFixture.meta = { source: 'cache', fetchedAt: NOW - 60 * 1000, stale: false, offline: true }
    const fake = createFakeApi(offlineFixture)
    client.mini.render(mounted.main.component, { api: fake.api })
    await flush()
    const tree = client.mini.render(mounted.main.component, { api: fake.api })
    const allText = texts(tree).join('\n')
    assert.ok(allText.includes('离线模式：当前展示的是随包快照或本地缓存，不是实时目录'))
    assert.ok(allText.includes('本地缓存（非实时）'))
    assert.equal(allText.includes('上游实时目录'), false, '离线模式不得标注为实时')
  })
})

test('渲染：初次加载有骨架与 TextShimmer', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const fake = createFakeApi(buildFixture())
    const tree = client.mini.render(mounted.main.component, { api: fake.api })
    const allText = texts(tree).join('\n')
    assert.ok(allText.includes('正在获取金融行业插件目录…'))
    assert.equal(elements(tree, (node) => node.props !== undefined && node.props.className === 'fs-skeletonRow').length, 3)
    const shimmer = elements(tree, (node) => node.type === client.primitives.TextShimmer)
    assert.equal(shimmer.length, 1)
    assert.equal(shimmer[0].props.active, true)
    assert.equal(elements(tree, (node) => node.type === client.primitives.Button).length, 0, '加载态不渲染页脚刷新动作')
  })
})

test('渲染：目录失败给出可见错误 + 重试按钮，且重试真的再请求', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const fixture = buildFixture()
    let catalogCalls = 0
    const fake = createFakeApi(fixture, {
      catalog: async () => {
        catalogCalls += 1
        throw new Error('ECONNREFUSED 127.0.0.1')
      },
    })
    client.mini.render(mounted.main.component, { api: fake.api })
    await flush()
    let tree = client.mini.render(mounted.main.component, { api: fake.api })
    let allText = texts(tree).join('\n')
    assert.ok(allText.includes('目录获取失败'), '错误原因要可见')
    assert.ok(allText.includes('ECONNREFUSED 127.0.0.1'))
    const retry = elements(tree, (node) => node.type === client.primitives.Button && textOf(node) === '重试')
    assert.equal(retry.length, 1)

    const before = catalogCalls
    retry[0].props.onClick()
    await flush()
    assert.ok(catalogCalls > before, '点重试必须真的重新请求目录')

    tree = client.mini.render(mounted.main.component, { api: fake.api })
    assert.ok(texts(tree).join('\n').includes('目录获取失败'), '仍然失败时继续给出可操作错误')
  })
})

test('渲染：详情 Modal = MarkdownText 正文 + 元信息 + footer 动作', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const PanelPage = mounted.main.component
    const fixture = buildFixture()
    const fake = createFakeApi(fixture)
    client.mini.render(PanelPage, { api: fake.api })
    await flush()
    let tree = client.mini.render(PanelPage, { api: fake.api })

    // 打开第一条（已安装、skillhub 来源、proprietary）的详情
    const firstRow = elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')[0]
    const rowTree = client.mini.render(firstRow.type, firstRow.props)
    const openButton = elements(rowTree, (node) => node.type === 'button' && node.props.className === 'fs-rowOpen')[0]
    assert.ok(openButton !== undefined, '行名称必须可点开详情')
    assert.equal(openButton.props['aria-label'], '查看 消保审查 详情')
    openButton.props.onClick()
    tree = client.mini.render(PanelPage, { api: fake.api })

    const modalElements = elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'DetailModal')
    assert.equal(modalElements.length, 1, '点名称应打开详情 Modal')
    const detailTree = client.mini.render(modalElements[0].type, modalElements[0].props)
    await flush()
    const readyTree = client.mini.render(modalElements[0].type, modalElements[0].props)

    const modal = elements(readyTree, (node) => node.type === client.primitives.Modal)
    assert.equal(modal.length, 1)
    assert.equal(modal[0].props.open, true)
    assert.equal(modal[0].props.title, '消保审查')
    assert.equal(modal[0].props.closeLabel, '关闭')
    assert.equal(modal[0].props.className, 'fs-detail')

    const markdown = elements(readyTree, (node) => node.type === client.primitives.MarkdownText)
    assert.equal(markdown.length, 1, '正文必须用官方 MarkdownText')
    assert.ok(markdown[0].props.text.includes('这是技能正文'))
    assert.equal(markdown[0].props.variant, 'body')
    assert.equal(typeof markdown[0].props.labels, 'object')

    const allText = texts(readyTree).join('\n')
    assert.ok(allText.includes('标识'))
    assert.ok(allText.includes('consumer-protection-review'))
    assert.ok(allText.includes('版本'))
    assert.ok(allText.includes('1.0.0'))
    assert.ok(allText.includes('来源 SkillHub 的专有技能，仅本地安装使用。'), 'proprietary 必须如实提示')
    assert.ok(allText.includes('2 个文件 · 160 B'))
    assert.ok(allText.includes('安装位置'))
    assert.ok(allText.includes('/tmp/skills/consumer-protection-review'))
    assert.ok(allText.includes('skillhub install consumer-protection-review'), 'SkillHub 命令要可见（复制失败时可手抄）')

    const footerButtons = elements(readyTree, (node) => node.type === client.primitives.Button)
    const buttonTexts = footerButtons.map((node) => textOf(node))
    assert.ok(buttonTexts.includes('复制 SkillHub 命令'))
    assert.ok(buttonTexts.includes('打开来源站'))
    assert.ok(buttonTexts.includes('卸载'), '已安装技能在详情里应可卸载')
    const successTag = elements(readyTree, (node) => node.type === client.primitives.Tag && node.props.tone === 'success')
    assert.ok(successTag.length >= 1)

    // 复制不走 alert；Node 下没有 clipboard，应给出手动复制提示
    const copyButton = footerButtons.find((node) => textOf(node) === '复制 SkillHub 命令')
    await copyButton.props.onClick()
    await flush()
    const afterCopy = client.mini.render(modalElements[0].type, modalElements[0].props)
    assert.ok(texts(afterCopy).join('\n').includes('复制失败，请手动选中命令复制'))
  })
})

test('渲染：行内安装 / 卸载会调用宿主路由并给出反馈', async () => {
  await withClient({}, async (client) => {
    const mounted = mountComponents(client)
    const PanelPage = mounted.main.component
    const fixture = buildFixture()
    const fake = createFakeApi(fixture)
    client.mini.render(PanelPage, { api: fake.api })
    await flush()
    let tree = client.mini.render(PanelPage, { api: fake.api })

    const rows = elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')
    const notInstalled = rows.find((row) => row.props.skill.installed !== true)
    assert.ok(notInstalled !== undefined)
    const notInstalledRowTree = client.mini.render(notInstalled.type, notInstalled.props)
    const installButton = elements(notInstalledRowTree, (node) => node.type === client.primitives.Button && node.props.variant === 'primary')[0]
    assert.ok(installButton !== undefined, '未安装行必须有 primary 安装按钮')
    assert.equal(textOf(installButton), '安装')
    installButton.props.onClick()
    await flush()
    assert.deepEqual(fake.calls.filter((call) => call[0] === 'install'), [['install', notInstalled.props.skill.id]])

    tree = client.mini.render(PanelPage, { api: fake.api })
    const expectedName = notInstalled.props.skill.name.zh
    assert.ok(texts(tree).join('\n').includes('已安装 ' + expectedName), '安装成功要有反馈行')

    const installedRow = elements(tree, (node) => typeof node.type === 'function' && node.type.name === 'SkillRow')
      .find((row) => row.props.skill.installed === true)
    assert.ok(installedRow !== undefined)
    const installedRowTree = client.mini.render(installedRow.type, installedRow.props)
    const uninstallButton = elements(installedRowTree, (node) => node.type === client.primitives.Button && textOf(node) === '卸载')[0]
    assert.ok(uninstallButton !== undefined, '已安装行必须有 ghost 卸载按钮')
    uninstallButton.props.onClick()
    await flush()
    assert.deepEqual(fake.calls.filter((call) => call[0] === 'uninstall'), [['uninstall', installedRow.props.skill.id]])
    tree = client.mini.render(PanelPage, { api: fake.api })
    assert.ok(texts(tree).join('\n').includes('已卸载 ' + installedRow.props.skill.name.zh))
  })
})
//#endregion
