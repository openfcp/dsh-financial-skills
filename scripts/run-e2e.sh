#!/bin/sh
# run-e2e.sh — thin wrapper around test/e2e-remote.mjs.
#
# Boots an ISOLATED DeepSeek Harness web Host (own DSH_HOME under <repo>/.e2e,
# never the live ~/.dsh profile), mounts this plugin the way a real profile does,
# then asserts the whole /api/financial-skills/* contract over HTTP, including a
# fixture install + uninstall. No LLM tokens are spent.
#
#   ./scripts/run-e2e.sh                  # boot, assert, install + uninstall fixture
#   ./scripts/run-e2e.sh --verbose        # stream the Host log while it boots
#   ./scripts/run-e2e.sh --keep           # leave the Host up (it prints the URL)
#   ./scripts/run-e2e.sh --attach <url>   # drive an already-running isolated Host
#   ./scripts/run-e2e.sh --help           # every option
#
# Every argument is forwarded to test/e2e-remote.mjs.
# Environment overrides:
#   DSH_CLI                    dsh launcher   (default: the shipped app CLI)
#   DSH_E2E_HOME               isolated DSH_HOME (default: <repo>/.e2e/home)
#   DSH_E2E_PROFILE            profile name   (default: fs-e2e)
#   DSH_E2E_PORT               listen port    (default: 0 = OS picks a free one)
#   DSH_E2E_FIXTURE_SKILL      fixture skill id (default: dyz-gongwen-skills)
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(CDPATH= cd -- "$here/.." && pwd -P)

DSH_CLI="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
DSH_E2E_HOME="${DSH_E2E_HOME:-$repo_root/.e2e/home}"

if ! command -v node >/dev/null 2>&1; then
  echo "run-e2e: node is not on PATH (Node >= 20 is required for fetch/ESM)." >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "run-e2e: Node $(node --version) is too old (>= 20 required)." >&2
  exit 1
fi
if [ ! -x "$DSH_CLI" ]; then
  echo "run-e2e: dsh launcher not found or not executable: $DSH_CLI" >&2
  echo "         set DSH_CLI to the DeepSeek Harness CLI and try again." >&2
  exit 1
fi

echo "run-e2e: repo     $repo_root"
echo "run-e2e: DSH_HOME $DSH_E2E_HOME"
echo "run-e2e: dsh      $DSH_CLI"
echo

DSH_CLI="$DSH_CLI" DSH_E2E_HOME="$DSH_E2E_HOME" exec node "$repo_root/test/e2e-remote.mjs" "$@"
