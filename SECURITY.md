# Security Policy

## Scope

This is an **offline, single-device** game app. It has:

- no backend, no network calls, no accounts, no analytics;
- no collection or transmission of personal data;
- local persistence only (game state, settings, and per-device stats in the
  WebView's `localStorage`).

The realistic attack surface is therefore small. The most relevant "security-like"
concerns are **information-leak bugs** specific to a hidden-role game - e.g. a UI
that reveals a secret role on a shared screen. We treat those as high-priority
defects (see below).

## Reporting a vulnerability

Please **do not** open a public issue for a sensitive report. Instead, use GitHub's
**private vulnerability reporting** ("Report a vulnerability" under the Security tab)
if enabled, or contact the maintainers privately through the channel listed in the
repository profile.

When reporting, include:

- a description of the issue and its impact,
- steps to reproduce,
- affected version / commit.

We aim to acknowledge reports within a reasonable time and to address confirmed
issues in a timely manner.

## Hidden-information bugs

If you find a case where the app reveals secret information it shouldn't (a role, a
drawn policy, an investigation/bugging result, a vote before reveal, a radicalised
player's new allegiance) on a screen visible to other players, please report it -
these directly affect game integrity and are prioritized like security bugs.

## Keystores & secrets

Never commit signing keystores, `credentials.json`, or API tokens. These are
git-ignored. The release signing key must be kept private by the maintainer.

## Dependency advisories

Dependabot alerts and security updates are enabled, and `.github/dependabot.yml`
schedules weekly grouped dependency-update PRs.

Context for the remaining `npm audit` / Dependabot findings: the shipped app is a
WebView that loads the self-contained `assets/app.html` (original code only), so the
npm packages are **build-time / local-dev tooling**, not runtime code in the APK.

- `eas-cli` has been removed from `devDependencies` (run it via `npx eas-cli`),
  which eliminated the critical/high advisories that lived in its dependency tree.
- The advisories that remain are transitive dependencies inside **Expo SDK 51's**
  CLI/build tooling (Metro, prebuild, the React Native community CLI, xcode/plist/
  xmldom, etc.). `npm audit fix` already applies every non-breaking fix; the rest are
  resolvable only by a **major Expo SDK upgrade** (51 -> current), which is tracked as
  deliberate future work because it must be migrated and re-tested against a device.
- None of these are reachable from the running game (no server, no network, offline).
