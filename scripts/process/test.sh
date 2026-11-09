#!/usr/bin/env bash
# Tests of the process tools (docs/process.md). Runs from any directory, needs bash, node and jq.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
fx="$here/fixtures"
scripts="$here"
fail=0
pass() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

# expect <name> <exit code> <output pattern or empty> -- <command...>
expect() {
	local name=$1 code=$2 pattern=$3; shift 4
	local out rc=0
	out=$("$@" 2>&1) || rc=$?
	if [ "$rc" -ne "$code" ]; then bad "$name (exit $rc, want $code): $out"; return; fi
	if [ -n "$pattern" ] && ! grep -qE "$pattern" <<<"$out"; then bad "$name (output: $out)"; return; fi
	pass "$name"
}

sha=8fc7dde4c8183fbc1d346c5c565dab358bfe8063
rec() { node "$scripts/check-record.mjs" "$@"; }

expect "record: valid, approval" 0 'Counts as an approval' -- rec "$fx/valid-record.md" --sha "$sha" --spec "$fx/spec.md"
expect "record: legacy styleguide marker still reads" 0 'Counts as an approval' -- rec "$fx/legacy-styleguide-record.md" --sha "$sha"
expect "record: identifier must exist in the base source" 1 'not in the specification: R99.9' -- rec "$fx/wrong-requirement.md" --spec "$fx/spec.md"
expect "record: other head SHA" 1 'differs from the head SHA' -- rec "$fx/valid-record.md" --sha 0000000000000000000000000000000000000000
expect "record: short SHA" 1 'sha must be 40 hex' -- rec "$fx/bad-sha.md"
expect "record: Tier 3 is valid but no approval" 0 'Not an approval: verdict is needs-owner. tier is 3.' -- rec "$fx/needs-owner.md"
expect "record: marker required" 1 'not the marker' -- rec "$fx/no-marker.md"
expect "record: custom identifier pattern" 1 'not in the specification' -- rec "$fx/valid-record.md" --spec "$fx/spec.md" --pattern '^(ADR-[0-9]{4})'
expect "record: a line range is a citation" 0 'Counts as an approval' -- rec "$fx/range-citation.md"
expect "record: prose is not a citation" 1 'not path:line' -- rec "$fx/prose-citation.md"
expect "record: usage" 2 'Usage' -- rec

expect "decision: well-formed" 0 '"recommended":1' -- "$scripts/check-decision-request.sh" --json "$fx/decision-good.md"
expect "decision: gaps listed" 1 "1 options; a request has 2 to 4" -- "$scripts/check-decision-request.sh" "$fx/decision-bad.md"

expect "config: reads a key" 0 '^composer install$' -- env PROJECT_CONF="$fx/project.conf" "$scripts/project-config.sh" setup
expect "config: default for a missing key" 0 '^none$' -- env PROJECT_CONF="$fx/project.conf" "$scripts/project-config.sh" design_files --default none
expect "config: this repository sets gate, setup and spec" 0 '^docs/specification.md$' -- env PROJECT_CONF="$root/.agent/project.conf" "$scripts/project-config.sh" spec
expect "config: a repeated key is an error" 2 'twice' -- env PROJECT_CONF="$fx/project-dup.conf" "$scripts/project-config.sh" gate

# One marker, one home: the record marker in the standard, the skill and the validator agree.
for f in docs/process.md docs/skills/vision-check.md scripts/process/records.mjs; do
	grep -q '<!-- agent:review -->' "$root/$f" && pass "$f names the record marker" || bad "$f does not name <!-- agent:review -->"
done

exit "$fail"
