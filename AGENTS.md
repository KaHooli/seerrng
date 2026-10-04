# Agent Instructions — SeerrNG (KaHooli fork)

## Communication contract

These rules apply to all model interfaces using this repository:

- Never praise questions or validate premises before answers.
- Correct mistaken premises directly; do not capitulate without new evidence.
- Assess numbers independently instead of anchoring on a supplied estimate.
- Use explicit confidence levels for claims, recommendations and estimates:
  `high`, `moderate`, `low`, or `unknown`.
- Do not add disclaimers, unsolicited ethics lectures, or formulaic hedges.
- Surface negative conclusions directly; optimize for accuracy, not approval.
- If you do not know, say so. Never fabricate.

## How this fork is maintained

This fork has one owner, who does not write or review code. All code changes
are made by AI agents, and **the automated test suite is the reviewer**. There
is no human code review step, so:

- Agents may open, update, and merge pull requests into `main` once every
  required CI check is green. No human approval is needed.
- Upstream sync pull requests (from `snapetech/seerrng`) are merged
  automatically by the daily sync routine when CI is green. "Green" means
  every check on the PR's latest commit passed or was skipped, with one
  exception: a CodeQL failure whose alerts all sit in upstream code the fork
  has not changed may be merged, listing those alerts in the PR and the
  report. Any other failure is fixed on the PR branch first; never merge red.
- Ask the owner only for decisions that change behaviour they would notice
  (removing a feature, changing defaults, data loss risk), not for code review.
- Never deploy to or change the owner's live server (Unraid containers, DNS,
  Traefik, Cloudflare) without the owner asking for it in the current
  conversation.
- Explain outcomes in plain language: what changed for the person using
  SeerrNG, what was verified, and what was not.

Upstream's `CONTRIBUTING.md` describes upstream's contribution policy. It does
not apply to work inside this fork, and agents must not open pull requests
against `snapetech/seerrng`.

## Because CI is the reviewer

With no human reviewer, the tests are the only safeguard. Therefore:

- Fix failures at their source. Never skip, delete, or weaken a test or
  assertion, disable a check, or add a blanket exclusion to get a green
  result. If an accepted behaviour change supersedes a check, replace it with
  an equally meaningful check in the same change and say why.
- Treat a failing test as real until proven otherwise; "flaky" is not a root
  cause.
- Never aim tests at live configuration, accounts, queues, or databases.
- Before merging, run the repository's own checks for the area you touched:
  `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, affected unit tests, and
  `pnpm current-batch:check` plus `pnpm ui-style:check` for UI changes.
- Database and settings migrations must be safe for the owner's existing
  data: keep existing migration names, never renumber shipped permission bits,
  and add a migration (with a test) whenever stored data must change.

## Fork features to preserve during upstream syncs

Resolve conflicts so both sides keep working. Fork-specific behaviour:

- Import lists, including the `MANAGE_IMPORT_LISTS` permission at bit 2^52
  (check upstream has not claimed that bit) and the import-list Trakt client
  at `server/api/trakt/importList.ts`.
- Theme packages, the admin default theme (Aurora), enforced theme, and the
  three-way light/dark/auto mode.
- The fork's deploy and Helm gating in `.github/workflows`, and
  `.github/codeql/codeql-config.yml`.
- This `AGENTS.md`, the absence of `.github/CODEOWNERS`, the short PR
  template, and the removed PR-template and `ai-generated` workflow jobs. When
  upstream changes those files, keep the fork's version.

## User interface work

`src/styles/globals.css` owns reusable appearance and layout; components use
its semantic classes rather than inline Tailwind presentation utilities. Read
`docs/maintainers/ui-style-standard.md` before changing shared UI, and keep the
standard, CSS, and its contract checks in sync. A build passing does not prove
the rendered page looks right; say so when a change was not checked visually.

## Release-note contract

Every user-facing feature, fix, security, operational, or documentation change
needs a new structured fragment under `release-notes/`, following
`release-notes/README.md`. Fragments are append-only. Internal-only work selects
the internal-only box in the PR template (or writes `release-note: none`).
Upstream sync PRs that bring in upstream fragments select the fragment box, not
internal-only: CI's contract rejects internal-only when the diff adds
fragments, and reads the PR body only on push, so a wrong box needs a new push.
Preview notes with `pnpm release-notes:preview --base <base> --head <head>`.
Changing release or tag history also requires
`node scripts/check-changelog-tags.mjs`.
