# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## 0.2.3 — 2026-11-18

去掉目录区顶部那条多余的黄色提示。

### 变更

- **删除「当前展示本地缓存目录（非实时）。可点刷新从上游重取。」提示行**，以及它旁边那枚第二枚「重试」按钮。非实时状态已经由元信息行的「非实时」Tag 说明，刷新也已经有那一枚红色胶囊，多一条黄字 + 多一个按钮属于重复告知，还把搜索框和分类胶囊之间的版面撞出一道空档。
- 页脚来源 Tag（`本地缓存（非实时）` / `随包快照（非实时）`）保留——它说明的是「这份清单从哪来」，与顶部状态标签分工不同。
- 真错误仍然如实显示：目录抓取异常（`meta.error`）、安装/卸载失败、操作成功提示都不受影响。

### 测试

`npm test` **92/92**（Host 65 + 浏览器半 27）。两处断言改为反向锁定：cache / snapshot / offline 三种来源**不得**再出现说明行，非实时态**不得**出现第二枚「重试」按钮，同时「目录抓取异常」这类真错误必须仍然显示。

## 0.2.2 — 2026-11-18

版式收口：作者与核验日期上移、卸载按钮显形、banner 统计胶囊重排并放大。

### 变更

- **作者与核验日期移到卡片右上角，并跨卡片对齐**：从元信息行挪进标题行（`.fs-cardHead`）尾部，与中文名 / 英文名同一行、靠右对齐（`margin-left: auto`）。两项各自是 `grid-template-columns: max-content 10ch` 的**定宽两列**（键宽随文字、值列恒 `10ch` + `tabular-nums`），整块宽度对每张卡片都相同，所以**作者列、核验日期列在纵向一列一列对齐**，作者名或技能名长短都不会把日期推走；超出 `10ch` 的作者名用省略号，`title` 给全文。元信息行因此只剩四枚胶囊，纵向少一行，卡片更矮；窄屏（≤720px）标题行自动换行，整块信息落到名称下方右对齐，不会被挤掉。
- **卸载按钮加灰色边框**：`variant` 由 `ghost` 改为 `outline`（详情弹窗里的卸载同步改），和只有文字的「详情」区分开——卸载是破坏性动作，需要一个看得见的按钮边界，但仍低于「安装」的 `primary`。
- **banner 统计胶囊改成「{分类数} 个分类 · {技能数} 个技能」并放大**：分类在前、条数在后，字号 `11.5/16` → `13/18`（字重 500、内距 `5 12`）。两个数字都由当前目录实时算出（分类数在目录没声明分类时退回技能里实际出现过的分类数），刷新、搜索、安装都不会让数字停在旧值；目录没到手前显示 `—`，不写 0。

### 文档

- **README 重写**（中英双版）：首图 + 「DSH 插件：把「金融行业 skills 精选」放进左边栏」一句话主题 + 数据链路图 + 三步上手图；新增「为什么做这个」「技能从哪来（收录标准 + 九类分布）」；删除逐条罗列式的旧介绍。配图由 `scripts/readme-images.py` 用 PIL 直绘（2× 超采样），风格沿用上游清单站的纸感浅底 + 深绿。

### 测试

`npm test` **92/92**（Host 65 + 浏览器半 27）。新增/改写断言：统计胶囊必须「分类数在条数之前」且两个数字随清单变化（含分类缺失时的回退）、作者/核验日期必须是标题行最后一个元素且不占元信息行、卸载按钮必须是 `outline`。

## 0.2.1 — 2026-11-18

版式微调，只动界面，不动数据与安装链路。

### 变更

- **刷新按钮上移并变醒目**：从页脚左下角搬到元信息行，**紧贴在「实时 / 非实时」标签右侧**，改成**浅红底 + 红描边 + 红字**的胶囊按钮（`background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)`、`border` 45%、`color` 纯 token；hover 分别提到 18% / 68%）。不用实心大红——整页只此一个彩色元素，浅色已经足够醒目，实心红反而抢内容。页脚不再放第二个刷新按钮：同一屏只留一个刷新入口。
- **元信息行去掉核验日期**：一行只剩「数据源 · 更新 · 实时/非实时 · 刷新」。核验日期仍在每张卡片的元信息里，信息没有丢失。
- **技能卡从多列网格改成一行一条的长条卡**：`.fs-grid` 改为 `flex-direction:column`，卡片横向分两段——左侧弹性信息段（名称 + 英文名 + 一行摘要 + 元信息）、右侧定宽动作段（详情 / 安装或卸载）。窄屏（≤720px）时动作段落到卡片下方并右对齐。
- **元信息按语义分两种形态**：类别 / 来源 / 版本 / 协议用官方 `Tag`（`tone="outline"`）画成**四枚胶囊**；作者 / 核验日期**直接写成文本**，不再有键名网格。`skillFieldPairs()` 每项加 `capsule` 标记，一处定义、两处消费。
- 摘要由两行截断改为单行（长条卡横向空间充足，不需要第二行抬高卡片）。
- **「已安装」标签从标题行挪到调用名行最前面**：标题行只剩「中文名 + 英文名」不再被标签挤短；标签后面紧跟「调用名 xxx」。老安装（0.1.x，provenance 里没有调用名）仍保留标签，并写「调用名未记录，重装一次即可补全」。
- **banner 标识换成灰白色调**：四块 `rx=3` 圆角方 + 各自一个半圆凸榫（圆心落在方边上，只露一半），顺时针首尾相扣；每块用 `<g opacity>` 包 `rect` + `circle`，组内重叠不二次加深，4 档组透明度（0.9 / 0.62 / 0.38 / 0.7）构成灰白层次。颜色只取 `currentColor` + `--dsw-alias-label-secondary`，亮/暗主题自动明暗，不写死任何灰。
- 加载骨架从 168px 方格卡改成 78px 长条，与真实卡片同形，目录到手时不跳版。

### 测试

`npm test` **91/91**（Host 65 + 浏览器半 26）。新增/改写断言：刷新按钮是 `button.fs-refresh` 且索引紧跟在 `freshness` 之后、全页只有一个刷新按钮、页脚无按钮、元信息行无核验日期、`.fs-grid` 必须是纵向 flex 且不得出现 `grid-template-columns`、四枚胶囊的 `data-field` 顺序与 `tone`、作者/核验日期不得用胶囊。

## 0.2.0 — 2026-11-18

这一版只解决一件事：**装得快、装得上、装完就能用**。界面同时按「banner → 元信息一行 → 搜索/视图 → 分割线 → 胶囊分类 → 技能卡片」重排。

### 性能

- **清单刷新快了一个数量级**：四个镜像从「串行降级、每条最长 8 秒」改成**错峰并行竞速**（首跳 0ms、之后每条错开 300ms，首个有效载荷胜出后立刻 abort 其余）。首发命中即返回，慢镜像不再拖住整次刷新。真机实测 `catalog: network 1559ms`（此前最坏要等满 4×22 秒）。
- **ETag / 304 复用**：缓存里存下 `etag`，刷新时带 `If-None-Match`；命中 304 时只更新 `fetchedAt`，不再重写 189 KB 正文。
- **stale-while-revalidate**：磁盘缓存过期时**先立即返回旧目录**，后台单飞重同步；页面不再为了等网络而空转。
- **整仓 tarball 取件**：GitHub 来源改为先取 codeload 整仓 tar.gz（一次请求拿到整个技能目录），失败再退 contents API / raw / jsDelivr。真机实测 42 文件 720 KB 的技能不再需要逐文件请求（tarball 通道 15 秒预算，超时即回落，不会把安装拖成 80 秒）。
- **批量写盘**：安装时按并发池（8 路）落盘，不再一个文件一次 `await`。

### 修复

- **安装成功却在技能列表里找不到、调不出来**：根因是 `@deepseek-ai/dsh-skill-filesystem` 的发现契约——只认 `<root>/<name>/SKILL.md`，且 frontmatter 的 `name` 必须是 kebab-case、`description` 必填，**不合法的条目会被静默丢弃**（例如上游 `ai-ppt-skill` 写的是 `name: ppt-master`、`shinora` 写的是 `name: 白之`）。现在安装时对**本地落盘的那份 `SKILL.md`** 做归一化：非法 `name` 改写为目录 id、缺失 `description` 补技能摘要，修复项记进 `.financial-skills.json` 的 `frontmatterRepairs` 与 `invocationName`。**上游仓库一个字节都不动**（`openfcp/awesome-financial-skills` 同时被 WorkBuddy 与官网引用）。
- **安装后要重启才生效**：安装/卸载成功立刻通知技能注册表——主通道 `skills.invalidateCache()`（bump revision + 清缓存 + 派发 `skills/change`），次级通道 `ctx.emit('fs/observed', path, …)`。两者都不可用时才退回 logger 告警。
- **安装/卸载后的界面刷新**：静默重取目录，卡片边框与「已安装」标记即时变化。
- **卡片显示调用名**：已安装且 frontmatter 调用名与技能 id 不同时，卡片上直接写出「调用名 `xxx`」，省得用户去猜该用哪个名字调用。

### 变更（界面）

- 版式按指定顺序重排：**头部 banner**（内联 22×22 线稿 SVG 标识 + 标题 + slogan + 右侧「N 个技能 · M 个分类」胶囊）→ **元信息一行**（数据源 · 更新 · 核验 · 实时/非实时 Tag · 刷新）→ **搜索框（左）+ 全部插件/已安装（右）** → **横分割线** → **胶囊分类** → **技能卡片网格**（`minmax(320px,1fr)`）。
- 卡片：中文名 + **英文名**、两行摘要、**类别 / 版本 / 来源 / 协议 / 作者 / 核验日期**六项元信息；**去掉头像**（原 48px 首字盒）。
- 卡片外边框：默认 `--dsw-alias-border-l2` 浅灰；**已安装换成 `--dsw-alias-state-success-primary`**（与卡片内「已安装」Tag 同色）。
- **页脚（更新日期一览）保持原样**：更新日期 · 相对时间 · 条数 · 来源 Tag · 刷新。
- 首屏更快立住：加载态就把 banner / 元信息行 / 搜索框 / 分割线画出来，只把内容区换成 6 张骨架卡，目录到手时不发生大幅跳版。
- 新增 `docs/preview.html`：`node scripts/preview.mjs`（`npm run preview`）从 `client.js` 抽真实 CSS + 随包快照生成静态预览页，不启动宿主也能看版式（亮/暗跟随系统）；CI 增加「预览页不漂移」检查。
- 0.1.x 的三张位图截图（`docs/preview*.png`）随版式改版移除，`screenshots.json` 置空——旧截图描述的是行列表版式，留着会误导读安装的人。需要在商店页展示位图时，在真实宿主里重拍后回填。

### 新增

- `docs/DESIGN.md` 全量对齐新版式（栅格、区域→原语→token 对照、状态矩阵、反模式清单）。
- 测试增至 **91 个**（Host 65 + 浏览器半 26）：新增竞速/错峰/304 复用、tarball 取件与中文路径、frontmatter 归一化、注册表通知、版式顺序断言、卡片结构与六项元信息断言。

### 升级说明

git 依赖不会自动跟随仓库更新，`pnpm add <同一个地址>` 会命中「Already up to date」，插件管理器因此报
`无法从依赖变更中确定安装了哪一个包`。升级请**改用带版本 tag 的地址**（推荐），或先卸载再安装：

```
https://github.com/openfcp/dsh-financial-skills#v0.2.0
```

### 其它修复（0.1.1 之后累积）

- **GitHub 来源支持「技能就在仓库根」**：上游自 2026-11-17 起收录了一批根目录布局的仓库（`source.path: ""`）。此前归一化会把空 path 改写成 `plugins/<id>`，这些技能的详情与安装全部 404。现在空 path 原样保留，`resolve` 模板里的 `{path}` 会被真正替换掉（不再留下字面量 `{path}`），raw 地址也不会出现 `//`。
- **支持 `source.exclude`**：上游对纯展示资源（`examples/`、`assets/showcase/`、`docs/` 等）声明了排除前缀，此前会被一并取回，容易撞上文件数 / 总量上限。现在按前缀跳过，与上游取件脚本 `install.py` 的行为一致。
- **非 ASCII 文件名不再被静默丢弃**：`isSafeRelativePath` 从 ASCII 白名单改为黑名单（只挡路径逃逸、控制字符、Windows 保留字符与尾点 / 尾空格），中文目录 / 文件名（如 `参考/`、`示例（一）/`、`党建语料/`）可以正常列出、下载、解压与安装；路径被拒绝时改为向 logger 告警，不再悄悄少文件。raw / contents API URL 也按段编码，避免中文路径拼出非法 URL。
- **补齐 loopback 围栏**：除 `remoteAddress` 外增加 `Host` 校验（挡 DNS rebinding），POST 要求 `application/json` 且 `Origin`（若有）与 `Host` 同源（挡 `text/plain` 简单请求 CSRF）。非本机 Host 返回 403 `unexpected host`，非 JSON 返回 415。
- **随包快照刷新**：`catalog.snapshot.json` 更新到上游 2026-11-18 版本（9 类 171 条），`official-source-qa` 已被上游移除；README / README.en / docs 不再宣称「唯一 vendored 条目」，条数改为「以清单 `updated` 为准」的不写死表述。测试改为按快照条数 / 结构性事实断言，刷新快照不必再同步改数字。

## 0.1.1 — 2026-11-13

### 变更

- 侧栏入口名称由「**金融业技能**」改为「**金融技能**」（英文界面仍为 `Financial Skills`，`id` / 路由 / 包名不变）。其余行为、配置项与 HTTP API 与 0.1.0 完全一致。

## 0.1.0 — 2026-11-13

首个版本 / First release. 作者：八大权益。

### 新增

- 双半区插件：Host 半区（`index.js` + `lib/`）负责目录抓取、缓存、安装/卸载与路由；浏览器半区（`client.js`）是手写 `__ModuleLoader__` bundle，无构建步骤。
- 左侧栏入口「**金融业技能**」（`sidebar.panellist`，`id: financial-skills`，`order: 25`），与官方「插件」「定时任务」入口共存不抢位。
- 右侧整页「**金融行业skills精选**」：搜索、9 类分类筛选（含数量）、全部/已安装切换、详情弹窗（Markdown 正文 + 文件清单 + license）、一键安装/卸载、页脚数据源与刷新。
- 数据源为 `openfcp/awesome-financial-skills` 的 `catalog.json`（发布时为 9 类 17 个技能），按 raw.githubusercontent → fastly.jsdelivr → gcore.jsdelivr → cdn.jsdelivr 四级降级抓取，6 小时磁盘缓存，全部失败时回落到随包 `catalog.snapshot.json`，并在 `meta` 中如实标注 `source / offline / stale / error`。
- **兼容上游目录 `format: 3`（2026-11-13 迁移）**：上游改为「只存引用、不存正文」，删除 `plugins/<id>/`，新增顶层 `resolve` 取回模板（skillhub zip：`https://api.skillhub.cn/api/v1/download?slug={slug}`；github：raw + api 模板）与每条的来源坐标（skillhub `{namespace,slug}` / github `{repo,path,ref,vendored}`）。安装/详情按 `source.type` 取回正文：SkillHub 下载 zip 并解压，GitHub 逐文件 raw → API → jsDelivr；唯一 vendored 的 `official-source-qa`（正文在 `skills/official-source-qa/`）同样走 GitHub 坐标。来源记录 `.financial-skills.json` 增加 `sourceType` 与来源坐标字段；引用不可达时明确报错并清理暂存目录，不产生半装技能。旧 `format: 2` 清单/缓存/快照/`plugins/<id>/` fixture 仍兼容。
- 6 条 Host 路由：`GET /api/financial-skills/{catalog,installed,detail,health}`、`POST /api/financial-skills/{install,uninstall}`，统一 `{ok,value}` / `{ok,error}` 信封。
- 安全围栏：loopback-only（否则 403）、客户端只传 id（文法校验）、路径逃逸防护、staging + rename 安装、文件数/单文件/总量上限（200 / 2 MB / 16 MB）、卸载移入 `.trash` 而非删除。
- 安装后调用 `skills.invalidateCache()`（可选，失败只 warn），新技能立刻出现在会话技能目录。
- 零 npm 依赖，只用 `node:` 内置模块；浏览器半区只使用宿主暴露的 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`。
- 测试：
  - `npm test`（`node --test`）：Host 单元测试 + 浏览器半契约测试，全部离线可过；
  - `test/e2e-remote.mjs` + `scripts/run-e2e.sh`：隔离 `DSH_HOME` 真机 E2E，覆盖插件挂载、目录/已安装/详情/健康路由、`client.js` 产物、fixture 安装与卸载；`DSH_FINANCIAL_SKILLS_FIXTURE` 指向本地 fixture，安装链路无需联网。
- 文档与发布：`README.md` / `README.en.md`、`docs/E2E.md`、`docs/DESIGN.md`、`LICENSE`（MIT）、`CHANGELOG.md`、GitHub Actions CI（Node 20，语法检查 + `npm test` + 脚本 `sh -n`）。

### 已知边界

- 0.1.0 时上游有 5 个分类 0 条（2026-11-18 版已全部有内容）：UI 仍显示分类（数量 0），空结果给出「该分类暂无工具」而不是隐藏。
- 部分技能 `license: proprietary`：列表行不展示 license，详情里如实显示；安装只是在本地下载使用，不代表获得再分发授权。
- 安装/详情依赖网络（SkillHub / GitHub / jsDelivr）；断网或引用失效时页面给出可操作错误，不出现空白，也不会留下半装目录。SkillHub 条目的 `namespace` 仅用于展示与去重，zip 下载只需要 `slug`。
- 只做索引与本地安装，不内置或搬运任何技能正文（0.1.0 时上游有一条自己 vendored 的 `official-source-qa`，该条目已于 2026-11-18 从上游清单移除）；清单只存引用，正文版权与许可证归各自作者。
