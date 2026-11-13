/**
 * dsh-financial-skills —— 浏览器半（手写 web module-loader bundle，无构建步骤）。
 *
 * 结构（自上而下）：
 *   侧栏一行（图标 + 「金融业技能」标签）   —— 只是入口，不画文字/底色
 *   主区整页「金融行业skills精选」          —— 页头标题/副标题/数据源行
 *     ├─ 工具栏：官方 Input 搜索 + 官方 SegmentedControl（全部插件 / 已安装 n）
 *     ├─ 分类条：官方 Pill × 10（全部 + 9 类，带条数）
 *     ├─ 结果列表：48px 字形盒 + 名称 14/500 + 摘要 12/18 两行截断 + Tag 元信息 + 动作
 *     ├─ 详情：官方 Modal + MarkdownText（安装/卸载/复制 SkillHub 命令/打开来源站）
 *     └─ 页脚：更新日期 · fetchedAt 相对时间 · 条数 · 刷新
 *
 * 视觉：只使用 DSH 官方设计 token（var(--dsw-*)）与官方 UI 原语
 * （@deepseek-ai/dsh-client-ui-primitives）；与官方插件页同一套栅格
 * （max-width 960、页边距 clamp(24px,4vw,48px)、标题 20/28、页内间距 32）。
 * 无 logo / 插画 / 渐变 / 大色块；暗色主题由宿主 token 自动适配；
 * prefers-reduced-motion 下关闭过渡与旋转。
 *
 * 数据：只请求同源、文档相对路径的宿主路由（<base href="./"> 存在于子路径部署），
 * 全部 cache:'no-store'；并发用自增 seq 丢弃过期响应；不加载任何第三方资源。
 *
 * 测试：纯函数通过 module.exports.__test 暴露，Node 端不必渲染即可断言
 * （见 test/client-contract.test.mjs）。
 */

if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined && typeof window.__ModuleLoader__.load === 'function') {
  window.__ModuleLoader__.load({
    id: 'dsh-financial-skills',
    factory: (require) => {
      const module = { exports: {} }
      const exports = module.exports

      const React = require('react')
      const h = React.createElement
      const P = require('@deepseek-ai/dsh-client-ui-primitives')
      const { useState, useEffect, useMemo, useRef } = React

      //#region 常量
      /** 侧栏行 id 与主区 slot key，两处必须一致（契约 §4）。 */
      const PANEL_ID = 'financial-skills'
      /** 行序：官方 Plugins=0、Schedule=10，skills-hub=40，取 25 与其共存不抢位。 */
      const PANEL_ORDER = 25
      /** 注入 CSS 的唯一标识（style[data-plugin-css="..."]），用于幂等守卫。 */
      const CSS_TAG_ID = 'dsh-financial-skills/panel.css'
      /** 视图枚举：全部插件 / 已安装。 */
      const VIEW_ALL = 'all'
      const VIEW_INSTALLED = 'installed'
      /** 分类「全部」的伪 id。 */
      const CATEGORY_ALL = 'all'

      /**
       * 宿主路由（文档相对路径）。
       *
       * 不能写成根绝对的 /api/...：宿主用 <base href="./"> 提供 GUI，子路径部署时
       * 根绝对路径会逃出前缀、打不到插件路由。官方客户端也是同样的相对写法。
       */
      const API = {
        catalog: 'api/financial-skills/catalog',
        installed: 'api/financial-skills/installed',
        detail: 'api/financial-skills/detail?id=',
        install: 'api/financial-skills/install',
        uninstall: 'api/financial-skills/uninstall',
      }
      //#endregion

      //#region 文案（zh / en 两份字典，语言取 document.documentElement.lang）
      const DICT = {
        zh: {
          'entry.label': '金融业技能',
          'page.title': '金融行业skills精选',
          'page.subtitle': '为金融从业者策展的 AI 技能清单：按业务场景分类，标注能力边界与来源。',
          'page.sourcePrefix': '数据源',
          'page.sourceRepo': 'openfcp/awesome-financial-skills',
          'page.updated': '更新 {date}',
          'search.label': '搜索插件',
          'search.placeholder': '搜索名称、摘要、标签或作者',
          'filter.viewLabel': '视图',
          'filter.all': '全部插件',
          'filter.installed': '已安装',
          'filter.categoryLabel': '按分类筛选',
          'filter.categoryAll': '全部',
          'row.detail': '详情',
          'row.install': '安装',
          'row.installing': '安装中…',
          'row.uninstall': '卸载',
          'row.uninstalling': '卸载中…',
          'row.installed': '已安装',
          'row.openAria': '查看 {name} 详情',
          'row.noSummary': '暂无摘要',
          'source.skillhub': 'SkillHub',
          'source.github': 'GitHub',
          'source.other': '其他来源',
          'license.proprietary': '专有',
          'state.loading': '正在获取金融行业插件目录…',
          'state.loadError': '目录获取失败：{error}',
          'state.retry': '重试',
          'state.emptyCategory': '该分类暂无工具',
          'state.emptyCategoryHint': '上游目录暂时没有归入「{category}」的技能，可切换其他分类。',
          'state.emptySearch': '没有匹配「{query}」的插件',
          'state.emptySearchHint': '试试名称、摘要里的关键词或标签。',
          'state.emptyInstalled': '还没有安装任何插件',
          'state.emptyInstalledHint': '在「全部插件」里选择技能后点安装。',
          'state.resetFilters': '查看全部插件',
          'footer.counts': '共 {total} 个 · 已安装 {installed} 个 · 显示 {visible} 个',
          'footer.refreshed': '{relative}刷新',
          'footer.refresh': '刷新',
          'footer.refreshing': '刷新中…',
          'meta.source.network': '上游实时目录',
          'meta.source.cache': '本地缓存（非实时）',
          'meta.source.snapshot': '随包快照（非实时）',
          'meta.offline': '离线模式',
          'meta.offlineNotice': '离线模式：当前展示的是随包快照或本地缓存，不是实时目录。安装/卸载仍需宿主联网。',
          'meta.snapshotNotice': '上游目录获取失败，当前展示随包快照（非实时）。安装仍需联网，可稍后刷新重试。',
          'meta.cacheNotice': '当前展示本地缓存目录（非实时）。可点刷新从上游重取。',
          'meta.error': '目录抓取异常：{error}',
          'action.installFailed': '安装失败：{error}',
          'action.uninstallFailed': '卸载失败：{error}',
          'action.installOk': '已安装 {name}',
          'action.uninstallOk': '已卸载 {name}',
          'action.refreshFailed': '刷新失败：{error}',
          'detail.loading': '正在加载技能说明…',
          'detail.loadError': '技能说明加载失败：{error}',
          'detail.emptyBody': '这个技能没有附带说明正文。',
          'detail.field.name': '名称',
          'detail.field.id': '标识',
          'detail.field.category': '分类',
          'detail.field.version': '版本',
          'detail.field.author': '作者',
          'detail.field.license': '许可',
          'detail.field.source': '来源',
          'detail.field.files': '文件',
          'detail.field.path': '安装位置',
          'detail.field.tags': '标签',
          'detail.filesSummary': '{count} 个文件 · {size}',
          'detail.moreFiles': '+{count} 个文件',
          'detail.copyCommand': '复制 SkillHub 命令',
          'detail.copied': '已复制',
          'detail.copyFailed': '复制失败，请手动选中命令复制',
          'detail.openSite': '打开来源站',
          'detail.proprietaryNotice': '来源 SkillHub 的专有技能，仅本地安装使用。',
          'detail.close': '关闭',
          'detail.install': '安装',
          'detail.uninstall': '卸载',
          'detail.installing': '安装中…',
          'detail.uninstalling': '卸载中…',
          'detail.markdown.copy': '复制',
          'detail.markdown.copied': '已复制',
          'detail.markdown.code': '代码',
          'detail.markdown.wrap': '自动换行',
          'detail.markdown.unwrap': '取消换行',
          'detail.markdown.footnotes': '脚注',
          'common.unknownError': '未知错误',
        },
        en: {
          'entry.label': 'Financial Skills',
          'page.title': 'Curated Financial Skills',
          'page.subtitle': 'A curated AI skill catalog for financial professionals — organized by business scenario, with capability boundaries and provenance made explicit.',
          'page.sourcePrefix': 'Data source',
          'page.sourceRepo': 'openfcp/awesome-financial-skills',
          'page.updated': 'Updated {date}',
          'search.label': 'Search skills',
          'search.placeholder': 'Search name, summary, tag or author',
          'filter.viewLabel': 'View',
          'filter.all': 'All skills',
          'filter.installed': 'Installed',
          'filter.categoryLabel': 'Filter by category',
          'filter.categoryAll': 'All',
          'row.detail': 'Details',
          'row.install': 'Install',
          'row.installing': 'Installing…',
          'row.uninstall': 'Uninstall',
          'row.uninstalling': 'Uninstalling…',
          'row.installed': 'Installed',
          'row.openAria': 'View {name} details',
          'row.noSummary': 'No summary yet',
          'source.skillhub': 'SkillHub',
          'source.github': 'GitHub',
          'source.other': 'Other',
          'license.proprietary': 'Proprietary',
          'state.loading': 'Loading the financial skills catalog…',
          'state.loadError': 'Could not load the catalog: {error}',
          'state.retry': 'Retry',
          'state.emptyCategory': 'No skills in this category yet',
          'state.emptyCategoryHint': 'The upstream catalog has no skills under "{category}" right now. Try another category.',
          'state.emptySearch': 'No skills match "{query}"',
          'state.emptySearchHint': 'Try a keyword from the name or summary, or a tag.',
          'state.emptyInstalled': 'No skills installed yet',
          'state.emptyInstalledHint': 'Pick a skill under "All skills" and press Install.',
          'state.resetFilters': 'Show all skills',
          'footer.counts': '{total} total · {installed} installed · {visible} shown',
          'footer.refreshed': 'Refreshed {relative}',
          'footer.refresh': 'Refresh',
          'footer.refreshing': 'Refreshing…',
          'meta.source.network': 'Live from upstream',
          'meta.source.cache': 'Local cache (not live)',
          'meta.source.snapshot': 'Bundled snapshot (not live)',
          'meta.offline': 'Offline mode',
          'meta.offlineNotice': 'Offline mode: showing a bundled snapshot or local cache, not the live catalog. Install and uninstall still need the host to reach the network.',
          'meta.snapshotNotice': 'The upstream catalog could not be fetched, so the bundled snapshot is shown (not live). Installing still needs the network — refresh to retry later.',
          'meta.cacheNotice': 'Showing the locally cached catalog (not live). Press Refresh to fetch from upstream again.',
          'meta.error': 'Catalog fetch issue: {error}',
          'action.installFailed': 'Install failed: {error}',
          'action.uninstallFailed': 'Uninstall failed: {error}',
          'action.installOk': 'Installed {name}',
          'action.uninstallOk': 'Uninstalled {name}',
          'action.refreshFailed': 'Refresh failed: {error}',
          'detail.loading': 'Loading skill instructions…',
          'detail.loadError': 'Could not load the skill: {error}',
          'detail.emptyBody': 'This skill ships no instruction body.',
          'detail.field.name': 'Name',
          'detail.field.id': 'ID',
          'detail.field.category': 'Category',
          'detail.field.version': 'Version',
          'detail.field.author': 'Author',
          'detail.field.license': 'License',
          'detail.field.source': 'Source',
          'detail.field.files': 'Files',
          'detail.field.path': 'Installed at',
          'detail.field.tags': 'Tags',
          'detail.filesSummary': '{count} files · {size}',
          'detail.moreFiles': '+{count} files',
          'detail.copyCommand': 'Copy SkillHub command',
          'detail.copied': 'Copied',
          'detail.copyFailed': 'Copy failed — select the command and copy it manually',
          'detail.openSite': 'Open upstream site',
          'detail.proprietaryNotice': 'Proprietary skill from SkillHub — local installation only.',
          'detail.close': 'Close',
          'detail.install': 'Install',
          'detail.uninstall': 'Uninstall',
          'detail.installing': 'Installing…',
          'detail.uninstalling': 'Uninstalling…',
          'detail.markdown.copy': 'Copy',
          'detail.markdown.copied': 'Copied',
          'detail.markdown.code': 'Code',
          'detail.markdown.wrap': 'Wrap',
          'detail.markdown.unwrap': 'Unwrap',
          'detail.markdown.footnotes': 'Footnotes',
          'common.unknownError': 'unknown error',
        },
      }

      /** 当前界面语言：document.lang 以 en 开头取 en，其余一律 zh。 */
      function currentLang() {
        const raw = typeof document !== 'undefined' && document.documentElement !== undefined && typeof document.documentElement.lang === 'string'
          ? document.documentElement.lang
          : ''
        return raw.toLowerCase().startsWith('en') ? 'en' : 'zh'
      }

      /** 当前语言的字典副本（面板行 label 在渲染时也走这里，支持运行时切语言）。 */
      function dictionary() {
        return DICT[currentLang()]
      }

      /**
       * 取一条文案，支持 {name} 占位插值。
       * @param {string} key 字典键
       * @param {Record<string, string|number>} [values] 插值参数
       * @returns {string} 文案；缺键时回退为键名
       */
      function tt(key, values) {
        const table = dictionary()
        let text = typeof table[key] === 'string' ? table[key] : key
        if (values !== undefined) {
          for (const name of Object.keys(values)) {
            text = text.replaceAll('{' + name + '}', String(values[name]))
          }
        }
        return text
      }
      //#endregion

      //#region 纯函数（无 DOM 依赖，__test 导出供 Node 契约测试）
      /**
       * 取本地化字段：优先当前语言，缺失回退另一语言。
       * @param {unknown} value 形如 {zh,en} 的字段
       * @param {string} lang 当前语言
       * @returns {string}
       */
      function pickLocalized(value, lang) {
        if (typeof value === 'string') return value
        if (value === undefined || value === null || typeof value !== 'object') return ''
        const primary = value[lang]
        if (typeof primary === 'string' && primary !== '') return primary
        const other = value[lang === 'en' ? 'zh' : 'en']
        return typeof other === 'string' ? other : ''
      }

      /** 规范化搜索串：去首尾空白、转小写。 */
      function normalizeQuery(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : ''
      }

      /** 一个技能参与搜索匹配的所有字段（id / 中英文名 / 中英文摘要 / 标签 / 作者）。 */
      function searchableFields(skill) {
        if (skill === undefined || skill === null) return []
        const name = skill.name !== undefined && skill.name !== null ? skill.name : {}
        const summary = skill.summary !== undefined && skill.summary !== null ? skill.summary : {}
        const tags = Array.isArray(skill.tags) ? skill.tags : []
        return [skill.id, name.zh, name.en, summary.zh, summary.en, skill.author, ...tags]
          .filter((field) => typeof field === 'string' && field !== '')
          .map((field) => field.toLowerCase())
      }

      /**
       * 单个技能是否命中搜索词（大小写不敏感，子串匹配）。
       * @param {object} skill 归一化技能
       * @param {string} query 原始搜索词（内部 trim + lowercase）
       * @returns {boolean}
       */
      function matchesQuery(skill, query) {
        const text = normalizeQuery(query)
        if (text === '') return true
        return searchableFields(skill).some((field) => field.includes(text))
      }

      /**
       * 叠加「搜索 + 分类 + 视图」三个筛选条件（顺序稳定，不重排）。
       * @param {Array<object>} skills 归一化技能数组
       * @param {{query?:string, category?:string, view?:string}} [options] 筛选条件
       * @returns {Array<object>} 命中的技能
       */
      function filterSkills(skills, options) {
        const list = Array.isArray(skills) ? skills : []
        const opts = options === undefined || options === null ? {} : options
        const query = normalizeQuery(opts.query)
        const category = typeof opts.category === 'string' && opts.category !== '' ? opts.category : CATEGORY_ALL
        const view = opts.view === VIEW_INSTALLED ? VIEW_INSTALLED : VIEW_ALL
        return list.filter((skill) => {
          if (category !== CATEGORY_ALL && skill.category !== category) return false
          if (view === VIEW_INSTALLED && skill.installed !== true) return false
          return matchesQuery(skill, query)
        })
      }

      /**
       * 统计每个分类的条数（以及全部条数），分类以目录声明为准。
       * 未声明分类的条目计入 unclassified，不悄悄塞进「其他」。
       * @param {Array<{id:string}>} categories 目录分类
       * @param {Array<{category:string}>} skills 技能
       * @returns {{all:number, byCategory:Record<string,number>, unclassified:number}}
       */
      function categoryCounts(categories, skills) {
        const list = Array.isArray(skills) ? skills : []
        const known = Array.isArray(categories) ? categories : []
        const byCategory = {}
        for (const category of known) {
          if (category !== null && category !== undefined && typeof category.id === 'string' && category.id !== '') {
            byCategory[category.id] = 0
          }
        }
        let unclassified = 0
        for (const skill of list) {
          const id = skill !== null && skill !== undefined && typeof skill.category === 'string' ? skill.category : ''
          if (id === '' || !(id in byCategory)) {
            unclassified += 1
            continue
          }
          byCategory[id] += 1
        }
        return { all: list.length, byCategory, unclassified }
      }

      /**
       * 相对时间（12/18 caption 用）。桶：<1 分钟「刚刚」、<1 小时「n 分钟前」、
       * <1 天「n 小时前」、<30 天「n 天前」，再久给绝对日期。未来时间按 0 处理。
       * @param {number|string} value 时间戳
       * @param {number} [now] 当前时间（测试注入用）
       * @param {string} [lang] 'zh' | 'en'
       * @returns {string}
       */
      function relativeTime(value, now, lang) {
        const ts = typeof value === 'number' ? value : Number(value)
        if (!Number.isFinite(ts) || ts <= 0) return ''
        const current = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
        const language = lang === 'en' || lang === 'zh' ? lang : currentLang()
        const MINUTE = 60 * 1000
        const HOUR = 60 * MINUTE
        const DAY = 24 * HOUR
        const diff = Math.max(0, current - ts)
        if (diff < MINUTE) return language === 'en' ? 'just now' : '刚刚'
        if (diff < HOUR) {
          const minutes = Math.floor(diff / MINUTE)
          return language === 'en' ? minutes + ' min ago' : minutes + ' 分钟前'
        }
        if (diff < DAY) {
          const hours = Math.floor(diff / HOUR)
          return language === 'en' ? hours + ' h ago' : hours + ' 小时前'
        }
        if (diff < 30 * DAY) {
          const days = Math.floor(diff / DAY)
          return language === 'en' ? days + ' d ago' : days + ' 天前'
        }
        return new Date(ts).toISOString().slice(0, 10)
      }

      /**
       * 把宿主 meta 归一成一个只讲事实的展示摘要。
       * 只有 source === 'network' 且非离线才算 live；cache / snapshot / offline 一律显式标注「非实时」。
       * @param {object} meta 宿主 meta（source/fetchedAt/stale/offline/error）
       * @param {number} [now] 当前时间
       * @param {string} [lang] 语言
       * @returns {{source:string, live:boolean, stale:boolean, offline:boolean, labelKey:string, tone:string, fetchedAt:number, relative:string, error:(string|undefined)}}
       */
      function summarizeMeta(meta, now, lang) {
        const input = meta !== null && meta !== undefined ? meta : {}
        const declared = typeof input.source === 'string' ? input.source : ''
        const source = declared === 'network' || declared === 'cache' ? declared : 'snapshot'
        const offline = input.offline === true
        const fetchedAt = typeof input.fetchedAt === 'number' && Number.isFinite(input.fetchedAt) ? input.fetchedAt : 0
        const error = typeof input.error === 'string' && input.error !== '' ? input.error : undefined
        const labelKey = source === 'network'
          ? 'meta.source.network'
          : source === 'cache'
            ? 'meta.source.cache'
            : 'meta.source.snapshot'
        const tone = source === 'network' && !offline ? 'info' : source === 'cache' ? 'neutral' : 'warning'
        return {
          source,
          live: source === 'network' && !offline,
          stale: input.stale === true || source !== 'network' || offline,
          offline,
          labelKey,
          tone,
          fetchedAt,
          relative: relativeTime(fetchedAt, now, lang),
          error,
        }
      }

      /** 侧栏行 / 主区 slot 共用的 id。 */
      function panelId() {
        return PANEL_ID
      }

      /** 侧栏行 label（渲染时取当前 document.lang，支持运行时切换）。 */
      function panelLabel() {
        return tt('entry.label')
      }

      /** 人类可读体积（详情页文件总大小用）。 */
      function formatBytes(value) {
        const bytes = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
      }

      /** 48px 字形盒里的首字（不加载任何第三方图片）。 */
      function skillInitial(skill, lang) {
        const name = pickLocalized(skill !== null && skill !== undefined ? skill.name : undefined, lang)
        const source = name !== '' ? name : skill !== null && skill !== undefined && typeof skill.id === 'string' ? skill.id : '?'
        const chars = Array.from(source)
        return chars.length > 0 ? chars[0].toUpperCase() : '?'
      }

      /** 分类 id → 本地化分类名（找不到时回退 id 本身，不隐藏分类）。 */
      function categoryTitle(categories, id, lang) {
        const list = Array.isArray(categories) ? categories : []
        const hit = list.find((category) => category !== null && category !== undefined && category.id === id)
        if (hit === undefined) return typeof id === 'string' ? id : ''
        const title = pickLocalized(hit.title, lang)
        return title !== '' ? title : String(id)
      }

      /** 错误对象/字符串 → 一行可读文本。 */
      function errorText(error) {
        if (error instanceof Error && error.message !== '') return error.message
        if (typeof error === 'string' && error !== '') return error
        return tt('common.unknownError')
      }

      /** MarkdownText 的界面文案（代码块工具条 / 脚注），须保持引用稳定。 */
      function markdownLabels() {
        return {
          code: {
            copyLabel: tt('detail.markdown.copy'),
            copiedLabel: tt('detail.markdown.copied'),
            toolbarLabels: {
              codeLabel: tt('detail.markdown.code'),
              wrapLabel: tt('detail.markdown.wrap'),
              unwrapLabel: tt('detail.markdown.unwrap'),
            },
          },
          footnotes: tt('detail.markdown.footnotes'),
        }
      }
      //#endregion

      //#region API（同源 fetch，统一信封 {ok, value|error}）
      /**
       * 发一个宿主 JSON 请求。
       * @param {string} url 文档相对路径
       * @param {{method?:string, body?:unknown}} [options]
       * @returns {Promise<unknown>} 信封里的 value
       */
      async function requestJson(url, options) {
        const init = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options === undefined ? {} : options)
        init.headers = Object.assign({ accept: 'application/json' }, init.headers === undefined ? {} : init.headers)
        if (init.body !== undefined && typeof init.body !== 'string') {
          init.headers['content-type'] = 'application/json'
          init.body = JSON.stringify(init.body)
        }
        const response = await fetch(url, init)
        let payload = null
        try {
          payload = await response.json()
        } catch (error) {
          payload = null
        }
        if (!response.ok || payload === null || payload.ok !== true) {
          const message = payload !== null && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status
          throw new Error(message)
        }
        return payload.value
      }

      /** 宿主路由客户端。客户端只传 id，不传 URL / 路径（安全围栏在宿主侧）。 */
      function createApi() {
        return {
          catalog: (refresh) => requestJson(API.catalog + (refresh === true ? '?refresh=1' : '')),
          installed: () => requestJson(API.installed),
          detail: (id) => requestJson(API.detail + encodeURIComponent(id)),
          install: (id) => requestJson(API.install, { method: 'POST', body: { id } }),
          uninstall: (id) => requestJson(API.uninstall, { method: 'POST', body: { id } }),
        }
      }

      /** 复制纯文本；失败返回 false（UI 给手动复制提示，不弹 alert）。 */
      async function copyText(text) {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text)
            return true
          }
        } catch (error) {
          return false
        }
        return false
      }

      /** 打开上游站点（用户显式点击才发生；不预取、不埋点）。 */
      function openExternal(url) {
        if (typeof url !== 'string' || url === '') return
        try {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(url, '_blank', 'noopener,noreferrer')
          }
        } catch (error) {
          /* 弹窗被拦截时静默：不影响页面其余功能 */
        }
      }
      //#endregion

      //#region 样式（只用官方 token；颜色/圆角/边框全部走 var(--dsw-*)）
      const CSS = `
.fs-view{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;height:100%;min-height:0}
.fs-page{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:32px;height:100%;min-height:0;padding:0 clamp(24px,4vw,48px) 48px;overflow:hidden auto;color:var(--dsw-alias-label-primary)}
.fs-pageHead{box-sizing:border-box;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;width:100%;max-width:960px;padding-top:28px}
.fs-headMain{min-width:0}
.fs-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.fs-intro{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.fs-sourceLine{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.fs-content{display:flex;flex-direction:column;gap:24px;width:100%;max-width:960px;min-width:0}
.fs-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.fs-searchField{flex:1 1 240px;min-width:0;max-width:320px}
.fs-toolbarSpacer{flex:1}
.fs-categoryBar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fs-panelBody{display:flex;flex-direction:column;gap:24px;min-width:0}
.fs-pillCount{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.fs-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.fs-row{border-radius:var(--dsw-radius-xl);margin:0 -8px;min-width:0;transition:background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out)}
.fs-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.fs-rowHead{display:flex;align-items:center;gap:14px;padding:8px}
.fs-rowIcon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:48px;height:48px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-secondary);font-size:18px;font-weight:500;line-height:1;overflow:hidden}
.fs-rowMain{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.fs-rowTitleRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.fs-rowOpen{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:0 0;color:inherit;font:inherit;font-size:14px;font-weight:500;line-height:20px;text-align:left;cursor:pointer}
.fs-rowOpen:hover{text-decoration:underline;text-underline-offset:3px}
.fs-rowSummary{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.fs-rowMeta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.fs-rowEnd{display:inline-flex;flex:none;align-items:center;gap:8px}
.fs-state{display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px 16px;text-align:center}
.fs-stateText{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.fs-stateIcon{color:var(--dsw-alias-label-caption)}
.fs-stateHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.fs-banner{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.fs-notice{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere}
.fs-noticeRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.fs-noticeOk{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary);overflow-wrap:anywhere}
.fs-skeletons{display:flex;flex-direction:column;gap:2px;width:100%}
.fs-skeletonRow{display:flex;align-items:center;gap:14px;padding:8px}
.fs-skeletonIcon{width:48px;height:48px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-skeleton)}
.fs-skeletonLines{flex:1;height:40px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-skeleton)}
.fs-footer{display:flex;flex-wrap:wrap;align-items:center;gap:12px;width:100%;padding:8px 0 4px;border-top:.5px solid var(--dsw-alias-border-l2)}
.fs-footerText{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.fs-footerSpacer{flex:1}
.fs-detail{width:min(720px,100%);max-height:min(760px,100%)}
.fs-detailContent{min-height:0;overflow-y:auto}
.fs-detailMeta{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0 0 16px;padding:0 0 16px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px}
.fs-detailKey{margin:0;color:var(--dsw-alias-label-caption);white-space:nowrap}
.fs-detailValue{margin:0;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.fs-detailSource{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fs-detailTags{display:flex;flex-wrap:wrap;gap:6px}
.fs-detailBody{min-width:0}
.fs-detailFoot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;width:100%}
.fs-detailFootMeta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.fs-detailFootActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fs-code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12.5px}
.fs-fileList{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 0}
.fs-footHintOk{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}
.fs-footHintError{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.fs-spin{animation:fs-spin 1s linear infinite}
@keyframes fs-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.fs-view *,.fs-view *::before,.fs-view *::after{animation:none!important;transition:none!important}}
`

      /**
       * 把面板 CSS 注入 document.head，只注入一次。
       * 守卫与已装插件一致：靠 style[data-plugin-css] 查重，挂载 data-plugin 标记。
       */
      function patchStyle() {
        if (typeof document === 'undefined') return
        const selector = 'style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']'
        if (document.querySelector(selector) !== null) return
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-financial-skills'
        tag.dataset.pluginCss = CSS_TAG_ID
        tag.textContent = CSS
        if (document.head !== null && document.head !== undefined) document.head.appendChild(tag)
      }

      patchStyle()
      //#endregion

      //#region 侧栏图标（只画 16×16 线稿，颜色跟随 currentColor，不画文字/底色）
      /**
       * 银行柱廊字形：山花 + 檐口 + 三根立柱 + 地面线。
       * @param {{size?:number, active?:boolean}} props 宿主给的方形边长与选中态
       * @returns {object} svg 元素
       */
      function PanelIcon({ size, active }) {
        const edge = typeof size === 'number' && Number.isFinite(size) ? size : 16
        return h('svg', {
          'data-dsh-panel-entry': PANEL_ID,
          'data-dsh-part': 'panel-icon',
          'data-active': active === true ? 'true' : undefined,
          viewBox: '0 0 16 16',
          width: edge,
          height: edge,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
          h('path', { key: 'ground', d: 'M1.75 13.25h12.5' }),
          h('path', { key: 'cornice', d: 'M2.5 6.5h11' }),
          h('path', { key: 'pediment', d: 'M8 2.75 13.5 6.5h-11z' }),
          h('path', { key: 'columns', d: 'M4.25 8.75v4.5M8 8.75v4.5M11.75 8.75v4.5' }),
        )
      }
      //#endregion

      //#region 列表行
      /**
       * 一条技能行：左 48px 字形盒（首字，不加载图片），中间名称 + 两行摘要 + Tag 元信息，
       * 右侧官方 Button（未装 primary 安装 / 已装 ghost 卸载 + 详情）。点名称开详情 Modal。
       */
      function SkillRow(props) {
        const skill = props.skill
        const lang = props.lang
        const busy = props.busy
        const installed = skill.installed === true
        const rowBusy = busy !== undefined && busy !== null && busy.id === skill.id
        const installing = rowBusy && busy.kind === 'install'
        const uninstalling = rowBusy && busy.kind === 'uninstall'
        const displayName = pickLocalized(skill.name, lang) || skill.id
        const summary = pickLocalized(skill.summary, lang)
        const sourceType = skill.source !== null && skill.source !== undefined ? skill.source.type : undefined
        const sourceLabel = tt(sourceType === 'github' ? 'source.github' : sourceType === 'skillhub' ? 'source.skillhub' : 'source.other')
        const version = typeof skill.version === 'string' && skill.version !== '' ? skill.version : ''
        const metaTags = [
          h(P.Tag, { key: 'category', tone: 'outline' }, props.categoryTitle),
          version !== '' ? h(P.Tag, { key: 'version', tone: 'outline' }, 'v' + version) : null,
          h(P.Tag, { key: 'source', tone: 'outline' }, sourceLabel),
          installed ? h(P.Tag, { key: 'installed', tone: 'success' }, tt('row.installed')) : null,
        ].filter((node) => node !== null)

        return h('li', { className: 'fs-row', 'data-dsh-part': 'skill-row', 'data-skill': skill.id },
          h('div', { className: 'fs-rowHead' },
            h('span', { className: 'fs-rowIcon', 'aria-hidden': 'true' }, skillInitial(skill, lang)),
            h('div', { className: 'fs-rowMain' },
              h('div', { className: 'fs-rowTitleRow' },
                h('button', {
                  type: 'button',
                  className: 'fs-rowOpen',
                  'aria-label': tt('row.openAria', { name: displayName }),
                  onClick: props.onOpen,
                }, displayName),
              ),
              h('span', {
                className: 'fs-rowSummary',
                title: summary !== '' ? summary : undefined,
              }, summary !== '' ? summary : tt('row.noSummary')),
              h('div', { className: 'fs-rowMeta' }, metaTags),
            ),
            h('div', { className: 'fs-rowEnd' },
              h(P.Button, {
                size: 'sm',
                variant: 'ghost',
                onClick: props.onOpen,
              }, tt('row.detail')),
              installed
                ? h(P.Button, {
                  size: 'sm',
                  variant: 'ghost',
                  disabled: rowBusy,
                  onClick: props.onUninstall,
                }, uninstalling ? tt('row.uninstalling') : tt('row.uninstall'))
                : h(P.Button, {
                  size: 'sm',
                  variant: 'primary',
                  disabled: rowBusy,
                  onClick: props.onInstall,
                }, installing ? tt('row.installing') : tt('row.install')),
            ),
          ),
        )
      }
      //#endregion

      //#region 详情 Modal
      /**
       * 详情弹窗：官方 Modal + MarkdownText 正文 + 元信息 + footer 动作。
       * 正文按需请求 detail 路由；加载中 / 失败都有可见状态且有重试。
       */
      function DetailModal(props) {
        const id = props.id
        const skill = props.skill
        const catalog = props.catalog
        const lang = props.lang
        const busy = props.busy
        const [detail, setDetail] = useState(undefined)
        const [phase, setPhase] = useState('loading')
        const [error, setError] = useState('')
        const [copyState, setCopyState] = useState('')
        const loadSeq = useRef(0)

        const load = async () => {
          const seq = ++loadSeq.current
          setPhase('loading')
          setError('')
          try {
            const value = await props.api.detail(id)
            if (seq !== loadSeq.current) return
            setDetail(value)
            setPhase('ready')
          } catch (err) {
            if (seq !== loadSeq.current) return
            setError(errorText(err))
            setPhase('error')
          }
        }

        useEffect(() => {
          load()
        }, [id])

        const labels = useMemo(() => markdownLabels(), [lang])
        const displayName = skill !== undefined ? pickLocalized(skill.name, lang) || id : id
        const summary = skill !== undefined ? pickLocalized(skill.summary, lang) : ''
        const installed = skill !== undefined && skill.installed === true
        const idBusy = busy !== undefined && busy !== null && busy.id === id
        const installing = idBusy && busy.kind === 'install'
        const uninstalling = idBusy && busy.kind === 'uninstall'
        const sourceType = skill !== undefined && skill.source !== null && skill.source !== undefined ? skill.source.type : undefined
        const sourceLabel = tt(sourceType === 'github' ? 'source.github' : sourceType === 'skillhub' ? 'source.skillhub' : 'source.other')
        const command = skill !== undefined && skill.source !== null && skill.source !== undefined && typeof skill.source.skillhubCommand === 'string'
          ? skill.source.skillhubCommand
          : ''
        const license = detail !== undefined && typeof detail.license === 'string' && detail.license !== ''
          ? detail.license
          : skill !== undefined && typeof skill.license === 'string' ? skill.license : ''
        const version = detail !== undefined && typeof detail.version === 'string' && detail.version !== ''
          ? detail.version
          : skill !== undefined && typeof skill.version === 'string' ? skill.version : ''
        const markdown = detail !== undefined && typeof detail.markdown === 'string' ? detail.markdown : ''
        const files = detail !== undefined && Array.isArray(detail.files) ? detail.files : []
        const totalBytes = detail !== undefined && typeof detail.totalBytes === 'number' ? detail.totalBytes : 0
        const upstreamSite = catalog !== undefined && typeof catalog.upstreamSite === 'string' ? catalog.upstreamSite : ''

        /** 详情元信息 dl：键值成对，空值直接不渲染该行。 */
        const metaPairs = []
        const addPair = (key, node) => {
          if (node === undefined || node === null) return
          metaPairs.push(h('dt', { className: 'fs-detailKey', key: 'k' + metaPairs.length }, tt(key)))
          metaPairs.push(h('dd', { className: 'fs-detailValue', key: 'v' + metaPairs.length }, node))
        }
        addPair('detail.field.name', displayName)
        addPair('detail.field.id', h('code', { className: 'fs-code' }, id))
        addPair('detail.field.category', categoryTitle(catalog !== undefined ? catalog.categories : undefined, skill !== undefined ? skill.category : '', lang))
        addPair('detail.field.version', version !== '' ? version : undefined)
        addPair('detail.field.author', skill !== undefined && typeof skill.author === 'string' && skill.author !== '' ? skill.author : undefined)
        addPair('detail.field.license', license !== '' ? h(P.Tag, {
          tone: license === 'proprietary' ? 'warning' : 'outline',
        }, license === 'proprietary' ? tt('license.proprietary') : license) : undefined)
        addPair('detail.field.source', h('span', { className: 'fs-detailSource' },
          sourceLabel,
          command !== '' ? h('code', { className: 'fs-code', 'data-dsh-part': 'skillhub-command' }, command) : null,
        ))
        addPair('detail.field.tags', skill !== undefined && Array.isArray(skill.tags) && skill.tags.length > 0
          ? h('span', { className: 'fs-detailTags' }, skill.tags.map((tag) => h(P.Tag, { key: String(tag), tone: 'quiet' }, String(tag))))
          : undefined)
        addPair('detail.field.files', phase === 'ready'
          ? tt('detail.filesSummary', { count: String(files.length), size: formatBytes(totalBytes) })
          : undefined)
        addPair('detail.field.path', installed && typeof skill.installedPath === 'string' && skill.installedPath !== ''
          ? h('code', { className: 'fs-code' }, skill.installedPath)
          : undefined)

        /** 正文区：加载 / 失败 / 就绪三态。 */
        let body
        if (phase === 'loading') {
          body = h('div', { className: 'fs-state', 'data-dsh-part': 'detail-loading', role: 'status' },
            h(P.TextShimmer, { active: true, className: 'fs-stateText' }, tt('detail.loading')),
          )
        } else if (phase === 'error') {
          body = h('div', { className: 'fs-state', 'data-dsh-part': 'detail-error' },
            h(P.IconWarningTriangleOutlineRegular, { size: 28, className: 'fs-stateIcon' }),
            h('p', { className: 'fs-stateText' }, tt('detail.loadError', { error })),
            h(P.Button, {
              size: 'sm',
              variant: 'outline',
              icon: h(P.IconRefreshOutlineRegular, { size: 16 }),
              onClick: () => { load() },
            }, tt('state.retry')),
          )
        } else {
          const bodyParts = [
            h('dl', { className: 'fs-detailMeta', 'data-dsh-part': 'detail-meta', key: 'meta' }, metaPairs),
            license === 'proprietary'
              ? h('p', { className: 'fs-notice', 'data-dsh-part': 'license-notice', key: 'license' }, tt('detail.proprietaryNotice'))
              : null,
            markdown !== ''
              ? h(P.MarkdownText, { key: 'markdown', text: markdown, labels, variant: 'body' })
              : h('p', { className: 'fs-stateText', key: 'empty' }, tt('detail.emptyBody')),
          ]
          if (files.length > 1) {
            bodyParts.push(h('p', { className: 'fs-fileList', 'data-dsh-part': 'detail-files', key: 'files' },
              files.slice(0, 12).map((file) => h('code', { className: 'fs-code', key: String(file.path) }, String(file.path))),
              files.length > 12 ? h('span', { className: 'fs-stateHint', key: 'more' }, tt('detail.moreFiles', { count: String(files.length - 12) })) : null,
            ))
          }
          body = h('div', { className: 'fs-detailBody', 'data-dsh-part': 'detail-body' }, bodyParts)
        }

        /** footer：左元信息，右动作（复制命令 / 打开来源站 / 安装或卸载）。 */
        const footer = h('div', { className: 'fs-detailFoot' },
          h('div', { className: 'fs-detailFootMeta' },
            h(P.Tag, { tone: 'outline' }, sourceLabel),
            installed ? h(P.Tag, { tone: 'success' }, tt('row.installed')) : null,
            copyState === 'copied' ? h('span', { className: 'fs-footHintOk', 'data-dsh-part': 'copy-ok' }, tt('detail.copied')) : null,
            copyState === 'failed' ? h('span', { className: 'fs-footHintError', 'data-dsh-part': 'copy-failed' }, tt('detail.copyFailed')) : null,
          ),
          h('div', { className: 'fs-detailFootActions' },
            command !== ''
              ? h(P.Button, {
                size: 'sm',
                variant: 'outline',
                icon: h(P.IconCopyOutlineRegular, { size: 16 }),
                onClick: async () => {
                  const ok = await copyText(command)
                  setCopyState(ok ? 'copied' : 'failed')
                },
              }, tt('detail.copyCommand'))
              : null,
            upstreamSite !== ''
              ? h(P.Button, {
                size: 'sm',
                variant: 'ghost',
                icon: h(P.IconRightUpOutlineRegular, { size: 16 }),
                onClick: () => { openExternal(upstreamSite) },
              }, tt('detail.openSite'))
              : null,
            installed
              ? h(P.Button, {
                size: 'sm',
                variant: 'ghost',
                disabled: idBusy,
                onClick: () => { props.onUninstall(id) },
              }, uninstalling ? tt('detail.uninstalling') : tt('detail.uninstall'))
              : h(P.Button, {
                size: 'sm',
                variant: 'primary',
                disabled: idBusy,
                onClick: () => { props.onInstall(id) },
              }, installing ? tt('detail.installing') : tt('detail.install')),
          ),
        )

        return h(P.Modal, {
          open: true,
          onClose: props.onClose,
          title: displayName,
          closeLabel: tt('detail.close'),
          description: summary !== '' ? summary : undefined,
          className: 'fs-detail',
          contentClassName: 'fs-detailContent',
          footer,
        }, body)
      }
      //#endregion

      //#region 主区页面
      /**
       * 主区整页：页头（标题/副标题/数据源行）→ 工具栏（搜索 + 视图切换）→
       * 分类 Pill → 结果列表 → 页脚（更新/刷新/条数）。
       * 状态：初次加载骨架 + TextShimmer、错误重试、空结果、离线/快照明确标注。
       */
      function PanelPage(props) {
        const api = props !== undefined && props !== null && props.api !== undefined ? props.api : createApi()
        const lang = currentLang()
        const [catalog, setCatalog] = useState(undefined)
        const [meta, setMeta] = useState(undefined)
        const [installedInfo, setInstalledInfo] = useState(undefined)
        const [loading, setLoading] = useState(true)
        const [refreshing, setRefreshing] = useState(false)
        const [error, setError] = useState(undefined)
        const [query, setQuery] = useState('')
        const [category, setCategory] = useState(CATEGORY_ALL)
        const [view, setView] = useState(VIEW_ALL)
        const [busy, setBusy] = useState(undefined)
        const [actionError, setActionError] = useState(undefined)
        const [notice, setNotice] = useState(undefined)
        const [detailId, setDetailId] = useState(undefined)
        const loadSeq = useRef(0)
        /** 动作互斥锁：state 的 busy 要等重渲染才可见，ref 保证连点不会重复提交。 */
        const actionLock = useRef(false)

        /**
         * 拉目录（可选同时刷新 installed 索引）。
         * mode: 'initial' 显示整页加载态；'refresh' 顶部刷新态；'silent' 安装/卸载后静默重取。
         * seq 守卫：只接受最后一次请求的响应，快速连点不会出现旧数据回写。
         */
        const load = async (mode) => {
          const seq = ++loadSeq.current
          const isRefresh = mode === 'refresh'
          const silent = mode === 'silent'
          if (isRefresh) setRefreshing(true)
          else if (!silent) setLoading(true)
          if (!silent) setError(undefined)
          try {
            const [value, installedValue] = await Promise.all([
              api.catalog(isRefresh),
              api.installed().catch(() => undefined),
            ])
            if (seq !== loadSeq.current) return
            setCatalog(value !== undefined && value !== null && value.catalog !== undefined ? value.catalog : undefined)
            setMeta(value !== undefined && value !== null && value.meta !== undefined ? value.meta : undefined)
            if (installedValue !== undefined) setInstalledInfo(installedValue)
          } catch (err) {
            if (seq !== loadSeq.current) return
            // 已有目录时的刷新失败只降级为一行错误提示（内容保留）；首次加载失败才整页报错。
            if (silent || catalog !== undefined) setActionError(tt('action.refreshFailed', { error: errorText(err) }))
            else setError(errorText(err))
          } finally {
            if (seq === loadSeq.current) {
              setLoading(false)
              setRefreshing(false)
            }
          }
        }

        useEffect(() => {
          load('initial')
        }, [])

        const categories = catalog !== undefined && Array.isArray(catalog.categories) ? catalog.categories : []
        const skills = catalog !== undefined && Array.isArray(catalog.skills) ? catalog.skills : []

        /** 已安装 id 集合：目录自带的 installed 标记 + installed 路由的扫描结果合并。 */
        const installedIds = useMemo(() => {
          const set = {}
          for (const skill of skills) {
            if (skill.installed === true) set[skill.id] = true
          }
          if (installedInfo !== undefined && installedInfo !== null && Array.isArray(installedInfo.skills)) {
            for (const entry of installedInfo.skills) {
              if (entry !== null && entry !== undefined && typeof entry.id === 'string') set[entry.id] = true
            }
          }
          return set
        }, [skills, installedInfo])

        const decorated = useMemo(() => skills.map((skill) => (
          installedIds[skill.id] === true && skill.installed !== true ? Object.assign({}, skill, { installed: true }) : skill
        )), [skills, installedIds])

        const installedCount = useMemo(() => decorated.filter((skill) => skill.installed === true).length, [decorated])
        const counts = useMemo(() => categoryCounts(categories, decorated), [categories, decorated])
        const visible = useMemo(() => filterSkills(decorated, { query, category, view }), [decorated, query, category, view])
        const metaSummary = useMemo(() => summarizeMeta(meta, Date.now(), lang), [meta, lang])
        const totalCount = decorated.length

        /** 安装 / 卸载：串行（busy 期间忽略重复触发），成功后静默重取目录刷新 installed 标记。 */
        const runAction = async (id, kind) => {
          if (busy !== undefined || actionLock.current) return
          actionLock.current = true
          setBusy({ id, kind })
          setActionError(undefined)
          setNotice(undefined)
          try {
            if (kind === 'install') await api.install(id)
            else await api.uninstall(id)
            const hit = decorated.find((skill) => skill.id === id)
            const name = hit !== undefined ? pickLocalized(hit.name, lang) || hit.id : id
            setNotice({ kind: 'ok', text: tt(kind === 'install' ? 'action.installOk' : 'action.uninstallOk', { name }) })
            await load('silent')
          } catch (err) {
            setActionError(tt(kind === 'install' ? 'action.installFailed' : 'action.uninstallFailed', { error: errorText(err) }))
          } finally {
            actionLock.current = false
            setBusy(undefined)
          }
        }

        /** 空结果文案：搜索 > 分类（含 0 条分类）> 已安装视图，按最具体的原因给提示。 */
        const emptyState = () => {
          const trimmed = query.trim()
          const categoryEmpty = category !== CATEGORY_ALL && (counts.byCategory[category] || 0) === 0
          let text
          let hint
          if (trimmed !== '') {
            text = tt('state.emptySearch', { query: trimmed })
            hint = tt('state.emptySearchHint')
          } else if (categoryEmpty) {
            text = tt('state.emptyCategory')
            hint = tt('state.emptyCategoryHint', { category: categoryTitle(categories, category, lang) })
          } else if (view === VIEW_INSTALLED) {
            text = tt('state.emptyInstalled')
            hint = tt('state.emptyInstalledHint')
          } else {
            text = tt('state.emptyCategory')
            hint = ''
          }
          const canReset = trimmed !== '' || category !== CATEGORY_ALL || view !== VIEW_ALL
          return h('div', { className: 'fs-state', 'data-dsh-part': 'empty-state' },
            h(P.IconSkillOutlineRegular, { size: 28, className: 'fs-stateIcon' }),
            h('p', { className: 'fs-stateText' }, text),
            hint !== '' ? h('p', { className: 'fs-stateHint' }, hint) : null,
            canReset ? h(P.Button, {
              size: 'sm',
              variant: 'outline',
              onClick: () => {
                setQuery('')
                setCategory(CATEGORY_ALL)
                setView(VIEW_ALL)
              },
            }, tt('state.resetFilters')) : null,
          )
        }

        /** 页头：标题（20/28/500）+ 副标题（13/20 secondary）+ 数据源行（12/18 tertiary + 来源 Tag）。 */
        const introText = pickLocalized(catalog !== undefined ? catalog.description : undefined, lang) || tt('page.subtitle')
        const updated = catalog !== undefined && typeof catalog.updated === 'string' ? catalog.updated : ''
        const head = h('header', { className: 'fs-pageHead', 'data-dsh-part': 'page-head' },
          h('div', { className: 'fs-headMain' },
            h('h1', { className: 'fs-title' }, tt('page.title')),
            h('p', { className: 'fs-intro' }, introText),
            h('p', { className: 'fs-sourceLine', 'data-dsh-part': 'source-line' },
              h('span', { key: 'repo' }, tt('page.sourcePrefix') + ' ' + tt('page.sourceRepo')),
              updated !== '' ? h('span', { key: 'updated' }, '· ' + tt('page.updated', { date: updated })) : null,
              meta !== undefined ? h(P.Tag, { key: 'source', tone: metaSummary.tone }, tt(metaSummary.labelKey)) : null,
            ),
          ),
        )

        /** 工具栏：官方 Input（搜索图标前置）+ 官方 SegmentedControl（全部插件 / 已安装 n）。 */
        const viewOptions = [
          { value: VIEW_ALL, label: tt('filter.all') },
          { value: VIEW_INSTALLED, label: tt('filter.installed') + ' (' + installedCount + ')' },
        ]
        const toolbar = h('div', { className: 'fs-toolbar', 'data-dsh-part': 'toolbar' },
          h('div', { className: 'fs-searchField' },
            h(P.Input, {
              type: 'search',
              value: query,
              spellCheck: false,
              'aria-label': tt('search.label'),
              placeholder: tt('search.placeholder'),
              icon: h(P.IconSearchOutlineRegular, { size: 16 }),
              onChange: (event) => { setQuery(event.target.value) },
              onKeyDown: (event) => {
                if (event.key === 'Escape' && query !== '') setQuery('')
              },
            }),
          ),
          h(P.SegmentedControl, {
            id: PANEL_ID + '-view',
            value: view,
            options: viewOptions,
            label: tt('filter.viewLabel'),
            onChange: (next) => { setView(next) },
          }),
          h('div', { className: 'fs-toolbarSpacer' }),
        )

        /** 分类条：官方 Pill，「全部」+ 9 类，每枚带条数（0 条也显示，不隐藏分类）。 */
        const countBadge = (count) => h('span', { className: 'fs-pillCount' }, String(count))
        const categoryPills = [
          h(P.Pill, {
            key: CATEGORY_ALL,
            active: category === CATEGORY_ALL,
            'aria-pressed': category === CATEGORY_ALL,
            'data-dsh-part': 'category-pill',
            'data-category': CATEGORY_ALL,
            onClick: () => { setCategory(CATEGORY_ALL) },
          }, tt('filter.categoryAll'), countBadge(counts.all)),
          ...categories.map((entry) => h(P.Pill, {
            key: entry.id,
            active: category === entry.id,
            'aria-pressed': category === entry.id,
            'data-dsh-part': 'category-pill',
            'data-category': entry.id,
            onClick: () => { setCategory(entry.id) },
          }, pickLocalized(entry.title, lang) || entry.id, countBadge(counts.byCategory[entry.id] || 0))),
        ]

        /** 首次加载：3 行骨架 + TextShimmer 状态文案（都带 data-dsh-part 锚点）。 */
        let contentBody
        if (loading && catalog === undefined) {
          contentBody = h('div', { className: 'fs-skeletons', 'data-dsh-part': 'loading', role: 'status' },
            h('div', { className: 'fs-state' },
              h(P.TextShimmer, { active: true, className: 'fs-stateText' }, tt('state.loading')),
            ),
            [0, 1, 2].map((index) => h('div', { className: 'fs-skeletonRow', key: 's' + index, 'aria-hidden': 'true' },
              h('span', { className: 'fs-skeletonIcon' }),
              h('span', { className: 'fs-skeletonLines' }),
            )),
          )
        } else if (error !== undefined && catalog === undefined) {
          contentBody = h('div', { className: 'fs-state', 'data-dsh-part': 'load-error' },
            h(P.IconWarningTriangleOutlineRegular, { size: 28, className: 'fs-stateIcon' }),
            h('p', { className: 'fs-stateText' }, tt('state.loadError', { error })),
            h(P.Button, {
              size: 'sm',
              variant: 'outline',
              icon: h(P.IconRefreshOutlineRegular, { size: 16 }),
              onClick: () => { load('initial') },
            }, tt('state.retry')),
          )
        } else {
          const notices = []
          if (metaSummary.error !== undefined) {
            notices.push(h('p', { className: 'fs-banner', 'data-dsh-part': 'meta-error', key: 'meta-error' }, tt('meta.error', { error: metaSummary.error })))
          }
          if (metaSummary.offline || metaSummary.source !== 'network') {
            // 非实时来源不仅标注原因，还给一个就地重试入口（不弹 alert）。
            const noticeKey = metaSummary.offline ? 'meta.offlineNotice' : metaSummary.source === 'snapshot' ? 'meta.snapshotNotice' : 'meta.cacheNotice'
            notices.push(h('div', { className: 'fs-noticeRow', 'data-dsh-part': 'offline-notice', key: 'offline-notice' },
              h('p', { className: 'fs-notice' }, tt(noticeKey)),
              h(P.Button, {
                size: 'sm',
                variant: 'ghost',
                disabled: refreshing,
                icon: h(P.IconRefreshOutlineRegular, { size: 16, className: refreshing ? 'fs-spin' : undefined }),
                onClick: () => { load('refresh') },
              }, tt('state.retry')),
            ))
          }
          if (actionError !== undefined) {
            notices.push(h('p', { className: 'fs-banner', 'data-dsh-part': 'action-error', key: 'action-error' }, actionError))
          }
          if (notice !== undefined) {
            notices.push(h('p', { className: 'fs-noticeOk', 'data-dsh-part': 'action-ok', key: 'action-ok' }, notice.text))
          }
          contentBody = h(React.Fragment, null,
            toolbar,
            h('div', {
              id: PANEL_ID + '-view-' + view + '-panel',
              className: 'fs-panelBody',
              role: 'tabpanel',
              'aria-labelledby': PANEL_ID + '-view-' + view,
              'data-dsh-part': 'view-panel',
            },
              h('div', { className: 'fs-categoryBar', 'data-dsh-part': 'category-bar' }, categoryPills),
              notices,
              visible.length === 0
                ? emptyState()
                : h('ul', { className: 'fs-list', 'data-dsh-part': 'skill-list' },
                  visible.map((skill) => h(SkillRow, {
                    key: skill.id,
                    skill,
                    lang,
                    busy,
                    categoryTitle: categoryTitle(categories, skill.category, lang),
                    onOpen: () => { setDetailId(skill.id) },
                    onInstall: () => { runAction(skill.id, 'install') },
                    onUninstall: () => { runAction(skill.id, 'uninstall') },
                  }))),
            ),
          )
        }

        /** 页脚：更新日期 · fetchedAt 相对时间 · 条数 · 来源 Tag · 刷新按钮。 */
        const footer = h('footer', { className: 'fs-footer', 'data-dsh-part': 'footer' },
          updated !== '' ? h('p', { className: 'fs-footerText' }, tt('page.updated', { date: updated })) : null,
          // 快照的 fetchedAt 是「本次从随包快照读取」的时刻而非上游抓取时刻，不说成「刚刚刷新」。
          metaSummary.relative !== '' && metaSummary.source !== 'snapshot'
            ? h('p', { className: 'fs-footerText' }, tt('footer.refreshed', { relative: metaSummary.relative }))
            : null,
          h('p', { className: 'fs-footerText', 'data-dsh-part': 'footer-counts' },
            tt('footer.counts', {
              total: String(totalCount),
              installed: String(installedCount),
              visible: String(visible.length),
            })),
          meta !== undefined ? h(P.Tag, { tone: metaSummary.tone }, tt(metaSummary.labelKey)) : null,
          h('span', { className: 'fs-footerSpacer' }),
          h(P.Button, {
            size: 'sm',
            variant: 'ghost',
            disabled: refreshing,
            icon: h(P.IconRefreshOutlineRegular, { size: 16, className: refreshing ? 'fs-spin' : undefined }),
            onClick: () => { load('refresh') },
          }, refreshing ? tt('footer.refreshing') : tt('footer.refresh')),
        )

        const detailSkill = detailId !== undefined ? decorated.find((skill) => skill.id === detailId) : undefined
        return h('div', {
          className: 'fs-view',
          'data-dsh-financial-skills-view': '',
          'data-dsh-plugin': 'financial-skills',
        },
          h('section', { className: 'fs-page', 'data-dsh-part': 'page' },
            head,
            h('div', { className: 'fs-content', 'data-dsh-part': 'content' },
              contentBody,
              catalog !== undefined ? footer : null,
            ),
          ),
          detailId !== undefined ? h(DetailModal, {
            key: detailId,
            id: detailId,
            skill: detailSkill,
            catalog,
            lang,
            busy,
            api,
            onClose: () => { setDetailId(undefined) },
            onInstall: (id) => { runAction(id, 'install') },
            onUninstall: (id) => { runAction(id, 'uninstall') },
          }) : null,
        )
      }
      //#endregion

      //#region 注册与挂载
      const inject = ['slots']

      /**
       * 挂载侧栏入口与主区页面。
       *
       * 两个 seat 由本包不依赖的 shell 插件声明，因此都用 ctx.slots.inject 包一层：
       * 只有声明了 seat 的宿主才会真正注册；没有该 seat 的宿主只会少一个面板，不会炸 boot。
       * slots / effect 都是软依赖：缺失时只 warn，不抛错。
       */
      function apply(ctx) {
        if (ctx === undefined || ctx === null) return
        const slots = ctx.slots
        if (slots === undefined || slots === null || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          console.warn('[financial-skills] slots service 不可用，侧栏入口与主区页面未挂载')
          return
        }
        const api = createApi()
        const disposers = []
        try {
          disposers.push(slots.inject('sidebar.panellist', () => slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: PANEL_ORDER,
            label: () => panelLabel(),
          }, PanelIcon)))
          disposers.push(slots.inject('main', () => slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ api }),
          }, PanelPage)))
        } catch (error) {
          console.warn('[financial-skills] 面板注册失败：', error)
        }
        const disposeAll = () => {
          for (const dispose of disposers.splice(0)) {
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {
              console.warn('[financial-skills] 面板释放失败：', error)
            }
          }
        }
        if (typeof ctx.effect === 'function') {
          try {
            ctx.effect(() => disposeAll, 'financial-skills: ui mounts')
          } catch (error) {
            console.warn('[financial-skills] effect 注册失败：', error)
          }
        }
      }
      //#endregion

      module.exports = { apply, inject }
      // 纯函数导出：仅供 Node 契约测试（test/client-contract.test.mjs）使用，
      // 浏览器运行时只消费 apply / inject。
      module.exports.__test = {
        filterSkills,
        categoryCounts,
        summarizeMeta,
        relativeTime,
        panelId,
        panelLabel,
      }
      return module.exports
    },
  })
}
