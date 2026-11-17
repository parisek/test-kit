# Codex gate

The Codex review of a pull request runs on the owner's machine (`docs/process.md`, section 5). The scripts in `scripts/process/` run it without a person in the loop. The design comes from `portadesign/portadesign-mcp` (`scripts/agent/codex-gate.sh`, `codex-queue.sh`, `gate-label.sh`).

## What runs where

| Step | Who | Where |
| --- | --- | --- |
| Open a draft pull request, wait for green CI, post the Claude record | The agent that opened the pull request | Cloud session |
| Set `gate/codex-pending` (`scripts/process/gate-label.sh <PR> codex-pending`, or the label in GitHub) | The same agent | Cloud session |
| Review every `gate/codex-pending` pull request with green CI | `scripts/process/codex-queue.sh` | Owner's machine |
| Post the review record and set the commit status `review/codex` | `scripts/process/codex-gate.sh` | Owner's machine |
| Fix or rebut each finding, push, set `gate/codex-pending` again | The agent that opened the pull request | Cloud session |

The cloud agent learns the verdict from the record comment on its watched pull request. Nobody copies a record by hand.

## Rules the scripts keep

- Codex runs with `codex exec -s workspace-write -c approval_policy="never"`. The sandbox has no network. No script turns the network on.
- The prompt holds `scripts/process/codex-review-prompt.md`, the base branch and the head SHA. It holds no pull request title, body or comment (`docs/process.md`, section 4, reviewer rule 1).
- Codex runs with `project_doc_max_bytes=0`, so it loads no `AGENTS.md` of the PR head by itself. The queue cleans the shared worktree before each pull request.
- The specification, `.agent/project.conf` and the review instruction (`docs/skills/vision-check.md`, `docs/process.md`, `docs/vision.md`, `AGENTS.md`) come from the base branch. A change cannot add its own R-number or rewrite its own review.
- The queue runs `setup` in the PR worktree outside the Codex sandbox. Here it is `npm ci --ignore-scripts`, so no install script of the PR head runs. The queue reviews only heads in this repository, never a fork head.
- The gate posts at most 20 findings of at most 500 characters each.
- `mode`, `reviewer` and `sha` come from the script, never from the model.
- `check-record.mjs` checks the record before it is posted. An invalid record is not posted. The status is then `error` and the label stays.
- A reviewer that changes a tracked file fails the gate.
- The queue reviews a head only when every check run on it is green. A push after an approval voids it. The queue then reviews the new head.

## Labels

Exactly one `gate/*` label is on a pull request. The label is only the queue. The proof is the record and `review/codex` on the head SHA.

| Label | Meaning | Next step |
| --- | --- | --- |
| `gate/codex-pending` | Waits for the Codex gate | `codex-queue.sh` |
| `gate/codex-changes` | Codex found a conflict or a blocker | The author fixes or rebuts it |
| `gate/codex-approved` | The Codex record is an approval | The merge rule of `docs/process.md`, section 4 |
| `gate/owner` | Codex gave `needs-owner` | The owner |

## Exit codes

`codex-gate.sh`: 0 the record is an approval, 1 the record is posted but is no approval, 2 the gate could not run (nothing posted). `codex-queue.sh`: 0 done or empty, 1 a gate could not run (its label stays for the next run), 64 usage.

## Run it on the owner's machine

By hand, from the main checkout:

```bash
scripts/process/codex-queue.sh --dry-run   # list what it would review
scripts/process/codex-queue.sh
```

A Remote Control session runs the same command. Each `codex exec` call happens inside the script, so the session needs one permission for the script and none for Codex. `.claude/settings.json` of the repository holds the `allow` and `ask` lists of `portadesign/portadesign-mcp`, adapted to npm. Its PreToolUse guard hook (`guard-bash.sh`) and its SessionStart worktree prune are not ported yet:

- `allow`: `codex-gate.sh`, the test commands, `npm ci`, and read-only `git` and `gh` commands. There is no rule for a bare `codex exec`. `codex-queue.sh` and `gate-label.sh` ask first in a session; launchd or a person runs the queue.
- `ask`: `gh pr merge`, `gh release`, `git tag`, a force push, `git reset --hard`, `ssh` and `scp`. These always need the owner.

The scripts call `gh` for the GitHub API and `npm ci` (the `setup` key) for dependencies. Codex itself gets no network.

Every 15 minutes with launchd (macOS). Save as `~/Library/LaunchAgents/test-kit.codex-queue.plist`, change the path, then `launchctl load` it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>test-kit.codex-queue</string>
  <key>WorkingDirectory</key><string>/path/to/test-kit</string>
  <key>ProgramArguments</key><array><string>scripts/process/codex-queue.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>/tmp/test-kit-codex-queue.log</string>
  <key>StandardErrorPath</key><string>/tmp/test-kit-codex-queue.log</string>
</dict>
</plist>
```

The queue holds a lock (`.git/codex-queue.lock`), so two runs never overlap. It reviews in one shared worktree, `.claude/worktrees/codex-queue`. After a crash, remove the lock directory by hand.

## Not in scope

- The merge rule does not change. Tier 3 and security-relevant changes still wait for the owner.
- Tags and releases do not change. The owner pushes tags.
