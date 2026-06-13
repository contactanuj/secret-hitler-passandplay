# Secret Hitler — Pass &amp; Play (Android)

A single-device, **pass-and-play** implementation of the social-deduction game
*Secret Hitler*, packaged as an Android APK with Expo + a WebView (the same shell
pattern as `wink-killer-expo`). One phone is passed around the table; the app
handles secret role dealing, the policy deck, executive powers, term limits, the
election tracker, and all win conditions. **You bring the table talk.**

This is the **offline / in-person** app. A separate **"Secret Hitler Online"**
APK (networked multiplayer, each player on their own phone) will reuse the same
rules engine over a Firebase transport — see *Architecture* below.

---

## Architecture: one engine, (eventually) two transports

```
assets/sh-engine.js   Pure rules engine. No DOM, no network. Deterministic given
                      a seed (state.rngState). JSON-serializable state. This is
                      the single source of truth for the rules and is reused
                      verbatim by the future online APK.
assets/ui.js          Pass-and-play DOM UI: screens, device-handoff gating.
assets/styles.css     Theme.
build.js              Inlines styles.css + sh-engine.js + ui.js into one
                      self-contained assets/app.html (the WebView loads a single
                      HTML string, so nothing can be an external file).
App.js                Expo shell: loads assets/app.html into a react-native-webview.
tests/                Node tests (no dependencies) — see "Tests".
```

Why a build step instead of one hand-written `app.html`? So the **rules engine is
a standalone, unit-testable module** (full games are simulated in Node) and can be
**reused** by the online app — neither of which a giant inline HTML allows.

### Build &amp; run

```bash
npm install
npm run build:html      # regenerate assets/app.html from the source modules
npm start               # build + expo start (scan QR with Expo Go)
npm run build:android   # build + EAS preview APK
```

`npm start` / `npm run android` / `npm run build:android` all run `build:html`
first, so `app.html` is always fresh. **If you edit `sh-engine.js`, `ui.js`, or
`styles.css`, run `npm run build:html`** (or any of the above) before testing in
the app.

### Tests

```bash
npm test
```

- `tests/engine.test.js` — config validation + targeted rules checks (term
  limits, chaos, Hitler-as-Chancellor win, executing Hitler, special-election
  rotation, veto) + **fuzz: 240 full random-but-legal games** (5–10 players)
  asserting termination and invariants.
- `tests/ui.smoke.test.js` — stubs a minimal DOM and drives **complete games
  through the real UI action layer** across all three voting modes, catching
  UI↔engine wiring bugs.

(Independent sanity check: random play lands at ~75% Fascist wins, matching the
reference online game's bot simulations — Secret Hitler genuinely favors Fascists.)

---

## Configuration ("maximum configurable, but validated")

In **New game → Advanced configuration** you can edit, with live validation:

- Player count (5–10 official; 2–15 allowed and **warned** as off-spec).
- Role split (Liberals / Fascists; Hitler is always 1) — must sum to the count.
- Whether Hitler knows the Fascists (the night-phase rule).
- Policy deck composition (default 6 Liberal / 11 Fascist).
- Win thresholds (5 Liberal / 6 Fascist), and the Hitler-as-Chancellor threshold.
- Failed elections before chaos (default 3); veto unlock (default 5).
- The Fascist board's power in each slot.
- **Voting mode** (see below) and whether individual votes are revealed.

**Validation is the point**, not just sliders: combinations that would produce an
illegal/unwinnable game are **blocked** (errors); off-spec-but-playable ones are
**warned** but allowed. The game will not start a game it cannot legally finish.

### Voting modes

Votes in Secret Hitler are **public** by the rules, so the phone does **not** need
to be passed to vote. Pick how the table votes:

- **Table vote** *(default)* — everyone votes IRL (hands/cards) simultaneously;
  you tap **Passed / Failed** (optionally log the exact tally). Fastest, most
  faithful. The phone is still passed only for genuinely hidden info (roles, the
  policy draw, investigate/peek).
- **Open** — tap each player's vote on one shared screen; the app tallies.
- **Secret** — pass-and-play: each player votes privately, revealed together
  (for groups with no physical cards who want enforced simultaneity).

`Reveal individual votes` is **on** by default (official). Turning it off is an
**anonymous-vote house rule** — flagged by validation, because hiding votes
removes key deduction information.

---

## Experience & polish

- **One-tap rule sets** on the New Game screen: *Official*, *Beginner* (table
  voting + guidance), *Fast* (chaos after 2 failed elections), *Tense* (secret
  voting). Each only tweaks balance-safe knobs, so it's always valid.
- **Guided tips** (Settings → Guidance tips): contextual hints on every phase for
  new groups. On automatically with the Beginner rule set.
- **Atmosphere**: dramatic role-reveal flip, win banners, suspense animations, and
  optional **synthesized sound** (no audio files — generated via WebAudio, fully
  toggleable).
- **Clarity aids**: always-visible board with "needs N more to win", the live
  Hitler-as-Chancellor danger warning, and optional **confirmed-not-Hitler
  markers** (players proven safe by surviving the Chancellor check).
- **Post-game recap**: a timeline of the key public events, plus per-device
  **stats** (games played, Liberal vs Fascist wins).
- **Resumable**: an in-progress game survives app reloads; resume from Home.

All of this lives in the UI layer; the rules engine stays pure and headless-tested.

## Bots (AI players)

Set **Bots** in New Game to fill the last N seats with AI — useful below 5 humans,
for learning, or an all-bot demo. Bots:

- play every decision automatically (nominate, vote, legislate, veto, all powers,
  including the Communist powers) via `assets/sh-bot.js` — a pure, faction-aware
  brain that reasons from the bot's legitimate night-phase knowledge plus a public
  suspicion score derived from the enactment history;
- are skipped in the night reveal and vote programmatically (so **voting goes
  on-device** when bots are present — table voting needs an all-human table);
- act after a short delay so humans can follow, and are marked `AI` on the board.

> Current balance: bot-vs-bot sims favour Liberals (~60%); the fascist heuristics are
> deliberately simple and a known tuning target. Bots play legally in every config.

## Roadmap

- **Phase 2 — Communist / Secret Hitler XL expansion** — ✅ shipped (opt-in third
  faction: Communist track + Bugging / Radicalisation / Confession / Five-Year Plan).
- **Bots** — ✅ shipped (`sh-bot.js`).
- **Bot tuning** — fascist heuristics are simple; bot-vs-bot currently favours
  Liberals. A stronger fascist/Hitler strategy is the next quality pass.
- **Possible future**: Congress power (communist re-acknowledge), more roles,
  online multiplayer (separate "Secret Hitler Online" APK reusing this engine).

---

## ⚠️ Licensing — read before distributing

*Secret Hitler* is created by Mike Boxleiter, Tommy Maranges, and Mac Schubert and
licensed **Creative Commons BY-NC-SA 4.0**. That license is **non-commercial** and
its terms state you **may not submit anything using the game to an app store
without the creators' approval**.

Practical consequences for this project:
- Fine for personal / private / non-commercial use and sideloaded APKs.
- **Do not sell it or publish to Google Play / the App Store** without permission.
- Any derivative must keep the **same BY-NC-SA license** and credit the creators.

This app ships **no official Secret Hitler artwork** — only original code and a
plain themed UI — to keep the asset side clean. See `creativecommons.org/licenses/by-nc-sa/4.0`.

### App icon
`assets/icon.png` is an **original** 1024×1024 mark — two fanned policy cards (blue
**L**iberal + red **F**ascist) in the game's own colours, on the warm brand
background, sized inside the adaptive-icon **safe zone** so launcher masks never clip
it. It's generated with **zero dependencies** by `npm run icon` (`tools/make-icon.js`
— pure Node + built-in zlib, SDF rasteriser). Tweak the design constants there and
re-run to regenerate.
