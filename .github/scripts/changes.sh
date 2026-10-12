#!/usr/bin/env bash
# What a change needs from CI (issue #239). Reads the changed files, one per line, and prints three answers:
#
#   app=true|false     the learner app's browser tests, and its deployment
#   code=true|false    the suites
#   review=true|false  the review app's deployment
#
# The rules are wide on purpose. A file is known not to touch the learner app only if it is the review
# app's, a document or top-level Markdown; anything else (shared code, the pipeline's sample that the
# demo studies, dependencies, the workflows) runs everything. No files at all also runs everything:
# an empty list is more likely a comparison that went wrong than a change of nothing.
set -euo pipefail

app=false
code=false
review=false
seen=false

while IFS= read -r file; do
  [ -n "$file" ] || continue
  seen=true
  case "$file" in
    docs/* | LICENSE) ;;
    */*)
      code=true
      case "$file" in
        review-app/*) ;;
        *) app=true ;;
      esac
      ;;
    *.md) ;;
    *)
      code=true
      app=true
      ;;
  esac
  # As the review app's deployment has always been decided: its own files and what it is built from.
  case "$file" in
    review-app/* | pipeline/src/* | core/src/* | pnpm-lock.yaml) review=true ;;
  esac
done

if [ "$seen" = false ]; then
  app=true
  code=true
  review=true
fi

echo "app=$app"
echo "code=$code"
echo "review=$review"
