#!/usr/bin/env bash
# Print one value of the project configuration (#825): `key = value` lines in
# PROJECT_CONF, else .agent/project.conf at the top of the worktree. The file
# is parsed, never sourced. A repeated key or a line that is no pair is an error.
# Usage: scripts/agent/project-config.sh <key> [--default <value>]
# Exit:  0 printed, 1 key or file missing (and no default), 2 usage or bad file.
set -euo pipefail

[ $# -ge 1 ] || { echo "usage: project-config.sh <key> [--default <value>]" >&2; exit 2; }
key=$1 has_default=0 default=""
shift
while [ $# -gt 0 ]; do
	case "$1" in
		--default) [ $# -ge 2 ] || { echo "--default needs a value" >&2; exit 2; }; has_default=1 default=$2; shift 2 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

file=${PROJECT_CONF:-}
if [ -z "$file" ]; then
	top=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
	file="$top/.agent/project.conf"
fi

missing() {
	if [ "$has_default" -eq 1 ]; then printf '%s\n' "$default"; exit 0; fi
	echo "project-config: $1" >&2
	exit 1
}
[ -f "$file" ] || missing "no configuration file $file (needed for '$key')"

found=0 value="" n=0 seen=" "
while IFS= read -r line || [ -n "$line" ]; do
	n=$((n + 1))
	[[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
	if ! [[ "$line" =~ ^[[:space:]]*([a-z_][a-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
		echo "project-config: $file line $n is not 'key = value'" >&2
		exit 2
	fi
	k=${BASH_REMATCH[1]} v=${BASH_REMATCH[2]}
	# Any repeated key makes the file invalid, so every reader agrees on it.
	# A plain string, not an associative array: macOS ships bash 3.2.
	if [[ "$seen" == *" $k "* ]]; then
		echo "project-config: $file sets '$k' twice (line $n)" >&2
		exit 2
	fi
	seen="$seen$k "
	[ "$k" = "$key" ] || continue
	v=${v#"${v%%[![:space:]]*}"}
	value=${v%"${v##*[![:space:]]}"}
	found=1
done < "$file"

[ "$found" -eq 1 ] || missing "$file does not set '$key'"
printf '%s\n' "$value"
