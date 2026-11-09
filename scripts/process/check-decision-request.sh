#!/usr/bin/env bash
# Check a decision request against the fixed format of AGENTS.md
# "Decision requests" (#824). Lines it does not know are free context.
# Usage: scripts/agent/check-decision-request.sh [--json] <file>
# Exit:  0 well-formed (with --json, the parsed request on stdout),
#        1 gaps (one per line on stdout), 2 usage.
set -euo pipefail

MARKER='<!-- agent:decision-request -->'

json=0
if [ "${1:-}" = --json ]; then json=1; shift; fi
if [ $# -ne 1 ] || [ ! -f "$1" ]; then
	echo "usage: check-decision-request.sh [--json] <file>" >&2
	exit 2
fi
file=$1

marker=0 question="" recommended="" reason="" has_rec=0 has_reason=0
labels=() consequences=() gaps=()
count=0

# The first separator wins: an em dash, then an en dash, then a spaced hyphen.
split_option() {
	local text=$1 sep
	for sep in ' — ' ' – ' ' - '; do
		if [[ "$text" == *"$sep"* ]]; then
			SPLIT_LABEL=${text%%"$sep"*}
			SPLIT_REST=${text#*"$sep"}
			return 0
		fi
	done
	return 1
}

while IFS= read -r line || [ -n "$line" ]; do
	line=${line%$'\r'}
	if [ "$line" = "$MARKER" ]; then marker=1; continue; fi
	# A blank line after the request lines starts the free context.
	if [ -n "$question" ] && [[ "$line" =~ ^[[:space:]]*$ ]]; then break; fi
	if [[ "$line" =~ ^Question:[[:space:]]*(.*[^[:space:]].*)$ ]] && [ -z "$question" ]; then
		question=${BASH_REMATCH[1]}
	elif [[ "$line" =~ ^Option[[:space:]]+([0-9]+):[[:space:]]*(.*)$ ]]; then
		count=$((count + 1))
		n=${BASH_REMATCH[1]} text=${BASH_REMATCH[2]}
		[ "$n" -eq "$count" ] || gaps+=("option $count is numbered $n")
		if split_option "$text"; then
			labels+=("$SPLIT_LABEL") consequences+=("$SPLIT_REST")
		else
			gaps+=("option $count has no ' — ' or ' - ' between label and consequence")
			labels+=("$text") consequences+=("")
		fi
	elif [[ "$line" =~ ^Recommended:[[:space:]]*(.*)$ ]] && [ "$has_rec" -eq 0 ]; then
		has_rec=1 recommended=${BASH_REMATCH[1]}
	elif [[ "$line" =~ ^Reason:[[:space:]]*(.*[^[:space:]].*)$ ]] && [ "$has_reason" -eq 0 ]; then
		has_reason=1 reason=${BASH_REMATCH[1]}
	fi
done < "$file"

[ "$marker" -eq 1 ] || gaps+=("no $MARKER marker")
[ -n "$question" ] || gaps+=("no 'Question:' line")
if [ "$count" -lt 2 ] || [ "$count" -gt 4 ]; then
	gaps+=("$count options; a request has 2 to 4")
fi
if [ "$has_rec" -eq 0 ]; then
	gaps+=("no 'Recommended:' line")
elif ! [[ "$recommended" =~ ^[0-9]{1,2}$ ]] || [ "$recommended" -lt 1 ] || [ "$recommended" -gt "$count" ]; then
	gaps+=("'Recommended: $recommended' names no option")
fi
[ "$has_reason" -eq 1 ] || gaps+=("no 'Reason:' line")

if [ "${#gaps[@]}" -gt 0 ]; then
	printf '%s\n' "${gaps[@]}"
	exit 1
fi

if [ "$json" -eq 1 ]; then
	options=$(for i in "${!labels[@]}"; do
		jq -cn --argjson n $((i + 1)) --arg l "${labels[$i]}" --arg c "${consequences[$i]}" \
			'{n: $n, label: $l, consequence: $c}'
	done | jq -cs .)
	jq -cn --arg q "$question" --argjson o "$options" --argjson r "$recommended" --arg why "$reason" \
		'{question: $q, options: $o, recommended: $r, reason: $why}'
fi
