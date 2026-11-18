# 设计规范 · 金融技能（dsh-financial-skills）浏览器半

> 本文是 `client.js` 的 UI 落地对照：每个界面区域用了哪个**官方 UI 原语**、哪种**官方设计 token**、
> 多少尺寸/间距，以及为什么这样写。实现与文字冲突时，以 `test/client-contract.test.mjs` 的断言与本文为准；
> 改动视觉必须同步改本文与 `test/client-contract.test.mjs` 的静态断言（该测试是随包发布的契约）。

## 1. 命名口径

| 位置 | 文案 | 说明 |
| --- | --- | --- |
| 插件中文名 / 侧栏行 label（zh） | **金融技能** | 宿主左侧栏入口，用户看到的名字 |
| 侧栏行 label（en） | **Financial Skills** | `document.documentElement.lang` 以 `en` 开头时使用 |
| 页面标题（banner） | **金融行业skills精选** | 主区 banner 标题，固定文案，不随插件名变化 |
| banner slogan | 「按业务场景策展的金融 AI 技能库」/ 英文对应句 | 固定文案：上游 `description` 长短不一，放进 banner 会让版式随数据抖动 |
| 数据源 | `openfcp/awesome-financial-skills` | 元信息行 + 页脚来源 Tag，不写成「实时」除非 `meta.source === 'network'` |
| id / slot key / 语义锚点 | `financial-skills`、`data-dsh-financial-skills-view` | 不随中文名变化（宿主契约） |

## 2. 设计立场

1. **官方原语优先**：搜索框、视图切换、分类胶囊、标签、按钮、详情弹窗、Markdown 正文、加载文案
   全部来自 `@deepseek-ai/dsh-client-ui-primitives`。插件自己的 CSS 只负责**布局容器、banner、
   元信息行、卡片列表、弹窗正文外壳**这些原语覆盖不到的结构。
2. **官方 token 优先**：颜色、圆角、边框、骨架底色全部走 `var(--dsw-*)`；字体继承官方或
   `var(--ds-font-family-code)`。亮/暗主题不做任何插件侧覆盖，由宿主替换 token 值。
3. **版式顺序固定**（用户指定）：banner → 元信息一行（数据源 / 更新 / 实时或非实时 + **紧跟其右的红色刷新**）→
   搜索（左）+ 视图（右）→ 横分割线 → 胶囊分类 → **一行一条的长条卡片**（自上而下排列）→ 页脚（更新日期一览，保持原样）。
4. **先快后美**：首屏能立住（banner / 元信息 / 搜索框在骨架期就画出来）、装完立即出现、
   刷新不闪没；动效与装饰只做「不拖慢」的那部分。
5. **数据与来源如实**：目录来自网络、本地缓存还是随包快照，UI 必须直说；快照/缓存不得标成实时；
   安装/卸载失败给可操作的行内错误，不弹 `alert`。

## 3. 页面栅格

| 项 | 值 | 落地位置 |
| --- | --- | --- |
| 页面最大宽度 | `max-width: 1120px` | `.fs-shell` |
| 页边距 | `padding: 0 clamp(20px, 3vw, 40px) 40px` | `.fs-page` |
| 顶部留白 | `padding-top: 20px` | `.fs-shell` |
| shell 内区块间距 | `gap: 18px`（banner / 元信息 / 工具条 / 分割线 / 内容 / 页脚） | `.fs-shell` |
| 面板内间距 | `gap: 14px`（分类条 / 通知 / 卡片列表） | `.fs-panelBody` |
| 卡片列表 | `display:flex; flex-direction:column; gap:10px`（**一行一条**，不排多列） | `.fs-grid` |
| banner 标题 | `19px / 26px / 600` | `.fs-heroTitle` |
| banner slogan | `12.5px / 18px`，`--dsw-alias-label-secondary` | `.fs-heroSlogan` |
| 元信息行 / caption | `12px / 18px`，`--dsw-alias-label-tertiary` | `.fs-metaRow`、`.fs-footerText` |
| 卡片名称 | `14.5px / 21px / 600` | `.fs-cardName` |
| 卡片英文名 | `11.5px / 16px`，`--dsw-alias-label-tertiary` | `.fs-cardNameEn` |
| 卡片摘要 | `12px / 18px`，单行截断（长条卡横向空间够，不需要第二行） | `.fs-cardSummary` |
| 卡片元信息 | `11.5px / 16px`；四枚胶囊 + 两项纯文本，`flex-wrap` | `.fs-cardMeta` / `.fs-cardChips` / `.fs-cardFacts` |
| 刷新按钮 | `height 26`、`padding 0 12`、`border-radius 999px`、`12.5/26/500` | `.fs-refresh` |
| 圆角 | banner / 卡片 / 弹窗外壳 `--dsw-radius-xl`；banner 标识盒 `--dsw-radius-lg` | 见各选择器 |
| 边框 | 卡片 `1px solid var(--dsw-alias-border-l2)`；已安装卡片换成 `--dsw-alias-state-success-primary`；分割线 `--dsw-alias-border-l2` | `.fs-card`、`.fs-divider` |
| 响应式 | 唯一断点 `720px`：长条卡从「信息左 / 动作右」改为上下两段；其余靠 `clamp` 页边距 + 元信息/胶囊 `flex-wrap` | `.fs-card`（`@media (max-width:720px)`） |

## 4. 区域 → 官方原语 → token → 尺寸

| # | UI 区域 | 官方原语 / 结构 | 使用 token | 尺寸 / 间距 |
| --- | --- | --- | --- | --- |
| 1 | 侧栏入口图标 | 手绘 16×16 `svg`（银行柱廊：地面/檐口/山花/三柱），`stroke="currentColor"`、`fill="none"`、`aria-hidden` | 颜色继承宿主行 | `viewBox 0 0 16 16`；`width/height = size`（宿主给 16） |
| 2 | banner 容器 | `<header>` | 边框 `--dsw-alias-border-l2`、底色 `--dsw-alias-bg-layer-1`、圆角 `--dsw-radius-xl` | `padding 22 24`、`gap 16` |
| 3 | banner 标识 | 内联 22×22 `svg`：**四块 `rx=3` 圆角方 + 每块一个半圆凸榫**（圆心落在方边上，只露一半），顺时针首尾相扣；每块是 `<g opacity>` 包 `rect` + `circle` | 盒描边 `--dsw-alias-border-l3`、底色 `--dsw-alias-bg-layer-2`、图标色 `--dsw-alias-label-secondary`；块面 `fill="currentColor"` + 4 档组透明度（0.9 / 0.62 / 0.38 / 0.7）→ **灰白色调**，亮/暗自动跟随 | 44×44 盒、图标 22、圆角 `--dsw-radius-lg`、凸榫 `r=1.9` |
| 4 | banner 标题 | `<h1>` | `--dsw-alias-label-primary` | `19/26/600`、字距 `0.2px` |
| 5 | banner slogan | `<p>`（固定文案） | `--dsw-alias-label-secondary` | `12.5/18` |
| 6 | banner 统计胶囊 | `<span>`（非交互，只读数字）**「{分类数} 个分类 · {技能数} 个技能」——分类在前、条数在后，两个数字都从当前目录算，不写死** | 边框 `--dsw-alias-border-l2`、文字 `--dsw-alias-label-secondary` | `padding 5 12`、`13/18/500`、字距 `0.2px`、`tabular-nums`、`border-radius 999px`；窄屏（≤720px）banner 换行，胶囊落到标题下方 |
| 7 | 元信息行 | `<div>` + `<span>` 键值对 + 官方 `Tag`（实时/非实时）+ **紧贴其右的原生 `<button>`（刷新）** | 键 `--dsw-alias-label-caption`、值 `--dsw-alias-label-secondary`、分隔点 `--dsw-alias-border-l3`；Tag tone `info`（实时）/ `warning`（非实时）；刷新**浅红底（10%）+ 红描边（45%）+ 红字**，全部由 `--dsw-alias-state-error-primary` 经 `color-mix` 调出来，不写死红色 | `12/18`、`gap 10`、`tabular-nums`；刷新 `height 26`、`padding 0 11`、胶囊圆角、图标 14 |
| 8 | 工具栏 | `<div>` 布局容器（搜索左、视图右，中间 `flex:1` 撑开） | — | `gap 12`、`flex-wrap` |
| 9 | 搜索框 | 官方 `Input`（`type=search`）+ 官方 `IconSearchOutlineRegular` 前置图标 | 原语自带（含 focus 环） | 容器 `flex:0 1 360px; min-width:200px; max-width:360px`；图标 16 |
| 10 | 视图切换 | 官方 `SegmentedControl`（`全部插件` / `已安装 (n)`） | 原语自带 | 结构 id `financial-skills-view` |
| 11 | 横分割线 | `<hr>` | `--dsw-alias-border-l2` | `.5px` |
| 12 | 分类胶囊 | 官方 `Pill` × 10（全部 + 9 类）+ 计数 `span` | Pill 自带选中态；计数 `--dsw-alias-label-caption` | `12/18`、`tabular-nums`、gap 8 |
| 13 | 卡片列表 | `<ul>`（纵向 flex）/ `<li>` | — | `flex-direction:column`、`gap 10` |
| 14 | 卡片容器（长条） | `<li>` 横向两段：`.fs-cardMain`（`flex:1`，信息）+ `.fs-cardActions`（`flex:none`，动作） | 边框 `1px --dsw-alias-border-l2`（已安装换 `--dsw-alias-state-success-primary`）、底色 `--dsw-alias-bg-layer-1`、hover `--dsw-alias-bg-layer-2` + `--dsw-alias-border-l3`、圆角 `--dsw-radius-xl` | `padding 12 14 12 16`、`gap 16`、`align-items:center` |
| 15 | 卡片名称 | 原生 `<button>`（link 样式，无底色无边框） | `color: inherit` | `14.5/21/600`；hover 下划线；不覆盖焦点环 |
| 16 | 卡片英文名 | `<span>` | `--dsw-alias-label-tertiary` | `11.5/16`；与中文名相同则不渲染 |
| 17 | 卡片摘要 | `<p>`，`-webkit-line-clamp: 1`，`title` 给全文 | `--dsw-alias-label-tertiary` | `12/18`（单行，长条卡不再预留两行高度） |
| 18 | 卡片元信息 · **胶囊** | 官方 `Tag` `tone="outline"` × 4：类别 / 来源 / 版本 / 协议（缺值写「未标注」，不隐藏） | 原语自带描边与底色 | `11.5/16`、`gap 6`、`flex-wrap` |
| 18b | 卡片标题行 · **右上角纯文本** | `<span>` 键值对 × 2：作者 / 核验日期，装在 `.fs-cardHead` 尾部（与中英名同一行，`margin-left:auto` 顶到最右；窄屏整块换行）。两项各是 `grid-template-columns: max-content 10ch` 的**定宽两列**——键宽由文字定、值列恒为 `10ch`，整块宽度因此对每张卡片都一样，**作者列与日期列纵向对齐**，姓名/作者名长短都不会把日期推来推去 | 键 `--dsw-alias-label-caption`、值 `--dsw-alias-label-secondary` | `11.5/16`、两项间距 `14`、键值间距 `4`、值列 `10ch` 省略号、`tabular-nums` |
| 19 | 卡片调用名（已安装才出现） | `<p>`：**官方 `Tag`（已安装）打头** + 「调用名」 + `<code>`；缺调用名时用一句话兜底 | 标签 `--dsw-alias-state-success-primary`、代码 `--ds-font-family-code`、兜底文案 `--dsw-alias-label-tertiary` | `11.5/16`、gap 6、值省略号截断 |
| 20 | 卡片动作 | 官方 `Button` `size="sm"`，装在 `.fs-cardActions`（定宽、不与信息抢位） | `variant="primary"`（安装）/ `variant="ghost"`（详情）/ `variant="outline"`（卸载，**带灰描边**） | 原语自带；`gap 6`、窄屏（≤720px）时换行到卡片下方并右对齐 |
| 21 | 加载态 | 官方 `TextShimmer` + 6 条卡片骨架；**banner / 元信息行（含刷新按钮）/ 工具条 / 分割线照常渲染** | 骨架底色 `--dsw-alias-bg-skeleton`、文案 `--dsw-alias-label-tertiary` | 骨架条 `height 78`、`radius xl`、`role="status"` |
| 22 | 错误态 | 官方 `IconWarningTriangleOutlineRegular` + `Button variant="outline"` | `--dsw-alias-state-error-primary`（文案） | 图标 28、`13/20`、`padding 40 16` |
| 23 | 空结果态 | 官方 `IconSkillOutlineRegular` + `Button variant="outline"`（清空筛选） | `--dsw-alias-label-tertiary` / `--dsw-alias-label-caption` | 图标 28、`13/20` + `12/18` |
| 24 | 离线 / 快照提示 | `<div>` + `Button variant="ghost"`（就地重试） | `--dsw-alias-state-warn-primary` | `12/18`、gap 8 |
| 25 | 详情弹窗 | 官方 `Modal`（open/title/description/footer/closeLabel） | 原语自带（遮罩/层级/焦点管理） | `width: min(720px,100%)`、`max-height: min(760px,100%)` |
| 26 | 详情元信息 | `<dl>` grid（`max-content 1fr`）+ 官方 `Tag` | 键 `--dsw-alias-label-caption`、值 `--dsw-alias-label-primary`、分隔线 `--dsw-alias-border-l2` | `13/20`、gap `4px 16px` |
| 27 | 详情正文 | 官方 `MarkdownText`（`variant="body"`，传 labels） | 原语自带 | 自适应 |
| 28 | 详情 footer | 官方 `Button size="sm"`：安装/卸载、复制 SkillHub 命令、打开来源站 | `primary`（安装）/ `outline`（卸载、复制命令）/ `ghost`（打开来源站）；成功/失败提示用 `--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary` | gap 8、可换行 |
| 29 | 文件清单 | `<code>` 小标签（最多 12 个 + 剩余计数） | `--ds-font-family-code`（官方核心字体 token，带 `ui-monospace` 回退） | `12.5px`、gap 6 |
| 30 | 页脚（更新日期一览，保持原样） | `<footer>` + 官方 `Tag`（来源）；**不再放刷新按钮**——同一屏只留一个刷新入口 | 分隔线 `--dsw-alias-border-l2`；文字 `--dsw-alias-label-tertiary` | `12/18`、gap 12、`padding 8 0 4` |

### 4.1 为什么卡片名称用原生 `<button>`

官方原语里没有「文本链接」型按钮；卡片动作本身已全部使用官方 `Button`。卡片名称沿用宿主技能行/插件行
的既有做法：一个 `background: none; border: 0; font: inherit` 的原生按钮，提供「点名称进详情」的
链接式可点区。它不绘制任何官方 Button 外观，也不覆盖焦点环样式，键盘行为（Enter/Space、Tab 顺序）
由浏览器原生提供。

### 4.2 为什么去掉头像 / 字形盒

旧版每条技能左侧有 48×48 首字盒：卡片宽度只有 320px 起，再让 48px 盒 + 间距吃掉横向空间，名称与摘要
就只剩一行。改成一行一条的长条卡后横排空间宽敞，左侧只留文字：中文名 + 英文名同行、摘要一行、
元信息「四枚胶囊 + 两项文本」一行——信息密度更高，且完全不靠装饰。

### 4.3 已安装卡片为什么换边框色而不是加底色

底色由 hover 态占用（`--dsw-alias-bg-layer-2`），再加一层已安装底色会让 hover 失效；外边框是唯一
「常态可见、hover 不冲突、暗色下仍成立」的位置。颜色取 `--dsw-alias-state-success-primary`，
与卡片内「已安装」Tag 同色系，两个线索互相印证。

## 5. 颜色与主题

**亮色与暗色不写两套 CSS。** 所有颜色都是语义 token，宿主在暗色下替换同一组变量，页面自动跟随。
客户端没有 `body[data-ds-dark-theme]` 之类的手写暗色覆盖（测试会静态断言它不存在）。

| token | 用途 |
| --- | --- |
| `--dsw-alias-label-primary` | banner 标题、卡片名称、详情值 |
| `--dsw-alias-label-secondary` | slogan、统计胶囊、元信息值、卡片元信息值 |
| `--dsw-alias-label-tertiary` | 元信息键之上的弱化信息、卡片英文名、摘要、页脚、空态 |
| `--dsw-alias-label-caption` | 元信息键、分类计数、卡片元信息键、空态提示 |
| `--dsw-alias-bg-layer-1` | banner / 卡片底色 |
| `--dsw-alias-bg-layer-2` | banner 标识盒底色、卡片 hover 底色 |
| `--dsw-alias-label-secondary` | banner 标识（灰白档，随主题在亮/暗之间自动换向）、slogan、统计胶囊 |
| `--dsw-alias-border-l2` | 卡片边框、分割线、页脚/详情分隔线、卡片元信息上分隔线、统计胶囊描边 |
| `--dsw-alias-border-l3` | banner 标识盒描边、元信息分隔点、卡片 hover 边框 |
| `--dsw-alias-bg-skeleton` | 加载骨架占位 |
| `--dsw-alias-state-success-primary` | 已安装卡片边框、「已安装」Tag、调用名、操作成功提示 |
| `--dsw-alias-state-warn-primary` | 非实时 Tag（快照 / 缓存 / 离线） |
| `--dsw-alias-state-error-primary` | 目录/刷新/详情加载错误、复制失败提示 |
| `--dsw-radius-xl` / `--dsw-radius-lg` | banner / 卡片 / 弹窗外壳 / 骨架卡；banner 标识盒 |
| `--ds-transition-duration`、`--ds-ease-in-out` | 唯一的过渡曲线（来自宿主核心变量，带 0.2s / ease-in-out 回退） |
| `--ds-font-family-code` | 调用名、详情里的命令与文件路径（带 `ui-monospace` 回退） |

> 说明：`--ds-*` 是 DSH 的核心变量（非 `--dsw-` 语义别名），官方已装插件的 CSS 同样用
> `--ds-font-family-code` / `--ds-transition-duration`，本文按契约 §4.1 引用。

## 6. 数据来源（meta）标注矩阵

宿主的 `meta` 只有 `network` / `cache` / `snapshot` 三种来源，并可能带 `offline`、`stale`、`error`。
**只有 `source === 'network'` 且非离线才算 live**，其余一律显式标注「非实时」。

「实时 / 非实时」在两处同时出现：元信息行里的 Tag（`实时` / `非实时`）与页脚来源 Tag（更具体的原因）。**不再有第三处**：0.2.3 删掉了目录区顶部的黄色说明行与它的第二枚「重试」，刷新只保留元信息行右侧那一枚红色胶囊。
前者给一眼可读，后者给可追溯依据。

| 宿主 meta | 元信息行 Tag | 页脚来源 Tag（zh） | 页脚 Tag tone | 页面提示行 | 页脚相对时间 |
| --- | --- | --- | --- | --- | --- |
| `source: network`，`offline: false` | 实时（`info`） | 上游实时目录 | `info` | 无 | 有（`n 分钟前刷新`） |
| `source: cache` | 非实时（`warning`） | 本地缓存（非实时） | `neutral` | 无（0.2.3 起不再插说明行，状态只由 Tag 承担） | 有 |
| `source: snapshot` | 非实时（`warning`） | 随包快照（非实时） | `warning` | 无（同上）；抓取异常另由 `.fs-banner` 报错行显示 | **不显示**（快照的 fetchedAt 是本次读数，不是上游抓取时刻，避免说成「刚刚刷新」） |
| `offline: true`（叠加在来源上） | 非实时（`warning`） | 跟随来源 | 跟随来源 | 无（同上） | 有 |
| `error` 存在 | — | 跟随来源 | 跟随来源 | 额外一行「目录抓取异常：<原因>」 | — |

页面在快照/缓存/离线时**不清空内容**：仍可浏览完整清单、看详情、复制 SkillHub 命令；
安装与卸载仍走宿主（宿主会自己给出网络错误）。任何错误都落在行内文本，不弹 `alert`。

## 7. 状态矩阵

| 状态 | 触发 | UI |
| --- | --- | --- |
| 初次加载 | 页面挂载、目录未到 | banner + 元信息行（日期位写「—」）+ 搜索/视图 + 分割线照常渲染，只把内容区换成 6 张骨架 + 官方 `TextShimmer`（`role="status"`）；无页脚 |
| 就绪 | 目录到达 | 元信息行补上真实日期与实时/非实时 Tag（刷新按钮一直在位）→ 分类条 + 长条卡片列表 + 页脚 |
| 刷新中 | 元信息行刷新（或页脚刷新、离线提示重试） | 内容保留；两处刷新按钮 `disabled` + 图标旋转；元信息行按钮文案「刷新中…」 |
| 首次加载失败 | 目录请求失败且无旧数据 | 整页错误态：原因 + 官方 `Button` 重试（真的重新请求） |
| 刷新失败 | 已有目录时刷新失败 | 内容保留 + 一行「刷新失败：<原因>」，按钮恢复可点 |
| 空结果 | 搜索 / 分类 / 已安装筛选无命中 | 空态图标 + 具体原因（无结果/该分类暂无工具/还没安装）+ 一键清空筛选 |
| 安装/卸载中 | 卡片或详情的动作按钮 | 该卡片/该弹窗按钮 `disabled` + 文案「安装中…/卸载中…」；`ref` 锁防连点重复提交 |
| 动作失败 | 宿主返回错误 | 行内错误行「安装失败/卸载失败：<原因>」，页面内容不变 |
| 动作成功 | 安装/卸载成功 | 行内成功提示「已安装/已卸载 <名称>」+ 静默重取目录刷新 installed 标记与卡片边框 |
| 详情加载中 | 点开详情 | 弹窗内 `TextShimmer`「正在加载技能说明…」 |
| 详情失败 | detail 路由失败 | 弹窗内错误原因 + 重试按钮；挂载的安装/卸载按钮仍可用 |
| 详情就绪 | detail 返回 | 元信息表 + `MarkdownText` 正文 + 文件清单 + footer 动作 |

## 8. 动效

| 动效 | 实现 | 说明 |
| --- | --- | --- |
| 卡片 hover 边框/底色过渡 | `transition: border-color, background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out)` | 唯一的状态过渡 |
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
| 卡片名称 / 动作 | 名称按钮带 `aria-label=查看 <名称> 详情`；动作按钮用文字标签（详情/安装/卸载），图标不单独承担语义 |
| 元信息 | 卡片元信息用 `<dl>/<dt>/<dd>`（键值语义由标签本身表达，不靠视觉排布）；截断的值带 `title` |
| 装饰元素 | 侧栏 svg、banner 标识 svg、空态/错误态图标均 `aria-hidden="true"` |
| 焦点 | 不写自定义 `outline`/`:focus-visible`；官方 Button/Input/Pill/Modal 的焦点环与焦点陷阱原样生效 |
| 键盘 | 全部为原生按钮/输入；Tab 顺序符合视觉顺序；Modal 用官方实现（Esc 关闭、焦点回收） |
| 状态播报 | 加载区 `role="status"`；错误/成功提示为正文文本（非仅颜色） |
| 语义 | banner `<header>` + `<h1>`，卡片列表 `<ul>/<li>`，页脚 `<footer>`，详情元信息 `<dl>` |
| 减少动态 | `prefers-reduced-motion` 下无过渡/动画 |
| 对比度 | 全部文字使用官方语义色 token（primary/secondary/tertiary/caption），不自定义低对比色 |

## 10. 明确避免的反模式

| 反模式 | 本实现 |
| --- | --- |
| 位图 logo / 插画 / 渐变 / 大色块 | banner 标识是内联 22×22 块面 SVG（`currentColor` + 4 档组透明度 = 灰白层次），随主题自动明暗；无位图、无渐变、无插画 |
| 头像 / 首字字形盒 | 已移除：卡片用中文名 + 英文名区分，不再占 48px 放一个装饰盒 |
| 硬编码颜色 / 手写暗色主题 | 颜色只用 `--dsw-*`（+ 2 个官方 `--ds-*` 核心变量）；无 `#hex`、`rgb()`、`hsl()`；无 `body[data-ds-dark-theme]` 覆盖（静态测试强制） |
| 手搓 Button / Input / Modal / Menu / Tag / Switch | 全部使用官方原语；自写 CSS 仅限布局容器、banner、元信息行、卡片、弹窗正文外壳 |
| 第三方图片 / 字体 / 统计 / 外链请求 | 无图片元素；无外部字体；`fetch` 只打 5 条文档相对 API，全部 `cache:'no-store'` |
| 根绝对 `/api/...` | 文档相对路径（宿主 `<base href="./">`，子路径部署不逃逸） |
| `alert()` / `confirm()` 报错 | 行内错误行 + 重试按钮；复制失败给手动复制提示 |
| 把快照/缓存说成「实时」 | 来源标注矩阵；快照连「刚刚刷新」都不显示 |
| 刷新时整页 spinner、内容闪没 | 刷新保留内容，只禁用按钮 + 旋转图标 |
| 隐藏 0 条分类 | 9 类全部展示，0 条给「该分类暂无工具」 |
| 自绘焦点环 / 覆盖 `outline` | 不覆盖官方焦点样式 |
| 搜索防抖 / 虚拟列表过度设计 | 全量词条输入即筛（`trim` + 大小写不敏感）；171 条卡片不需要虚拟化 |
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
| 版式外壳 | `PanelPage` | `.fs-page/.fs-shell`、`data-dsh-part="page"/"shell"` |
| banner | `PanelPage` | `.fs-hero/.fs-heroMark/.fs-heroMain/.fs-heroTitle/.fs-heroSlogan/.fs-heroSpacer/.fs-heroBadge`、`data-dsh-part="hero"/"hero-badge"` |
| 元信息一行 | `PanelPage` | `.fs-metaRow/.fs-metaItem/.fs-metaKey/.fs-metaVal/.fs-metaDot/.fs-metaSpacer`、`data-dsh-part="meta-row"/"source-line"/"updated-line"/"verified-line"/"freshness"/"refresh-action"` |
| 工具条 | `PanelPage` | `.fs-toolbar/.fs-searchField/.fs-toolbarSpacer`、`data-dsh-part="toolbar"` |
| 分割线 | `PanelPage` | `.fs-divider`、`data-dsh-part="divider"` |
| 视图内容面板 | `PanelPage` | `.fs-panelBody`、`role="tabpanel"`、id `financial-skills-view-<view>-panel` |
| 分类条 | `PanelPage` | `.fs-categoryBar/.fs-pillCount`、`data-dsh-part="category-bar"/"category-pill"` |
| 卡片列表 / 长条卡 | `SkillCard` | `.fs-grid/.fs-card/.fs-cardMain/.fs-cardHead/.fs-cardName/.fs-cardNameEn/.fs-cardBadge/.fs-cardSummary/.fs-cardMeta/.fs-cardChips/.fs-cardFacts/.fs-cardFact/.fs-cardFactKey/.fs-cardFactVal/.fs-cardInvoke/.fs-cardInvokeCode/.fs-cardActions`、`data-dsh-part="skill-grid"/"skill-card"/"card-meta"/"card-chips"/"card-facts"/"card-actions"/"card-invocation"`、`data-field="field.*"`、`data-installed="true|false"` |
| 刷新按钮 | `PanelPage` | `.fs-refresh/.fs-refreshIcon`、`data-dsh-part="refresh-action"`（紧随 `freshness` 之后，全页唯一） |
| 状态 | `PanelPage` / `DetailModal` | `.fs-state/.fs-stateText/.fs-stateIcon/.fs-stateHint/.fs-banner/.fs-notice/.fs-noticeOk/.fs-notices/.fs-skeletons/.fs-skeletonGrid/.fs-skeletonCard` |
| 页脚 | `PanelPage` | `.fs-footer/.fs-footerText/.fs-footerSpacer/.fs-spin`、`data-dsh-part="footer"/"footer-counts"` |
| 详情 | `DetailModal` | 官方 `Modal` + `.fs-detail/.fs-detailContent/.fs-detailMeta/.fs-detailKey/.fs-detailValue/.fs-detailSource/.fs-detailTags/.fs-detailBody/.fs-detailFoot/.fs-detailFootMeta/.fs-detailFootActions/.fs-code/.fs-fileList/.fs-footHintOk/.fs-footHintError` |
| 数据请求 | `createApi` / `requestJson` | `api/financial-skills/{catalog,installed,detail?id=,install,uninstall}` |

## 12. 验收与回归

```bash
# 语法
node --check client.js

# 浏览器半契约测试（26 个用例，无网络、无第三方依赖）
node --test test/client-contract.test.mjs
```

测试覆盖：
- **静态**：bundle id/外壳/语义锚点、官方模块 require、5 条文档相对 API、无 http(s)/图片元素/`alert`、
  无 `#hex`/`rgb()`/`hsl()`、`var()` 白名单、reduced-motion 存在、无手写暗色选择器；
- **注册**：侧栏 id/order/label（zh 金融技能、en Financial Skills）、16×16 线稿图标、
  主区 key/financial-skills/inject 面、`apply()` 缺 slots/effect 时不抛错、卸载释放两处注册；
- **API 客户端**：5 条文档相对路径、`cache:'no-store'`、`?refresh=1`、id URL 编码、
  POST JSON body、宿主失败信封与 HTTP 状态错误；
- **CSS**：注入一次、二次求值不重复、`data-plugin`/`data-plugin-css` 属性、无 document 时可加载、
  卡片默认浅灰边框 + 已安装换 success 边框的静态断言；
- **纯函数**：`filterSkills`（中英文名/摘要/标签/作者/id、分类、已安装、叠加）、
  `categoryCounts`（全量/分类计数、0 条分类、未归类）、`summarizeMeta`（network/cache/snapshot/offline）、
  `relativeTime`（刚刚/分钟/小时/天/绝对日期/非法值）、`panelId`/`panelLabel`、
  `skillFieldPairs`（六项齐全、缺值「未标注」、`proprietary` 本地化）、
  `secondaryName`（中↔英互补、同名不重复）、`invocationNameOf`；
- **渲染**：banner + 元信息一行 + 搜索/视图 + 分割线 **顺序断言**、10 枚分类 Pill、全量技能卡片、
  已安装卡片边框与 Tag、长条卡结构（中文名+英文名/单行摘要/四枚胶囊/两项文本/调用名/官方 Button 动作）、
  视图/分类/搜索/空态交互、加载态骨架与「banner 先立住不跳版」、首次加载失败重试、
  刷新 `?refresh=1` 失败降级、快照/离线标注、
  详情 Modal（`MarkdownText`/元信息/footer 动作/proprietary 提示/复制失败回退）、安装与卸载调用宿主路由。

与官方插件页的对齐点集中在上表；新增任何颜色、尺寸、原语替换时，请同步更新本文件与静态断言。
