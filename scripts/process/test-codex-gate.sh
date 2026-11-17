#!/usr/bin/env bash
# Tests of codex-gate.sh, gate-label.sh and codex-queue.sh with fake gh and codex binaries. Run by test.sh.
# Needs bash, git, node and jq. No network, no Codex account.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fail=0
pass() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

# A base branch with the configuration and a specification, and a PR head on top of it.
git init -q --bare "$T/origin.git"
git init -q -b main "$T/wt"
g() { git -C "$T/wt" -c user.name=t -c user.email=t@example.com "$@"; }
mkdir -p "$T/wt/.agent" "$T/wt/docs" "$T/wt/src"
printf 'spec = docs/specification.md\nsetup = true\n' > "$T/wt/.agent/project.conf"
printf '# Spec\n\n- R1.1 A rule.\n' > "$T/wt/docs/specification.md"
mkdir -p "$T/wt/docs/skills"
for f in docs/skills/vision-check.md docs/process.md docs/vision.md AGENTS.md; do echo "base $f" > "$T/wt/$f"; done
g add -A && g commit -q -m base
g remote add origin "$T/origin.git"
g -c push.negotiate=false push -q origin main 2>/dev/null
g checkout -q -b feature
echo 'x' > "$T/wt/src/a.js"
echo 'head rewrites the review' > "$T/wt/docs/skills/vision-check.md"
g add -A && g commit -q -m change
HEAD_SHA=$(g rev-parse HEAD)
export HEAD_SHA

mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'FAKE'
#!/usr/bin/env bash
case "$1 $2" in
	"pr view")
		case "$*" in
			*headRefOid*) [ "${GH_STALE:-0}" = 1 ] && echo 0000000000000000000000000000000000000000 || echo "$HEAD_SHA" ;;
			*baseRefName*) echo main ;;
			*) exit 1 ;;
		esac ;;
	"pr comment")
		while [ $# -gt 0 ]; do [ "$1" = --body-file ] && cp "$2" "$GH_T/comment.md"; shift; done
		echo "https://example.invalid/comment" ;;
	"api "*)
		case "$*" in
			*"/statuses/"*" -f state="*) for a in "$@"; do case "$a" in state=*) echo "${a#state=}" >> "$GH_T/statuses" ;; esac; done ;;
			*"-X DELETE "*)
				name=$(printf '%s' "$4" | sed 's|.*/labels/||; s|%2F|/|')
				{ grep -vx "$name" "$GH_T/labels" || true; } > "$GH_T/labels.tmp"; mv "$GH_T/labels.tmp" "$GH_T/labels" ;;
			*"/labels -f "*) echo "${4#labels[]=}" >> "$GH_T/labels" ;;
			*"/labels?"*) cat "$GH_T/labels" 2>/dev/null || true ;;
			*"issues?labels=gate/codex-pending"*) cat "$GH_T/pending" 2>/dev/null || true ;;
			*"issues?labels=gate/codex-approved"*) : ;;
			*"/pulls/"*"head.repo"*) echo "${GH_SAME_REPO:-true}" ;;
			*"/pulls/"*) echo "$HEAD_SHA" ;;
			*"/check-runs"*) cat "$GH_T/checks" ;;
			*) exit 1 ;;
		esac ;;
	*) exit 1 ;;
esac
FAKE
# Fake codex: writes $CODEX_RESULT to the -o argument. CODEX_TOUCH=1 changes a tracked file.
cat > "$T/bin/codex" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$GH_T/codex-args"
out="" dir=""
while [ $# -gt 0 ]; do
	case "$1" in -o) out=$2 ;; -C) dir=$2 ;; esac
	shift
done
cat > "$GH_T/prompt.md"
for f in $(grep -o '[^`]*/base/docs/skills/vision-check.md' "$GH_T/prompt.md"); do cp "$f" "$GH_T/seen-skill.md"; done
[ "${CODEX_TOUCH:-0}" = 1 ] && echo changed >> "$dir/src/a.js"
printf '%s\n' "$CODEX_RESULT" > "$out"
FAKE
chmod +x "$T/bin/gh" "$T/bin/codex"
export PATH="$T/bin:$PATH" GH_T="$T" CODEX_GATE_HEAD_TIMEOUT=0 CODEX_GATE_HEAD_INTERVAL=0

result() { # result <verdict> <tier> <requirement>
	jq -n --arg v "$1" --argjson t "$2" --arg r "$3" '{verdict: $v, principle: 2, tier: $t, requirements: [$r], default_behavior: "none",
		evidence: ["git diff"], unverified: ["none"], security: "none", unexpected_files: "none", tests: "present", risk: "none",
		citations: ["src/a.js:1"], findings: []}'
}
reset() { rm -f "$T/comment.md" "$T/statuses" "$T/labels"; g checkout -q -- . ; }
run_gate() { rc=0; out=$(cd "$T/wt" && "$HERE/codex-gate.sh" 7 "$T/wt" 2>&1) || rc=$?; }

reset; CODEX_RESULT=$(result fits 1 R1.1) run_gate
if [ "$rc" -eq 0 ] && grep -q '^<!-- agent:review -->' "$T/comment.md" && grep -q "\"sha\":\"$HEAD_SHA\"" "$T/comment.md" \
	&& grep -q '"reviewer":"codex"' "$T/comment.md" && [ "$(tail -1 "$T/statuses")" = success ] && [ "$(cat "$T/labels")" = gate/codex-approved ]; then
	pass "gate: fits posts a valid record, success and gate/codex-approved"
else bad "gate: fits (exit $rc): $out"; fi
if node "$HERE/check-record.mjs" "$T/comment.md" --sha "$HEAD_SHA" | grep -q 'Counts as an approval'; then
	pass "gate: the posted comment passes check-record.mjs"
else bad "gate: posted comment is no valid record"; fi

if grep -q 'Review instruction of the base branch' "$T/prompt.md" && grep -qx 'base docs/skills/vision-check.md' "$T/seen-skill.md"; then
	pass "gate: Codex gets the review instruction of the base branch, not the head"
else bad "gate: base review instruction ($(cat "$T/seen-skill.md" 2>/dev/null))"; fi
if grep -q 'project_doc_max_bytes=0' "$T/codex-args" && grep -q 'workspace-write' "$T/codex-args" && ! grep -q 'network' "$T/codex-args"; then
	pass "gate: Codex loads no AGENTS.md of the head and gets no network flag"
else bad "gate: codex arguments ($(cat "$T/codex-args"))"; fi

reset; CODEX_RESULT=$(result needs-owner 3 R1.1) run_gate
if [ "$rc" -eq 1 ] && [ -f "$T/comment.md" ] && [ "$(tail -1 "$T/statuses")" = failure ] && [ "$(cat "$T/labels")" = gate/owner ]; then
	pass "gate: needs-owner posts the record, failure and gate/owner"
else bad "gate: needs-owner (exit $rc): $out"; fi

reset; CODEX_RESULT=$(result conflicts 2 R1.1) run_gate
if [ "$rc" -eq 1 ] && [ "$(cat "$T/labels")" = gate/codex-changes ]; then
	pass "gate: conflicts sets gate/codex-changes"
else bad "gate: conflicts (exit $rc): $out"; fi

reset; CODEX_RESULT=$(result fits 1 R9.9) run_gate
if [ "$rc" -eq 2 ] && [ ! -f "$T/comment.md" ] && [ "$(tail -1 "$T/statuses")" = error ] && grep -q 'not in the specification: R9.9' <<<"$out"; then
	pass "gate: a requirement outside the base specification posts nothing"
else bad "gate: invalid record (exit $rc): $out"; fi

reset; CODEX_RESULT='not json' run_gate
if [ "$rc" -eq 2 ] && [ ! -f "$T/comment.md" ]; then pass "gate: no structured result posts nothing"; else bad "gate: no structured result (exit $rc): $out"; fi

reset; CODEX_TOUCH=1 CODEX_RESULT=$(result fits 1 R1.1) run_gate
if [ "$rc" -eq 2 ] && [ ! -f "$T/comment.md" ] && grep -q 'changed tracked files' <<<"$out"; then
	pass "gate: a reviewer that changes tracked files fails the gate"
else bad "gate: tracked change (exit $rc): $out"; fi
reset

GH_STALE=1 CODEX_RESULT=$(result fits 1 R1.1) run_gate
if [ "$rc" -eq 2 ] && grep -q 'is not the head' <<<"$out"; then pass "gate: a worktree off the PR head does not run"; else bad "gate: stale head (exit $rc): $out"; fi

rc=0; "$HERE/gate-label.sh" 7 merged >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 64 ] && pass "label: unknown state is a usage error" || bad "label: unknown state (exit $rc)"
reset; echo gate/codex-changes > "$T/labels"
"$HERE/gate-label.sh" 7 codex-pending >/dev/null && [ "$(cat "$T/labels")" = gate/codex-pending ] \
	&& pass "label: one gate label replaces the other" || bad "label: replace"

echo 7 > "$T/pending"
printf 'success\nskipped\n' > "$T/checks"
out=$(cd "$T/wt" && "$HERE/codex-queue.sh" --dry-run 2>&1) || true
grep -q "would review #7 at ${HEAD_SHA:0:7}" <<<"$out" && pass "queue: a pending PR with green CI is reviewed" || bad "queue: green ($out)"
printf 'success\npending\n' > "$T/checks"
out=$(cd "$T/wt" && "$HERE/codex-queue.sh" --dry-run 2>&1) || true
grep -q 'CI is not green yet; label kept' <<<"$out" && pass "queue: a pending PR waits for green CI" || bad "queue: not green ($out)"
printf 'success\n' > "$T/checks"
out=$(cd "$T/wt" && GH_SAME_REPO=false "$HERE/codex-queue.sh" --dry-run 2>&1) || true
grep -q 'head outside this repository' <<<"$out" && ! grep -q 'would review' <<<"$out" && pass "queue: a fork head is not reviewed" || bad "queue: fork ($out)"
rc=0; (cd "$T/wt" && "$HERE/codex-queue.sh" --now >/dev/null 2>&1) || rc=$?
[ "$rc" -eq 64 ] && pass "queue: unknown option is a usage error" || bad "queue: usage (exit $rc)"

exit "$fail"
