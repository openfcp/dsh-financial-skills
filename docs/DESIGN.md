# 设计规范 · 金融技能（dsh-financial-skills）浏览器半

> 本文是 `client.js` 的 UI 落地对照：每个界面区域用了哪个**官方 UI 原语**、哪种**官方设计 token**、
> 多少尺寸/间距，以及为什么这样写。实现与文字冲突时，以 `test/client-contract.test.mjs` 的断言与本文为准；
> 改动视觉必须同步改本文与 `test/client-contract.test.mjs` 的静态断言（该测试是随包发布的契约）。

## 1. 命名口径

| 位置 | 文案 | 说明 |
| --- | --- | --- |
| 插件中文名 / 侧栏行 label（zh） | **金融技能** | 宿主左侧栏入口，用户看到的名字 |
| 侧栏行 label（en） | **Financial Skills** | `document.documentElement.lang` 以 `en` 开头时使用 |
| 页面标题 | **金融行业skills精选** | 主区整页标题，固定文案，不随插件名变化 |
| 页面副标题 | 目录 `description`（上游中文/英文） | 取不到时回退本地字典文案 |
| 数据源 | `openfcp/awesome-financial-skills` | 页头数据源行 + 页脚来源 Tag，不写成「实时」除非 `meta.source === 'network'` |
| id / slot key / 语义锚点 | `financial-skills`、`data-dsh-financial-skills-view` | 不随中文名变化（宿主契约） |

## 2. 设计立场

1. **官方原语优先**：搜索框、视图切换、分类胶囊、标签、按钮、详情弹窗、Markdown 正文、加载文案
   全部来自 `@deepseek-ai/dsh-client-ui-primitives`。插件自己的 CSS 只负责**布局容器、列表行、
   字形盒、弹窗正文外壳**这些原语覆盖不到的结构。
2. **官方 token 优先**：颜色、圆角、边框、骨架底色全部走 `var(--dsw-*)`；字体继承官方或
   `var(--dsw-font-family)`。亮/暗主题不做任何插件侧覆盖，由宿主替换 token 值。
3. **同一套页面栅格**：与官方 Plugins / Schedule / Skills Hub 页一致——960px 居中列、
   `clamp(24px,4vw,48px)` 页边距、28px 页头留白、32px 页内区块间距、20/28 标题。
4. **数据与来源如实**：目录来自网络、本地缓存还是随包快照，UI 必须直说；快照/缓存不得标成实时；
   安装/卸载失败给可操作的行内错误，不弹 `alert`。

## 3. 页面栅格（取自官方插件页，非自创）

| 项 | 值 | 落地位置 |
| --- | --- | --- |
| 页面最大宽度 | `max-width: 960px; margin: 0 auto` | `.fs-pageHead` / `.fs-content` |
| 页边距 | `padding: 0 clamp(24px, 4vw, 48px) 48px` | `.fs-page` |
| 页头留白 | `padding-top: 28px` | `.fs-pageHead` |
| 页内区块间距 | `gap: 32px`（页头 ↔ 内容） | `.fs-page` |
| 内容块间距 | `gap: 24px`（工具条/分类条/列表/页脚） | `.fs-content`、`.fs-panelBody` |
| 列表行间距 | `gap: 2px` | `.fs-list` |
| 页面标题 | `20px / 28px / 500` | `.fs-title` |
| 页面副标题 | `13px / 20px / 400`，`--dsw-alias-label-secondary` | `.fs-intro` |
| 数据源 / caption | `12px / 18px`，`--dsw-alias-label-tertiary` | `.fs-sourceLine`、`.fs-footerText` |
| 行名称 | `14px / 20px / 500` | `.fs-rowOpen` |
| 行摘要 | `12px / 18px`，两行截断 | `.fs-rowSummary` |
| 图标盒 | `48px × 48px` | `.fs-rowIcon` |
| 圆角 | 行/弹窗外壳 `--dsw-radius-xl`；图标盒 `--dsw-radius-lg`；骨架条 `--dsw-radius-md` | 见各选择器 |
| 边框 | `.5px solid var(--dsw-alias-border-l3)`（图标盒）；分隔线 `--dsw-alias-border-l2` | `.fs-rowIcon`、`.fs-footer`、`.fs-detailMeta` |
| 响应式 | 无断点：960 上限 + `clamp` 页边距 + 分类/动作 `flex-wrap` | 全页 |

## 4. 区域 → 官方原语 → token → 尺寸

| # | UI 区域 | 官方原语 / 结构 | 使用 token | 尺寸 / 间距 |
| --- | --- | --- | --- | --- |
| 1 | 侧栏入口图标 | 手绘 16×16 `svg`（银行柱廊：地面/檐口/山花/三柱），`stroke="currentColor"`、`fill="none"`、`aria-hidden` | 颜色继承宿主行 | `viewBox 0 0 16 16`；`width/height = size`（宿主给 16） |
| 2 | 页头容器 | `<header>` | `--dsw-alias-label-primary` | `max-width 960`、`padding-top 28`、`gap 32` |
| 3 | 页面标题 | `<h1>` | `--dsw-alias-label-primary` | `20/28/500` |
| 4 | 页面副标题 | `<p>`（目录 description） | `--dsw-alias-label-secondary` | `13/20`、上边距 4 |
| 5 | 数据源行 | `<p>` + 官方 `Tag` | `--dsw-alias-label-tertiary`；Tag tone `info`/`neutral`/`warning` | `12/18`、gap 6 |
| 6 | 工具栏 | `<div>` 布局容器 | — | `gap 12`、`flex-wrap` |
| 7 | 搜索框 | 官方 `Input`（`type=search`）+ 官方 `IconSearchOutlineRegular` 前置图标 | 原语自带（含 focus 环） | 容器 `flex:1 1 240px; max-width:320px`；图标 16 |
| 8 | 视图切换 | 官方 `SegmentedControl`（`全部插件` / `已安装 (n)`） | 原语自带 | 结构 id `financial-skills-view` |
| 9 | 分类胶囊 | 官方 `Pill` × 10（全部 + 9 类）+ 计数 `span` | Pill 自带选中态；计数 `--dsw-alias-label-caption` | `12/18`、`tabular-nums`、gap 8 |
| 10 | 结果列表 | `<ul>` / `<li>` | 行圆角 `--dsw-radius-xl`；hover `--dsw-alias-interactive-bg-hover` | `gap 2`、行 `margin: 0 -8px`（hover 出血） |
| 11 | 行容器 | `<div>` 布局容器 | — | `padding 8`、`gap 14` |
| 12 | 48px 字形盒 | `<span>` + 名称首字（中/英），不加载图片 | 边框 `--dsw-alias-border-l3`、圆角 `--dsw-radius-lg`、文字 `--dsw-alias-label-secondary` | `48×48`、`18/500`、`aria-hidden` |
| 13 | 行名称 | 原生 `<button>`（link 样式，无底色无边框） | `color: inherit` | `14/20/500`；hover 下划线；不覆盖焦点环 |
| 14 | 行摘要 | `<span>`，`-webkit-line-clamp: 2` | `--dsw-alias-label-tertiary` | `12/18` |
| 15 | 元信息 | 官方 `Tag`（分类 / `v<version>` / 来源类型 / 已安装；license 只在详情里显示） | tone `outline`（分类/版本/来源）、`success`（已安装） | 原语尺寸、gap 6、可换行 |
| 16 | 行动作 | 官方 `Button` `size="sm"` | `variant="primary"`（安装）/ `variant="ghost"`（详情、卸载） | 原语自带 |
| 17 | 加载态 | 官方 `TextShimmer` + 3 行骨架 | 骨架底色 `--dsw-alias-bg-skeleton`；文案 `--dsw-alias-label-tertiary` | 骨架 `48px` 盒 + 40px 条、`radius lg/md`、`role="status"` |
| 18 | 错误态 | 官方 `IconWarningTriangleOutlineRegular` + `Button variant="outline"` | `--dsw-alias-state-error-primary`（文案） | 图标 28、`13/20`、`padding 40 16` |
| 19 | 空结果态 | 官方 `IconSkillOutlineRegular` + `Button variant="outline"`（清空筛选） | `--dsw-alias-label-tertiary` / `--dsw-alias-label-caption` | 图标 28、`13/20` + `12/18` |
| 20 | 离线 / 快照提示 | `<div>` + `Button variant="ghost"`（就地重试） | `--dsw-alias-state-warn-primary` | `12/18`、gap 8 |
| 21 | 详情弹窗 | 官方 `Modal`（open/title/description/footer/closeLabel） | 原语自带（遮罩/层级/焦点管理） | `width: min(720px,100%)`、`max-height: min(760px,100%)` |
| 22 | 详情元信息 | `<dl>` grid（`max-content 1fr`）+ 官方 `Tag` | 键 `--dsw-alias-label-caption`、值 `--dsw-alias-label-primary`、分隔线 `--dsw-alias-border-l2` | `13/20`、gap `4px 16px` |
| 23 | 详情正文 | 官方 `MarkdownText`（`variant="body"`，传 labels） | 原语自带 | 自适应 |
| 24 | 详情 footer | 官方 `Button size="sm"`：安装/卸载、复制 SkillHub 命令、打开来源站 | primary/ghost/outline；成功/失败提示用 `--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary` | gap 8、可换行 |
| 25 | 文件清单 | `<code>` 小标签（最多 12 个 + 剩余计数） | `--ds-font-family-code`（官方核心字体 token，带 `ui-monospace` 回退） | `12.5px`、gap 6 |
| 26 | 页脚 | `<footer>` + 官方 `Tag` + 官方 `Button variant="ghost"`（刷新） | 分隔线 `--dsw-alias-border-l2`；文字 `--dsw-alias-label-tertiary`；图标旋转 `--ds-transition-duration` / `--ds-ease-in-out` | `12/18`、gap 12、`padding 8 0 4` |

### 4.1 为什么行名称用原生 `<button>`

官方原语里没有「文本链接」型按钮；行动作本身已全部使用官方 `Button`。行名称沿用宿主技能行/插件行
的既有做法：一个 `background: none; border: 0; font: inherit` 的原生按钮，提供「点名称进详情」的
链接式可点区。它不绘制任何官方 Button 外观，也不覆盖焦点环样式，键盘行为（Enter/Space、Tab 顺序）
由浏览器原生提供。

## 5. 颜色与主题

**亮色与暗色不写两套 CSS。** 所有颜色都是语义 token，宿主在暗色下替换同一组变量，页面自动跟随。
客户端没有 `body[data-ds-dark-theme]` 之类的手写暗色覆盖（测试会静态断言它不存在）。

| token | 用途 |
| --- | --- |
| `--dsw-alias-label-primary` | 标题、行名称、详情值 |
| `--dsw-alias-label-secondary` | 副标题、图标盒文字 |
| `--dsw-alias-label-tertiary` | 数据源行、摘要、页脚、空态 |
| `--dsw-alias-label-caption` | 分类计数、详情元信息键、空态提示 |
| `--dsw-alias-interactive-bg-hover` | 列表行 hover 底色 |
| `--dsw-alias-border-l2` | 页脚 / 详情元信息分隔线 |
| `--dsw-alias-border-l3` | 48px 字形盒描边 |
| `--dsw-alias-bg-skeleton` | 加载骨架占位 |
| `--dsw-alias-state-success-primary` | 已安装 Tag、操作成功提示 |
| `--dsw-alias-state-warn-primary` | 专有 license Tag、快照/离线提示 |
| `--dsw-alias-state-error-primary` | 目录/刷新/详情加载错误、复制失败提示 |
| `--dsw-radius-xl` / `--dsw-radius-lg` / `--dsw-radius-md` | 行 / 图标盒 / 骨架 |
| `--ds-transition-duration`、`--ds-ease-in-out` | 唯一的过渡曲线（来自宿主核心变量，带 0.2s / ease-in-out 回退） |
| `--ds-font-family-code` | 详情里的命令与文件路径（带 `ui-monospace` 回退） |

> 说明：`--ds-*` 是 DSH 的核心变量（非 `--dsw-` 语义别名），官方已装插件的 CSS 同样用
> `--ds-font-family-code` / `--ds-transition-duration`，本文按契约 §4.1 引用。

## 6. 数据来源（meta）标注矩阵

宿主的 `meta` 只有 `network` / `cache` / `snapshot` 三种来源，并可能带 `offline`、`stale`、`error`。
**只有 `source === 'network'` 且非离线才算 live**，其余一律显式标注「非实时」。

| 宿主 meta | 来源 Tag 文案（zh） | Tag tone | 页面提示行 | 页脚相对时间 |
| --- | --- | --- | --- | --- |
| `source: network`，`offline: false` | 上游实时目录 | `info` | 无 | 有（`n 分钟前刷新`） |
| `source: cache` | 本地缓存（非实时） | `neutral` | 「当前展示本地缓存目录（非实时）…」+ 重试 | 有 |
| `source: snapshot` | 随包快照（非实时） | `warning` | 「上游目录获取失败，当前展示随包快照（非实时）…」+ 重试 | **不显示**（快照的 fetchedAt 是本次读数，不是上游抓取时刻，避免说成「刚刚刷新」） |
| `offline: true`（叠加在来源上） | 跟随来源 | 跟随来源 | 「离线模式：当前展示的是随包快照或本地缓存，不是实时目录…」+ 重试 | 有 |
| `error` 存在 | 跟随来源 | 跟随来源 | 额外一行「目录抓取异常：<原因>」 | — |

页面在快照/缓存/离线时**不清空内容**：仍可浏览 9 类 17 条、看详情、复制 SkillHub 命令；
安装与卸载仍走宿主（宿主会自己给出网络错误）。任何错误都落在行内文本，不弹 `alert`。

## 7. 状态矩阵

| 状态 | 触发 | UI |
| --- | --- | --- |
| 初次加载 | 页面挂载、目录未到 | 页头 + 3 行骨架 + 官方 `TextShimmer`（`role="status"`）；无页脚按钮 |
| 就绪 | 目录到达 | 工具条 + 分类条 + 列表 + 页脚 |
| 刷新中 | 页脚刷新 / 离线提示重试 | 内容保留；刷新按钮 `disabled` + 图标旋转；按钮文案「刷新中…」 |
| 首次加载失败 | 目录请求失败且无旧数据 | 整页错误态：原因 + 官方 `Button` 重试（真的重新请求） |
| 刷新失败 | 已有目录时刷新失败 | 内容保留 + 一行「刷新失败：<原因>」，按钮恢复可点 |
| 空结果 | 搜索 / 分类 / 已安装筛选无命中 | 空态图标 + 具体原因（无结果/该分类暂无工具/还没安装）+ 一键清空筛选 |
| 安装/卸载中 | 行或详情的动作按钮 | 该行/该弹窗按钮 `disabled` + 文案「安装中…/卸载中…」；`ref` 锁防连点重复提交 |
| 动作失败 | 宿主返回错误 | 行内错误行「安装失败/卸载失败：<原因>」，页面内容不变 |
| 动作成功 | 安装/卸载成功 | 行内成功提示「已安装/已卸载 <名称>」+ 静默重取目录刷新 installed 标记 |
| 详情加载中 | 点开详情 | 弹窗内 `TextShimmer`「正在加载技能说明…」 |
| 详情失败 | detail 路由失败 | 弹窗内错误原因 + 重试按钮；挂载的安装/卸载按钮仍可用 |
| 详情就绪 | detail 返回 | 元信息表 + `MarkdownText` 正文 + 文件清单 + footer 动作 |

## 8. 动效

| 动效 | 实现 | 说明 |
| --- | --- | --- |
| 行 hover 底色过渡 | `transition: background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out)` | 唯一的状态过渡 |
| 刷新图标旋转 | `@keyframes fs-spin` + `.fs-spin` | 只在刷新进行中挂到官方 icon 的 `className` |
| `prefers-reduced-motion: reduce` | `.fs-view * { animation: none !important; transition: none !important }` | 关闭旋转与过渡；不复用任何入场动画 |
| 骨架 shimmer | 官方 `TextShimmer` | 动效由原语管理；本插件不加额外动画 |
| 弹窗/胶囊/按钮动效 | 官方原语 | 不覆盖、不加自定义 keyframes |

## 9. 可访问性

| 项 | 落地 |
| --- | --- |
| 分类胶囊 | 官方 `Pill` + `aria-pressed` 表示选中；同一时刻只有一枚 `active` |
| 视图切换 | 官方 `SegmentedControl` 自带 `role="tablist"`、`role="tab"`、`aria-selected`、方向键；内容面板用 `role="tabpanel"` + `id="financial-skills-view-<view>-panel"` + `aria-labelledby` 与 `aria-controls` 对应 |
| 搜索 | `Input` 带 `aria-label=搜索插件`；`type="search"`；Esc 清空 |
| 行名称 / 动作 | 名称按钮带 `aria-label=查看 <名称> 详情`；动作按钮用文字标签（详情/安装/卸载），图标不单独承担语义 |
| 装饰元素 | 侧栏 svg、48px 字形盒、空态/错误态图标均 `aria-hidden="true"` |
| 焦点 | 不写自定义 `outline`/`:focus-visible`；官方 Button/Input/Pill/Modal 的焦点环与焦点陷阱原样生效 |
| 键盘 | 全部为原生按钮/输入；Tab 顺序符合视觉顺序；Modal 用官方实现（Esc 关闭、焦点回收） |
| 状态播报 | 加载区 `role="status"`；错误/成功提示为正文文本（非仅颜色） |
| 语义 | 页头 `<header>` + `<h1>`，列表 `<ul>/<li>`，页脚 `<footer>`，详情元信息 `<dl>` |
| 减少动态 | `prefers-reduced-motion` 下无过渡/动画 |
| 对比度 | 全部文字使用官方语义色 token（primary/secondary/tertiary/caption），不自定义低对比色 |

## 10. 明确避免的反模式

| 反模式 | 本实现 |
| --- | --- |
| 品牌 logo / 插画 / 渐变 / 大色块 | 只有 16×16 线稿图标 + 名称首字字形盒；无渐变、无插画、无品牌色 |
| 硬编码颜色 / 手写暗色主题 | 颜色只用 `--dsw-*`（+ 3 个官方 `--ds-*` 核心变量）；无 `#hex`、`rgb()`、`hsl()`；无 `body[data-ds-dark-theme]` 覆盖（静态测试强制） |
| 手搓 Button / Input / Modal / Menu / Tag / Switch | 全部使用官方原语；自写 CSS 仅限布局容器、列表行、字形盒、弹窗正文外壳 |
| 第三方图片 / 字体 / 统计 / 外链请求 | 无 `<img>`；无外部字体；`fetch` 只打 5 条文档相对 API，全部 `cache:'no-store'` |
| 根绝对 `/api/...` | 文档相对路径（宿主 `<base href="./">`，子路径部署不逃逸） |
| `alert()` / `confirm()` 报错 | 行内错误行 + 重试按钮；复制失败给手动复制提示 |
| 把快照/缓存说成「实时」 | 来源标注矩阵；快照连「刚刚刷新」都不显示 |
| 刷新时整页 spinner、内容闪没 | 刷新保留内容，只禁用按钮 + 旋转图标 |
| 隐藏 0 条分类 | 9 类全部展示，0 条给「该分类暂无工具」 |
| 自绘焦点环 / 覆盖 `outline` | 不覆盖官方焦点样式 |
| 搜索防抖 / 虚拟列表过度设计 | 17 条输入即筛（`trim` + 大小写不敏感） |
| 构建步骤 / JSX / npm 依赖 | 手写 module-loader bundle，只 require `react` 与官方原语 |
| 组件内联 `<style>` 重复注入 | CSS 用 `style[data-plugin-css="dsh-financial-skills/panel.css"]` 守卫注入一次；挂 `data-plugin`/`data-plugin-css` |

## 11. 实现对照

CSS 只注入一次，注入标记：

```html
<style data-plugin="dsh-financial-skills"
       data-plugin-css="dsh-financial-skills/panel.css">…</style>
```

| 区域 | 组件（client.js） | 根 CSS 类 / 语义锚点 |
| --- | --- | --- |
| 侧栏入口 | `PanelIcon` | `data-dsh-panel-entry="financial-skills"` |
| 页面根 | `PanelPage` | `.fs-view`、`data-dsh-financial-skills-view`、`data-dsh-plugin="financial-skills"` |
| 页头 | `PanelPage` | `.fs-pageHead/.fs-headMain/.fs-title/.fs-intro/.fs-sourceLine`、`data-dsh-part="page-head"/"source-line"` |
| 工具条 | `PanelPage` | `.fs-toolbar/.fs-searchField/.fs-toolbarSpacer`、`data-dsh-part="toolbar"` |
| 视图内容面板 | `PanelPage` | `.fs-panelBody`、`role="tabpanel"`、id `financial-skills-view-<view>-panel` |
| 分类条 | `PanelPage` | `.fs-categoryBar/.fs-pillCount`、`data-dsh-part="category-bar"/"category-pill"` |
| 列表 / 行 | `SkillRow` | `.fs-list/.fs-row/.fs-rowHead/.fs-rowIcon/.fs-rowMain/.fs-rowTitleRow/.fs-rowOpen/.fs-rowSummary/.fs-rowMeta/.fs-rowEnd`、`data-dsh-part="skill-list"/"skill-row"` |
| 状态 | `PanelPage` / `DetailModal` | `.fs-state/.fs-stateText/.fs-stateIcon/.fs-stateHint/.fs-banner/.fs-notice/.fs-noticeRow/.fs-noticeOk/.fs-skeletons/.fs-skeletonRow/.fs-skeletonIcon/.fs-skeletonLines` |
| 页脚 | `PanelPage` | `.fs-footer/.fs-footerText/.fs-footerSpacer/.fs-spin`、`data-dsh-part="footer"/"footer-counts"` |
| 详情 | `DetailModal` | 官方 `Modal` + `.fs-detail/.fs-detailContent/.fs-detailMeta/.fs-detailKey/.fs-detailValue/.fs-detailSource/.fs-detailTags/.fs-detailBody/.fs-detailFoot/.fs-detailFootMeta/.fs-detailFootActions/.fs-code/.fs-fileList/.fs-footHintOk/.fs-footHintError` |
| 数据请求 | `createApi` / `requestJson` | `api/financial-skills/{catalog,installed,detail?id=,install,uninstall}` |

## 12. 验收与回归

```bash
# 语法
node --check client.js

# 浏览器半契约测试（25 个用例，无网络、无第三方依赖）
node --test test/client-contract.test.mjs
```

测试覆盖：
- **静态**：bundle id/外壳/语义锚点、官方模块 require、5 条文档相对 API、无 http(s)/`<img>`/`alert`、
  无 `#hex`/`rgb()`/`hsl()`、`var()` 白名单、reduced-motion 存在、无手写暗色选择器；
- **注册**：侧栏 id/order/label（zh 金融技能、en Financial Skills）、16×16 线稿图标、
  主区 key/financial-skills/inject 面、`apply()` 缺 slots/effect 时不抛错、卸载释放两处注册；
- **API 客户端**：5 条文档相对路径、`cache:'no-store'`、`?refresh=1`、id URL 编码、
  POST JSON body、宿主失败信封与 HTTP 状态错误；
- **CSS**：注入一次、二次求值不重复、`data-plugin`/`data-plugin-css` 属性、无 document 时可加载；
- **纯函数**：`filterSkills`（中英文名/摘要/标签/作者/id、分类、已安装、叠加）、
  `categoryCounts`（9 类 17 条、0 条分类、未归类）、`summarizeMeta`（network/cache/snapshot/offline）、
  `relativeTime`（刚刚/分钟/小时/天/绝对日期/非法值）、`panelId`/`panelLabel`；
- **渲染**：页头 + 搜索 + 视图 + 10 枚分类 Pill + 17 行 + 已安装计数、行内结构（48px 字形盒、
  14/500 名称、两行摘要、Tag 元信息、官方 Button 动作）、视图/分类/搜索/空态交互、
  加载骨架、首次加载失败重试、刷新 `?refresh=1` 失败降级、快照/离线标注、
  详情 Modal（`MarkdownText`/元信息/footer 动作/proprietary 提示/复制失败回退）、安装与卸载调用宿主路由。

与官方插件页的对齐点集中在上表；新增任何颜色、尺寸、原语替换时，请同步更新本文件与静态断言。
