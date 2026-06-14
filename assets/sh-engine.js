/*
 * sh-engine.js - Secret Hitler rules engine (pure, transport-agnostic).
 *
 * No DOM, no network. Deterministic given a seed, so it can be:
 *   - unit-tested in Node by simulating full games (tests/engine.test.js),
 *   - inlined into the pass-and-play app.html (this APK),
 *   - reused verbatim by the future "Secret Hitler Online" APK.
 *
 * State is a plain JSON-serializable object (survives localStorage / network sync).
 * Randomness uses a seeded PRNG stored on the state (state.rngState) so reshuffles
 * are reproducible and the whole game can be replayed from (config, seed).
 *
 * Rules implemented per the official Secret Hitler rulebook (BY-NC-SA 4.0).
 */
(function (root, factory) {
  var SH = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = SH;
  if (root) root.SH = SH;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Static data: per-player-count presets and fascist-board power layouts.
  // ---------------------------------------------------------------------------

  // Roles by player count. Hitler is always exactly 1 (not included in `fascists`).
  // `hitlerKnowsFascists` is true only for 5-6 players (small games).
  var PRESETS = {
    5:  { liberals: 3, fascists: 1, hitlerKnowsFascists: true,  board: '5-6' },
    6:  { liberals: 4, fascists: 1, hitlerKnowsFascists: true,  board: '5-6' },
    7:  { liberals: 4, fascists: 2, hitlerKnowsFascists: false, board: '7-8' },
    8:  { liberals: 5, fascists: 2, hitlerKnowsFascists: false, board: '7-8' },
    9:  { liberals: 5, fascists: 3, hitlerKnowsFascists: false, board: '9-10' },
    10: { liberals: 6, fascists: 3, hitlerKnowsFascists: false, board: '9-10' }
  };

  // Power granted when the Nth Fascist Policy is enacted (index 0 = 1st policy).
  // null = no power. The final slot is 'win' (6th Fascist Policy ends the game).
  var BOARDS = {
    '5-6':  [null, null, 'policy_peek', 'execution', 'execution', 'win'],
    '7-8':  [null, 'investigate', 'special_election', 'execution', 'execution', 'win'],
    '9-10': ['investigate', 'investigate', 'special_election', 'execution', 'execution', 'win']
  };

  var POWERS = ['investigate', 'special_election', 'policy_peek', 'execution'];

  // Communist / Secret Hitler XL expansion (opt-in: config.roles.communists > 0).
  // A third faction with its own policy track and powers. The standard game is
  // untouched when communists === 0.
  var COMMUNIST_POWERS = ['bugging', 'radicalisation', 'confession', 'five_year_plan'];
  var COMMUNIST_BOARD = ['bugging', 'radicalisation', 'confession', 'five_year_plan', 'win'];

  var POWER_LABELS = {
    investigate: 'Investigate Loyalty',
    special_election: 'Call Special Election',
    policy_peek: 'Policy Peek',
    execution: 'Execution',
    bugging: 'Bugging',
    radicalisation: 'Radicalisation',
    confession: 'Confession',
    five_year_plan: 'Five-Year Plan',
    win: 'Faction wins',
    null: 'No power'
  };

  // Named one-tap rule sets. Each only tweaks SAFE, balance-neutral knobs (never
  // roles/deck/board), so every preset is guaranteed valid for any player count.
  // `feel` flags are UI-only hints (tips/markers), not engine rules.
  var RULESETS = {
    official: { name: 'Official', desc: 'Standard rules, balanced for your player count.', cfg: {}, feel: { tips: false } },
    beginner: { name: 'Beginner', desc: 'Table voting + extra on-screen guidance for new groups.', cfg: { votingMode: 'table', revealVotes: true }, feel: { tips: true } },
    fast: { name: 'Fast', desc: 'Chaos after 2 failed elections - quicker, wilder games.', cfg: { electionTrackerMax: 2 }, feel: { tips: false } },
    tense: { name: 'Tense', desc: 'Secret on-device voting for maximum paranoia.', cfg: { votingMode: 'secret', revealVotes: true }, feel: { tips: false } }
  };

  // Returns a NEW config = base default for the player count + the ruleset's patch.
  function applyRuleset(baseConfig, key) {
    var rs = RULESETS[key] || RULESETS.official;
    var c = deepClone(baseConfig);
    var patch = rs.cfg || {};
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) c[k] = patch[k];
    return c;
  }

  // ---------------------------------------------------------------------------
  // Seeded PRNG (mulberry32) - deterministic + JSON-serializable via state.rngState.
  // ---------------------------------------------------------------------------

  function nextRand(state) {
    var t = (state.rngState = (state.rngState + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffleInPlace(state, arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(nextRand(state) * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // ---------------------------------------------------------------------------
  // Config construction + validation.
  // ---------------------------------------------------------------------------

  // Build a faithful default config for a player count (5-10 are official presets;
  // outside that range we synthesize a reasonable default and let validation warn).
  function defaultConfig(playerCount, names) {
    var pc = playerCount || 5;
    var preset = PRESETS[pc];
    var roles, hk, boardKey;
    if (preset) {
      roles = { liberals: preset.liberals, fascists: preset.fascists };
      hk = preset.hitlerKnowsFascists;
      boardKey = preset.board;
    } else {
      // Synthesized fallback for non-official counts: ~1/3 fascists (incl. Hitler).
      var fascTotal = Math.max(1, Math.round(pc / 3));
      roles = { liberals: pc - fascTotal, fascists: fascTotal - 1 };
      hk = pc <= 6;
      boardKey = pc <= 6 ? '5-6' : (pc <= 8 ? '7-8' : '9-10');
    }
    return {
      playerCount: pc,
      playerNames: (names && names.slice(0, pc)) || defaultNames(pc),
      roles: { liberals: roles.liberals, fascists: roles.fascists, communists: 0 },
      hitlerKnowsFascists: hk,
      communistsKnowEachOther: true,
      deck: { liberal: 6, fascist: 11, communist: 0 },
      win: { liberal: 5, fascist: 6, communist: 5 },
      board: BOARDS[boardKey].slice(),
      communistBoard: COMMUNIST_BOARD.slice(),
      electionTrackerMax: 3,
      hitlerChancellorThreshold: 3,
      vetoUnlockAt: 5,
      // How the public election vote is taken:
      //   'table'  - group votes IRL with hands/cards; app records only Passed/Failed
      //   'open'   - app records each player's Ja/Nein openly on one shared screen
      //   'secret' - pass-and-play: each player votes privately, revealed together
      votingMode: 'table',
      // Votes are public per the official rules. false = anonymous house-rule.
      revealVotes: true,
      // Number of AI-controlled seats (the last N seats become bots).
      bots: 0
    };
  }

  var VOTING_MODES = ['table', 'open', 'secret'];

  function defaultNames(pc) {
    var out = [];
    for (var i = 0; i < pc; i++) out.push('Player ' + (i + 1));
    return out;
  }

  // Turn a standard config into a 3-faction (Communist) config with sensible
  // defaults. Communists are taken out of the Liberal pool so the count still sums.
  // Balance for the expansion is experimental (validation warns).
  function enableCommunists(config) {
    var c = deepClone(config);
    c.roles.communists = c.playerCount >= 8 ? 2 : 1;
    normalizeRoles(c); // guarantees a valid sum even from an extreme base config
    c.communistsKnowEachOther = true;
    c.deck.communist = 8;
    c.win.communist = 5;
    c.communistBoard = COMMUNIST_BOARD.slice();
    return c;
  }

  // 3-way party membership (what Bugging / Confession reveal). Hitler reads Fascist.
  function partyOf(role) {
    if (role === 'liberal') return 'Liberal';
    if (role === 'communist') return 'Communist';
    return 'Fascist'; // fascist or hitler
  }

  // Force the role split to always respect the player count:
  //   liberals + fascists + communists + 1 (Hitler) === playerCount,
  // with liberals >= 1 and fascists >= 1. Fascists/Communists are trimmed if they'd
  // leave no room for a Liberal + the single Hitler. Liberals auto-fill the remainder.
  // Idempotent - safe to call on every render so an against-the-count config is
  // simply unreachable.
  function normalizeRoles(config) {
    var pc = config.playerCount, r = config.roles;
    var fasc = Math.max(1, (r.fascists | 0) || 1);
    var comm = Math.max(0, (r.communists || 0) | 0);
    var maxNonLib = Math.max(2, pc - 2); // room for >=1 Liberal + 1 Hitler
    if (fasc + comm > maxNonLib) {
      comm = Math.max(0, Math.min(comm, maxNonLib - 1)); // keep fascists >= 1
      fasc = Math.max(1, maxNonLib - comm);
    }
    r.fascists = fasc;
    r.communists = comm;
    r.liberals = Math.max(1, pc - fasc - comm - 1);
    return config;
  }

  // Resize/repair a config's board to match the fascist win threshold.
  // Keeps existing powers where possible, forces the last slot to 'win'.
  function reconcileBoard(config) {
    var n = config.win.fascist;
    var src = config.board || [];
    var out = [];
    for (var i = 0; i < n; i++) {
      out[i] = (i === n - 1) ? 'win' : (i < src.length && src[i] !== 'win' ? src[i] : null);
    }
    config.board = out;
    return config;
  }

  // Returns { ok, errors:[], warnings:[] }.
  // errors block starting a game (the config could produce a broken/illegal game).
  // warnings are off-spec but still playable (respecting "maximum configurable").
  function validateConfig(config) {
    var errors = [], warnings = [];
    var c = config;

    if (!c || typeof c !== 'object') {
      return { ok: false, errors: ['No configuration provided.'], warnings: [] };
    }

    var pc = c.playerCount;
    if (!(pc >= 2)) errors.push('Player count must be at least 2.');

    // Roles must sum (with the single Hitler) to the player count.
    var lib = c.roles && c.roles.liberals, fas = c.roles && c.roles.fascists;
    var comm = (c.roles && c.roles.communists) || 0;
    if (!(lib >= 0) || !(fas >= 0) || !(comm >= 0)) {
      errors.push('Role counts must be non-negative numbers.');
    } else {
      if (fas < 1) errors.push('There must be at least 1 ordinary Fascist (in addition to Hitler).');
      if (lib < 1) errors.push('There must be at least 1 Liberal.');
      var sum = lib + fas + comm + 1; // +1 Hitler
      if (sum !== pc) {
        errors.push('Roles (' + lib + ' Liberal + ' + fas + ' Fascist + ' + comm + ' Communist + 1 Hitler = ' + sum +
          ') must equal the player count (' + pc + ').');
      }
      if (comm === 0 && lib <= fas + 1) {
        warnings.push('Liberals (' + lib + ') do not outnumber the Fascist team (' + (fas + 1) +
          '). Official games always give Liberals a majority.');
      }
    }

    // Names: one per player, non-empty, unique.
    var names = c.playerNames || [];
    if (names.length !== pc) {
      errors.push('You have ' + names.length + ' name(s) but ' + pc + ' player(s).');
    }
    var seen = {};
    for (var i = 0; i < names.length; i++) {
      var nm = (names[i] || '').trim();
      if (!nm) { errors.push('Every player needs a name (player ' + (i + 1) + ' is blank).'); continue; }
      var key = nm.toLowerCase();
      if (seen[key]) warnings.push('Duplicate name "' + nm + '" - players may be hard to tell apart.');
      seen[key] = true;
    }

    // Deck.
    var dl = c.deck && c.deck.liberal, df = c.deck && c.deck.fascist;
    var dc = (c.deck && c.deck.communist) || 0;
    if (!(dl >= 0) || !(df >= 0) || !(dc >= 0)) {
      errors.push('Deck policy counts must be non-negative numbers.');
    } else {
      if (dl + df + dc < 3) errors.push('The policy deck needs at least 3 tiles (the President draws 3).');
      if (df < 1) warnings.push('No Fascist policies in the deck - Fascists can only win by electing Hitler.');
      if (dl < 1) warnings.push('No Liberal policies in the deck - Liberals can only win by killing Hitler.');
    }

    // Win thresholds vs deck - these are warnings, not errors: an unreachable
    // policy track still leaves the Hitler win/lose paths, so the game is playable.
    var wl = c.win && c.win.liberal, wf = c.win && c.win.fascist;
    if (!(wl >= 1) || !(wf >= 1)) {
      errors.push('Win thresholds must be at least 1.');
    } else {
      if (dl >= 0 && dl < wl) {
        warnings.push('Only ' + dl + ' Liberal tiles but ' + wl +
          ' needed to win - Liberals cannot win on policies (only by killing Hitler).');
      }
      if (df >= 0 && df < wf) {
        warnings.push('Only ' + df + ' Fascist tiles but ' + wf +
          ' needed to win - Fascists cannot win on policies (only by electing Hitler).');
      }
    }

    // Board must have exactly one slot per Fascist policy up to the win threshold.
    var board = c.board || [];
    if (wf >= 1 && board.length !== wf) {
      errors.push('The Fascist board has ' + board.length + ' slot(s) but the Fascist win threshold is ' +
        wf + '. They must match.');
    }
    for (var b = 0; b < board.length; b++) {
      var p = board[b];
      var isLast = (b === board.length - 1);
      if (isLast && p !== 'win') {
        warnings.push('The final Fascist slot is normally the "Fascists win" slot.');
      }
      if (!isLast && p !== null && POWERS.indexOf(p) === -1) {
        errors.push('Board slot ' + (b + 1) + ' has an unknown power "' + p + '".');
      }
    }

    // Misc thresholds.
    if (!(c.electionTrackerMax >= 1)) errors.push('Election tracker maximum must be at least 1.');
    if (c.hitlerChancellorThreshold < 0) errors.push('Hitler-Chancellor threshold cannot be negative.');
    if (wf >= 1 && c.hitlerChancellorThreshold > wf) {
      warnings.push('Hitler-as-Chancellor only becomes a loss after ' + c.hitlerChancellorThreshold +
        ' Fascist policies, but the game ends at ' + wf + ' - that win condition can never trigger.');
    }
    if (!(c.vetoUnlockAt >= 1)) {
      errors.push('Veto unlock threshold must be at least 1.');
    } else if (wf >= 1 && c.vetoUnlockAt > wf) {
      warnings.push('Veto unlocks at ' + c.vetoUnlockAt + ' Fascist policies, but the game ends at ' +
        wf + ' - veto will never become available.');
    }

    // Off-spec player counts: supported, but balance is not guaranteed.
    if (!PRESETS[pc] && pc >= 2) {
      warnings.push('Player count ' + pc + ' is outside the official 5-10 range - playable, but balance is untested.');
    }

    // Bots must fit within the player count.
    var bots = c.bots || 0;
    if (bots < 0 || bots > pc) {
      errors.push('Bots (' + bots + ') must be between 0 and the player count (' + pc + ').');
    } else if (bots === pc) {
      warnings.push('All seats are bots - useful as a demo, but no one is playing.');
    }

    // Communist (Secret Hitler XL) expansion checks.
    if (comm > 0) {
      warnings.push('The Communist (Secret Hitler XL) faction is enabled - a fun but experimental variant whose balance is not officially tuned.');
      var wc = c.win && c.win.communist;
      if (!(wc >= 1)) {
        errors.push('Communist win threshold must be at least 1.');
      } else {
        if ((c.communistBoard || []).length !== wc) {
          errors.push('The Communist board has ' + (c.communistBoard || []).length + ' slot(s) but the Communist win threshold is ' + wc + '. They must match.');
        }
        if (dc < wc) warnings.push('Only ' + dc + ' Communist tiles but ' + wc + ' needed to win - Communists cannot win on policies.');
      }
    }

    // Voting options.
    if (VOTING_MODES.indexOf(c.votingMode) === -1) {
      errors.push('Voting mode must be one of: table, open, secret.');
    }
    if (c.revealVotes === false) {
      warnings.push('Anonymous voting is a house rule - official Secret Hitler votes are public, and hiding them removes key deduction information.');
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle.
  // ---------------------------------------------------------------------------

  function uid(i) { return 'p' + i; }

  function newGame(config, seed) {
    var state = {
      config: deepClone(config),
      rngState: (seed >>> 0) || 1,
      players: [],
      deck: [],
      discard: [],
      enactments: [], // structured history: {round, color, presidentId, chancellorId, chaos}
      liberalPolicies: 0,
      fascistPolicies: 0,
      communistPolicies: 0,
      electionTracker: 0,
      round: 1,
      currentPresidentId: null,
      rotationAnchorId: null,
      pendingSpecialPresidentId: null,
      lastElected: { president: null, chancellor: null },
      nomineeChancellorId: null,
      votes: {},
      lastVotes: null,        // snapshot of last completed vote for public display
      drawnPolicies: [],      // President's 3
      chancellorPolicies: [], // Chancellor's 2
      pendingPower: null,
      pendingVeto: false,
      vetoRefused: false, // a refused veto can't be re-proposed this session (prevents a veto loop)
      vetoUnlocked: false,
      lastInvestigation: null, // {presidentId, targetId, party} for the reveal screen
      lastPeek: null,          // [3 policies] for the reveal screen
      phase: 'reveal',
      winner: null,            // 'liberal' | 'fascist'
      winReason: '',
      log: []
    };

    // Players in seating order (names order). Roles assigned randomly.
    var names = config.playerNames;
    var botCount = config.bots || 0;
    for (var i = 0; i < names.length; i++) {
      state.players.push({
        id: uid(i),
        name: names[i],
        role: null,
        alive: true,
        isBot: i >= names.length - botCount, // the last N seats are AI
        investigated: false,
        clearedNotHitler: false, // proven not-Hitler by surviving the Chancellor check
        converted: false,        // radicalised into the Communist party
        partyRevealed: null      // public party (set by Confession)
      });
    }

    var roleBag = [];
    roleBag.push('hitler');
    for (var l = 0; l < config.roles.liberals; l++) roleBag.push('liberal');
    for (var f = 0; f < config.roles.fascists; f++) roleBag.push('fascist');
    for (var cm = 0; cm < (config.roles.communists || 0); cm++) roleBag.push('communist');
    shuffleInPlace(state, roleBag);
    for (var r = 0; r < state.players.length; r++) state.players[r].role = roleBag[r];

    // Policy deck.
    for (var dl = 0; dl < config.deck.liberal; dl++) state.deck.push('L');
    for (var df = 0; df < config.deck.fascist; df++) state.deck.push('F');
    for (var dcm = 0; dcm < (config.deck.communist || 0); dcm++) state.deck.push('C');
    shuffleInPlace(state, state.deck);

    // Random first Presidential Candidate.
    var firstIdx = Math.floor(nextRand(state) * state.players.length);
    state.currentPresidentId = state.players[firstIdx].id;
    state.rotationAnchorId = state.currentPresidentId;

    return state;
  }

  // Called once the night-phase reveal is done.
  function beginPlay(state) {
    state.phase = 'nomination';
    pushLog(state, 'Game begins. ' + nameOf(state, state.currentPresidentId) + ' is the first Presidential Candidate.');
    return state;
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function getPlayer(state, id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }
  function nameOf(state, id) { var p = getPlayer(state, id); return p ? p.name : '?'; }
  function policyWord(c) { return c === 'L' ? 'Liberal' : (c === 'C' ? 'Communist' : 'Fascist'); }
  function aliveCount(state) {
    var n = 0; for (var i = 0; i < state.players.length; i++) if (state.players[i].alive) n++; return n;
  }
  function alivePlayers(state) { return state.players.filter(function (p) { return p.alive; }); }
  function pushLog(state, text) { state.log.push({ round: state.round, text: text }); }

  function clockwiseNextAlive(state, fromId) {
    var idx = 0;
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === fromId) { idx = i; break; }
    var n = state.players.length;
    for (var k = 1; k <= n; k++) {
      var cand = state.players[(idx + k) % n];
      if (cand.alive) return cand.id;
    }
    return fromId; // degenerate (everyone else dead)
  }

  // Term limits: the last *elected* President and Chancellor are ineligible to be
  // nominated as Chancellor. Exception: with 5 or fewer players alive, only the
  // last Chancellor is term-limited (the last President may be nominated).
  function isTermLimited(state, pid) {
    var le = state.lastElected;
    if (pid === le.chancellor) return true;
    if (pid === le.president && aliveCount(state) > 5) return true;
    return false;
  }

  function eligibleChancellors(state) {
    var pres = state.currentPresidentId;
    return alivePlayers(state).filter(function (p) {
      return p.id !== pres && !isTermLimited(state, p.id);
    }).map(function (p) { return p.id; });
  }

  // The set a President may actually nominate from. Normally the term-eligible
  // players; but if term limits would leave NO valid candidate (possible after
  // executions in small/custom games), they are relaxed for this election so the
  // game can never deadlock - mirroring the spirit of the official 5-player rule.
  function nominationCandidates(state) {
    var strict = eligibleChancellors(state);
    if (strict.length > 0) return { ids: strict, relaxed: false };
    var relaxed = alivePlayers(state)
      .filter(function (p) { return p.id !== state.currentPresidentId; })
      .map(function (p) { return p.id; });
    return { ids: relaxed, relaxed: true };
  }

  function powerForFascistCount(state, count) {
    var board = state.config.board;
    var p = board[count - 1];
    if (p && p !== 'win' && POWERS.indexOf(p) !== -1) return p;
    return null;
  }

  function powerForCommunistCount(state, count) {
    var board = state.config.communistBoard || [];
    var p = board[count - 1];
    if (p && p !== 'win' && COMMUNIST_POWERS.indexOf(p) !== -1) return p;
    return null;
  }

  function reshuffleIfNeeded(state) {
    if (state.deck.length < 3) {
      state.deck = shuffleInPlace(state, state.deck.concat(state.discard));
      state.discard = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Election phase.
  // ---------------------------------------------------------------------------

  function nominate(state, chancellorId) {
    if (state.phase !== 'nomination') throw new Error('Not in nomination phase.');
    if (nominationCandidates(state).ids.indexOf(chancellorId) === -1) throw new Error('That player is not an eligible Chancellor.');
    state.nomineeChancellorId = chancellorId;
    state.votes = {};
    state.phase = 'voting';
    pushLog(state, nameOf(state, state.currentPresidentId) + ' nominated ' + nameOf(state, chancellorId) + ' as Chancellor.');
    return state;
  }

  function castVote(state, playerId, vote) {
    if (state.phase !== 'voting') throw new Error('Not in voting phase.');
    var p = getPlayer(state, playerId);
    if (!p || !p.alive) throw new Error('Only living players vote.');
    if (vote !== 'ja' && vote !== 'nein') throw new Error('Vote must be ja or nein.');
    state.votes[playerId] = vote;
    return state;
  }

  function allVotesIn(state) {
    var alive = alivePlayers(state);
    for (var i = 0; i < alive.length; i++) if (!state.votes[alive[i].id]) return false;
    return true;
  }

  // Core election transition, shared by all voting modes.
  // `summary` is an optional human-readable tally string for the log.
  function applyElectionOutcome(state, passed, summary) {
    var suffix = summary ? ' ' + summary : '';
    if (passed) {
      state.lastElected = { president: state.currentPresidentId, chancellor: state.nomineeChancellorId };
      pushLog(state, 'Government ELECTED: President ' + nameOf(state, state.currentPresidentId) +
        ' / Chancellor ' + nameOf(state, state.nomineeChancellorId) + suffix + '.');
      if (state.fascistPolicies >= state.config.hitlerChancellorThreshold) {
        var chanc = getPlayer(state, state.nomineeChancellorId);
        if (chanc.role === 'hitler') {
          return endGame(state, 'fascist', 'Hitler was elected Chancellor after ' +
            state.fascistPolicies + ' Fascist Policies.');
        }
        // Survived the check with the threshold met: provably not Hitler.
        chanc.clearedNotHitler = true;
      }
      enterLegislative(state);
    } else {
      pushLog(state, 'Government REJECTED' + suffix + '. Election Tracker ' +
        (state.electionTracker + 1) + '/' + state.config.electionTrackerMax + '.');
      advanceElectionTracker(state);
    }
    return state;
  }

  // On-device voting (secret pass-and-play, or open tally): tally state.votes.
  function resolveVotes(state) {
    if (state.phase !== 'voting') throw new Error('Not in voting phase.');
    var alive = alivePlayers(state);
    var ja = 0, nein = 0;
    for (var i = 0; i < alive.length; i++) {
      if (state.votes[alive[i].id] === 'ja') ja++; else nein++;
    }
    state.lastVotes = {
      president: state.currentPresidentId,
      chancellor: state.nomineeChancellorId,
      ja: ja, nein: nein,
      ballots: deepClone(state.votes),
      manual: false
    };
    var passed = ja * 2 > alive.length; // strict majority; ties fail
    return applyElectionOutcome(state, passed, '(' + ja + ' Ja / ' + nein + ' Nein)');
  }

  // Table voting: the group votes IRL; the app is told only the outcome.
  // An optional jaCount (votes are public anyway) enriches the log and overrides
  // `passed` for safety if provided.
  function resolveElectionManual(state, passed, jaCount) {
    if (state.phase !== 'voting') throw new Error('Not in voting phase.');
    var alive = aliveCount(state);
    var summary = '';
    if (jaCount != null) {
      passed = jaCount * 2 > alive; // strict majority; ties fail
      summary = '(' + jaCount + ' Ja / ' + (alive - jaCount) + ' Nein)';
    } else {
      summary = '(table vote)';
    }
    state.lastVotes = {
      president: state.currentPresidentId,
      chancellor: state.nomineeChancellorId,
      ja: (jaCount != null ? jaCount : null),
      nein: (jaCount != null ? alive - jaCount : null),
      ballots: null,
      manual: true
    };
    return applyElectionOutcome(state, !!passed, summary);
  }

  // A failed/inactive government advances the tracker; the 3rd triggers chaos.
  function advanceElectionTracker(state) {
    state.electionTracker++;
    if (state.electionTracker >= state.config.electionTrackerMax) {
      chaos(state);
    } else {
      startNextRound(state);
    }
  }

  function chaos(state) {
    reshuffleIfNeeded(state);
    var top = state.deck.shift();
    state.electionTracker = 0;
    state.lastElected = { president: null, chancellor: null }; // term limits forgotten
    applyPolicy(state, top, true);
    state.enactments.push({ round: state.round, color: top, presidentId: null, chancellorId: null, chaos: true });
    pushLog(state, 'Three failed elections - the country falls into chaos. Top policy enacted: ' +
      policyWord(top) + '. Term limits forgotten.');
    if (checkPolicyWin(state)) return;
    reshuffleIfNeeded(state);
    startNextRound(state);
  }

  // ---------------------------------------------------------------------------
  // Legislative session.
  // ---------------------------------------------------------------------------

  function enterLegislative(state) {
    reshuffleIfNeeded(state);
    state.drawnPolicies = [state.deck.shift(), state.deck.shift(), state.deck.shift()];
    state.vetoRefused = false;
    state.phase = 'legislative_president';
  }

  function presidentDiscard(state, index) {
    if (state.phase !== 'legislative_president') throw new Error('Not in President legislative phase.');
    if (index < 0 || index >= state.drawnPolicies.length) throw new Error('Invalid discard index.');
    var discarded = state.drawnPolicies.splice(index, 1)[0];
    state.discard.push(discarded);
    state.chancellorPolicies = state.drawnPolicies;
    state.drawnPolicies = [];
    state.phase = 'legislative_chancellor';
    return state;
  }

  function chancellorEnact(state, index) {
    if (state.phase !== 'legislative_chancellor') throw new Error('Not in Chancellor legislative phase.');
    if (index < 0 || index >= state.chancellorPolicies.length) throw new Error('Invalid enact index.');
    var enacted = state.chancellorPolicies.splice(index, 1)[0];
    state.discard.push(state.chancellorPolicies[0]); // the other one
    state.chancellorPolicies = [];
    applyPolicy(state, enacted, false);
    state.enactments.push({ round: state.round, color: enacted, presidentId: state.currentPresidentId, chancellorId: state.nomineeChancellorId, chaos: false });
    pushLog(state, 'A ' + policyWord(enacted) + ' Policy was enacted (' +
      state.liberalPolicies + ' Liberal / ' + state.fascistPolicies + ' Fascist' +
      ((state.config.roles.communists || 0) > 0 ? ' / ' + state.communistPolicies + ' Communist' : '') + ').');
    postEnact(state, enacted);
    return state;
  }

  function chancellorRequestVeto(state) {
    if (state.phase !== 'legislative_chancellor') throw new Error('Not in Chancellor legislative phase.');
    if (!state.vetoUnlocked) throw new Error('Veto is not unlocked yet.');
    if (state.vetoRefused) throw new Error('Veto was already refused this session - the Chancellor must enact.');
    state.pendingVeto = true;
    state.phase = 'veto_consent';
    pushLog(state, nameOf(state, state.nomineeChancellorId) + ' (Chancellor) proposes to VETO this agenda.');
    return state;
  }

  function presidentConsentVeto(state, consent) {
    if (state.phase !== 'veto_consent') throw new Error('Not awaiting veto consent.');
    state.pendingVeto = false;
    if (consent) {
      // Both remaining policies discarded; inactive government advances tracker.
      for (var i = 0; i < state.chancellorPolicies.length; i++) state.discard.push(state.chancellorPolicies[i]);
      state.chancellorPolicies = [];
      pushLog(state, 'President AGREED to the veto. Agenda discarded (inactive government).');
      advanceElectionTracker(state);
    } else {
      state.vetoRefused = true; // chancellor may not veto again this session
      state.phase = 'legislative_chancellor';
      pushLog(state, 'President REFUSED the veto. The Chancellor must enact a Policy.');
    }
    return state;
  }

  function applyPolicy(state, color, isChaos) {
    if (color === 'L') state.liberalPolicies++;
    else if (color === 'C') state.communistPolicies++;
    else state.fascistPolicies++;
    state.electionTracker = 0; // any face-up policy resets the tracker
    if (state.fascistPolicies >= state.config.vetoUnlockAt) state.vetoUnlocked = true;
  }

  function postEnact(state, enactedColor) {
    reshuffleIfNeeded(state);
    if (checkPolicyWin(state)) return;
    if (enactedColor === 'F') {
      var power = powerForFascistCount(state, state.fascistPolicies);
      if (power) {
        state.pendingPower = power;
        state.phase = 'power';
        pushLog(state, 'The Fascist Policy grants the President a power: ' + POWER_LABELS[power] + '.');
        return;
      }
    } else if (enactedColor === 'C') {
      var cpow = powerForCommunistCount(state, state.communistPolicies);
      if (cpow) {
        state.pendingPower = cpow;
        state.phase = 'power';
        pushLog(state, 'The Communist Policy grants a power: ' + POWER_LABELS[cpow] + '.');
        return;
      }
    }
    startNextRound(state);
  }

  // ---------------------------------------------------------------------------
  // Executive powers.
  // ---------------------------------------------------------------------------

  function powerInvestigate(state, targetId) {
    requirePower(state, 'investigate');
    var t = getPlayer(state, targetId);
    if (!t || !t.alive) throw new Error('Cannot investigate that player.');
    if (t.id === state.currentPresidentId) throw new Error('The President cannot investigate themselves.');
    if (t.investigated) throw new Error('That player has already been investigated.');
    t.investigated = true;
    var party = (t.role === 'liberal') ? 'Liberal' : 'Fascist';
    state.lastInvestigation = { presidentId: state.currentPresidentId, targetId: targetId, party: party };
    pushLog(state, nameOf(state, state.currentPresidentId) + ' investigated ' + t.name + ' (result kept secret).');
    finishPower(state);
    return party;
  }

  function powerSpecialElection(state, targetId) {
    requirePower(state, 'special_election');
    var t = getPlayer(state, targetId);
    if (!t || !t.alive) throw new Error('Cannot pick that player.');
    if (t.id === state.currentPresidentId) throw new Error('Pick another player.');
    state.rotationAnchorId = state.currentPresidentId; // rotation resumes left of the enactor
    state.pendingSpecialPresidentId = targetId;
    pushLog(state, nameOf(state, state.currentPresidentId) + ' called a Special Election: ' + t.name +
      ' will be the next Presidential Candidate.');
    finishPower(state);
    return state;
  }

  function powerPolicyPeek(state) {
    requirePower(state, 'policy_peek');
    reshuffleIfNeeded(state);
    state.lastPeek = state.deck.slice(0, 3);
    pushLog(state, nameOf(state, state.currentPresidentId) + ' used Policy Peek (saw the top 3 policies).');
    finishPower(state);
    return state.lastPeek.slice();
  }

  function powerExecution(state, targetId) {
    requirePower(state, 'execution');
    var t = getPlayer(state, targetId);
    if (!t || !t.alive) throw new Error('Cannot execute that player.');
    if (t.id === state.currentPresidentId) throw new Error('The President cannot execute themselves.');
    t.alive = false;
    pushLog(state, nameOf(state, state.currentPresidentId) + ' executed ' + t.name + '.');
    if (t.role === 'hitler') {
      return endGame(state, 'liberal', 'Hitler was assassinated.');
    }
    finishPower(state);
    return state;
  }

  // ---- Communist (XL) powers ----

  // Bugging: like Investigate, but reveals the 3-way party (Hitler reads Fascist).
  function powerBugging(state, targetId) {
    requirePower(state, 'bugging');
    var t = getPlayer(state, targetId);
    if (!t || !t.alive) throw new Error('Cannot bug that player.');
    if (t.id === state.currentPresidentId) throw new Error('Pick another player.');
    var party = partyOf(t.role);
    state.lastInvestigation = { presidentId: state.currentPresidentId, targetId: targetId, party: party, bug: true };
    pushLog(state, nameOf(state, state.currentPresidentId) + ' bugged ' + t.name + ' (party seen in secret).');
    finishPower(state);
    return party;
  }

  // Confession: the President's party is revealed publicly to the whole table.
  function powerConfession(state) {
    requirePower(state, 'confession');
    var pres = getPlayer(state, state.currentPresidentId);
    pres.partyRevealed = partyOf(pres.role);
    pushLog(state, 'CONFESSION: ' + pres.name + ' (President) is publicly revealed as ' + pres.partyRevealed + '.');
    finishPower(state);
    return pres.partyRevealed;
  }

  // Five-Year Plan: shuffle 2 Communist + 1 Liberal policy into the deck.
  function powerFiveYearPlan(state) {
    requirePower(state, 'five_year_plan');
    state.deck.push('C', 'C', 'L');
    shuffleInPlace(state, state.deck);
    pushLog(state, 'FIVE-YEAR PLAN: 2 Communist and 1 Liberal policy were shuffled into the deck.');
    finishPower(state);
    return state;
  }

  // Radicalisation: convert a player to the Communist party. Hitler is immune
  // (the attempt silently fails; the outcome is revealed privately to the target).
  function powerRadicalise(state, targetId) {
    requirePower(state, 'radicalisation');
    var t = getPlayer(state, targetId);
    if (!t || !t.alive) throw new Error('Cannot radicalise that player.');
    if (t.id === state.currentPresidentId) throw new Error('Pick another player.');
    var success = (t.role !== 'hitler');
    if (success) { t.role = 'communist'; t.converted = true; }
    state.lastConversion = { targetId: targetId, success: success };
    pushLog(state, nameOf(state, state.currentPresidentId) + ' attempted to radicalise ' + t.name + ' (outcome secret).');
    finishPower(state);
    return success;
  }

  function requirePower(state, name) {
    if (state.phase !== 'power' || state.pendingPower !== name) {
      throw new Error('Power "' + name + '" is not currently available.');
    }
  }

  function finishPower(state) {
    state.pendingPower = null;
    startNextRound(state);
  }

  // ---------------------------------------------------------------------------
  // Round transitions + win checks.
  // ---------------------------------------------------------------------------

  function startNextRound(state) {
    if (state.winner) return;
    state.round++;
    if (state.pendingSpecialPresidentId) {
      state.currentPresidentId = state.pendingSpecialPresidentId;
      state.pendingSpecialPresidentId = null;
      // rotationAnchorId already set to the enactor; do not change it.
    } else {
      state.currentPresidentId = clockwiseNextAlive(state, state.rotationAnchorId);
      state.rotationAnchorId = state.currentPresidentId;
    }
    state.nomineeChancellorId = null;
    state.votes = {};
    state.drawnPolicies = [];
    state.chancellorPolicies = [];
    state.pendingPower = null;
    state.pendingVeto = false;
    state.vetoRefused = false;
    state.phase = 'nomination';
  }

  function checkPolicyWin(state) {
    if (state.liberalPolicies >= state.config.win.liberal) {
      endGame(state, 'liberal', state.config.win.liberal + ' Liberal Policies were enacted.');
      return true;
    }
    if (state.fascistPolicies >= state.config.win.fascist) {
      endGame(state, 'fascist', state.config.win.fascist + ' Fascist Policies were enacted.');
      return true;
    }
    if ((state.config.roles.communists || 0) > 0 && state.communistPolicies >= state.config.win.communist) {
      endGame(state, 'communist', state.config.win.communist + ' Communist Policies were enacted.');
      return true;
    }
    return false;
  }

  function endGame(state, winner, reason) {
    state.winner = winner;
    state.winReason = reason;
    state.phase = 'game_over';
    pushLog(state, (winner === 'liberal' ? 'LIBERALS' : 'FASCISTS') + ' WIN - ' + reason);
    return state;
  }

  // Night-phase info a given player should see during the secret reveal.
  function revealInfo(state, playerId) {
    var me = getPlayer(state, playerId);
    var info = { role: me.role, knows: [] };
    var i, p;
    if (me.role === 'fascist') {
      for (i = 0; i < state.players.length; i++) {
        p = state.players[i];
        if (p.id === me.id) continue;
        if (p.role === 'fascist') info.knows.push({ name: p.name, label: 'Fascist' });
        if (p.role === 'hitler') info.knows.push({ name: p.name, label: 'Hitler' });
      }
    } else if (me.role === 'hitler' && state.config.hitlerKnowsFascists) {
      for (i = 0; i < state.players.length; i++) {
        p = state.players[i];
        if (p.role === 'fascist') info.knows.push({ name: p.name, label: 'Fascist' });
      }
    } else if (me.role === 'communist' && state.config.communistsKnowEachOther) {
      for (i = 0; i < state.players.length; i++) {
        p = state.players[i];
        if (p.id === me.id) continue;
        if (p.role === 'communist') info.knows.push({ name: p.name, label: 'Communist' });
      }
    }
    return info;
  }

  return {
    PRESETS: PRESETS,
    BOARDS: BOARDS,
    POWERS: POWERS,
    POWER_LABELS: POWER_LABELS,
    RULESETS: RULESETS,
    applyRuleset: applyRuleset,
    COMMUNIST_BOARD: COMMUNIST_BOARD,
    COMMUNIST_POWERS: COMMUNIST_POWERS,
    defaultConfig: defaultConfig,
    defaultNames: defaultNames,
    enableCommunists: enableCommunists,
    partyOf: partyOf,
    reconcileBoard: reconcileBoard,
    normalizeRoles: normalizeRoles,
    validateConfig: validateConfig,
    newGame: newGame,
    beginPlay: beginPlay,
    // queries
    getPlayer: getPlayer,
    nameOf: nameOf,
    aliveCount: aliveCount,
    alivePlayers: alivePlayers,
    eligibleChancellors: eligibleChancellors,
    nominationCandidates: nominationCandidates,
    isTermLimited: isTermLimited,
    powerForFascistCount: powerForFascistCount,
    allVotesIn: allVotesIn,
    revealInfo: revealInfo,
    // actions
    nominate: nominate,
    castVote: castVote,
    resolveVotes: resolveVotes,
    resolveElectionManual: resolveElectionManual,
    presidentDiscard: presidentDiscard,
    chancellorEnact: chancellorEnact,
    chancellorRequestVeto: chancellorRequestVeto,
    presidentConsentVeto: presidentConsentVeto,
    powerInvestigate: powerInvestigate,
    powerSpecialElection: powerSpecialElection,
    powerPolicyPeek: powerPolicyPeek,
    powerExecution: powerExecution,
    powerForCommunistCount: powerForCommunistCount,
    powerBugging: powerBugging,
    powerConfession: powerConfession,
    powerFiveYearPlan: powerFiveYearPlan,
    powerRadicalise: powerRadicalise
  };
});
