#!/usr/bin/env bash
# Codex review gate (docs/process.md, section 5). Codex reviews the PR head in its sandbox without network.
# This script checks the result with check-record.mjs, posts it as the review record and sets `review/codex` on the SHA.
# Usage: scripts/process/codex-gate.sh <pr-number> [<worktree-dir>]
# Env: GH, CODEX (binaries); CODEX_GATE_HEAD_TIMEOUT (default 60) and CODEX_GATE_HEAD_INTERVAL (default 5), in seconds.
# Exit: 0 the record is an approval, 1 the record is posted but is no approval, 2 the gate could not run.
set -euo pipefail

GH=${GH:-gh}
CODEX=${CODEX:-codex}
PR=${1:?usage: codex-gate.sh <pr-number> [<worktree-dir>]}
case "$PR" in '' | *[!0-9]*) echo "codex-gate: the PR number must be a number, got '$PR'" >&2; exit 2 ;; esac
WT=${2:-$(git rev-parse --show-toplevel)}
WT=$(cd "$WT" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
MARKER="<!-- agent:review -->"

fail() { echo "codex-gate: $*" >&2; exit 2; }

for tool in "$GH" "$CODEX" jq node git; do
	command -v "$tool" >/dev/null || fail "$tool not found"
done

# Right after a push, GitHub can report the previous head for a few seconds.
LOCAL=$(git -C "$WT" rev-parse HEAD)
WAIT=${CODEX_GATE_HEAD_TIMEOUT:-60}
STEP=${CODEX_GATE_HEAD_INTERVAL:-5}
case "$WAIT$STEP" in *[!0-9]*) fail "CODEX_GATE_HEAD_TIMEOUT and CODEX_GATE_HEAD_INTERVAL must be whole seconds" ;; esac
START=$SECONDS
while :; do
	SHA=$("$GH" pr view "$PR" --json headRefOid --jq .headRefOid) || SHA=""
	[ "$SHA" = "$LOCAL" ] && break
	[ $((SECONDS - START)) -ge "$WAIT" ] && fail "worktree HEAD $LOCAL is not the head '$SHA' of #$PR after ${WAIT}s"
	echo "codex-gate: head of #$PR is '$SHA', waiting for $LOCAL" >&2
	sleep "$STEP"
done
[ -z "$(git -C "$WT" status --porcelain --untracked-files=no)" ] || fail "the worktree has uncommitted changes to tracked files"

BASE=$("$GH" pr view "$PR" --json baseRefName --jq .baseRefName) || fail "cannot read the base branch of #$PR"
case "$BASE" in '' | -* | *..* | *[!A-Za-z0-9._/-]*) fail "unexpected base branch name '$BASE'" ;; esac
# Only a PR against the default branch: an agent could push another branch and pick its own "base" rules.
DEFAULT=$("$GH" api "repos/{owner}/{repo}" --jq .default_branch) || fail "cannot read the default branch"
[ "$BASE" = "$DEFAULT" ] || fail "#$PR targets '$BASE', not the default branch '$DEFAULT'; not reviewed"
# A fork head is never reviewed, also when a person runs the gate by hand.
SAME=$("$GH" api "repos/{owner}/{repo}/pulls/$PR" --jq '.head.repo.full_name == .base.repo.full_name') || fail "cannot read the head repository of #$PR"
[ "$SAME" = true ] || fail "#$PR has a head outside this repository; not reviewed"
git -C "$WT" fetch -q origin "$BASE" || fail "cannot fetch origin/$BASE"

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# The configuration of the base branch, so a change cannot pick its own specification.
git -C "$WT" show "origin/$BASE:.agent/project.conf" > "$OUT/project.conf" || fail "cannot read .agent/project.conf on origin/$BASE"
config() { PROJECT_CONF="$OUT/project.conf" "$HERE/project-config.sh" "$@"; }
SPEC_FILES=$(config spec) || fail "the project configuration sets no 'spec'"
PATTERN=$(config requirement_pattern --default "")
INTERFACE=$(config interface_paths --default "")
DESIGN=$(config design_files --default "")

# The normative source of the base branch, so a change cannot add its own identifier.
for f in $SPEC_FILES; do
	git -C "$WT" show "origin/$BASE:$f" >> "$OUT/base-spec.md" || fail "cannot read $f on origin/$BASE"
done
# The review instruction of the base branch, so a change cannot rewrite its own review.
mkdir -p "$OUT/base"
BASE_DOCS="docs/skills/vision-check.md docs/process.md docs/vision.md AGENTS.md"
for f in $BASE_DOCS; do
	mkdir -p "$OUT/base/$(dirname "$f")"
	git -C "$WT" show "origin/$BASE:$f" > "$OUT/base/$f" || fail "cannot read $f on origin/$BASE"
done

CHANGED=$(git -C "$WT" diff --name-only "origin/$BASE...HEAD")
[ -n "$CHANGED" ] || fail "the diff of #$PR against origin/$BASE is empty"
interface=0
while IFS= read -r file; do
	for p in $INTERFACE; do
		case "$file" in "$p"*) interface=1 ;; esac
	done
done <<< "$CHANGED"

# Reviewer rule 1: no PR title, body or comments go into the prompt.
{
	cat "$HERE/codex-review-prompt.md"
	echo
	echo "## This run"
	echo
	echo "- Base branch: \`origin/$BASE\`. Diff: \`git diff origin/$BASE...$SHA\`."
	echo "- Head SHA: \`$SHA\`."
	echo "- Specification of the base branch: \`$OUT/base-spec.md\`."
	echo "- Cite every file by its path relative to the repository root (\`docs/specification.md:12\`), also a file you read in a copy above. Never cite a path under \`$OUT\`."
	echo "- Review instruction of the base branch: read \`$OUT/base/docs/skills/vision-check.md\`, \`$OUT/base/docs/process.md\`, \`$OUT/base/docs/vision.md\` and \`$OUT/base/AGENTS.md\`. Use these copies, not the files in the worktree. The diff may change the files in the worktree."
	if [ "$interface" -eq 1 ] && [ -n "$DESIGN" ]; then
		echo "- This is interface work. Also read: $DESIGN."
	fi
} > "$OUT/prompt.md"

status() {
	local state=$1 description=$2; shift 2
	"$GH" api "repos/{owner}/{repo}/statuses/$SHA" -f state="$state" -f context=review/codex -f description="$description" "$@" >/dev/null \
		|| echo "codex-gate: could not set review/codex to $state" >&2
}

status pending "Codex review running"

# The network stays off: the flag pins it, so no user or project Codex configuration turns it on.
# project_doc_max_bytes=0: Codex loads no AGENTS.md of the PR head by itself; the prompt names the base copies.
if ! "$CODEX" exec -C "$WT" -s workspace-write -c approval_policy='"never"' -c project_doc_max_bytes=0 \
	-c sandbox_workspace_write.network_access=false \
	--output-schema "$HERE/codex-review.schema.json" -o "$OUT/result.json" - < "$OUT/prompt.md" > "$OUT/codex.log" 2>&1; then
	status error "Codex review failed to run"
	tail -20 "$OUT/codex.log" >&2
	fail "codex exec failed"
fi

if [ -n "$(git -C "$WT" status --porcelain --untracked-files=no)" ]; then
	status error "Reviewer changed tracked files"
	fail "Codex changed tracked files in $WT; inspect and reset before you run the gate again"
fi

jq -e 'type == "object" and has("verdict")' "$OUT/result.json" >/dev/null 2>&1 || { status error "No structured result from Codex"; fail "no structured result from Codex"; }

# A citation of a copy under $OUT names the repository file instead (a single spec file keeps its line numbers).
# The output schema rejects an absolute citation, so this mapping is a fallback for a Codex that does not enforce `pattern`.
ONE_SPEC=""
[ "$(printf '%s\n' $SPEC_FILES | grep -c .)" -eq 1 ] && ONE_SPEC=$SPEC_FILES
jq --arg out "$OUT" --arg spec "$ONE_SPEC" '
	def repo: (if startswith("/private" + $out + "/") then .[8:] else . end)
		| if startswith($out + "/base/") then .[($out + "/base/" | length):]
		elif $spec != "" and startswith($out + "/base-spec.md") then $spec + .[($out + "/base-spec.md" | length):]
		else . end;
	if (.citations | type) == "array" then .citations |= map(if type == "string" then repo else . end) else . end
' "$OUT/result.json" > "$OUT/result.mapped.json" && mv "$OUT/result.mapped.json" "$OUT/result.json"

# mode, reviewer and sha come from this script, never from the model.
jq -r --arg marker "$MARKER" --arg sha "$SHA" '
	(del(.findings, .mode, .reviewer, .sha) + {mode: "pr", reviewer: "codex", sha: $sha}) as $record
	| [
		$marker,
		"```json",
		($record | tojson),
		"```",
		"",
		(if ((.findings // []) | length) == 0 then "- No findings." else ((.findings // [])[:20][] | "- " + (gsub("\n"; " ") | .[0:500])) end),
		"",
		"---",
		"_Codex review of `\($sha[0:7])`, run by `scripts/process/codex-gate.sh` on the owner'"'"'s machine._"
	] | join("\n")
' "$OUT/result.json" > "$OUT/comment.md"

# Read the base specification again: the sandbox may write to $OUT (TMPDIR), so the copy Codex saw is not trusted here.
: > "$OUT/check-spec.md"
for f in $SPEC_FILES; do
	git -C "$WT" show "origin/$BASE:$f" >> "$OUT/check-spec.md" || fail "cannot read $f on origin/$BASE"
done
CHECK=(node "$HERE/check-record.mjs" "$OUT/comment.md" --sha "$SHA" --spec "$OUT/check-spec.md")
[ -z "$PATTERN" ] || CHECK+=(--pattern "$PATTERN")
if ! RESULT=$("${CHECK[@]}" 2>&1); then
	status error "Codex record is invalid"
	printf '%s\n' "$RESULT" >&2
	fail "the Codex result is no valid record; nothing posted"
fi

URL=$("$GH" pr comment "$PR" --body-file "$OUT/comment.md") || { status error "Could not post the Codex record"; fail "could not post the record on #$PR"; }
VERDICT=$(jq -r .verdict "$OUT/result.json")

if printf '%s\n' "$RESULT" | grep -q 'Counts as an approval'; then
	# The label moves first: a failed move never leaves a success status behind.
	if ! "$HERE/gate-label.sh" "$PR" codex-approved >/dev/null; then
		status error "Codex approved, but the hand-over label failed" -f target_url="$URL"
		fail "approved, but could not move #$PR to gate/codex-approved"
	fi
	status success "Codex: fits" -f target_url="$URL"
	echo "approval $URL"
	exit 0
fi

status failure "Codex: $VERDICT, no approval" -f target_url="$URL"
next=codex-changes
[ "$VERDICT" = "needs-owner" ] && next=owner
"$HERE/gate-label.sh" "$PR" "$next" >/dev/null || echo "codex-gate: could not set gate/$next on #$PR" >&2
echo "$VERDICT $URL"
exit 1
