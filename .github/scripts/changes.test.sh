#!/usr/bin/env bash
# The rules of changes.sh, case by case. Run by CI's static job.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
failed=0

# expect "<app> <code> <review>" file...
expect() {
  local want=$1
  shift
  local got
  got=$(printf '%s\n' "$@" | bash "$here/changes.sh" | cut -d= -f2 | tr '\n' ' ' | sed 's/ $//')
  if [ "$got" != "$want" ]; then
    echo "FAIL: [$*] gave app/code/review = $got, expected $want"
    failed=1
  fi
}

# Documents alone need nothing.
expect "false false false" docs/deploy.md
expect "false false false" README.md CLAUDE.md docs/superpowers/specs/a.md LICENSE
# The review app alone: the suites and its deployment, not the learner app's browsers.
expect "false true true" review-app/src/App.tsx
expect "false true true" review-app/src/App.tsx docs/deploy.md
expect "false true true" review-app/README.md
# The learner app and its server.
expect "true true false" web/src/main.tsx
expect "true true false" server/src/index.ts
expect "true true false" server/migrations/0012_interface_language.sql
expect "true true false" client-data/src/index.ts
# One learner-app file among the review app's is enough.
expect "true true true" review-app/src/App.tsx web/src/main.tsx
# What both are built from.
expect "true true true" core/src/index.ts
expect "true true true" pipeline/src/build.ts
expect "true true true" pnpm-lock.yaml
# The demo studies the pipeline's sample, which the review app is not deployed for.
expect "true true false" pipeline/samples/a1/manifest.json
# The workflows, the scripts beside them, and the files at the top run everything of the learner app.
expect "true true false" .github/workflows/ci.yml
expect "true true false" .github/scripts/changes.sh
expect "true true false" package.json
expect "true true false" tsconfig.base.json
# Markdown inside a package is that package's, not a document.
expect "true true false" web/README.md
# A folder nobody has named yet.
expect "true true false" new-package/src/index.ts
# No files: a comparison that went wrong, so everything.
expect "true true true" ""

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "changes.sh: all cases pass"
