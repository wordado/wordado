#!/usr/bin/env bash
# What this run needs (issue #239), as step outputs: app, code, review (see changes.sh).
#
# A pull request is compared with the branch it merges into. A push to main is compared with the last
# commit that was deployed, not with the push before it: if an earlier run failed, its changes are
# still undeployed, and a later merge that touches something else must not pass over them.
# Whatever cannot be compared runs everything.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

# answer <key> <base>: that key's answer for the files changed since <base>; true when there is no usable base.
answer() {
  local key=$1 base=$2 files
  if [ -z "$base" ] || ! git merge-base --is-ancestor "$base" HEAD 2>/dev/null; then
    echo true
    return
  fi
  files=$(git diff --name-only "$base" HEAD)
  if [ -z "$files" ]; then
    # The same commit as the base: nothing new for this key.
    echo false
    return
  fi
  bash "$here/changes.sh" <<<"$files" | sed -n "s/^$key=//p"
}

# last_deployed <environment>: the newest commit whose deployment there succeeded; nothing if none is found.
last_deployed() {
  local environment=$1 id sha
  gh api "repos/$GITHUB_REPOSITORY/deployments?environment=$environment&per_page=30" --jq '.[] | "\(.id) \(.sha)"' 2>/dev/null |
    while read -r id sha; do
      # An older deployment's newest status is "inactive" once a later one succeeded, so any success counts.
      if gh api "repos/$GITHUB_REPOSITORY/deployments/$id/statuses" --jq 'any(.[]; .state == "success")' 2>/dev/null | grep -qx true; then
        echo "$sha"
        break
      fi
    done || true
}

if [ "$EVENT" = pull_request ]; then
  # The checkout is the merge of the pull request into its base: the first parent is the base.
  base=$(git rev-parse --verify --quiet 'HEAD^1' || true)
  git rev-parse --verify --quiet 'HEAD^2' >/dev/null || base=''
  app=$(answer app "$base")
  code=$(answer code "$base")
  # Nothing is deployed for the review app from a pull request.
  review=false
else
  app_base=$(last_deployed production)
  review_base=$(last_deployed production-review)
  echo "Last deployed: the app at ${app_base:-nothing found}, the review app at ${review_base:-nothing found}"
  app=$(answer app "$app_base")
  review=$(answer review "$review_base")
  code=$(answer code "${BEFORE:-}")
  # A deployment is never made of what the suites did not run on.
  if [ "$app" = true ] || [ "$review" = true ]; then code=true; fi
fi

echo "app=$app code=$code review=$review"
{
  echo "app=$app"
  echo "code=$code"
  echo "review=$review"
} >>"$GITHUB_OUTPUT"
