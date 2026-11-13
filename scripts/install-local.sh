#!/bin/sh
# install-local.sh — install dsh-financial-skills into a DSH profile from this checkout.
#
#   ./scripts/install-local.sh [profile]
#
# profile defaults to $DSH_PROFILE or "desktop"; DSH_HOME defaults to ~/.dsh and
# can be overridden. The script:
#   1. records this checkout as a `link:` plugin dependency of the profile
#      (`dsh plugin --profile <profile> add link:<repo>`), so edits are picked up
#      without reinstalling;
#   2. makes sure "dsh-financial-skills" is listed in the profile's
#      `dsh.profile.bundles` — that is what composes the bundle's cordis.patch.yml
#      and inserts the `financial-skills` row;
#   3. prints what is left to do: FULLY restart DeepSeek Harness.
#
# The profile lives outside the workspace file sandbox, so run this from a normal
# terminal (not from inside a confined DSH session).
set -eu

profile="${1:-${DSH_PROFILE:-desktop}}"
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(CDPATH= cd -- "$here/.." && pwd -P)
dsh="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir="$dsh_home/profiles/$profile"
manifest="$profile_dir/package.json"
bundle_name="dsh-financial-skills"

if [ ! -x "$dsh" ]; then
  echo "error: dsh CLI not found or not executable: $dsh" >&2
  echo "       set DSH_CLI to the DeepSeek Harness launcher and try again." >&2
  exit 1
fi
if [ ! -f "$manifest" ]; then
  echo "error: profile '$profile' not found at $profile_dir" >&2
  echo "       Open DeepSeek Harness once (it creates the 'desktop' profile)," >&2
  echo "       or pass the profile name: ./scripts/install-local.sh <profile>" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not on PATH (Node >= 20 is required)." >&2
  exit 1
fi

echo "installing $repo_root"
echo "  profile : $profile"
echo "  DSH_HOME: $dsh_home"
echo "  cli     : $dsh"
echo

# Remove first: a re-run should replace the recorded dependency instead of
# failing on an already-present spec, and a stale copy must not win.
"$dsh" plugin --profile "$profile" remove "$bundle_name" >/dev/null 2>&1 || true
DSH_HOME="$dsh_home" "$dsh" plugin --profile "$profile" add "link:$repo_root"

# Enable the bundle. A bundle is only composed when it is listed in
# dsh.profile.bundles; its own cordis.patch.yml then inserts the plugin row.
if ! node - "$manifest" "$bundle_name" <<'EOF'
const { readFileSync, writeFileSync } = require('node:fs')
const file = process.argv[2]
const name = process.argv[3]
const manifest = JSON.parse(readFileSync(file, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
const bundles = (manifest.dsh.profile.bundles ??= [])
if (!Array.isArray(bundles)) throw new Error('dsh.profile.bundles is not an array')
if (!bundles.includes(name)) bundles.push(name)
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`bundle entry ready: ${name}`)
EOF
then
  echo
  echo "error: could not update $manifest automatically." >&2
  echo "       Add \"$bundle_name\" to dsh.profile.bundles manually, like:" >&2
  echo '         "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-financial-skills"]' >&2
  exit 1
fi

echo
echo "================================================================"
echo " 安装完成 / installed, one step left: FULLY RESTART DeepSeek Harness."
echo "================================================================"
echo " 1. This script already added \"$bundle_name\" to"
echo "    $manifest"
echo "    (dsh.profile.bundles). If you ever edit that file, keep the entry."
echo
echo " 2. Quit the app completely — menu bar: DeepSeek Harness -> Quit"
echo "    (or Cmd+Q), and check Activity Monitor has NO DeepSeek Harness"
echo "    process left. Closing the window is NOT a restart; the background"
echo "    process keeps running and the plugin will not load."
echo
echo " 3. Reopen DeepSeek Harness, look at the left sidebar for the"
echo "    \"金融业技能\" entry (English: Financial Skills) and click it — the"
echo "    right side shows the full-page \"金融行业skills精选\" catalog."
echo
echo " To uninstall: ./scripts/uninstall-local.sh $profile"
