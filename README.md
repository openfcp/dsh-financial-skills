# dsh-financial-skills · 金融业技能

> **把「金融行业skills精选」搬进 DeepSeek Harness 的左边栏。**
> 装一次，侧栏多一个「金融业技能」入口；点开是整页精选金融行业skill目录：搜索、按业务分类筛选、看详情、一键安装/卸载。

[English](README.en.md) | 中文

[![ci](https://github.com/openfcp/dsh-financial-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/openfcp/dsh-financial-skills/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.2-4f46e5)](package.json)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

![金融业技能页面预览 · 浅色](docs/preview.png)

<p align="center"><sub>浅色主题：侧栏「金融业技能」入口 + 「金融行业skills精选」整页；截图取自隔离
DSH 实例的真实浏览器渲染（1440×900）。</sub></p>

![金融业技能页面预览 · 暗色](docs/preview-dark.png)

<p align="center"><sub>暗色主题：颜色全部来自宿主 <code>--dsw-*</code> token，插件不覆盖主题。</sub></p>

![已安装视图](docs/preview-installed.png)

<p align="center"><sub>「已安装」视图：装好的技能带绿色「已安装」标签，动作变为「卸载」。</sub></p>

---

## 它是什么

**金融业技能**（英文包名 `dsh-financial-skills`）是 DeepSeek Harness（DSH）的双半区插件：

- **左侧栏入口**：一个图标 +「金融业技能」标签（英文界面显示 `Financial Skills`），排在官方「插件」和「定时任务」之后，不与其它第三方插件抢位；
- **右侧整页**：「金融行业skills精选」——把 [openfcp/awesome-financial-skills](https://github.com/openfcp/awesome-financial-skills) 这份为金融从业者策展的技能清单，做成可以直接浏览、检索、安装的插件目录；
- 页面里的每一行，安装后就是一个 DSH 原生技能（写进 `<DSH_HOME>/skills/<id>/SKILL.md`），当前对话的技能目录里能立刻看到。

**数据源只有一个**：[`catalog.json`](https://github.com/openfcp/awesome-financial-skills/blob/main/catalog.json)（站点 <https://openfcp.github.io/awesome-financial-skills/> 的全部内容也由它构建）。上游已升级为 **`format: 3`**：清单**只存引用、不存技能正文**，当前 **9 个分类、17 个技能**（消费者保护 6、办公与设计 5、数据与技术 5、合规与法律 1；其余 5 类开放收录中，页面仍显示分类并标注数量 0）。

本插件**不内置、不搬运**任何技能正文（上游唯一 vendored 的条目是 `official-source-qa`，正文在它自己的仓库里）。安装/预览时按技能的 `source.type` 与清单顶层 `resolve` 模板，从**原始出处**取回正文：

| 来源 | 清单里的坐标 | 安装时如何取回 |
| --- | --- | --- |
| SkillHub（16 条） | `source.namespace` + `source.slug` | 按 `resolve.skillhub` 模板 GET 得到 zip，解压（`SKILL.md` 在根目录） |
| GitHub（1 条：`official-source-qa`，`vendored: true`） | `source.repo` / `source.path` / `source.ref` | 按 `resolve.github` 的 raw 模板逐文件取；raw 不可达走 GitHub API，再不可达走 jsDelivr 镜像 |

引用不可达（SkillHub 不可用、GitHub/镜像都失败）时，安装会**明确报错并清理暂存目录**——磁盘上不会留下装了一半的技能。`format: 2` 的旧清单/旧缓存/旧 fixture（`plugins/<id>/` 目录）仍然兼容。

## 装完你会看到什么

1. 打开 DSH，左侧栏多出「金融业技能」入口（图标是银行建筑线条：三角山墙 + 三根柱子 + 地面线，16×16 stroke 风格）；
2. 点击后，右侧主区整页变成「金融行业skills精选」：顶部标题 + 副标题，下面是搜索框、9 个分类胶囊、全部/已安装切换；
3. 17 条技能按分类列出，每条显示名称、摘要、分类、版本、来源（许可证在详情里如实显示）；
4. 点名称打开详情弹窗：SKILL.md 正文（Markdown 渲染）、文件清单、总大小、许可证与来源坐标；
5. 点「安装」，技能被写进本地技能目录，按钮变成「已安装 / 卸载」；
6. 点「卸载」，技能目录被移到 `.trash`（不直接删除，可手动找回）。

## 快速安装（3 步）

> 前提：DeepSeek Harness **>= 0.2.0-rc.2**，Node **>= 20**。刷新目录与安装/预览技能需要网络（SkillHub、GitHub 或 jsDelivr）；目录本身有随包快照，可先离线浏览。

**第 1 步：把本仓库装进 profile**

```sh
git clone https://github.com/openfcp/dsh-financial-skills.git
dsh plugin --profile desktop add link:$(pwd)/dsh-financial-skills
```

> `link:` 指向本仓库目录，插件改动重启后即可生效，不需要重新打包。
> 也可以直接用仓库里的脚本，它会把第 1、2 步一起做掉：
>
> ```sh
> cd dsh-financial-skills && ./scripts/install-local.sh desktop
> ```

**第 2 步：把 bundle 加进 profile 的启用列表**

打开 `~/.dsh/profiles/desktop/package.json`，找到 `dsh` → `profile` → `bundles`，把 `"dsh-financial-skills"` 加进去：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-financial-skills"
]
```

> 只有列在 `dsh.profile.bundles` 里的 bundle 才会被组合进来；它自带 `cordis.patch.yml`，负责插入 `financial-skills` 这一行。

**第 3 步：彻底重启 DeepSeek Harness**

菜单栏「DeepSeek Harness → 退出」（或窗口激活时按 **Cmd+Q**），确认「活动监视器」里**没有**任何 DeepSeek Harness 进程了，再重新打开。

> 只关掉窗口、再点 Dock 图标打开，**不算重启**——后台进程还在跑，插件不会加载。这是最容易踩的坑。

装好后想确认：侧栏出现「金融业技能」→ 点开后页面显示数据源、更新时间与 17 条技能。

## 卸载

```sh
./scripts/uninstall-local.sh desktop
```

或者手动两步：

```sh
dsh plugin --profile desktop remove dsh-financial-skills
# 再从 ~/.dsh/profiles/desktop/package.json 的 dsh.profile.bundles 中删掉 "dsh-financial-skills"
```

然后同样**彻底重启**。通过本插件安装过的技能目录（`<DSH_HOME>/skills/<id>/`）属于用户数据，卸载插件不会删除；需要的话在插件里点「卸载」或手动删除。

## 功能

| 功能 | 说明 |
| --- | --- |
| 搜索 | 按 id / 中文名 / 英文名 / 摘要 / 标签 / 作者匹配，大小写不敏感，输入即筛；与分类、已安装筛选叠加。 |
| 分类筛选 | 一行 9 个官方 `Pill`（含「全部」与每类数量）；空分类仍显示，点开提示「该分类暂无工具」。 |
| 已安装视图 | 官方 `SegmentedControl` 切换「全部插件 / 已安装 (n)」，已安装条目带 success 标签。 |
| 详情预览 | 官方 `Modal` + `MarkdownText` 渲染 SKILL.md 正文（截断 64KB），附文件清单、总大小、license、版本与来源坐标（列表行不展示 license，详情里如实显示）。 |
| 一键安装 | 按 id 和清单坐标取回正文：SkillHub 走 zip 下载解压，GitHub 走 raw → API → jsDelivr；校验后整目录改名落位，失败清理暂存不留痕。 |
| 一键卸载 | 移动到 `<DSH_HOME>/skills/.trash/<id>-<时间戳>/`，不直接删除。 |
| 离线快照 | 网络不可用或源站降级时回落到随包 `catalog.snapshot.json`；页面页脚**如实标注** `source: network / cache / snapshot` 与是否过期，绝不把快照说成实时。 |
| 刷新 | 页脚「刷新」按钮请求 `GET /api/financial-skills/catalog?refresh=1`，失败以错误行展示。 |

## 已知边界

- **清单只存引用**：除了上游自己 vendored 的 `official-source-qa`，技能正文都不随清单分发；插件只做索引与本地安装，不搬运、不再分发正文。正文版权与许可证归各自作者，详情里如实显示 `license`。
- **部分技能是专有许可**：16 条 SkillHub 技能里多数 `license: proprietary`；安装只代表下载到本地使用，不代表获得再分发授权。
- **安装依赖网络**：SkillHub 条目从 `api.skillhub.cn` 取 zip，GitHub 条目从 raw / API / jsDelivr 取文件。断网或引用失效时页面给出可操作错误，不会空白，也不会留下半装目录。
- **SkillHub 的 `namespace` 只用于展示与去重**，下载 zip 只需要 `slug`；清单的 `resolve` 模板是唯一取回规则，客户端不能传 URL。
- **格式 2 兼容**：缺少 `resolve` 的旧清单回落到内置默认模板；旧 `plugins/<id>/` 目录布局与旧缓存/旧快照仍可读。

## 配置

所有配置都有默认值；非法值回落到默认值，**不会让 DSH 启动失败**。在 profile 的 `cordis.patch.yml` 末尾按 `id: financial-skills` 覆盖即可，例如：

```yaml
- id: financial-skills
  config:
    offline: true          # 只用本地缓存/快照，完全不联网
    cacheTtlMs: 21600000   # 目录缓存 6 小时
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `indexUrl` | `https://raw.githubusercontent.com/openfcp/awesome-financial-skills/main/catalog.json` | 目录源地址（单条）。 |
| `indexUrls` | raw.githubusercontent → fastly.jsdelivr → gcore.jsdelivr → cdn.jsdelivr 四级降级链 | 覆盖目录抓取的降级链。 |
| `cacheTtlMs` | `21600000`（6 小时） | 目录缓存有效期。 |
| `offline` | `false` | `true` 时只用缓存/快照，不联网。 |
| `installRoot` | `<dshHome>/skills` | 技能安装根目录（测试可覆盖）。 |
| `dshHome` | `$DSH_HOME`，否则 `~/.dsh` | 用户配置根。 |
| `maxFiles` | `200` | 单个技能允许的最大文件数。 |
| `maxFileBytes` | `2097152`（2 MB） | 单个文件允许的最大字节数。 |
| `maxTotalBytes` | `16777216`（16 MB） | 单个技能允许的最大总字节数。 |

## HTTP API

Host 半区只注册 **6 条**精确匹配 `GET`/`POST` 路由（客户端只传 id，不传 URL/路径）：

| 方法 | 路径 | 入参 | 成功响应 `value` |
| --- | --- | --- | --- |
| GET | `/api/financial-skills/catalog` | `?refresh=1` 强制刷新 | 归一化目录（含 format-3 顶层 `resolve` 取回规则与每条 `source` 坐标）+ `meta`（source/fetchedAt/stale/offline/error） |
| GET | `/api/financial-skills/installed` | — | `{ root, count, skills:[{ id,name,version,description,path,installedAt,managed }] }` |
| GET | `/api/financial-skills/detail` | `?id=` | `{ id, markdown, files:[{path,size}], totalBytes, license, version, source }`——`source` 带类型与坐标（skillhub：`namespace`/`slug`；github：`repo`/`path`/`ref`/`vendored`） |
| POST | `/api/financial-skills/install` | `{ "id": "..." }` | `{ id, path, files, bytes, version, license }`——`files` 是**数量**（int）；安装同时写入来源记录 `.financial-skills.json` |
| POST | `/api/financial-skills/uninstall` | `{ "id": "..." }` | `{ id, trashedTo }` |
| GET | `/api/financial-skills/health` | — | `{ version, upstream, cacheAt, offline, skillRoot, dshHome }` |

统一信封：成功 `{ ok: true, value }`；失败 `{ ok: false, error }`，状态码 400 / 403 / 404 / 409 / 502 / 503。所有响应 `content-type: application/json; charset=utf-8`、`cache-control: no-store`。安装写出的 `.financial-skills.json` 记录 `id`、`version`、`license`、`sourceType` 与来源坐标（github：`sourceRepo`/`sourcePath`/`sourceRef`；skillhub：`sourceSlug`/`sourceNamespace`）、`installedAt`（毫秒）、`files`（相对路径数组）、`fileCount`、`bytes`。

浏览器半区不使用这些路由之外的任何第三方接口；页面里所有数据来自本机 Host。

## 安全模型

- **只服务本机**：每条路由先校验连接来源是 loopback（`127.0.0.0/8`、`::1`、`::ffff:127.0.0.1`），否则 403。不监听公网、不做账号体系。
- **只认 id**：客户端只能传技能 id（文法 `/^[a-z0-9][a-z0-9-]{0,63}$/`），不能传 URL、不能传路径；非法 id 直接 400。取正文的地址只来自清单里的 `source` 坐标 + `resolve` 模板，客户端无法指定下载地址。
- **路径围栏**：安装/卸载只从 id 重建路径，写盘前解析出的绝对路径必须仍在 `installRoot` 之内，防止 `../` 路径逃逸。
- **先暂存再落位**：安装先下载到 `installRoot/.staging-<id>-<随机>/`，校验文件数（≤200）、单文件（≤2 MB）、总量（≤16 MB）、相对路径文法后，整目录 `rename` 到 `installRoot/<id>`；目标已存在返回 409；任一步失败清理暂存并返回错误，磁盘保持原状。
- **卸载不删数据**：移到 `installRoot/.trash/<id>-<时间戳>/`，可人工找回。
- **不读敏感数据**：不读取凭据、会话内容或工作区文件；只扫描技能目录判断「已安装」。
- **无遥测**：不向任何第三方发送统计或使用数据。网络请求只发往：配置的目录源与镜像（刷新目录）、`api.skillhub.cn`（下载 SkillHub zip）、GitHub raw/API 与 jsDelivr 镜像（下载 GitHub 坐标的技能）。

## 常见问题

**侧栏没有「金融业技能」入口？**
1. 确认是**彻底退出**再打开（活动监视器里旧进程都没了）；
2. `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里确实有 `"dsh-financial-skills"`；
3. 刷新页面（Cmd+R / F5）再试一次。

**页面一直显示空/过期数据？**
页脚会写明 `source`：`snapshot` 表示本次用的是随包快照（可能是网络不可达或被配置为 `offline`）。点「刷新」重试；网络恢复后下一轮抓取会自动写缓存。

**安装某条技能失败？**
安装依赖网络：SkillHub 技能从 `api.skillhub.cn` 取 zip，GitHub 技能从 raw / API / jsDelivr 取文件。失败时页面给出可操作的错误信息（重试 / 复制 `skillhub install …` 命令），且暂存目录会被清理——不会出现装了一半的技能。批量失败通常是网络问题，不是目录数据问题。

**license 显示 `proprietary`？**
上游部分技能是 SkillHub 上的专有技能，列表行不展示 license，详情里如实显示；安装仅代表下载到本地使用，不代表获得再分发授权。

**升级插件后没变化？**
本插件是按仓库路径 `link:` 安装的，重启即可加载最新代码；如果改的是 `package.json` / `cordis.patch.yml`，仍建议重新执行一次安装脚本再彻底重启。

**会占很多磁盘吗？**
只会写入你点「安装」的技能目录，每个通常几十 KB 到几 MB；卸载移入 `.trash`，不会自动清理。

## 开发与测试

零 npm 依赖、无构建步骤。要求 Node >= 20。

```sh
node --check index.js client.js lib/*.js test/*.mjs   # 语法
npm test                                              # 单元 + 半区契约测试（离线可过）
./scripts/run-e2e.sh                                  # 真机 E2E（隔离 DSH_HOME）
./scripts/run-e2e.sh --verbose                        # 顺便把 Host 日志打到终端
node test/e2e-remote.mjs --help                       # 全部 E2E 选项
```

E2E 会：在工作区下的 `.e2e/` 建**独立 DSH_HOME**（绝不碰你正在用的 `~/.dsh`）→ 从官方 `web` 模板克隆 profile → 把本插件按真实 bundle 方式装进 profile → 生成 `--patch` 配置覆盖并用 `--dump-config` 预检 → 起一个 `--no-open --port 0` 的 Host → 用 `/connect` 换 cookie → 断言插件挂载、6 条路由、9 类 17 条目录及其来源坐标、`client.js` 产物，并用本地 fixture（`plugins/<id>/` 兼容布局）完整跑一遍安装（`SKILL.md` + 带 `sourceType` 的 `.financial-skills.json` 来源记录）与卸载（移入 `.trash`）。不花模型 token。

细节、故障排查与日志位置见 [docs/E2E.md](docs/E2E.md)。

## 仓库与反馈

- 源码、Issue、更新：<https://github.com/openfcp/dsh-financial-skills>
- 版本：`v0.1.0`，变更记录见 [CHANGELOG.md](CHANGELOG.md)
- 技能清单的上游数据：<https://github.com/openfcp/awesome-financial-skills>

**报 bug 时请附上**：DSH 版本（关于面板）、插件版本（`GET /api/financial-skills/health` 返回 `version`）、操作系统、复现步骤；涉及安装失败的请附页面上的错误行（不要附 cookie / token）。

欢迎 PR：保持零 npm 依赖、`npm test` 离线全绿、`sh -n scripts/*.sh` 通过即可。

## 兼容性

- 在 **DSH 0.2.2-rc.1**（当前桌面版）上完整测试通过；要求 DSH >= **0.2.0-rc.2**、Node >= **20**。
- Host 半区只依赖 DSH 公开的 `webServer` 注册能力与 `node:` 内置模块；浏览器半区只手写 `__ModuleLoader__` bundle，只使用宿主提供的 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`。
- 若未来 DSH 改动侧栏/主区插槽名，页面入口会消失，但已经安装到本地的技能不受影响。

## License 与免责声明

[MIT](LICENSE)

**作者**：八大权益（[OpenFCP](https://github.com/openfcp)）。

本项目是社区插件，**与 DeepSeek（深度求索）无隶属、合作或背书关系**，也未获得其官方认证；上游技能清单与各技能正文的版权归各自作者所有，遵循其许可证（详情里显示各技能的 `license`）。

本插件只做索引与本地安装，不构成投资建议、法律意见或合规承诺；金融业务落地前请自行完成合规评估与人工复核。
