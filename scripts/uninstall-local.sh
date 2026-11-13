#!/bin/sh
# uninstall-local.sh — remove dsh-financial-skills from a DSH profile.
#
#   ./scripts/uninstall-local.sh [profile]
#
# profile defaults to $DSH_PROFILE or "desktop"; DSH_HOME defaults to ~/.dsh and
# can be overridden. The script removes the plugin dependency and the
# "dsh-financial-skills" entry from the profile's dsh.profile.bundles, then tells
# you to fully restart DeepSeek Harness.
#
# Skills previously installed through the plugin live under <DSH_HOME>/skills and
# are user data: this script leaves them alone.
set -eu

profile="${1:-${DSH_PROFILE:-desktop}}"
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(CDPATH= cd -- "$here/.." && pwd -P)
dsh="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir="$dsh_home/profiles/$profile"
manifest="$profile_dir/package.json"
bundle_name="dsh-financial-skills"

echo "uninstalling $repo_root"
echo "  profile : $profile"
echo "  DSH_HOME: $dsh_home"
echo

if [ ! -x "$dsh" ]; then
  echo "error: dsh CLI not found or not executable: $dsh" >&2
  echo "       set DSH_CLI to the DeepSeek Harness launcher and try again." >&2
  exit 1
fi
if [ ! -f "$manifest" ]; then
  echo "error: profile '$profile' not found at $profile_dir" >&2
  exit 1
fi

# 1. Drop the dependency (tolerate it already being absent).
DSH_HOME="$dsh_home" "$dsh" plugin --profile "$profile" remove "$bundle_name" >/dev/null 2>&1 || true

# 2. Drop the bundle entry, otherwise the profile keeps trying to compose it.
if command -v node >/dev/null 2>&1; then
  node - "$manifest" "$bundle_name" <<'EOF'
const { readFileSync, writeFileSync } = require('node:fs')
const file = process.argv[2]
const name = process.argv[3]
const manifest = JSON.parse(readFileSync(file, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  const next = bundles.filter((entry) => entry !== name)
  if (next.length !== bundles.length) {
    manifest.dsh.profile.bundles = next
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`bundle entry removed: ${name}`)
  } else {
    console.log(`bundle entry was not present: ${name}`)
  }
} else {
  console.log('no dsh.profile.bundles array; nothing to remove')
}
EOF
else
  echo "warning: node is not on PATH; remove \"$bundle_name\" from dsh.profile.bundles manually." >&2
fi

echo
echo "================================================================"
echo " 卸载完成 / removed, one step left: FULLY RESTART DeepSeek Harness."
echo "================================================================"
echo " Quit the app completely (Cmd+Q / menu bar -> Quit) and make sure no"
echo " DeepSeek Harness process remains, then reopen. Closing the window is"
echo " NOT a restart; the old background process would keep the plugin loaded."
echo
echo " Skills you installed through the plugin are kept in:"
echo "   $dsh_home/skills"
echo " Delete a skill directory yourself, or reinstall the plugin and use its"
echo " 卸载 button, if you want them gone."
