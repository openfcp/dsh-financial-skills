#!/usr/bin/env node
/**
 * e2e-remote.mjs — end-to-end proof harness for dsh-financial-skills.
 *
 * Boots a REAL DeepSeek Harness web Host in an isolated DSH_HOME (never the live
 * `~/.dsh` home), mounts this plugin the way a real profile does:
 *
 *   1. copy the package into `<profile>/node_modules/dsh-financial-skills`
 *   2. record a `file:` dependency and append `dsh-financial-skills` to
 *      `dsh.profile.bundles`, so the package's own cordis.patch.yml inserts the
 *      `financial-skills` row;
 *   3. generate a `--patch` overlay that overrides that row's config (offline
 *      mode by default) — a config override, not a second insert, so exactly one
 *      row is composed;
 *   4. `--dump-config` preflight proves the row really is in the composition;
 *   5. boot `dsh <profile> --patch <overlay> --no-open --port 0`, parse the
 *      printed authenticated URL, exchange it for a `/connect` cookie, then
 *      assert the plugin's public wire contract over HTTP.
 *
 * No external dependencies, no LLM tokens: it never calls `session.prompt`.
 *
 * Usage:
 *   node test/e2e-remote.mjs [options]
 *   DSH_E2E_HOME=/tmp/x node test/e2e-remote.mjs --keep
 *
 * Options (env var in brackets):
 *   --home <dir>          isolated DSH_HOME      [DSH_E2E_HOME]   default <repo>/.e2e/home
 *   --profile <name>      profile to boot        [DSH_E2E_PROFILE] default fs-e2e
 *   --template <name>     shipped profile copied when creating it   default web
 *   --plugin <path>       plugin dir             [DSH_E2E_PLUGIN] default <repo>
 *   --port <n>            listen port, 0 = OS picks [DSH_E2E_PORT]  default 0
 *   --dsh <path>          dsh CLI               [DSH_CLI]        default the shipped app CLI
 *   --plugin-config <json> row config for the patch overlay  default {"offline":true}
 *   --fixture-skill <id>  skill id installed from the local GitHub fixture
 *                         [DSH_E2E_FIXTURE_SKILL] default official-source-qa
 *   --fixture <dir>       local fixture repo root [DSH_FINANCIAL_SKILLS_FIXTURE]
 *                         default <home>/../fixture
 *   --attach <url>        skip boot; drive an already-running Host URL (with token)
 *   --attach-write        in --attach mode also run install/uninstall checks
 *   --keep                leave the Host running after the run
 *   --log <file>          host log path (default <home>/logs/host-<ts>.log)
 *   --boot-timeout <ms>   default 180000
 *   --http-timeout <ms>   per-request timeout, default 30000
 *   --verbose             stream the Host log to stdout
 *   --no-preflight        skip the `--dump-config` composition check
 *   --help
 *
 * Output: human-readable progress, then one machine-readable last line:
 *   E2E_RESULT {"ok":true,"plugin":"dsh-financial-skills","home":"…","url":"…",
 *               "checks":{"pluginMounted":true,…},"error":null,…}
 *
 * Exit code: 0 when every assertion passed, 1 otherwise.
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ────────────────────────────────────────────────────────────────────────────
// constants and helpers
// ────────────────────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const DEFAULT_DSH = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'

/** The package name, row id and client bundle path this repo promises. */
const PACKAGE_NAME = 'dsh-financial-skills'
const ROW_ID = 'financial-skills'

/** Wire contract, documented in README.md (API table) and docs/E2E.md. */
const API = {
  catalog: '/api/financial-skills/catalog',
  installed: '/api/financial-skills/installed',
  detail: '/api/financial-skills/detail',
  install: '/api/financial-skills/install',
  uninstall: '/api/financial-skills/uninstall',
  health: '/api/financial-skills/health',
}

/** The committed upstream snapshot has 9 categories and 17 skills. */
const EXPECTED = { categories: 9, skills: 17 }

const ID_GRAMMAR = /^[a-z0-9][a-z0-9-]{0,63}$/
const FIXTURE_ID_GRAMMAR = ID_GRAMMAR

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const paint = (code) => (text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : String(text))
const bold = paint('1')
const dim = paint('2')
const red = paint('31')
const green = paint('32')
const yellow = paint('33')

let STEP = 0
function section(title) {
  STEP += 1
  process.stdout.write(`\n${bold(`[${STEP}]`)} ${bold(title)}\n`)
}
function info(label, value) {
  process.stdout.write(`    ${dim(String(label).padEnd(20))} ${value}\n`)
}
function ok(label, value = '') {
  process.stdout.write(`    ${green('✓')} ${label}${value === '' ? '' : ` ${dim(value)}`}\n`)
}
function bad(label, value = '') {
  process.stdout.write(`    ${red('✗')} ${label}${value === '' ? '' : ` ${dim(value)}`}\n`)
}
function note(text) {
  process.stdout.write(`    ${dim(text)}\n`)
}
function warn(text) {
  process.stdout.write(`    ${yellow('!')} ${text}\n`)
}

function fail(message, extra) {
  const error = new Error(message)
  if (extra !== undefined) error.details = extra
  throw error
}

/** Last `n` lines of a text blob, for error reporting. */
function tailOf(text, n = 40) {
  const lines = String(text ?? '').split('\n')
  return lines.slice(Math.max(0, lines.length - n)).join('\n')
}

/** Run a child to completion synchronously and return {status, stdout, stderr}. */
function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
    env: options.env ?? process.env,
    cwd: options.cwd,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error !== undefined) {
    return { status: -1, stdout: result.stdout ?? '', stderr: `${result.error.message}`, error: result.error }
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * Signal a whole process group.
 *
 * `dsh` is a shell launcher that `exec`s an Electron binary, which can fork a
 * helper with the same command line. Killing only the direct child therefore
 * leaks a Host, so the harness spawns the Host `detached` (making it its own
 * process-group leader) and signals the group.
 */
function signalTree(pid, signal) {
  if (pid === undefined) return false
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    try {
      process.kill(pid, signal)
      return true
    } catch {
      return false
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** Resolve a package's entry module from its manifest (for sanity checks). */
function resolveEntry(dir, manifest) {
  const exportsField = manifest?.exports
  let relative
  if (typeof exportsField === 'string') relative = exportsField
  else if (exportsField?.['.'] !== undefined) {
    const dot = exportsField['.']
    relative = typeof dot === 'string' ? dot : (dot.import ?? dot.default ?? dot.node)
  }
  relative ??= manifest?.main ?? 'index.js'
  return path.resolve(dir, relative)
}

/** True when `child` is inside `parent` (both already absolute). */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Copy a package tree while skipping the harness's own scaffolding.
 *
 * `fs.cpSync` refuses to copy a directory into its own subtree (EINVAL), and the
 * isolated `DSH_HOME` lives inside the repo by design. Walking the tree ourselves
 * also lets us skip `.e2e/` before descending into it, so the copy cannot
 * recurse into itself.
 */
function copyTree(source, destination, skip) {
  const stat = fs.lstatSync(source)
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true })
    for (const leaf of fs.readdirSync(source)) {
      if (skip.has(leaf)) continue
      copyTree(path.join(source, leaf), path.join(destination, leaf), skip)
    }
    return
  }
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination)
    return
  }
  if (stat.isFile()) {
    fs.copyFileSync(source, destination)
    try {
      fs.chmodSync(destination, stat.mode)
    } catch {
      /* best effort: a read-only package still runs */
    }
  }
  // sockets / fifos have no business inside a plugin package.
}

// ────────────────────────────────────────────────────────────────────────────
// command line
// ────────────────────────────────────────────────────────────────────────────

const BOOLEAN_FLAGS = new Set(['keep', 'verbose', 'help', 'no-preflight', 'attach-write'])

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) fail(`unexpected argument ${JSON.stringify(token)} (every option starts with --)`)
    let key = token.slice(2)
    let value
    const eq = key.indexOf('=')
    if (eq !== -1) {
      value = key.slice(eq + 1)
      key = key.slice(0, eq)
    }
    if (value === undefined) {
      if (BOOLEAN_FLAGS.has(key)) value = true
      else {
        value = argv[i + 1]
        if (value === undefined || value.startsWith('--')) fail(`--${key} needs a value`)
        i += 1
      }
    }
    opts[key] = value
  }
  return opts
}

function buildConfig(argv) {
  const opts = parseArgs(argv)
  if (opts.help) {
    // The file header is the single source of truth for the option list.
    const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const header = source.match(/^(?:#![^\n]*\n)?\/\*\*([\s\S]*?)\*\//u)
    process.stdout.write(
      header === null
        ? 'e2e-remote.mjs — isolated DSH Host E2E for dsh-financial-skills\n'
        : `${header[1]
            .split('\n')
            .map((line) => line.replace(/^\s*\* ?/u, ''))
            .join('\n')
            .trim()}\n`,
    )
    process.exit(0)
  }
  const env = process.env
  const home = path.resolve(opts.home ?? env.DSH_E2E_HOME ?? path.join(REPO_ROOT, '.e2e', 'home'))
  const plugin = path.resolve(opts.plugin ?? env.DSH_E2E_PLUGIN ?? REPO_ROOT)
  const port = Number(opts.port ?? env.DSH_E2E_PORT ?? 0)
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be an integer 0..65535, got ${opts.port}`)

  const fixtureSkill = opts['fixture-skill'] ?? env.DSH_E2E_FIXTURE_SKILL ?? 'official-source-qa'
  if (!FIXTURE_ID_GRAMMAR.test(fixtureSkill)) {
    fail(`--fixture-skill must match ${ID_GRAMMAR}, got ${JSON.stringify(fixtureSkill)}`)
  }
  const fixture = path.resolve(
    opts.fixture ?? env.DSH_FINANCIAL_SKILLS_FIXTURE ?? path.join(path.dirname(home), 'fixture'),
  )

  // Default: never hit the network. The catalog then comes from the packaged
  // snapshot (still 9/17) and any GitHub-backed route comes from the local
  // fixture repo; pass --plugin-config '{}' to exercise live defaults instead.
  let pluginConfig = { offline: true }
  if (opts['plugin-config'] !== undefined) {
    try {
      pluginConfig = JSON.parse(opts['plugin-config'])
    } catch (error) {
      fail(`--plugin-config is not valid JSON: ${error.message}`)
    }
  }

  return {
    home,
    profile: opts.profile ?? env.DSH_E2E_PROFILE ?? 'fs-e2e',
    template: opts.template ?? 'web',
    plugin,
    pluginConfig,
    port,
    dsh: opts.dsh ?? env.DSH_CLI ?? DEFAULT_DSH,
    fixture,
    fixtureSkill,
    attach: opts.attach,
    attachWrite: opts['attach-write'] === true,
    keep: opts.keep === true,
    log: opts.log,
    bootTimeoutMs: Number(opts['boot-timeout'] ?? 180000),
    httpTimeoutMs: Number(opts['http-timeout'] ?? 30000),
    verbose: opts.verbose === true,
    preflight: opts['no-preflight'] !== true,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// host log follower (file-backed: the Host keeps running even after we exit)
// ────────────────────────────────────────────────────────────────────────────

class LogTail {
  constructor(file, verbose) {
    this.file = file
    this.verbose = verbose
    this.offset = 0
    this.text = ''
  }

  /** Read whatever the Host appended since the last call. */
  pump() {
    let stat
    try {
      stat = fs.statSync(this.file)
    } catch {
      return ''
    }
    if (stat.size <= this.offset) return ''
    const length = stat.size - this.offset
    const buffer = Buffer.alloc(length)
    const fd = fs.openSync(this.file, 'r')
    try {
      fs.readSync(fd, buffer, 0, length, this.offset)
    } finally {
      fs.closeSync(fd)
    }
    this.offset = stat.size
    const chunk = buffer.toString('utf8')
    this.text += chunk
    if (this.verbose) process.stdout.write(chunk)
    return chunk
  }

  /** Wait for a regex match in the accumulated log, failing on timeout or child exit. */
  async waitFor(patterns, { timeoutMs, label, child }) {
    const list = Array.isArray(patterns) ? patterns : [patterns]
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      this.pump()
      for (const pattern of list) {
        const match = this.text.match(pattern)
        if (match !== null) return match
      }
      if (child !== undefined && child.exitCode !== null) {
        fail(`the Host exited (code ${child.exitCode}) before ${label}.\n--- host log tail ---\n${tailOf(this.text)}`)
      }
      await sleep(120)
    }
    fail(`timed out after ${timeoutMs}ms waiting for ${label}.\n--- host log tail ---\n${tailOf(this.text)}`)
    return undefined
  }
}

// ────────────────────────────────────────────────────────────────────────────
// steps: isolated profile + install + patch
// ────────────────────────────────────────────────────────────────────────────

/** Refuse to touch the live home; the harness must stay isolated. */
function guardIsolatedHome(cfg) {
  const live = path.resolve(path.join(os.homedir(), '.dsh'))
  if (path.resolve(cfg.home) === live) {
    fail('refusing to run against the live ~/.dsh home; pass --home with an isolated directory')
  }
  if (isInside(live, cfg.home)) fail(`--home must not be inside ${live}; pick an isolated directory`)
}

/** Create the isolated profile from a shipped template when it does not exist yet. */
function ensureProfile(cfg) {
  const profDir = path.join(cfg.home, 'profiles', cfg.profile)
  const manifestPath = path.join(profDir, 'package.json')
  if (fs.existsSync(manifestPath)) {
    info('profile', `${profDir} ${dim('(exists)')}`)
    return { created: false, dir: profDir }
  }
  fs.mkdirSync(cfg.home, { recursive: true })
  const args = [cfg.profile, '--from-default-profile', cfg.template, '--dump-config']
  const result = runSync(cfg.dsh, args, { env: { ...process.env, DSH_HOME: cfg.home }, timeout: 180000 })
  if (result.status !== 0 || !fs.existsSync(manifestPath)) {
    fail(
      `could not create profile '${cfg.profile}' from template '${cfg.template}'.\n` +
        `command: ${cfg.dsh} ${args.join(' ')} (DSH_HOME=${cfg.home})\n` +
        `exit: ${result.status}\n--- stdout ---\n${tailOf(result.stdout, 30)}\n--- stderr ---\n${tailOf(result.stderr, 30)}`,
    )
  }
  info('profile', `${profDir} ${dim(`(created from '${cfg.template}' template)`)}`)
  return { created: true, dir: profDir }
}

/**
 * Install the plugin into the profile the way `dsh plugin add link:` does:
 * the package directory is copied into the profile's node_modules, recorded as
 * a `file:` dependency, and selected in `dsh.profile.bundles`. The bundle is
 * what composes this package's own cordis.patch.yml and inserts the row.
 *
 * A plugin living outside the profile could not import `@deepseek-ai/*`; the
 * copy is the arrangement that lets the plugin resolve the Host's own modules.
 */
function installPluginIntoProfile(cfg, profileDir) {
  const stat = fs.existsSync(cfg.plugin) ? fs.statSync(cfg.plugin) : undefined
  if (stat === undefined) fail(`plugin path does not exist: ${cfg.plugin}`)
  const pluginDir = stat.isDirectory() ? cfg.plugin : path.dirname(cfg.plugin)
  const manifestPath = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(manifestPath)) fail(`plugin package.json not found: ${manifestPath}`)
  const manifest = readJson(manifestPath)
  const name = manifest.name
  if (name !== PACKAGE_NAME) fail(`expected package name ${PACKAGE_NAME}, found ${JSON.stringify(name)}`)
  const entry = resolveEntry(pluginDir, manifest)
  if (!fs.existsSync(entry)) fail(`plugin entry module not found: ${entry}`)
  const bundlePatch = manifest.dsh?.bundle?.patch
  if (typeof bundlePatch !== 'string') fail('package.json is missing dsh.bundle.patch; the bundle cannot mount')
  const patchFile = path.resolve(pluginDir, bundlePatch)
  if (!fs.existsSync(patchFile)) fail(`bundle patch file not found: ${patchFile}`)

  const nodeModules = path.join(profileDir, 'node_modules')
  const dest = path.join(nodeModules, name)
  // Guard: dest must be exactly <profile>/node_modules/<pkg>, never a computed surprise.
  if (path.dirname(dest) !== nodeModules || path.basename(dest) !== name) fail(`refusing to install into ${dest}`)
  fs.mkdirSync(nodeModules, { recursive: true })

  // The isolated DSH_HOME lives inside the repo (by default), so the copy MUST
  // skip the harness's own scaffolding or it would recurse into itself.
  const SKIP = new Set(['.git', '.e2e', '.work', '.verify', '.pnpm-store', 'node_modules', '.DS_Store'])
  const staging = `${dest}.e2e-staging`
  fs.rmSync(staging, { recursive: true, force: true })
  copyTree(pluginDir, staging, SKIP)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.renameSync(staging, dest)

  // Record it as a dependency so the profile stays self-describing, and select
  // it as a bundle so its cordis.patch.yml layer is composed.
  const profManifestPath = path.join(profileDir, 'package.json')
  const profManifest = fs.existsSync(profManifestPath)
    ? readJson(profManifestPath)
    : { name: `dsh-profile-${cfg.profile}`, private: true }
  profManifest.dependencies ??= {}
  profManifest.dependencies[name] = `file:${pluginDir}`
  profManifest.dsh ??= {}
  profManifest.dsh.profile ??= {}
  const bundles = (profManifest.dsh.profile.bundles ??= [])
  if (!bundles.includes(name)) bundles.push(name)
  writeJson(profManifestPath, profManifest)

  info('plugin', `${name}@${manifest.version ?? '0.0.0'}`)
  info('installed', `${dest} ${dim('(copy)')}`)
  info('bundle', `${name} ${dim('(in dsh.profile.bundles)')}`)
  info('patch file', patchFile)
  return { name, dir: pluginDir, entry, manifest, installedPath: dest, profileDir, patchFile }
}

/**
 * Build a tiny local stand-in for the upstream GitHub repo.
 *
 * `DSH_FINANCIAL_SKILLS_FIXTURE` makes the host half read `plugins/<id>/…` from
 * this directory instead of api.github.com / raw.githubusercontent.com, so the
 * install/detail paths are exercised deterministically and offline.
 */
function prepareFixture(cfg) {
  const root = cfg.fixture
  const skillDir = path.join(root, 'plugins', cfg.fixtureSkill)
  fs.rmSync(skillDir, { recursive: true, force: true })
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${cfg.fixtureSkill}`,
      'description: E2E fixture skill generated by test/e2e-remote.mjs. Not the upstream body.',
      '---',
      '',
      `# ${cfg.fixtureSkill}`,
      '',
      'This file only exists to prove the install pipeline: tree listing, download,',
      'staging, rename, provenance and uninstall-to-.trash. It is not shipped.',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(root, 'plugins', cfg.fixtureSkill, 'package.json'),
    `${JSON.stringify(
      {
        name: cfg.fixtureSkill,
        version: '0.0.1-e2e',
        private: true,
        description: 'E2E fixture skill package (generated).',
      },
      null,
      2,
    )}\n`,
  )
  // Harmless extra file: proves the tree walk copies more than SKILL.md and
  // that the limits are enforced against a real multi-file tree.
  fs.writeFileSync(path.join(root, 'plugins', cfg.fixtureSkill, 'README.md'), '# fixture\n')
  // The catalog the fixture repo would publish, for the host to use when it
  // prefers a local catalog over the packaged snapshot.
  const snapshot = path.join(REPO_ROOT, 'catalog.snapshot.json')
  if (fs.existsSync(snapshot) && !fs.existsSync(path.join(root, 'catalog.json'))) {
    fs.copyFileSync(snapshot, path.join(root, 'catalog.json'))
  }
  info('fixture', root)
  info('fixture skill', `${cfg.fixtureSkill} ${dim('(plugins/<id>/SKILL.md)')}`)
  return { root, skillId: cfg.fixtureSkill }
}

/** Write the `--patch` overlay: a config override for the bundle-inserted row. */
function writeOverlay(cfg, home) {
  const patchPath = path.join(home, 'e2e.patch.yml')
  const config = cfg.pluginConfig
  const lines = [
    `# Generated by test/e2e-remote.mjs at ${new Date().toISOString()}.`,
    `# The row is inserted by this package's cordis.patch.yml; this overlay only`,
    `# overrides its config, so exactly one '${ROW_ID}' row is composed.`,
    `- id: ${ROW_ID}`,
    `  config: ${JSON.stringify(config)}`,
  ]
  fs.mkdirSync(path.dirname(patchPath), { recursive: true })
  fs.writeFileSync(patchPath, `${lines.join('\n')}\n`)
  info('patch', patchPath)
  info('row', `${ROW_ID} ${dim('(config override)')}`)
  info('config', JSON.stringify(config))
  return { patchPath, rowId: ROW_ID }
}

/** Verify the composed profile tree actually contains our row before booting. */
function preflight(cfg, patchPath) {
  const args = [cfg.profile, '--patch', patchPath, '--dump-config']
  const result = runSync(cfg.dsh, args, { env: { ...process.env, DSH_HOME: cfg.home }, timeout: 120000 })
  if (result.status !== 0) {
    fail(
      `--dump-config failed, the patch overlay is not loadable.\n` +
        `command: ${cfg.dsh} ${args.join(' ')}\n` +
        `exit: ${result.status}\n--- stderr ---\n${tailOf(result.stderr, 30)}`,
    )
  }
  const lines = result.stdout.split('\n')
  const rowIndex = lines.findIndex((line) => line === `- id: ${ROW_ID}`)
  if (rowIndex === -1) {
    fail(
      `the composed profile does not list the row '${ROW_ID}'; the bundle or patch was ignored.\n` +
        `--- dump-config tail ---\n${tailOf(result.stdout, 20)}`,
    )
  }
  // The override must be applied to that row (look inside its block, which ends
  // at the next top-level '- ' line or '# ==' header).
  let blockEnd = lines.length
  for (let i = rowIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('- ') || lines[i].startsWith('# ==')) {
      blockEnd = i
      break
    }
  }
  const block = lines.slice(rowIndex, blockEnd).join('\n')
  const overrideApplied = JSON.stringify(cfg.pluginConfig)
    .slice(1, -1)
    .split(',')
    .every((fragment) => block.includes(fragment.split(':')[0].replaceAll('"', '').trim()))
  const rows = lines.filter((line) => line === `- id: ${ROW_ID}`).length
  if (rows !== 1) fail(`expected exactly one '${ROW_ID}' row, found ${rows}`)
  if (!overrideApplied) {
    fail(`the '${ROW_ID}' row does not carry the overlay config.\n--- row ---\n${block}`)
  }
  const entries = lines.filter((line) => /^- id: /u.test(line)).length
  ok('composition', `row '${ROW_ID}' present (1), ${entries} entries composed, config overlaid`)
}

/** Spawn the Host and wait for its printed authenticated URL. */
async function bootHost(cfg, patchPath) {
  const logFile =
    cfg.log ?? path.join(cfg.home, 'logs', `host-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.log`)
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = fs.openSync(logFile, 'a')

  const args = [cfg.profile, '--patch', patchPath, '--no-open', '--port', String(cfg.port)]
  info('command', `${path.basename(cfg.dsh)} ${args.join(' ')}`)
  info('DSH_HOME', cfg.home)
  info('log', logFile)

  const env = {
    ...process.env,
    DSH_HOME: cfg.home,
    // Point the host half's GitHub bridge at the local fixture repo.
    DSH_FINANCIAL_SKILLS_FIXTURE: cfg.fixture,
  }
  const child = spawn(cfg.dsh, args, {
    // Own process group, so cleanup can signal the launcher AND any helper it forks.
    detached: true,
    stdio: ['ignore', fd, fd],
    env,
  })
  fs.closeSync(fd)
  child.on('error', (error) => info('spawn-error', error.message))

  const tail = new LogTail(logFile, cfg.verbose)
  const match = await tail.waitFor([/dsh web:\s+(\S+)/], {
    timeoutMs: cfg.bootTimeoutMs,
    label: 'the authenticated URL line ("dsh web: http://…/?token=…")',
    child,
  })
  const url = match[1]
  const parsed = new URL(url)
  const token = parsed.searchParams.get('token')
  if (token === null) fail(`the URL printed by the Host carries no ?token=: ${url}`)
  ok('booted', `${parsed.origin} (pid ${child.pid})`)
  return { child, logFile, tail, url, origin: parsed.origin, token }
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP / RPC
// ────────────────────────────────────────────────────────────────────────────

/** Exchange the launch token for a signed browser-session cookie. */
async function authenticate(baseUrl, token) {
  const url = new URL('/connect', baseUrl)
  url.searchParams.set('token', token)
  url.searchParams.set('interactions', 'answer')
  let last = 'no attempt'
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
      const location = response.headers.get('location') ?? ''
      if (response.status === 302 && location.includes('api/remote.mux')) {
        const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
        const raw = cookies.length > 0 ? cookies : [response.headers.get('set-cookie') ?? '']
        const cookie = raw
          .map((value) => value.split(';')[0])
          .filter((value) => value.length > 0)
          .join('; ')
        if (cookie === '') fail('the /connect redirect carried no Set-Cookie header')
        return cookie
      }
      last = `status ${response.status} location ${JSON.stringify(location)}`
    } catch (error) {
      last = error.message
    }
    await sleep(250)
  }
  fail(`/connect did not issue a session cookie (last: ${last})`)
  return undefined
}

/** One HTTP request against the Host, carrying the browser-session cookie. */
async function http(cfg, session, pathname, options = {}) {
  const url = new URL(pathname, session.baseUrl)
  const headers = {
    cookie: session.cookie,
    origin: new URL(session.baseUrl).origin,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    ...(options.headers ?? {}),
  }
  if (options.json !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    signal: AbortSignal.timeout(cfg.httpTimeoutMs),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  return { status: response.status, headers: response.headers, text, json: parsed, pathname }
}

/**
 * Read the authenticated app shell (the HTML document that carries the
 * `__DSH_BOOT__` payload).
 *
 * `/connect` issues an API credential (v2 payload); the document itself is
 * authenticated by the navigation cookie set when `/?token=…` redirects to `/`
 * (v1 payload). Both cookies share the same `dsh-auth-<authority-hash>` name, so
 * they must be sent **separately** — concatenating them makes the server reject
 * the request with 401.
 */
async function fetchAppShell(cfg, session, token) {
  const root = new URL('/', session.baseUrl)
  const attempt = async (cookie) => {
    const response = await fetch(root, {
      headers: { cookie, accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.httpTimeoutMs),
    })
    return { status: response.status, text: await response.text() }
  }

  // Some builds accept the API cookie for the document too; try it cheaply.
  const withApi = await attempt(session.cookie)
  if (withApi.status === 200 && withApi.text.includes('__DSH_BOOT__')) {
    return { text: withApi.text, cookie: session.cookie }
  }

  const navUrl = new URL('/?token=' + encodeURIComponent(token), session.baseUrl)
  const nav = await fetch(navUrl, { redirect: 'manual', signal: AbortSignal.timeout(cfg.httpTimeoutMs) })
  const rawCookies = typeof nav.headers.getSetCookie === 'function' ? nav.headers.getSetCookie() : []
  const pageCookie = (rawCookies.length > 0 ? rawCookies : [nav.headers.get('set-cookie') ?? ''])
    .map((entry) => entry.split(';')[0])
    .filter((entry) => entry.length > 0)
    .join('; ')
  if (pageCookie === '') fail('the `/?token=` navigation exchange carried no Set-Cookie header')

  const withPage = await attempt(pageCookie)
  if (withPage.status !== 200 || !withPage.text.includes('__DSH_BOOT__')) {
    fail(`could not read the authenticated app shell (HTTP ${withPage.status}, no __DSH_BOOT__)`)
  }
  return { text: withPage.text, cookie: pageCookie }
}

/**
 * Extract `window.__DSH_BOOT__ = {…}` from the shell HTML with a brace scanner,
 * so the payload can be inspected as an object instead of a regex soup.
 */
function extractBootPayload(html) {
  const marker = html.indexOf('__DSH_BOOT__')
  if (marker === -1) return undefined
  const start = html.indexOf('{', marker)
  if (start === -1) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i += 1) {
    const character = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/** The `plugins/??<pkg>/client.js&rev=<hex>` entry from the boot payload. */
function findClientBundleEntry(bootText) {
  const combo = bootText.match(/plugins\/\?\?dsh-financial-skills\/client\.js(?:&|&amp;|\\u0026)rev=[a-f0-9]+/u)
  const entryId =
    /"id"\s*:\s*"dsh-financial-skills"/u.test(bootText) ||
    /"packageName"\s*:\s*"dsh-financial-skills"/u.test(bootText) ||
    /"moduleName"\s*:\s*"dsh-financial-skills"/u.test(bootText)
  return {
    comboPath: combo === null ? undefined : combo[0].replaceAll('&amp;', '&').replaceAll('\\u0026', '&'),
    entryId,
  }
}


/** POST one unary Remote RPC to /api/<namespace>/<method>. */
async function rpc(cfg, session, method, args) {
  const endpoint = new URL(`/api/${method}`, session.baseUrl)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: session.cookie,
      origin: new URL(session.baseUrl).origin,
      'accept-language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      method,
      payload: { args },
    }),
    signal: AbortSignal.timeout(cfg.httpTimeoutMs),
  })
  const text = await response.text()
  if (response.status === 404) fail(`${method}: 404 — no Remote endpoint is registered at ${endpoint.pathname}`)
  if (!text.startsWith('{')) fail(`${method}: HTTP ${response.status} with a non-JSON body: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

/** Call a method whose generated parameter name we may not know (`{}` vs `{_request:{}}`). */
async function callWithArgs(cfg, session, method, candidates) {
  let envelope
  for (const args of candidates) {
    envelope = await rpc(cfg, session, method, args)
    if (envelope.result?.ok === true) return envelope
    const message = envelope.result?.error?.message ?? ''
    if (!/args fields do not match|missing "/u.test(message)) return envelope
  }
  return envelope
}

/** Describe an envelope failure for a human. */
function envelopeError(result) {
  if (result.status !== 200) return `HTTP ${result.status} ${JSON.stringify(result.json ?? result.text.slice(0, 200))}`
  const error = result.json?.error
  if (typeof error === 'string') return error
  if (error !== undefined && error !== null) return JSON.stringify(error)
  return 'not ok'
}

// ────────────────────────────────────────────────────────────────────────────
// assertions
// ────────────────────────────────────────────────────────────────────────────

/**
 * The whole E2E is expressed as named checks so a failed run still reports the
 * full picture (`checks` in E2E_RESULT) instead of stopping at the first miss.
 */
function createJudge(report) {
  const checks = {}
  report.checks = checks
  return {
    checks,
    expect(name, value, detail = '') {
      const passed = value === true
      checks[name] = passed
      if (passed) ok(name, detail)
      else bad(name, detail)
      return passed
    },
    /** Run a probe that returns {passed, detail}; a thrown error fails the check. */
    probe(name, fn) {
      try {
        const result = fn()
        const passed = result === true || (result !== null && typeof result === 'object' && result.passed === true)
        const detail = typeof result === 'object' && result !== null ? (result.detail ?? '') : ''
        return this.expect(name, passed, detail)
      } catch (error) {
        checks[name] = false
        bad(name, error.message)
        return false
      }
    },
  }
}

/** Everything that happens against a booted (or attached) Host. */
async function runAgainstHost(cfg, report, { url, child, tail, facts, write }) {
  const parsed = new URL(url)
  const token = parsed.searchParams.get('token')
  if (token === null) fail('the Host URL carries no ?token=')
  const baseUrl = `${parsed.origin}/`
  const judge = createJudge(report)
  const checks = judge.checks

  section('authenticate over /connect')
  const cookie = await authenticate(baseUrl, token)
  ok('cookie', `${cookie.split('=')[0]}=… ${dim(`(${cookie.length} bytes)`)}`)
  const session = { baseUrl, cookie }
  report.url = url

  section('prove the plugin mounted (pluginInventory/list)')
  let inventory
  try {
    const envelope = await callWithArgs(cfg, session, 'pluginInventory/list', [{}, { _request: {} }])
    inventory = envelope.result?.ok === true ? envelope.result.value : undefined
  } catch (error) {
    note(`pluginInventory unavailable (${error.message.split('\n')[0]})`)
  }
  if (inventory === undefined) {
    judge.expect('pluginMounted', false, 'no plugin inventory in this composition')
  } else {
    const entries = inventory.entries ?? []
    const mine = entries.filter(
      (entry) => entry.moduleName === PACKAGE_NAME || String(entry.moduleName ?? '').includes(PACKAGE_NAME),
    )
    for (const entry of mine) info('row', `id=${entry.entryId} phase=${entry.fiberPhase} enabled=${entry.enabled}`)
    const active = mine.find((entry) => entry.fiberPhase === 'active')
    judge.expect(
      'pluginMounted',
      active !== undefined,
      active === undefined ? `inventory has ${entries.length} entries; none active for ${PACKAGE_NAME}` : `id=${active.entryId}`,
    )
  }

  section('GET ' + API.health)
  const health = await http(cfg, session, API.health)
  report.health = health.json?.value ?? null
  const healthValue = health.json?.ok === true ? health.json.value : undefined
  judge.expect(
    'healthOk',
    health.status === 200 && healthValue !== undefined,
    healthValue === undefined ? envelopeError(health) : `version=${healthValue.version ?? '?'} offline=${healthValue.offline} skillRoot=${healthValue.skillRoot ?? '?'}`,
  )
  const skillRoot =
    typeof healthValue?.skillRoot === 'string'
      ? healthValue.skillRoot
      : path.join(cfg.home, 'skills')
  report.skillRoot = skillRoot
  info('skill root', skillRoot)
  judge.expect('healthSkillRootInsideHome', isInside(cfg.home, skillRoot), skillRoot)
  if (typeof healthValue?.offline === 'boolean') {
    judge.expect('healthOfflineFlag', cfg.pluginConfig.offline === true ? healthValue.offline === true : true, String(healthValue.offline))
    report.offline = healthValue.offline
  }

  section('GET ' + API.catalog)
  const catalogResponse = await http(cfg, session, API.catalog)
  const catalogValue = catalogResponse.json?.ok === true ? catalogResponse.json.value : undefined
  const catalog = catalogValue?.catalog ?? catalogValue
  const meta = catalogValue?.meta
  report.catalogMeta = meta ?? null
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : []
  const skills = Array.isArray(catalog?.skills) ? catalog.skills : []
  judge.expect(
    'catalogRoute',
    catalogResponse.status === 200 && catalogResponse.json?.ok === true && catalog !== undefined,
    catalogResponse.json?.ok === true ? '' : envelopeError(catalogResponse),
  )
  judge.expect('catalogCategories', categories.length === EXPECTED.categories, `${categories.length} (expected ${EXPECTED.categories})`)
  judge.expect('catalogSkills', skills.length === EXPECTED.skills, `${skills.length} (expected ${EXPECTED.skills})`)
  judge.expect(
    'catalogUpstreamSite',
    catalog?.upstreamSite === 'https://openfcp.github.io/awesome-financial-skills/',
    String(catalog?.upstreamSite ?? '(missing)'),
  )
  judge.expect(
    'catalogMetaHonest',
    meta !== undefined &&
      typeof meta === 'object' &&
      ['network', 'cache', 'snapshot'].includes(meta.source) &&
      typeof meta.offline === 'boolean' &&
      typeof meta.stale === 'boolean',
    meta === undefined ? 'no meta object' : `source=${meta.source} offline=${meta.offline} stale=${meta.stale}`,
  )
  if (cfg.pluginConfig.offline === true) {
    judge.expect('catalogOfflineLabel', meta?.offline === true, String(meta?.offline))
  }
  info('categories', categories.map((item) => `${item.id}:${item.count}`).join(' '))
  const categoryCount = categories.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  judge.expect('catalogCategoryCounts', categoryCount === skills.length, `${categoryCount} vs ${skills.length} skills`)
  judge.expect(
    'catalogCategoryCountPresent',
    categories.length > 0 && categories.every((item) => typeof item.count === 'number'),
    `${categories.length} categories with numeric count`,
  )

  // Format 3: the catalog stores references only. The normalized payload must
  // carry the top-level resolve templates and per-skill source coordinates.
  const resolveBlock = catalog?.resolve
  judge.expect(
    'catalogResolveTemplates',
    resolveBlock !== undefined &&
      resolveBlock.skillhub?.kind === 'zip' &&
      typeof resolveBlock.skillhub?.url === 'string' &&
      resolveBlock.skillhub.url.includes('{slug}') &&
      resolveBlock.github?.kind === 'files' &&
      typeof resolveBlock.github?.raw === 'string' &&
      typeof resolveBlock.github?.api === 'string',
    resolveBlock === undefined
      ? '(no resolve block in the normalized catalog)'
      : `skillhub=${resolveBlock.skillhub?.kind} github=${resolveBlock.github?.kind}`,
  )
  const githubSkills = skills.filter((skill) => skill?.source?.type === 'github')
  const skillhubSkills = skills.filter((skill) => skill?.source?.type === 'skillhub')
  const githubCoordsOk =
    githubSkills.length > 0 &&
    githubSkills.every(
      (skill) =>
        typeof skill.source.repo === 'string' &&
        skill.source.repo !== '' &&
        typeof skill.source.path === 'string' &&
        skill.source.path !== '' &&
        typeof skill.source.ref === 'string' &&
        skill.source.ref !== '',
    )
  const skillhubCoordsOk =
    skillhubSkills.length > 0 &&
    skillhubSkills.every(
      (skill) =>
        typeof skill.source.slug === 'string' &&
        skill.source.slug !== '' &&
        typeof skill.source.skillhubCommand === 'string' &&
        skill.source.skillhubCommand.startsWith('skillhub install '),
    )
  judge.expect(
    'catalogSourceCoordinates',
    githubCoordsOk && skillhubCoordsOk,
    `github=${githubSkills.length} skillhub=${skillhubSkills.length}`,
  )
  const vendoredEntry = skills.find((skill) => skill.id === 'official-source-qa')
  judge.expect(
    'catalogVendoredEntry',
    vendoredEntry?.source?.type === 'github' &&
      vendoredEntry.source.vendored === true &&
      vendoredEntry.source.path === 'skills/official-source-qa',
    `${vendoredEntry?.id ?? 'official-source-qa'}: path=${vendoredEntry?.source?.path} vendored=${vendoredEntry?.source?.vendored}`,
  )
  info('sources', `github=${githubSkills.length} skillhub=${skillhubSkills.length}`)

  section('GET ' + API.installed)
  const installedResponse = await http(cfg, session, API.installed)
  const installedValue = installedResponse.json?.ok === true ? installedResponse.json.value : undefined
  const installedBefore = Array.isArray(installedValue?.skills) ? installedValue.skills : []
  report.installedBefore = installedBefore.length
  judge.expect(
    'installedRoute',
    installedResponse.status === 200 && installedValue !== undefined && typeof installedValue.count === 'number',
    installedValue === undefined ? envelopeError(installedResponse) : `root=${installedValue.root} count=${installedValue.count}`,
  )
  judge.expect('installedRoot', typeof installedValue?.root === 'string' && isInside(cfg.home, installedValue.root), String(installedValue?.root ?? '(missing)'))

  section('published browser bundle (boot payload)')
  // A bare /plugins/<pkg>/client.js is 404 by design. DSH's module loader exposes
  // the browser half through a combo URL listed in the boot payload:
  //   plugins/??<pkg>/client.js&rev=<hex>
  const shell = await fetchAppShell(cfg, session, token)
  const boot = extractBootPayload(shell.text)
  const bootText = boot === undefined ? shell.text : JSON.stringify(boot)
  const bundleEntry = findClientBundleEntry(bootText)
  judge.expect(
    'clientBundlePublished',
    bundleEntry.entryId && bundleEntry.comboPath !== undefined,
    `entryId=${bundleEntry.entryId} combo=${bundleEntry.comboPath ?? '(missing)'}${boot === undefined ? ' (HTML fallback)' : ''}`,
  )
  if (bundleEntry.comboPath === undefined) {
    judge.expect('clientBundleServed', false, 'no combo URL for dsh-financial-skills in the boot payload')
  } else {
    const bundlePath = `/${bundleEntry.comboPath}`
    // Combo assets are served by the document web server, so reuse the page
    // cookie (the v2 API cookie is not interchangeable here).
    const bundle = await http(cfg, { baseUrl: session.baseUrl, cookie: shell.cookie }, bundlePath)
    const served =
      bundle.status === 200 &&
      bundle.text.includes('__ModuleLoader__.load') &&
      bundle.text.includes('dsh-financial-skills')
    report.clientBundleUrl = bundlePath
    info('bundle url', bundlePath)
    judge.expect(
      'clientBundleServed',
      served,
      `HTTP ${bundle.status} ${bundle.status === 200 ? `${bundle.text.length} bytes` : bundle.text.slice(0, 120)}`,
    )
  }

  if (!write) {
    note('read-only run: install/uninstall checks skipped (boot mode runs them; --attach-write opts in)')
    return finish(cfg, report)
  }

  // ── write checks: install fixture → provenance → installed → uninstall ──
  const id = cfg.fixtureSkill
  const installedDir = path.join(skillRoot, id)
  const skillFile = path.join(installedDir, 'SKILL.md')
  const provenanceFile = path.join(installedDir, '.financial-skills.json')

  section('POST ' + API.install + ' (fixture skill)')
  const installResponse = await http(cfg, session, API.install, { method: 'POST', json: { id } })
  const installValue = installResponse.json?.ok === true ? installResponse.json.value : undefined
  report.install = { status: installResponse.status, value: installValue ?? null }
  const installOk = judge.expect(
    'installRoute',
    installResponse.status === 200 && installValue !== undefined,
    installValue === undefined ? envelopeError(installResponse) : `id=${installValue.id} files=${installValue.files} bytes=${installValue.bytes}`,
  )
  if (installOk) {
    judge.expect('installSkillFile', fs.existsSync(skillFile), skillFile)
    judge.expect('installProvenance', fs.existsSync(provenanceFile), provenanceFile)
    if (fs.existsSync(provenanceFile)) {
      judge.probe('installProvenanceFields', () => {
        const value = readJson(provenanceFile)
        report.provenance = value
        // Host contract: {id, version, license, sourceRepo, sourceType,
        // installedAt(ms), files:[relative paths], fileCount, bytes} plus
        // sourcePath/sourceRef (github) or sourceSlug/sourceNamespace
        // (skillhub). Note `files` here is a list, unlike the install response
        // where `files` is a count. The fixture skill is a github-coordinate
        // skill, so provenance must identify that source type and location.
        const versioned = typeof value.version === 'string' || typeof value.version === 'number'
        const stamped = typeof value.installedAt === 'number'
        const listed = Array.isArray(value.files) && value.files.includes('SKILL.md')
        const sameId = value.id === id || value.id === undefined
        const sourceTyped = value.sourceType === 'github'
        const coordsOk =
          typeof value.sourceRepo === 'string' &&
          value.sourceRepo.includes('/') &&
          typeof value.sourcePath === 'string' &&
          value.sourcePath !== '' &&
          typeof value.sourceRef === 'string' &&
          value.sourceRef !== ''
        return {
          passed: versioned && stamped && listed && sameId && sourceTyped && coordsOk,
          detail: `id=${value.id ?? '?'} version=${value.version ?? '?'} sourceType=${value.sourceType ?? '?'} repo=${value.sourceRepo ?? '?'} path=${value.sourcePath ?? '?'} ref=${value.sourceRef ?? '?'} files=${Array.isArray(value.files) ? value.files.length : value.fileCount ?? '?'} installedAt=${value.installedAt ?? '?'}`,
        }
      })
    }
    judge.expect(
      'installRespectsSkillRoot',
      isInside(skillRoot, installedDir),
      `${installedDir} ${dim('inside')} ${skillRoot}`,
    )
    judge.expect('installResultShape', installValue?.id === id && typeof installValue?.files === 'number' && typeof installValue?.bytes === 'number', JSON.stringify(installValue))
  } else {
    note('install failed — the dependent installed/uninstall checks are skipped')
    return finish(cfg, report)
  }

  section('GET ' + API.installed + ' after install')
  const installedAfterResponse = await http(cfg, session, API.installed)
  const installedAfterValue = installedAfterResponse.json?.ok === true ? installedAfterResponse.json.value : undefined
  const installedAfter = Array.isArray(installedAfterValue?.skills) ? installedAfterValue.skills : []
  report.installedAfter = installedAfter.length
  const listed = installedAfter.find((item) => item.id === id)
  judge.expect(
    'installedListsFixture',
    listed !== undefined,
    listed === undefined ? `${installedAfter.length} skills, ${id} missing` : `managed=${listed.managed} version=${listed.version ?? '?'}`,
  )
  judge.expect(
    'installedGrew',
    installedAfter.length === installedBefore.length + 1,
    `${installedBefore.length} → ${installedAfter.length}`,
  )

  section('GET ' + API.detail + '?id=' + id)
  const detailResponse = await http(cfg, session, `${API.detail}?id=${encodeURIComponent(id)}`)
  const detailValue = detailResponse.json?.ok === true ? detailResponse.json.value : undefined
  report.detail = detailValue === undefined ? null : { files: detailValue.files?.length, totalBytes: detailValue.totalBytes }
  judge.probe('detailRoute', () => {
    if (detailValue === undefined) return { passed: false, detail: envelopeError(detailResponse) }
    const markdown = typeof detailValue.markdown === 'string' ? detailValue.markdown : ''
    const files = Array.isArray(detailValue.files) ? detailValue.files : []
    // The fixture skill resolves through a github-coordinate source; the detail
    // payload must expose those coordinates instead of a vendored directory.
    const source = detailValue.source !== null && typeof detailValue.source === 'object' ? detailValue.source : {}
    const sourceOk =
      source.type === 'github' &&
      typeof source.repo === 'string' &&
      typeof source.path === 'string' &&
      typeof source.ref === 'string'
    return {
      passed: markdown.includes(cfg.fixtureSkill) && files.length >= 2 && id === detailValue.id && sourceOk,
      detail: `markdown=${markdown.length}B files=${files.length} totalBytes=${detailValue.totalBytes} source=${source.type ?? '?'}:${source.path ?? '?'}@${source.ref ?? '?'}`,
    }
  })

  section('POST ' + API.install + ' with an invalid id')
  const evilResponse = await http(cfg, session, API.install, { method: 'POST', json: { id: '../escape' } })
  judge.expect(
    'installRejectsPathEscape',
    evilResponse.status === 400 && evilResponse.json?.ok === false,
    `HTTP ${evilResponse.status} ${JSON.stringify(evilResponse.json?.error ?? evilResponse.text.slice(0, 80))}`,
  )

  section('POST ' + API.uninstall + ' (fixture skill)')
  const uninstallResponse = await http(cfg, session, API.uninstall, { method: 'POST', json: { id } })
  const uninstallValue = uninstallResponse.json?.ok === true ? uninstallResponse.json.value : undefined
  report.uninstall = { status: uninstallResponse.status, value: uninstallValue ?? null }
  const uninstallOk = judge.expect(
    'uninstallRoute',
    uninstallResponse.status === 200 && uninstallValue !== undefined,
    uninstallValue === undefined ? envelopeError(uninstallResponse) : `trashedTo=${uninstallValue.trashedTo}`,
  )
  if (uninstallOk) {
    const trashedTo = uninstallValue.trashedTo
    judge.expect(
      'uninstallTrashed',
      typeof trashedTo === 'string' && isInside(path.join(skillRoot, '.trash'), trashedTo) && fs.existsSync(trashedTo),
      String(trashedTo),
    )
    judge.expect('uninstallRemovedFromSkills', !fs.existsSync(skillFile), `${installedDir} ${dim('(expected gone)')}`)
  }

  section('GET ' + API.installed + ' after uninstall')
  const installedGoneResponse = await http(cfg, session, API.installed)
  const installedGoneValue = installedGoneResponse.json?.ok === true ? installedGoneResponse.json.value : undefined
  const installedGone = Array.isArray(installedGoneValue?.skills) ? installedGoneValue.skills : []
  judge.expect('installedAfterUninstall', installedGone.find((item) => item.id === id) === undefined, `${installedGone.length} skills`)

  return finish(cfg, report)
}

/** Aggregate the checks into the final verdict. */
function finish(cfg, report) {
  const checks = report.checks ?? {}
  const failed = Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key)
  report.ok = failed.length === 0
  if (!report.ok) report.error = `failed checks: ${failed.join(', ')}`
  return report
}

// ────────────────────────────────────────────────────────────────────────────
// main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = buildConfig(process.argv.slice(2))
  const outcome = {
    ok: false,
    plugin: PACKAGE_NAME,
    rowId: ROW_ID,
    home: cfg.home,
    profile: cfg.profile,
    fixture: cfg.fixture,
    fixtureSkill: cfg.fixtureSkill,
    mode: cfg.attach === undefined ? 'boot' : 'attach',
    url: null,
    hostPid: null,
    log: null,
    pluginConfig: cfg.pluginConfig,
    checks: {},
    install: null,
    uninstall: null,
    health: null,
    catalogMeta: null,
    clientBundleUrl: null,
    skillRoot: null,
    error: null,
  }
  let child

  const cleanup = async () => {
    if (child === undefined) return
    if (cfg.keep) {
      child.unref()
      info('kept', `host stays up: pid ${child.pid}, ${outcome.url}`)
      note(`stop it later with: kill -- -${child.pid}  (its process group; plain 'kill ${child.pid}' also works)`)
      return
    }
    if (child.exitCode !== null) return
    signalTree(child.pid, 'SIGTERM')
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && child.exitCode === null) await sleep(100)
    if (child.exitCode === null) {
      signalTree(child.pid, 'SIGKILL')
      const hardDeadline = Date.now() + 3000
      while (Date.now() < hardDeadline && child.exitCode === null) await sleep(100)
      if (child.exitCode === null) note(`warning: process group ${child.pid} did not exit`)
      else note(`stopped process group ${child.pid} (SIGKILL)`)
    } else {
      note(`stopped process group ${child.pid} (SIGTERM)`)
    }
  }

  // Interrupts must not leave a stray Host behind.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void cleanup().finally(() => {
        process.stdout.write(`E2E_RESULT ${JSON.stringify({ ...outcome, ok: false, error: `interrupted by ${signal}` })}\n`)
        process.exit(130)
      })
    })
  }

  try {
    guardIsolatedHome(cfg)

    if (cfg.attach !== undefined) {
      info('attach', cfg.attach)
      outcome.url = cfg.attach
      return await runAgainstHost(cfg, outcome, {
        url: cfg.attach,
        child: undefined,
        tail: undefined,
        facts: undefined,
        write: cfg.attachWrite,
      })
    }

    if (!fs.existsSync(cfg.dsh)) fail(`dsh CLI not found at ${cfg.dsh} (set --dsh or $DSH_CLI)`)
    section('isolated home, profile and fixture')
    info('DSH_HOME', cfg.home)
    fs.mkdirSync(cfg.home, { recursive: true })
    const profile = ensureProfile(cfg)
    const fixture = prepareFixture(cfg)

    section('install the plugin into the profile')
    const facts = installPluginIntoProfile(cfg, profile.dir)

    section('write the --patch overlay')
    const { patchPath } = writeOverlay(cfg, cfg.home)

    section('preflight the composition')
    if (cfg.preflight) preflight(cfg, patchPath)
    else note('skipped (--no-preflight)')

    section('boot the Host')
    const host = await bootHost(cfg, patchPath)
    child = host.child
    outcome.hostPid = child.pid
    outcome.log = host.logFile
    outcome.url = host.url
    return await runAgainstHost(cfg, outcome, {
      url: host.url,
      child,
      tail: host.tail,
      facts,
      write: true,
    })
  } catch (error) {
    outcome.ok = false
    outcome.error = error.message
    // Multi-line detail stays readable; the verdict line reports the short error.
    if (error.message.includes('\n')) note(error.message.split('\n').slice(1).join('\n'))
    if (outcome.checks === undefined) outcome.checks = {}
    return outcome
  } finally {
    // Runs before the caller sees the returned outcome, and also on a throw, so
    // a failed run cannot leave a Host behind.
    await cleanup()
  }
}

// ────────────────────────────────────────────────────────────────────────────

const result = await main()
process.stdout.write(`\n${bold('E2E_RESULT')} ${JSON.stringify(result)}\n`)
if (result.log !== null && result.log !== undefined) note(`host log: ${result.log}`)
if (!result.ok) {
  process.stderr.write(`\n${red('FAILED')} ${result.error}\n`)
  process.exitCode = 1
}
