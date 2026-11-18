# dsh-financial-skills · Financial Skills

> **The curated financial-skills collection, one click from the DeepSeek Harness left sidebar.**
> Install once: a sidebar entry appears; open it for a full page of curated financial-industry skills — search, filter by business category, read details, install or uninstall in one click.

[中文](README.md) | English

[![ci](https://github.com/openfcp/dsh-financial-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/openfcp/dsh-financial-skills/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.2-4f46e5)](package.json)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

<p align="center"><strong>Layout preview</strong>: open <a href="docs/preview.html"><code>docs/preview.html</code></a>
(regenerate with `npm run preview` — it extracts the real CSS from `client.js` and pairs it with the packaged snapshot; light/dark follows the system)</p>

```sh
npm run preview && open docs/preview.html
```

> The preview page shares the panel CSS and the same `--dsw-*` tokens with the host; only the primitives
> (Button / Input / Tag / Pill) are drawn as equivalent stand-ins. The three 0.1.x bitmap screenshots were removed
> with the redesign — capture new ones in a real host and fill in `screenshots.json` if you need bitmaps.

---

## What it is

**Financial Skills** (Chinese name **金融技能**, package name `dsh-financial-skills`) is a two-half DeepSeek Harness (DSH) plugin:

- **Sidebar entry** — an icon plus the label 「金融技能」 (shown as `Financial Skills` in an English UI). It sits after the official Plugins and Schedule entries (`order: 25`) and does not fight other third-party plugins for position.
- **Full-page view** — 「金融行业skills精选」, a browsable and installable front end for the curated [openfcp/awesome-financial-skills](https://github.com/openfcp/awesome-financial-skills) catalog.
- **Installed skills are ordinary DSH skills** — each install writes `<DSH_HOME>/skills/<id>/SKILL.md`, so the skill shows up in the current session's skill list immediately.

**One source of truth**: [`catalog.json`](https://github.com/openfcp/awesome-financial-skills/blob/main/catalog.json) (the site <https://openfcp.github.io/awesome-financial-skills/> is built from it). Upstream is now **`format: 3`**: the catalog **stores references only, never skill bodies**, and currently ships **9 categories and 171 skills** (counts follow the catalog's `updated` field; the plugin never hard-codes them).

The plugin never bundles or copies skill bodies. Install and preview fetch the content from the **original source**, using the skill's `source.type` plus the top-level `resolve` templates:

| Source | Coordinates in the catalog | How install fetches it |
| --- | --- | --- |
| SkillHub | `source.namespace` + `source.slug` | GET a zip from the `resolve.skillhub` template, then extract (`SKILL.md` at the root) |
| GitHub | `source.repo` / `source.path` / `source.ref` (`path` may be empty, meaning the skill sits at the repo root; prefixes in `source.exclude` are skipped) | Fetch files via the `resolve.github` raw template; fall back to the GitHub API, then the jsDelivr mirror |

If a reference is unreachable (SkillHub down, GitHub and mirrors failing), install returns a **clear error and cleans up its staging directory** — no half-installed skill is left on disk. Old `format: 2` catalogs/caches/fixtures (the `plugins/<id>/` directory layout) remain supported.

## What you see after installing

1. A **金融技能** sidebar entry appears in DSH — a 16×16 line icon of a classical bank facade (pediment, three columns, ground line);
2. Clicking it replaces the main area with the full-page 「金融行业skills精选」: a header banner (mark + title + slogan + an "N skills · M categories" pill), then a single meta row — **data source · updated · live/not-live · refresh**, where refresh is a **red capsule button sitting right next to the live/not-live tag** and is the only refresh entry on the page;
3. Next row: **search box (left) + All / Installed (right)**; below a horizontal rule come the **category pills**;
4. Then the **skill cards — one full-width bar per row, stacked vertically**: Chinese name + English name, a one-line summary; category / source / version / license are drawn as **four capsules**, while author / last verified stay plain text. Cards use a **light grey border**; **installed ones switch to a different border colour** and carry an Installed tag;
5. Clicking a name opens a detail modal with the rendered `SKILL.md` body, file list, total size, license and source coordinates;
6. **Install** writes the skill into the local skills directory — the card border updates immediately, the button becomes Uninstall, and the skill is **callable in the current conversation right away** (installed cards also show the invocation name);
7. **Uninstall** moves the directory under `.trash` instead of deleting it, so you can recover it manually;
8. The footer keeps the update-date overview (updated · relative time · counts · source).

## Install from a URL (plugin manager)

In DSH, open **Plugins → Install plugin → Git repository** and paste the address **including the version tag**:

```
https://github.com/openfcp/dsh-financial-skills#v0.2.2
```

It appears in the plugin list after install; **fully restart** (Cmd+Q, then reopen) and the 金融技能 sidebar entry shows up.

> ### Why the `#v0.2.2` suffix — and what "cannot determine which package was installed from the dependency change" means
>
> A git dependency without a ref pins the default branch to **one specific commit** in the lockfile. Clicking install
> again resolves to the same commit, pnpm prints `Already up to date`, and `package.json` does not change. The plugin
> manager attributes the install by diffing dependencies; with an empty diff it can only report
> `无法从依赖变更中确定安装了哪一个包` ("cannot determine which package was installed from the dependency change").
>
> Nothing is broken and the URL is not wrong — **it is already installed**. Hence:
>
> | Situation | What to do |
> | --- | --- |
> | Upgrading from an older version | Re-install with the new tag (`#v0.2.2`): the spec changes, so pnpm actually rewrites the lockfile |
> | Reinstalling the same version | **Uninstall** it in the plugin list first, then install with the same URL |
> | Tracking the latest | Use `#main`; when upstream has no new commit you still get `Already up to date` and the same notice — that is expected |
>
> To check the installed version: `version` in `~/.dsh/profiles/desktop/node_modules/dsh-financial-skills/package.json`.

## Install (3 steps)

> Requirements: DeepSeek Harness **>= 0.2.0-rc.2**, Node **>= 20**. Refreshing the catalog and installing/previewing a skill need network access (SkillHub, GitHub or jsDelivr); the catalog itself has a packaged snapshot, so browsing works offline first.

**Step 1 — install this checkout into a profile**

```sh
git clone https://github.com/openfcp/dsh-financial-skills.git
dsh plugin --profile desktop add link:$(pwd)/dsh-financial-skills
```

> The `link:` spec points at this repository, so edits are picked up after a restart without packing anything.
> Or use the helper script, which also performs step 2:
>
> ```sh
> cd dsh-financial-skills && ./scripts/install-local.sh desktop
> ```

**Step 2 — enable the bundle**

Open `~/.dsh/profiles/desktop/package.json`, find `dsh` → `profile` → `bundles`, and add `"dsh-financial-skills"`:

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-financial-skills"
]
```

> Only bundles listed in `dsh.profile.bundles` are composed. The bundle's own `cordis.patch.yml` inserts the `financial-skills` row.

**Step 3 — fully restart DeepSeek Harness**

Quit from the menu bar (**DeepSeek Harness → Quit**, or **Cmd+Q**), make sure **no** DeepSeek Harness process remains in Activity Monitor, then reopen.

> Closing the window and reopening from the Dock is **not** a restart — the background process keeps running and the plugin will not load. This is the number-one gotcha.

To verify: the **金融技能** entry appears in the sidebar, and the page shows the data source, update time and the full skill catalog.

## Uninstall

```sh
./scripts/uninstall-local.sh desktop
```

Or manually:

```sh
dsh plugin --profile desktop remove dsh-financial-skills
# then remove "dsh-financial-skills" from dsh.profile.bundles in
# ~/.dsh/profiles/desktop/package.json
```

Fully restart afterwards. Skill directories installed through this plugin (`<DSH_HOME>/skills/<id>/`) are user data: uninstalling the plugin does not delete them. Remove them with the in-page Uninstall button or by hand.

## Upgrade

Git dependencies **do not follow the repository automatically** — `pnpm add <the same URL>` just answers `Already up to date`. Upgrade like this:

```sh
# 1. Switch to the new tag (the spec changes, so pnpm re-resolves and the lockfile changes)
dsh plugin --profile desktop add https://github.com/openfcp/dsh-financial-skills#v0.2.2
# 2. Fully restart (Cmd+Q, then reopen)
```

Or uninstall and reinstall:

```sh
./scripts/uninstall-local.sh desktop
./scripts/install-local.sh desktop      # link: for local development — edits apply after a restart
```

> Every release is tagged `vX.Y.Z` and `CHANGELOG.md` spells out the changes and the upgrade path. **Installed skill
> directories survive a plugin upgrade**; to pick up the frontmatter normalisation added in 0.2.0 for a skill you
> already installed, uninstall and reinstall that skill once.

## Features

| Feature | Behaviour |
| --- | --- |
| Search | Matches id / Chinese name / English name / summary / tags / author, case-insensitive, filters as you type; combines with category and installed filters. |
| Category filter | One row of 9 official `Pill`s (plus All, with per-category counts). Empty categories stay visible and say "no tools in this category yet". |
| Installed view | Official `SegmentedControl` switches between All plugins and Installed (n); installed rows carry a success tag. |
| Detail preview | Official `Modal` + `MarkdownText` renders the skill body (truncated to 64 KB), with file list, total size, license, version and source coordinates (rows do not show the license; the detail view does). |
| One-click install | Fetches the body from the catalog coordinates: SkillHub as a zip (downloaded and extracted), GitHub via raw → API → jsDelivr; validates, then renames staging into place, and failures leave no traces. |
| One-click uninstall | Moves the skill to `<DSH_HOME>/skills/.trash/<id>-<timestamp>/` instead of deleting it. |
| Offline snapshot | Falls back to the packaged `catalog.snapshot.json` when the network or mirrors are unavailable; the page footer **honestly labels** `source: network / cache / snapshot` and whether the data is stale — a snapshot is never presented as live. |
| Refresh | The footer's Refresh button calls `GET /api/financial-skills/catalog?refresh=1` and surfaces failures as an inline error row. |

## Known boundaries

- **The catalog is an index of references**: skill bodies are not distributed with the catalog. This plugin only indexes and installs locally — it never re-hosts or redistributes bodies. Copyright and licenses stay with the original authors; the detail view shows `license` honestly.
- **Some skills are proprietary**: most of the 16 SkillHub entries are `license: proprietary`; installing only means downloading for local use, not a redistribution license.
- **Installs need network access**: SkillHub entries download a zip from `api.skillhub.cn`; GitHub entries fetch files from raw / API / jsDelivr. When the network or a reference fails, the page shows an actionable error instead of going blank, and no half-installed directory is left behind.
- **SkillHub `namespace` is display/dedup only**; the zip download needs just the `slug`. The catalog's `resolve` templates are the only fetch rules — the client can never supply a URL.
- **Format 2 stays compatible**: catalogs without `resolve` fall back to the built-in default templates; old `plugins/<id>/` layouts and old caches/snapshots still read.

## Configuration

Every setting has a default; invalid values fall back to the default and **never fail DSH boot**. Override in the profile's `cordis.patch.yml` by row id:

```yaml
- id: financial-skills
  config:
    offline: true          # only cache/snapshot, never touch the network
    cacheTtlMs: 21600000   # 6-hour catalog cache
```

| Field | Default | Meaning |
| --- | --- | --- |
| `indexUrl` | `https://raw.githubusercontent.com/openfcp/awesome-financial-skills/main/catalog.json` | Catalog URL (single). |
| `indexUrls` | raw.githubusercontent → fastly.jsdelivr → gcore.jsdelivr → cdn.jsdelivr chain | Overrides the catalog mirror fallback chain. |
| `cacheTtlMs` | `21600000` (6 h) | Catalog cache lifetime. |
| `offline` | `false` | `true` = cache/snapshot only, no network. |
| `installRoot` | `<dshHome>/skills` | Skill install root (overridable for tests). |
| `dshHome` | `$DSH_HOME`, else `~/.dsh` | User config root. |
| `maxFiles` | `200` | Max files per skill. |
| `maxFileBytes` | `2097152` (2 MB) | Max bytes per file. |
| `maxTotalBytes` | `16777216` (16 MB) | Max total bytes per skill. |

## HTTP API

The host half registers exactly **6** exact-match `GET`/`POST` routes. The client only ever sends an id, never a URL or a path:

| Method | Path | Input | Success `value` |
| --- | --- | --- | --- |
| GET | `/api/financial-skills/catalog` | `?refresh=1` forces a refresh | Normalized catalog (including the format-3 top-level `resolve` templates and each skill's `source` coordinates) + `meta` (source / fetchedAt / stale / offline / error) |
| GET | `/api/financial-skills/installed` | — | `{ root, count, skills:[{ id,name,version,description,path,installedAt,managed }] }` |
| GET | `/api/financial-skills/detail` | `?id=` | `{ id, markdown, files:[{path,size}], totalBytes, license, version, source }` — `source` carries type and coordinates (skillhub: `namespace`/`slug`; github: `repo`/`path`/`ref`/`vendored`) |
| POST | `/api/financial-skills/install` | `{ "id": "..." }` | `{ id, path, files, bytes, version, license }` — `files` is a **count** (int); the install also writes the `.financial-skills.json` provenance record |
| POST | `/api/financial-skills/uninstall` | `{ "id": "..." }` | `{ id, trashedTo }` |
| GET | `/api/financial-skills/health` | — | `{ version, upstream, cacheAt, offline, skillRoot, dshHome }` |

Envelope: success `{ ok: true, value }`; failure `{ ok: false, error }` with status 400 / 403 / 404 / 409 / 502 / 503. Every response is `content-type: application/json; charset=utf-8` and `cache-control: no-store`. The `.financial-skills.json` written by an install records `id`, `version`, `license`, `sourceType` and the source coordinates (github: `sourceRepo`/`sourcePath`/`sourceRef`; skillhub: `sourceSlug`/`sourceNamespace`), `installedAt` (ms), `files` (relative path array), `fileCount` and `bytes`.

## Security model

- **Loopback only** — every route first checks that the connection comes from loopback (`127.0.0.0/8`, `::1`, `::ffff:127.0.0.1`) and that `Host` is a loopback name (blocking DNS rebinding); POST additionally requires `application/json` with a same-origin `Origin` (blocking simple-request CSRF), otherwise 403/415. Nothing listens publicly and there is no account system.
- **Ids only** — the client can send a skill id (grammar `/^[a-z0-9][a-z0-9-]{0,63}$/`) and nothing else; URLs and paths are rejected. Invalid ids return 400. Fetch addresses come only from the catalog's `source` coordinates plus `resolve` templates — the client can never choose a download URL.
- **Path fence** — install/uninstall rebuild paths from the id alone; before writing, the resolved absolute path must stay inside `installRoot`, which blocks `../` escapes.
- **Stage, then rename** — an install downloads into `installRoot/.staging-<id>-<random>/`, validates file count (<=200), per-file size (<=2 MB), total size (<=16 MB) and relative-path grammar, then renames the whole directory to `installRoot/<id>`. An existing target returns 409; any failure cleans up staging and returns an error, leaving the disk unchanged.
- **Uninstall keeps data** — the directory is moved to `installRoot/.trash/<id>-<timestamp>/`.
- **No sensitive reads** — credentials, sessions and workspace files are never read; only the skills directory is scanned to compute "installed".
- **No telemetry** — nothing is reported to any third party. Network traffic goes only to: the configured catalog source and its mirrors (catalog refresh), `api.skillhub.cn` (SkillHub zip downloads), and GitHub raw/API plus the jsDelivr mirror (GitHub-coordinate downloads).

## FAQ

**No 金融技能 sidebar entry?**
1. Make sure you fully quit and reopened (old processes gone in Activity Monitor);
2. Check that `"dsh-financial-skills"` is in `dsh.profile.bundles` of `~/.dsh/profiles/<profile>/package.json`;
3. Refresh the page once (Cmd+R / F5) and look again.

**The page shows empty or stale data?**
The footer states the `source`: `snapshot` means this run is using the packaged snapshot (network unreachable, or `offline` is configured). Press Refresh to retry; a successful fetch writes the cache for the next six hours.

**An install failed?**
Installs need network access: SkillHub skills download a zip from `api.skillhub.cn`, GitHub skills fetch files from raw / API / jsDelivr. The page surfaces an actionable error (retry, or copy the `skillhub install …` command) and staging is cleaned up — a half-installed skill is never left behind. Repeated failures are usually network issues, not catalog data.

**License says `proprietary`?**
Some upstream skills are proprietary SkillHub skills. Rows do not show the license; the detail view does. Installing just means downloading it for local use, not a redistribution license.

**Nothing changed after an upgrade?**
This plugin is installed as a `link:` to the repository, so a restart picks up code changes. If `package.json` or `cordis.patch.yml` changed, re-run the install script and fully restart again.

**Will it eat disk space?**
It only writes the skills you choose to install (usually tens of KB to a few MB each). Uninstall moves them to `.trash`; nothing is auto-deleted.

## Development & tests

Zero npm dependencies, no build step. Node >= 20.

```sh
node --check index.js client.js lib/*.js test/*.mjs   # syntax
npm test                                              # unit + half-contract tests (offline)
./scripts/run-e2e.sh                                  # real-Host E2E (isolated DSH_HOME)
./scripts/run-e2e.sh --verbose                        # stream the Host log
node test/e2e-remote.mjs --help                       # every E2E option
```

The E2E: creates an **isolated DSH_HOME** under the repo's `.e2e/` (it never touches your live `~/.dsh`) → clones a profile from the official `web` template → installs this plugin exactly like a real bundle → writes a `--patch` config override and preflights it with `--dump-config` → boots a Host with `--no-open --port 0` → authenticates through `/connect` → asserts the plugin is active, all 6 routes, the packaged snapshot's categories and skill count with source coordinates and the served `client.js`, then runs a full install (`SKILL.md` + `.financial-skills.json` provenance including `sourceType`) and uninstall (moved to `.trash`) against a local `plugins/<id>/` fixture (the format-2-compatible layout). No model tokens are spent.

Details, troubleshooting and log locations: [docs/E2E.md](docs/E2E.md).

## Repository and feedback

- Source, issues, updates: <https://github.com/openfcp/dsh-financial-skills>
- Version: `v0.1.1` — see [CHANGELOG.md](CHANGELOG.md)
- Upstream catalog data: <https://github.com/openfcp/awesome-financial-skills>

**When filing a bug, include**: DSH version (About panel), plugin version (`version` from `GET /api/financial-skills/health`), OS, and reproduction steps. For install failures, paste the error line shown in the page (never paste cookies or tokens).

PRs are welcome: keep the package dependency-free, `npm test` green offline, and `sh -n scripts/*.sh` clean.

## Compatibility

- Fully tested on **DSH 0.2.2-rc.1** (current desktop build); requires DSH >= **0.2.0-rc.2** and Node >= **20**.
- The host half only relies on DSH's public `webServer` registration API and `node:` builtins. The browser half is a hand-written `__ModuleLoader__` bundle that only uses the host-provided `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`.
- If a future DSH release renames the sidebar/main slots, the entry disappears — skills already installed locally keep working.

## License & disclaimer

[MIT](LICENSE)

**Author**: 八大权益 ([OpenFCP](https://github.com/openfcp)).

This is a community plugin. It is **not affiliated with, endorsed by, or certified by DeepSeek**. Upstream catalog data and each skill's body remain the property of their authors and follow their licenses (the detail view shows each skill's `license`).

The plugin only indexes and installs skills locally. It is not investment, legal or compliance advice; complete your own compliance review and human sign-off before using anything in a financial production process.
