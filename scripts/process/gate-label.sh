#!/usr/bin/env bash
# Set the hand-over state of a PR: exactly one `gate/*` label. The label is only the queue.
# The proof stays the review record and the commit status `review/codex` on the head SHA.
# States: codex-pending, codex-changes, codex-approved, owner, none (remove every gate/* label).
# Usage: scripts/process/gate-label.sh <pr-number> <state>
# Exit: 0 the PR carries exactly the requested label, 1 it does not, 64 usage. GH overrides gh.
set -euo pipefail

GH=${GH:-gh}
STATES="codex-pending codex-changes codex-approved owner"
PR=${1:-}
STATE=${2:-}
case "$PR" in '' | *[!0-9]*) echo "usage: gate-label.sh <pr-number> <$(echo "$STATES" | tr ' ' '|')|none>" >&2; exit 64 ;; esac
case " $STATES none " in *" $STATE "*) ;; *) echo "gate-label: unknown state '$STATE'" >&2; exit 64 ;; esac

# Add the new label first: if the add fails, the PR keeps its earlier state.
if [ "$STATE" != none ]; then
	"$GH" api "repos/{owner}/{repo}/issues/$PR/labels" -f "labels[]=gate/$STATE" >/dev/null \
		|| { echo "gate-label: could not add gate/$STATE to #$PR; labels unchanged" >&2; exit 1; }
fi
for s in $STATES; do
	[ "$s" = "$STATE" ] && continue
	# 404 when the label is not on the PR. That is the normal case.
	"$GH" api -X DELETE "repos/{owner}/{repo}/issues/$PR/labels/gate%2F$s" >/dev/null 2>&1 || true
done
want=""
[ "$STATE" = none ] || want="gate/$STATE"
got=$("$GH" api "repos/{owner}/{repo}/issues/$PR/labels?per_page=100" --jq '.[].name' | { grep '^gate/' || true; } | sort | paste -sd ' ' -) \
	|| { echo "gate-label: could not read the labels of #$PR back" >&2; exit 1; }
if [ "$got" != "$want" ]; then
	echo "gate-label: #$PR has gate labels '$got', expected '$want'" >&2
	exit 1
fi
echo "gate-label: #$PR -> $STATE"
