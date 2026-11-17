#!/usr/bin/env bash
# Run the Codex gate on each open PR labelled `gate/codex-pending`, and on each `gate/codex-approved` PR whose head
# lost its approval. It runs on the owner's machine (by hand, cron, launchd or a Remote Control session).
# A PR is reviewed only when every check run on its head is green. A gate that cannot run keeps the label for the next run.
# Usage: scripts/process/codex-queue.sh [--dry-run]
# Env: GH, CODEX_GATE, GATE_LABEL (binaries and scripts); CODEX_QUEUE_SETUP (else `setup` of .agent/project.conf).
# Exit: 0 queue processed (or empty), 1 a gate could not run, 64 usage.
set -euo pipefail

GH=${GH:-gh}
HERE=$(cd "$(dirname "$0")" && pwd)
GATE=${CODEX_GATE:-$HERE/codex-gate.sh}
GATE_LABEL=${GATE_LABEL:-$HERE/gate-label.sh}
SETUP=${CODEX_QUEUE_SETUP:-}

DRY=0
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY=1 ;;
		*) echo "codex-queue: unknown option: $arg" >&2; exit 64 ;;
	esac
done

MAIN=$(git worktree list --porcelain | awk '/^worktree /{ if (!m) m = substr($0, 10) } END { print m }')
cd "$MAIN"

LOCK="$(git rev-parse --git-common-dir)/codex-queue.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
	echo "codex-queue: another run is active ($LOCK)"
	exit 0
fi
trap 'rmdir "$LOCK"' EXIT

labelled() {
	"$GH" api "repos/{owner}/{repo}/issues?labels=gate/$1&state=open&per_page=100" --paginate \
		--jq '.[] | select(.pull_request) | .number'
}
head_sha() { "$GH" api "repos/{owner}/{repo}/pulls/$1" --jq .head.sha; }
# The newest review/codex state of a SHA. Empty when it has none.
codex_state() {
	"$GH" api "repos/{owner}/{repo}/commits/$1/statuses?per_page=100" --paginate \
		--jq '.[] | select(.context == "review/codex") | .state' | sed -n 1p
}
# 0 when the SHA has at least one check run and all are green, 1 when not, 2 on an API error.
ci_green() {
	local runs total bad
	runs=$("$GH" api "repos/{owner}/{repo}/commits/$1/check-runs?per_page=100" --paginate \
		--jq '.check_runs[] | .conclusion // "pending"') || return 2
	total=$(printf '%s\n' "$runs" | grep -c . || true)
	bad=$(printf '%s\n' "$runs" | grep -v -E '^(success|skipped|neutral)$' | grep -c . || true)
	[ "$total" -gt 0 ] && [ "$bad" -eq 0 ]
}

failed=0
PENDING=$(labelled codex-pending) || { echo "codex-queue: cannot list gate/codex-pending" >&2; exit 1; }
APPROVED=$(labelled codex-approved) || { echo "codex-queue: cannot list gate/codex-approved" >&2; exit 1; }

# A push after an approval voids it (docs/process.md, section 4). Such a PR is gated again.
for pr in $APPROVED; do
	sha=$(head_sha "$pr") || { echo "codex-queue: cannot read the head of #$pr" >&2; failed=1; continue; }
	state=$(codex_state "$sha") || { echo "codex-queue: cannot read review/codex of #$pr" >&2; failed=1; continue; }
	case "$state" in success|pending) continue ;; esac
	PENDING=$(printf '%s\n%s\n' "$PENDING" "$pr")
done
PENDING=$(printf '%s\n' "$PENDING" | grep . | sort -n -u || true)
if [ -z "$PENDING" ]; then
	echo "codex-queue: nothing to review"
	exit "$failed"
fi

# All PRs share one worktree, detached at each head, so node_modules is reused.
WT="$MAIN/.claude/worktrees/codex-queue"
for pr in $PENDING; do
	sha=$(head_sha "$pr") || { echo "codex-queue: cannot read the head of #$pr" >&2; failed=1; continue; }
	rc=0; ci_green "$sha" || rc=$?
	if [ "$rc" -eq 2 ]; then
		echo "codex-queue: cannot read the check runs of #$pr" >&2; failed=1; continue
	elif [ "$rc" -ne 0 ]; then
		echo "codex-queue: #$pr head ${sha:0:7}: CI is not green yet; label kept"; continue
	fi
	if [ "$DRY" -eq 1 ]; then
		echo "codex-queue: would review #$pr at ${sha:0:7}"; continue
	fi
	echo "codex-queue: #$pr at ${sha:0:7}"
	git fetch -q origin "$sha" 2>/dev/null || git fetch -q origin "pull/$pr/head" || true
	if ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
		echo "codex-queue: cannot fetch head $sha of #$pr; label kept" >&2; failed=1; continue
	fi
	if [ -d "$WT" ]; then
		git -C "$WT" checkout -q --detach "$sha"
	else
		mkdir -p "$(dirname "$WT")"
		git worktree add -q --detach "$WT" "$sha"
	fi
	[ -n "$SETUP" ] || SETUP=$("$HERE/project-config.sh" setup --default true)
	if ! (cd "$WT" && eval "$SETUP"); then
		echo "codex-queue: setup failed for #$pr; label kept" >&2; failed=1; continue
	fi
	# A gate/codex-approved PR whose head lost its approval moves to pending while it is reviewed.
	"$GATE_LABEL" "$pr" codex-pending >/dev/null || true
	rc=0; "$GATE" "$pr" "$WT" || rc=$?
	case "$rc" in
		0) echo "codex-queue: #$pr approved" ;;
		1) echo "codex-queue: #$pr reviewed, no approval" ;;
		*) echo "codex-queue: the gate could not run on #$pr (exit $rc); label kept" >&2; failed=1 ;;
	esac
done
exit "$failed"
