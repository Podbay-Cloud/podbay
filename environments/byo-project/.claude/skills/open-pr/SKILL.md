---
name: open-pr
description: >-
  Push a branch and open a pull request from a headless pod using the gh CLI,
  with a MANDATORY confirmation gate before anything leaves the machine. Use when
  the user wants to open a PR for work on THEIR OWN repo. Pairs with
  finishing-a-development-branch (which prepares the commit). Never force-pushes,
  never runs `git add .`, never opens a PR without an explicit yes.
---

# Open a pull request (headless pod)

The pod has no browser, so PRs are opened with the `gh` CLI. Remote git is the one
place a mistake is hard to undo — so this skill is built around an explicit human
gate. This is for the user's **own** repo (they have push access). Contributing to
someone else's repo is the separate OSS-contribution flow, not this skill.

## Preconditions (verify, don't assume)

- `gh auth status` is authenticated. If not, tell the user to connect GitHub —
  do not attempt to authenticate on their behalf.
- You are on a feature branch, not the default branch. If on `main`/`master`,
  create a branch first (`git switch -c <descriptive-name>`).
- Tests were run and the working tree contains only the intended changes. If
  `finishing-a-development-branch` already prepared the commit, reuse that.

## The flow — confirm BEFORE anything leaves the machine

1. **Stage precisely.** Stage the specific files you changed by path. **Never
   `git add .` / `git add -A`** — it sweeps in stray files, secrets, or local
   config. Show the user `git status` + a diff summary.
2. **Commit** with a clear message that matches the repo's existing commit style
   (check `git log`). Don't invent a convention the repo doesn't use.
3. **STOP and confirm the push.** Show the user: the branch, the target remote,
   the commit(s), and the files. Ask for an explicit "yes" to push. Do not push
   until they say so.
4. **Push** the branch: `git push -u origin <branch>`. **Never force-push**
   (`--force` / `-f` / `--force-with-lease`) unless the user explicitly asks and
   understands why — and even then, prefer they run it themselves.
5. **STOP and confirm the PR.** Draft the PR title + body (summary, what changed,
   how it was tested). Show it to the user. Ask for an explicit "yes", and ask
   whether it should be a **draft** (default to draft for anything non-trivial).
6. **Open it:** `gh pr create --title "…" --body "…" [--draft] [--base <branch>]`.
   Report the URL back.

## After

- Report the PR URL and its checks status (`gh pr checks`).
- If CI fails, surface the failure; fix on the same branch and push again (with a
  fresh confirm) — don't open a second PR.

## Never

- Never push or open a PR without the explicit confirmation gate above.
- Never force-push, never `git add .`, never commit secrets or `.env` files.
- Never open multiple competing PRs for the same work.
- Never edit git history on a shared/default branch.
