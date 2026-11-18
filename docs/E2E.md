# E2E：隔离 DSH 真机端到端测试

本目录的 E2E 不 mock 任何 Host 行为：它**真启动一个 DeepSeek Harness web Host**，按真实 bundle 的方式挂载本插件，然后用 `/connect` 换到的浏览器会话 cookie 逐条断言插件对外的完整契约。

| 文件 | 作用 |
| --- | --- |
| [`test/e2e-remote.mjs`](../test/e2e-remote.mjs) | E2E harness（Node >= 20 ESM，零 npm 依赖） |
| [`scripts/run-e2e.sh`](../scripts/run-e2e.sh) | 薄封装：检查 Node / DSH CLI，设好默认路径并转发参数 |

它**不碰你正在用的 `~/.dsh`**：Host 是独立进程、独立 `DSH_HOME`，所有写入都在仓库自己的 `.e2e/` 下。

---

## 快速开始

```sh
cd dsh-financial-skills

./scripts/run-e2e.sh                 # 默认：隔离 profile + 完整断言 + 安装/卸载 fixture
./scripts/run-e2e.sh --verbose       # 同时把 Host 日志打到终端
./scripts/run-e2e.sh --keep          # 跑完不关 Host（打印 pid 与 URL）
./scripts/run-e2e.sh --attach <url>  # 接管一个已在跑的隔离 Host（只读断言）
./scripts/run-e2e.sh --help          # 全部选项（同 node test/e2e-remote.mjs --help）
```

默认位置（都在仓库内，可整目录删除）：

```
<repo>/.e2e/home                    隔离 DSH_HOME（profile、storages、skills、logs）
<repo>/.e2e/home/e2e.patch.yml      生成的 --patch 配置覆盖层
<repo>/.e2e/home/logs/host-<ts>.log Host 的 stdout/stderr
<repo>/.e2e/fixture                 本地 GitHub fixture（plugins/<id>/SKILL.md + package.json）
```

成功时退出码 0，最后一行是机器可读的：

```
E2E_RESULT {"ok":true,"plugin":"dsh-financial-skills","home":"…/.e2e/home","profile":"fs-e2e","url":"http://127.0.0.1:…/?token=…","hostPid":12345,"clientBundleUrl":"/plugins/??dsh-financial-skills/client.js&rev=…","checks":{"pluginMounted":true,"healthOk":true,…},"error":null,…}
```

`ok:false` 时退出码 1，`checks` 里失败项为 `false`，`error` 汇总失败项名称。

### 前置条件

- 本机安装 DeepSeek Harness（默认 CLI 路径 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，可用 `DSH_CLI` 或 `--dsh` 覆盖）；
- Node >= 20（需要全局 `fetch` / ESM）；
- **不需要**模型、凭据或网络：目录走 `offline: true`（随包 `format: 3` 快照，条数以快照为准、含来源坐标），安装/详情走 `DSH_FINANCIAL_SKILLS_FIXTURE` 指向的本地 fixture（`plugins/<id>/` 兼容布局）。一次运行不花模型 token。

---

## 一次运行做了什么

1. **隔离 home 与 profile** —— 拒绝 `~/.dsh` 及其子目录；在 `--home`（默认 `<repo>/.e2e/home`）下用官方 `web` 模板克隆 `profiles/<profile>`（已存在则复用）。
2. **生成 fixture** —— 在 `--fixture`（默认 `<home>/../fixture`）写一份极小的上游仓库替身：`plugins/<id>/SKILL.md`、`package.json`、`README.md`，以及从 `catalog.snapshot.json` 复制的 `catalog.json`。fixture 故意用 `format: 2` 时代的 `plugins/<id>/` 目录布局：Host 仍按兼容路径读取，所以这条用例同时守卫旧布局不回退。fixture 技能默认选 `dyz-gongwen-skills`——它在 format-3 清单里是 `source.type = github`、`path = skills/gongwen` 的条目，安装会经过「id 必须在目录里」的校验。
3. **把插件装进 profile** —— 复制包目录到 `profiles/<profile>/node_modules/dsh-financial-skills`，记录 `"dsh-financial-skills": "file:<repo>"` 依赖，并把 `dsh-financial-skills` 追加到 `dsh.profile.bundles`。bundle 被选中后，包自带的 `cordis.patch.yml` 才会插入 `financial-skills` 行。
4. **写 `--patch` 覆盖层** —— 只写一条 `- id: financial-skills` 的 **config 覆盖**（不是第二次 insert），默认 `{"offline": true}`；这样组合结果里始终只有一行 `financial-skills`。用 `--plugin-config` 可换配置（`--plugin-config '{}'` 走真实网络默认值）。
5. **预检** —— `dsh <profile> --patch <overlay> --dump-config`，断言组合树里有且仅有一行 `- id: financial-skills`，且覆盖配置确实生效。YAML/组合错误在这里就失败，不浪费一次十几秒的启动。
6. **启动 Host** —— `dsh <profile> --patch <overlay> --no-open --port 0`，环境变量 `DSH_HOME=<home>`、`DSH_FINANCIAL_SKILLS_FIXTURE=<fixture>`；stdout/stderr 写进日志文件，等待它打印：
   ```
   dsh web: http://127.0.0.1:<port>/?token=<TOKEN>
   ```
7. **鉴权** —— `GET /connect?token=…&interactions=answer`，从 302 的 `Set-Cookie` 取出 **API cookie**（v2），之后所有 `/api/*` 请求都带它（以及匹配的 `Origin`）。读页面壳 `GET /` 用的是另一枚 **导航 cookie**（v1，`GET /?token=…` 303 时下发）；两枚 cookie **同名**（`dsh-auth-<authority-hash>`），必须分开发送，拼在一起会 401。
8. **断言插件挂载** —— `POST /api/pluginInventory/list`（Remote RPC 信封），要求存在 `moduleName === "dsh-financial-skills"` 且 `fiberPhase === "active"` 的条目。
9. **断言路由与数据**（全部走 HTTP）—— 见下节。目录断言针对 **format 3 归一化载荷**：顶层 `resolve` 取回模板、每条技能的 `source` 坐标（skillhub `namespace`/`slug`/`skillhubCommand`，github `repo`/`path`/`ref`/`vendored`）与 `categories[].count` 都必须出现在响应里。
10. **安装 / 卸载 fixture** —— `POST install {id}` → 落盘校验（含 `.financial-skills.json` 的 `sourceType` 与来源坐标）→ `GET installed` → `GET detail`（正文 + 来源坐标）→ 非法 id 400 → `POST uninstall` → `.trash` 校验 → `GET installed`。
11. **收尾** —— `SIGTERM` 整个进程组，10 秒后 `SIGKILL`（`--keep` 时保留）；也在 `SIGINT`/`SIGTERM` 和异常路径上执行，失败不会留下孤儿 Host。

## 断言清单

| check | 证明什么 |
| --- | --- |
| `pluginMounted` | profile 组合真的插入了 `financial-skills` 行，插件实例 `fiberPhase: active`。 |
| `healthOk` / `healthSkillRootInsideHome` | `GET /health` 返回 `{version, upstream, cacheAt, offline, skillRoot, dshHome}`，且 `skillRoot` 在隔离 home 内。 |
| `catalogRoute` / `catalogCategories` / `catalogSkills` | `GET /catalog` 返回 `{ok:true,value:{catalog,meta}}`，`catalog.categories.length === 9`、`catalog.skills.length` 与随包快照一致。 |
| `catalogCategoryCountPresent` / `catalogCategoryCounts` | 每个分类都有数字 `count`，且所有 `count` 之和等于技能总数（9 类含 5 个 0 条分类）。 |
| `catalogResolveTemplates` | 归一化目录带 format-3 顶层 `resolve`：`skillhub.kind === 'zip'` 且 URL 含 `{slug}` 模板；`github.kind === 'files'` 且 raw/api 模板都是字符串。 |
| `catalogSourceCoordinates` | 至少各有一条 `source.type = github`（带 `repo`/`path`/`ref`）与 `source.type = skillhub`（带 `slug` 与 `skillhubCommand`）的条目——清单确实只存引用，且坐标被归一化保留。 |
| `catalogRootAndExcludeSources` | 仓库根来源（`source.path === ''`）与 `source.exclude` 条目在归一化后数量与随包快照一致，没有被改写成 `plugins/<id>` 或丢弃。 |
| `catalogUpstreamSite` / `catalogMetaHonest` / `catalogOfflineLabel` | `upstreamSite` 是上游站点；`meta.source ∈ {network,cache,snapshot}`、`offline`/`stale` 为布尔；离线模式下 `meta.offline === true`（不把快照谎称为实时）。 |
| `catalogCategoryCounts` | 每个分类的 `count` 之和等于技能总数（9 类含 5 个 0 条分类）。 |
| `installedRoute` / `installedRoot` | `GET /installed` 返回 `{root,count,skills}`，root 在隔离 home 内。 |
| `clientBundlePublished` | 页面壳（`GET /` 的 `__DSH_BOOT__` 载荷）里有 `dsh-financial-skills` 的入口，且带 `plugins/??dsh-financial-skills/client.js&rev=<hex>` 组合 URL（浏览器半区确实被模块加载器发布）。 |
| `clientBundleServed` | 按组合 URL 取到 200，正文含 `__ModuleLoader__.load` 与 `dsh-financial-skills`。注意裸路径 `/plugins/dsh-financial-skills/client.js` **按设计返回 404**；rev 不对也 404。 |
| `installRoute` / `installSkillFile` / `installProvenance` / `installProvenanceFields` / `installRespectsSkillRoot` / `installResultShape` | fixture 安装返回 `{id,path,files:number,bytes:number,version,license}`；`skills/<id>/SKILL.md` 存在；`.financial-skills.json` 存在且含 `version`、`installedAt`（毫秒）、**`sourceType`**（fixture 为 `github`）与 GitHub 坐标 `sourceRepo`/`sourcePath`/`sourceRef`、`files`（相对路径数组，含 `SKILL.md`）；安装路径在 `installRoot` 内。 |
| `installedListsFixture` / `installedGrew` | 安装后 `GET /installed` 立刻列出该技能（`managed` 等字段），数量 +1。 |
| `detailRoute` | `GET /detail?id=` 返回 fixture 的 Markdown 正文（frontmatter 已剥离）、文件清单与 `totalBytes`；`source` 是归一化坐标（`type: github` + `repo`/`path`/`ref`），不是 vendored 目录。 |
| `installRejectsPathEscape` | `POST install {"id":"../escape"}` 返回 400 `{ok:false}`（id 文法 + 路径围栏）。 |
| `uninstallRoute` / `uninstallTrashed` / `uninstallRemovedFromSkills` | 卸载返回 `trashedTo`，目标位于 `<skillRoot>/.trash/` 且存在；原 `skills/<id>/SKILL.md` 已消失。 |
| `installedAfterUninstall` | 卸载后 `GET /installed` 不再列出该技能。 |

`--attach` 模式默认只跑只读断言（挂载、health、catalog、installed、页面壳与 combo 资源）；加 `--attach-write` 才会在同一 Host 上跑安装/卸载。

## 传输契约（针对当前桌面版实测）

- **启动行**：`dsh <profile> --patch <overlay> --no-open --port 0` 在 loader 稳定后打印**一行** `dsh web: http://127.0.0.1:<port>/?token=…`；`--no-open` 不弹浏览器，`--port 0` 让系统挑空闲端口，URL 里的端口才是真的。
- **`/connect`**：`GET /connect?token=<TOKEN>&interactions=answer` → `302 Found`，`location: ./api/remote.mux`，`set-cookie: dsh-auth-<hash>=…`。这是一个 API 凭据，可以重放在 `/api` 请求上；`interactions=answer` 是流式/事件转发所需，unary 调用用 `none` 也够。用 `fetch(..., {redirect:'manual'})` + `headers.getSetCookie()` 即可。
- **Remote RPC**：`POST /api/<namespace>/<method>`，body 是 `{type:'client-request', rpcId, method, payload:{args}}`；`payload` 只能有 `args` 一个键，`args` 的键是生成的参数名（本 E2E 用 `pluginInventory/list`，先试 `{}` 再试 `{_request:{}}`）。响应是 `{type:'server-response', result:{ok:true,value}}`。
- **插件路由**：`ctx.webServer.register({kind:'exact', path, handler})` 注册的 6 条 `/api/financial-skills/*` 就是普通 HTTP GET/POST，带上 cookie 与 `Origin` 直接调；响应统一 `{ok:true,value}` / `{ok:false,error}`，`content-type: application/json; charset=utf-8`、`cache-control: no-store`。
- **浏览器半区的真实 URL 在启动载荷里**：`GET /`（导航 cookie）返回的 HTML 里 `window.__DSH_BOOT__ = {…}` 带着模块加载器条目，形如 `plugins/??dsh-financial-skills/client.js&rev=<12-hex>`。这是 **combo URL**：裸路径 `/plugins/dsh-financial-skills/client.js` 按设计 404，rev 不对也 404。package.json 里的 `dsh.client.platform = "web"` 是它被发布的依据；harness 从载荷里取 URL、以文档相对路径请求，断言 200 且正文含 `__ModuleLoader__.load`。
- **两种 cookie 不能混**：`/connect` 的 v2 API cookie 只用于 `/api/*`；页面壳与 combo 资源用 `/?token=` 下发的 v1 导航 cookie。同名 cookie 拼成一个 `Cookie` 头会被 Host 判 401，所以 harness 分开持有、分开使用。

## fixture 模式（离线安装）

Host 半区支持用环境变量把上游 GitHub 仓库替换成本地目录：

| 环境变量 | 作用 |
| --- | --- |
| `DSH_FINANCIAL_SKILLS_FIXTURE=<dir>` | 把 `<dir>` 当作上游正文的本地替身：安装/详情按 `source.type` 从 `<dir>` 取，支持 `plugins/<id>/`（format-2 兼容布局，E2E 用这个）、`skills/<id>/`、`skillhub/<slug>/` 三种布局；不访问 `api.skillhub.cn`、`api.github.com` 或 `raw.githubusercontent.com`。 |
| `DSH_FINANCIAL_SKILLS_OFFLINE=1` | 等价于配置 `offline: true`（只读缓存/快照）。 |
| `DSH_FINANCIAL_SKILLS_HOME` / `DSH_FINANCIAL_SKILLS_INSTALL_ROOT` | 覆盖 `dshHome` / `installRoot`（优先级：config > 环境变量 > `DSH_HOME` > `~/.dsh`）。 |

harness 用真实目录 id `dyz-gongwen-skills`（上游目录里本来就存在、`source.type = github` 的条目）做 fixture，所以安装会先经过「id 必须在目录里」的校验。fixture 内容由 harness 每次生成，**不是**上游技能正文。format-3 清单下 Host 会优先用 `source.path` 定位（`skills/gongwen`），找不到时回落到兼容的 `plugins/<id>/`；这条回落正是 E2E 要证明的。

## 故障排查

**`dsh CLI not found`**
`--dsh /path/to/dsh` 或导出 `DSH_CLI`；`scripts/run-e2e.sh` 默认用桌面版 CLI 路径。

**profile 创建失败**
首次会跑 `dsh <profile> --from-default-profile web --dump-config`。失败时看 stderr：通常是 DSH 版本不匹配（要求 >= 0.2.0-rc.2）或 CLI 路径不对。

**启动超时**
默认 `--boot-timeout 180000`（3 分钟）。首次启动要加载组合树，通常 10–20 秒；不要压到 60 秒以下。超时会打印 Host 日志末尾 40 行。

**端口被占**
默认 `--port 0` 由系统分配，不会冲突；只有手动传 `--port` 才需要自己保证空闲。

**改了插件但 E2E 没变化**
profile 里的插件是**复制**（不是软链）。改完源码直接重跑即可，harness 每次都会重新复制；如果手动复用 profile，删掉 `<home>/profiles/<profile>` 再跑。改 `package.json` / `cordis.patch.yml` 后同样重跑。

**`--keep` 之后收不干净**
用 `E2E_RESULT.hostPid` 收尾：`kill -- -<pid>`（杀整个进程组）或 `kill <pid>`。`dsh` 启动器会 `exec` 一个 Electron 进程并可能再 fork 同命令行 helper，所以 harness 用独立进程组发信号。

**`--attach` 模式断言失败**
`--attach <url>` 的 URL 必须带 `?token=`，且 `--home` 要指向那个 Host 的 `DSH_HOME`（fixture 安装校验依赖它）。只读断言不需要 `--home` 里的 profile 与本仓库一致。

**`clientBundlePublished` / `clientBundleServed` 失败**
先看 `E2E_RESULT.clientBundleUrl`：为空说明启动载荷里没有 `dsh-financial-skills` 条目（检查 `package.json` 的 `dsh.client.platform` 是否还在、profile 的 bundles 是否包含本包）；有 URL 但 404 说明 `rev` 与当前产物不匹配（重新跑一次即可，rev 由启动时计算）。裸路径 `/plugins/dsh-financial-skills/client.js` **永远是 404**，不要按它排查。

**Host 日志在哪**
`<home>/logs/host-<ts>.log`（`--log` 可覆盖），`E2E_RESULT.log` 里也有路径；`--verbose` 会实时打到终端。失败时 harness 自动回显日志末尾。

**清理**
整个 `.e2e/` 目录可以直接删；下次运行会重建。它已经在 `.gitignore` 里，不会被提交。

## 安全说明

- **绝不使用 `~/.dsh`**：`--home` 指向 live home（或其子目录）时直接拒绝；默认 home 在仓库内。
- 只操作自己启动的子进程：`detached` 起 Host，向**进程组**发 `SIGTERM` → `SIGKILL`，在 `finally`、`SIGINT`、`SIGTERM` 路径都会执行。
- 所有写入都在 `--home` / `--fixture` 下（默认 `<repo>/.e2e/`）。
- 不调用 `session.prompt`，不花模型 token；不需要凭据。
- Host 只绑定 loopback，端口由系统分配。

## 与 CI 的关系

GitHub Actions 无法启动桌面版 Host，因此 CI 只跑离线单元/契约测试（`npm test`）与静态检查（`node --check`、`sh -n`）。**真机 E2E 需要本机装有 DSH 时手动运行**，这也是本文件存在的原因。
