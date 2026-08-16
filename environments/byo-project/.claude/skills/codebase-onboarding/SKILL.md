---
name: codebase-onboarding
description: >-
  Orient yourself in an UNFAMILIAR existing codebase before making changes. Use
  at the start of any byo-project session and whenever you land in a repo you
  haven't mapped yet: read its docs, map the structure, detect the stack, and —
  critically — find and verify the install / dev / test commands. Produces a
  short orientation you report back, and (only if the repo lacks one) a starter
  AGENTS.md. Do NOT use for greenfield/scaffolding — this is for a repo that
  already exists.
---

# Codebase onboarding

You have been dropped into the user's **existing** repo at `~/work` (they brought
it in — it is not a template you scaffolded). Orient before you touch anything.
Guessing the structure or the test command wastes the user's time and erodes
trust. Work the phases in order; keep it fast.

## Phase 0 — Respect what's already there (read first, in this order)

The repo's own instructions **win** over any default you'd reach for. Read
whichever of these exist, before forming any plan:

1. `README*` — what the project is, how to run it.
2. `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md` —
   agent/house rules the maintainers already wrote. **Follow them.**
3. `CONTRIBUTING*` — conventions, required checks, commit/PR expectations.
4. `.editorconfig`, linter/formatter config (`.prettierrc`, `eslint`, `ruff`,
   `rustfmt`, etc.) — match the existing style; never introduce a new formatter.

If the repo already documents its own conventions, adopt them silently — don't
re-derive or override them.

## Phase 1 — Recon (map, don't read everything)

- List the top level and the primary source dir. Identify the **entry point(s)**.
- Detect the **stack + package manager** from the manifest: `package.json`
  (npm/pnpm/yarn — check the lockfile), `pyproject.toml`/`requirements.txt`,
  `Cargo.toml`, `go.mod`, `Gemfile`, etc. Note the language(s) and framework.
- Skim the directory names to infer architecture (routes/, services/, packages/,
  cmd/, tests/…). Use glob/grep for breadth; open files only to confirm a guess.
- Note how it's configured: `.env.example`, config files, required services
  (a database? Redis? external APIs?).

## Phase 2 — Make it run (the highest-value step)

An agent that can't run the project is guessing. Before proposing work:

- **Install dependencies** with the detected package manager.
- **Find the real commands** — read the manifest's scripts / Makefile / CI config
  (`.github/workflows/*`) for the canonical `build`, `test`, `lint`, and dev/run
  commands. CI is the source of truth for "what green looks like."
- **Run the test suite** (or a fast subset) and note whether it passes as-is. If
  it doesn't run cleanly out of the box, that's your first finding to report —
  don't start changing code on top of a broken baseline.
- If setup is non-obvious or something fails, glance at `~/.podbay-setup.log`.

## Phase 3 — Report back (short, then hand control to the user)

Give the user a tight orientation — a few lines, not an essay:

- **What it is** — one sentence.
- **Stack + how it's laid out** — the 3–5 dirs that matter and what lives where.
- **How to run + test it** — the exact commands you verified.
- **State** — do tests pass now? anything already broken or notable?

Then ask what they want to work on. Do not start changing code until they choose.

## Capture what you learned (so no session re-discovers it)

Persist the **verified, durable** findings into the repo's agent memory so the
next session starts oriented instead of re-auditing. This is the payoff of the
audit — don't skip it.

**What to capture** (only things you actually verified this session):
- The **install / dev / test / build / lint commands** — exactly as they work.
- A short **architecture map** — the handful of dirs that matter + entry points.
- **Required services + env vars** (a database? `.env.example` keys?).
- **Conventions** worth flagging (commit style, formatter, test layout).

**Where:**
- If the repo already has a `CLAUDE.md` or `AGENTS.md`, **enhance it** — add or
  refresh a single clearly-marked section (e.g. `## Build & run (verified by
  podbay)`); preserve everything already there, never rewrite the maintainer's
  content or their conventions.
- If it has neither, create a short `AGENTS.md` (works for Claude and Codex).

**How — ASK FIRST, always.** These are the maintainer's files; never modify them
unsolicited. Before writing: **show the user the exact text you'd add and which
file it goes in**, explain why (one line), and **wait for an explicit yes.** Only
then write. If they say no, keep the findings in the conversation and move on.
Never commit or push the change yourself (that's the gated `open-pr` flow).
Capture facts only — do not invent rules or conventions the repo doesn't follow.

## Recommend (don't inject) enrichments

You come with a set of dev skills (TDD, debugging, code-review, git, PR). If the
repo already has its own agent config (`.claude/skills`, `AGENTS.md`, `.cursorrules`),
**defer to it** — it wins. Where discovery shows a genuine gap (e.g. the repo has
no test-running guidance and you found a real test suite), you may **recommend** —
"based on what I found, X would help; want it?" — and let the user decide. Offer,
never impose: don't silently add skills, rules, or docs to their repo.

## Never

- Never assume greenfield, rewrite the layout, or "clean up" conventions you find.
- Never run destructive or stateful commands (migrations, `git clean`, deleting
  files, resetting a DB) as part of orientation.
- Never claim the project runs/tests a certain way until you've actually run it.
