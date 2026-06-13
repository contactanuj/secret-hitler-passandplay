# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-14

### Added

- **Core game**: full official Secret Hitler ruleset for 5–10 players — elections,
  term limits (incl. the 5-player exception), legislative session, the election
  tracker / chaos, all executive powers (Investigate, Special Election, Policy Peek,
  Execution), veto power, and all win conditions (policy tracks, Hitler elected
  after 3 Fascist policies, Hitler assassinated).
- **Pure rules engine** (`sh-engine.js`): deterministic (seeded RNG), JSON-
  serializable, fully headless-unit-tested.
- **Configurability with validation**: player count, role split, deck composition,
  win thresholds, board powers, election-tracker length, veto unlock, and
  Hitler-as-Chancellor threshold — illegal/unwinnable setups are blocked, off-spec
  ones warned.
- **Voting modes**: table (vote IRL, app records the result), open, and secret
  pass-and-play; optional anonymous (house-rule) voting.
- **Rule-set presets**: Official, Beginner, Fast, Tense.
- **Communist / "Secret Hitler XL"** third-faction variant (opt-in): Communist
  track and the Bugging, Radicalisation, Confession, and Five-Year Plan powers.
- **Bots** (`sh-bot.js`): faction-aware AI seats for sub-5-human, solo, or demo
  play; auto-play with on-screen delay.
- **Experience**: guided tips, role-reveal/win animations, synthesized sound
  (WebAudio, no asset files), post-game recap, and per-device stats.
- **Original app icon** generated with zero dependencies (`tools/make-icon.js`).
- **Tests**: engine fuzz (random, 3-faction, and bot-vs-bot full games) and a
  headless UI smoke test that drives complete games through the real UI.

### Fixed

- **Veto loop**: a refused veto could be re-proposed indefinitely
  (`legislative_chancellor ⇄ veto_consent`). A refused veto now forces the
  Chancellor to enact, per the official rules.
- **Nomination deadlock**: term limits are relaxed for an election if they would
  otherwise leave no eligible Chancellor (possible in small/custom games).

[1.0.0]: https://example.com/releases/1.0.0
