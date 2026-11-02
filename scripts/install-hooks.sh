#!/usr/bin/env bash
# install-hooks.sh: installs the local git hooks that run content-lint.
# Re-run in every clone and every worktree. Safe to run repeatedly.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
hooks="$(git rev-parse --git-path hooks)"
mkdir -p "$hooks"

cat > "$hooks/commit-msg" << 'HOOK'
#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
"$root/scripts/content-lint" message "$1"
HOOK

cat > "$hooks/pre-commit" << 'HOOK'
#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
git diff --cached --name-only --diff-filter=ACMR -z | xargs -0 "$root/scripts/content-lint" files
HOOK

chmod +x "$hooks/commit-msg" "$hooks/pre-commit" "$root/scripts/content-lint" "$root/scripts/content-lint-hook"
echo "hooks installed in $hooks"
common="$(git rev-parse --git-common-dir)"
[ -f "$common/info/content-lint-terms" ] || echo "note: $common/info/content-lint-terms does not exist yet; content-lint fails closed until it does" >&2
