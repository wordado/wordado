#!/usr/bin/env bash
# Installs one Playwright browser with its system packages, for CI.
#
# The system packages come from the runner's package mirror and normally take under a minute, but now
# and then a machine gets them at a trickle: one job once spent 19 minutes there and held the whole run
# and its deployment (issue #241). So each attempt has a time limit, and an attempt that passes it, or
# fails, is made again: what was downloaded is kept, so the next attempt goes on from there.
set -uo pipefail

browser=${1:?usage: install-browser.sh <chromium|firefox|webkit>}
limit=${INSTALL_LIMIT_SECONDS:-180}
# Only for trying the retry out: a limit for the first attempt alone.
first_limit=${INSTALL_FIRST_LIMIT_SECONDS:-$limit}
attempts=3

cd "$(dirname "$0")/../../web" || exit 1

for attempt in $(seq 1 "$attempts"); do
  seconds=$limit
  [ "$attempt" -eq 1 ] && seconds=$first_limit
  # The packages as root, with the limit inside sudo: a limit outside it could not stop what root runs.
  # After an attempt that was stopped, dpkg finishes whatever it had begun before the next one.
  if sudo env "PATH=$PATH" timeout --kill-after=10 "$seconds" node_modules/.bin/playwright install-deps "$browser" &&
    timeout --kill-after=10 "$seconds" node_modules/.bin/playwright install "$browser"; then
    exit 0
  fi
  echo "::warning::installing $browser: attempt $attempt of $attempts failed or passed ${seconds}s"
  sudo dpkg --configure -a || true
done

echo "::error::$browser could not be installed in $attempts attempts"
exit 1
