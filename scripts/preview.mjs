#!/usr/bin/env node
/**
 * 生成 docs/preview.html —— 面板版式的静态预览页。
 *
 * 用途：不启动宿主也能一眼看到 banner / 元信息行 / 搜索+视图 / 分割线 / 胶囊 / 卡片网格的排布。
 * 做法：从 client.js 里**原样抽出**那段面板 CSS（不复制、不手改），再按 PanelPage / SkillCard
 * 的同一套类名拼一份静态 DOM，数据取随包快照 catalog.snapshot.json。
 *
 * 因此预览页永远是当前 CSS 的真实渲染结果；改了 client.js 的 CSS 后重跑本脚本即可：
 *   node scripts/preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')

/** 从 client.js 抽出 `const CSS = \`...\`` 里的样式正文（与运行时注入的是同一份字符串）。 */
function extractCss(source) {
  const start = source.indexOf('const CSS = `')
  if (start < 0) throw new Error('client.js 里找不到 const CSS = `')
  const bodyStart = start + 'const CSS = `'.length
  const end = source.indexOf('`', bodyStart)
  if (end < 0) throw new Error('CSS 模板字符串没有收尾')
  return source.slice(bodyStart, end)
}

/**
 * 预览页专用的 token 取值。
 *
 * 这些值只活在预览页里：宿主真实取值由 DSH 主题提供（插件侧一律用 var()，不写死颜色）。
 * 这里给一套中性亮色 + 一套暗色，用来肉眼确认两种主题下都成立。
 */
const LIGHT = {
  'label-primary': '#1f2329',
  'label-secondary': '#5b6373',
  'label-tertiary': '#8a919f',
  'label-caption': '#a6acb8',
  'bg-base': '#fbfbfc',
  'bg-layer-1': '#ffffff',
  'bg-layer-2': '#f5f6f8',
  'bg-skeleton': '#eef0f3',
  'brand-primary': '#2f6bff',
  'border-l1': '#f0f1f4',
  'border-l2': '#e5e7eb',
  'border-l3': '#d5d8de',
  'state-success-primary': '#12a06a',
  'state-warn-primary': '#d18600',
  'state-error-primary': '#d92d20',
}

const DARK = {
  'label-primary': '#eceef2',
  'label-secondary': '#a8b0be',
  'label-tertiary': '#828b9a',
  'label-caption': '#6b7483',
  'bg-base': '#16181c',
  'bg-layer-1': '#1e2126',
  'bg-layer-2': '#262a31',
  'bg-skeleton': '#2a2e35',
  'brand-primary': '#7aa2ff',
  'border-l1': '#262a30',
  'border-l2': '#30353d',
  'border-l3': '#3c424b',
  'state-success-primary': '#42c08c',
  'state-warn-primary': '#e0a642',
  'state-error-primary': '#f2695f',
}

const tokenBlock = (tokens) => Object.entries(tokens)
  .map(([name, value]) => `  --dsw-alias-${name}: ${value};`)
  .join('\n')

const esc = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/** 长条卡片：与 SkillCard 的类名一一对应（不含交互，纯静态）。 */
function card(skill, categoryTitle, installed) {
  const summary = skill.summary !== undefined && skill.summary.zh !== undefined ? skill.summary.zh : ''
  const author = typeof skill.author === 'string' && skill.author !== '' ? skill.author : '未标注'
  const version = typeof skill.version === 'string' && skill.version !== '' ? skill.version : '未标注'
  const license = skill.license === 'proprietary' ? '专有' : (typeof skill.license === 'string' && skill.license !== '' ? skill.license : '未标注')
  const verified = typeof skill.verified_at === 'string' && skill.verified_at !== '' ? skill.verified_at : '未标注'
  const sourceLabel = skill.source !== undefined && skill.source.type === 'github' ? 'GitHub' : 'SkillHub'
  // 类别 / 来源 / 版本 / 协议 → 胶囊
  const chips = [categoryTitle, sourceLabel, version, license]
  // 作者 / 核验日期 → 纯文本
  const facts = [['作者', author], ['核验日期', verified]]
  const invoke = installed ? (skill.id.length > 22 ? skill.id.slice(0, 22) : skill.id) : ''
  return `      <li class="fs-card" data-installed="${installed ? 'true' : 'false'}">
        <div class="fs-cardMain">
          <div class="fs-cardHead">
            <button type="button" class="fs-cardName">${esc(skill.name.zh)}</button>
            <span class="fs-cardNameEn">${esc(skill.name.en)}</span>
            ${installed ? '<span class="fs-cardBadge"><span class="pv-tag pv-tag-success">已安装</span></span>' : ''}
          </div>
          <p class="fs-cardSummary" title="${esc(summary)}">${esc(summary)}</p>
          <div class="fs-cardMeta">
            <span class="fs-cardChips">
${chips.map((value) => `              <span class="pv-tag pv-tag-outline">${esc(value)}</span>`).join('\n')}
            </span>
            <span class="fs-cardFacts">
${facts.map(([key, value]) => `              <span class="fs-cardFact"><span class="fs-cardFactKey">${esc(key)}</span><span class="fs-cardFactVal" title="${esc(value)}">${esc(value)}</span></span>`).join('\n')}
            </span>
          </div>
          ${installed && invoke !== '' ? `<p class="fs-cardInvoke"><span>调用名</span><code class="fs-cardInvokeCode">${esc(invoke)}</code></p>` : ''}
        </div>
        <div class="fs-cardActions">
          <button type="button" class="pv-btn pv-btn-ghost pv-btn-sm">详情</button>
          ${installed
            ? '<button type="button" class="pv-btn pv-btn-ghost pv-btn-sm">卸载</button>'
            : '<button type="button" class="pv-btn pv-btn-primary pv-btn-sm">安装</button>'}
        </div>
      </li>`
}

function build(panelCss) {
  const catalog = JSON.parse(readFileSync(join(REPO_ROOT, 'catalog.snapshot.json'), 'utf8'))
  const categoryTitleOf = (id) => {
    const hit = catalog.categories.find((entry) => entry.id === id)
    return hit !== undefined && hit.title !== undefined ? hit.title.zh : id
  }
  const total = catalog.skills.length
  const installedIds = new Set(catalog.skills.slice(0, 2).map((skill) => skill.id))
  const shown = catalog.skills.slice(0, 12)

  const pill = (label, count, active) => `        <span class="pv-pill${active ? ' pv-pill-active' : ''}">${esc(label)}<span class="fs-pillCount">${count}</span></span>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>金融技能 · 面板预览</title>
<style>
/* 预览页专用 token（宿主真实取值由 DSH 主题提供） */
:root{
${tokenBlock(LIGHT)}
  --dsw-radius-xl: 12px;
  --dsw-radius-lg: 10px;
  --ds-transition-duration: .2s;
  --ds-ease-in-out: ease-in-out;
  --ds-font-family-code: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark){
  :root{
${tokenBlock(DARK)}
  }
}
html,body{margin:0;padding:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
/* 预览页把插件 CSS 之外缺的两类原语（Tag / Button / Pill / Input）画成等价外观，仅用于看版式 */
.pv-tag{display:inline-flex;align-items:center;height:20px;padding:0 6px;border-radius:5px;font-size:11.5px;line-height:20px;white-space:nowrap}
.pv-tag-success{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.pv-tag-info{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.pv-tag-warning{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.pv-tag-neutral{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}\n.pv-tag-outline{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;line-height:18px;height:20px}
.pv-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid transparent;border-radius:8px;cursor:pointer;font:inherit;background:0 0;color:inherit}
.pv-btn-sm{height:26px;padding:0 9px;font-size:12.5px;line-height:24px}
.pv-btn-ghost{color:var(--dsw-alias-label-secondary)}
.pv-btn-ghost:hover{background:var(--dsw-alias-bg-layer-2)}
.pv-btn-primary{background:var(--dsw-alias-brand-primary);color:#fff}
.pv-search{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-caption);font-size:13px}
.pv-seg{display:inline-flex;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);gap:2px}
.pv-seg-item{height:26px;padding:0 12px;border-radius:7px;display:inline-flex;align-items:center;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.pv-seg-item-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,#000 10%,transparent)}
.pv-pill{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);
  border-radius:999px;font-size:12.5px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.pv-pill-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);font-weight:500}
/* ↓↓↓ 以下为 client.js 注入的面板 CSS 原文 ↓↓↓ */
${panelCss}
/* 预览页只是把页面放进一个宿主大小的框里 */
.pv-frame{height:100vh;overflow:hidden}
</style>
</head>
<body>
<div class="fs-view pv-frame" data-dsh-financial-skills-view data-dsh-plugin="financial-skills">
  <section class="fs-page" data-dsh-part="page">
    <div class="fs-shell" data-dsh-part="shell">

      <header class="fs-hero" data-dsh-part="hero">
        <span class="fs-heroMark">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3.4 20 9.2H4z" fill="currentColor" fill-opacity="0.12"></path>
            <path d="M4.6 9.2h14.8"></path>
            <path d="M7.6 11.4v6.2M12 11.4v6.2M16.4 11.4v6.2"></path>
            <path d="M4.6 19.6h14.8"></path>
          </svg>
        </span>
        <div class="fs-heroMain">
          <h1 class="fs-heroTitle">金融行业skills精选</h1>
          <p class="fs-heroSlogan">按业务场景策展的金融 AI 技能库</p>
        </div>
        <span class="fs-heroSpacer"></span>
        <span class="fs-heroBadge">${total} 个技能 · ${catalog.categories.length} 个分类</span>
      </header>

      <div class="fs-metaRow" data-dsh-part="meta-row">
        <span class="fs-metaItem"><span class="fs-metaKey">数据源</span><span class="fs-metaVal">openfcp/awesome-financial-skills</span></span>
        <span class="fs-metaDot">·</span>
        <span class="fs-metaItem"><span class="fs-metaVal">更新 ${esc(catalog.updated)}</span></span>
        <span class="pv-tag pv-tag-info">实时</span>
        <button type="button" class="fs-refresh">
          <span class="fs-refreshIcon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"></path><path d="M12.4 1.9v2.6h-2.6"></path></svg></span>刷新
        </button>
      </div>

      <div class="fs-toolbar" data-dsh-part="toolbar">
        <div class="fs-searchField">
          <div class="pv-search"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="7" cy="7" r="4.2"></circle><path d="M10.2 10.2 13.5 13.5" stroke-linecap="round"></path></svg>搜索名称、摘要、标签或作者</div>
        </div>
        <div class="fs-toolbarSpacer"></div>
        <div class="pv-seg"><span class="pv-seg-item pv-seg-item-active">全部插件</span><span class="pv-seg-item">已安装 (2)</span></div>
      </div>

      <hr class="fs-divider" data-dsh-part="divider">

      <div class="fs-panelBody" role="tabpanel">
        <div class="fs-categoryBar" data-dsh-part="category-bar">
${pill('全部', total, true)}
${catalog.categories.map((entry) => pill(entry.title.zh, catalog.skills.filter((skill) => skill.category === entry.id).length, false)).join('\n')}
        </div>
        <ul class="fs-grid" data-dsh-part="skill-grid">
${shown.map((skill) => card(
    Object.assign({}, skill, { verified_at: catalog.verified_at }),
    categoryTitleOf(skill.category),
    installedIds.has(skill.id),
  )).join('\n')}
        </ul>
      </div>

      <footer class="fs-footer" data-dsh-part="footer">
        <p class="fs-footerText">更新 ${esc(catalog.updated)}</p>
        <p class="fs-footerText">2 分钟前刷新</p>
        <p class="fs-footerText">共 ${total} 个 · 已安装 2 个 · 显示 ${total} 个</p>
        <span class="pv-tag pv-tag-info">上游实时目录</span>
      </footer>

    </div>
  </section>
</div>
</body>
</html>
`
}

const source = readFileSync(join(REPO_ROOT, 'client.js'), 'utf8')
const css = extractCss(source)
const html = build(css)
const out = join(REPO_ROOT, 'docs', 'preview.html')
writeFileSync(out, html, 'utf8')
console.log('已生成 ' + out + '（CSS ' + css.length + ' 字节，来自 client.js 原文）')