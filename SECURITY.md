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
