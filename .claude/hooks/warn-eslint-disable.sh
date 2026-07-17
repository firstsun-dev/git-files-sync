#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): warns if the touched file contains an eslint-disable comment.
# Does not block the edit — see feedback memory "no lint-disable bypass".
set -euo pipefail

f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')

case "$f" in
*.ts | *.tsx | *.js | *.mjs) ;;
*) exit 0 ;;
esac

if [ -f "$f" ] && grep -q 'eslint-disable' "$f" 2>/dev/null; then
	jq -n --arg f "$f" \
		'{systemMessage: ("eslint-disable found in " + $f + " — fix the underlying lint issue instead of disabling the rule. If a disable is truly warranted, name the specific rule, add a one-line justification, and flag it to the user.")}'
fi
