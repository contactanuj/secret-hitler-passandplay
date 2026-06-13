/*
 * engine.test.js — exercises sh-engine.js with no external dependencies.
 *
 * Run: node tests/engine.test.js   (or: npm test)
 *
 * Covers:
 *   - config defaults + validation (the "scrutinize the configurations" requirement)
 *   - targeted rules checks (term limits, chaos, Hitler-chancellor win, execution win,
 *     special-election rotation, veto)
 *   - fuzz: many full random-but-legal playthroughs for every official player count,
 *     asserting termination + invariants and that no action throws.
 */
'use strict';

var SH = require('../assets/sh-engine.js');
var Bot = require('../assets/sh-bot.js');

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + msg); }
}
function section(name) { console.log('\n# ' + name); }
function throws(fn, msg) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, msg);
}

// ---------------------------------------------------------------------------
section('config defaults & validation');

[5, 6, 7, 8, 9, 10].forEach(function (pc) {
  var cfg = SH.defaultConfig(pc);
  var v = SH.validateConfig(cfg);
  ok(v.ok, 'default config for ' + pc + ' players validates (errors: ' + JSON.stringify(v.errors) + ')');
  ok(cfg.roles.liberals + cfg.roles.fascists + 1 === pc, 'roles sum to ' + pc);
  ok(cfg.board.length === cfg.win.fascist, 'board length matches fascist win for ' + pc);
});

// Official role splits, spot-checked against the rulebook table.
ok(SH.PRESETS[5].liberals === 3 && SH.PRESETS[5].fascists === 1 && SH.PRESETS[5].hitlerKnowsFascists === true, '5p: 3L/1F, Hitler knows');
ok(SH.PRESETS[7].liberals === 4 && SH.PRESETS[7].fascists === 2 && SH.PRESETS[7].hitlerKnowsFascists === false, '7p: 4L/2F, Hitler blind');
ok(SH.PRESETS[10].liberals === 6 && SH.PRESETS[10].fascists === 3, '10p: 6L/3F');

// Bad configs are rejected.
(function () {
  var c = SH.defaultConfig(5); c.roles.fascists = 2; // 3+2+1 = 6 != 5
  ok(!SH.validateConfig(c).ok, 'role-sum mismatch is an error');
})();
(function () {
  var c = SH.defaultConfig(6); c.win.fascist = 5; // board still length 6
  ok(!SH.validateConfig(c).ok, 'board length != fascist win is an error');
})();
(function () {
  var c = SH.defaultConfig(6); c.deck.liberal = 1; c.deck.fascist = 1; // < 3 tiles
  ok(!SH.validateConfig(c).ok, 'deck with < 3 tiles is an error');
})();
(function () {
  var c = SH.defaultConfig(7); c.playerNames[2] = '';
  ok(!SH.validateConfig(c).ok, 'blank player name is an error');
})();
(function () {
  // Unreachable liberal track is a WARNING, not an error (Hitler win still exists).
  var c = SH.defaultConfig(6); c.deck.liberal = 2; c.deck.fascist = 11; c.win.liberal = 5;
  var v = SH.validateConfig(c);
  ok(v.ok, 'too-few liberal tiles is playable (not an error)');
  ok(v.warnings.length > 0, 'too-few liberal tiles produces a warning');
})();
(function () {
  // Off-spec player count: synthesized + warned, still valid.
  var c = SH.defaultConfig(12);
  var v = SH.validateConfig(c);
  ok(c.roles.liberals + c.roles.fascists + 1 === 12, '12p synthesized roles sum to 12');
  ok(v.warnings.some(function (w) { return /outside the official/.test(w); }), '12p warns about off-spec balance');
})();

// ---------------------------------------------------------------------------
section('role assignment & reveal info');
(function () {
  var cfg = SH.defaultConfig(7);
  var s = SH.newGame(cfg, 12345);
  var counts = { liberal: 0, fascist: 0, hitler: 0 };
  s.players.forEach(function (p) { counts[p.role]++; });
  ok(counts.liberal === 4 && counts.fascist === 2 && counts.hitler === 1, '7p role bag dealt exactly 4/2/1');

  var hitler = s.players.filter(function (p) { return p.role === 'hitler'; })[0];
  var fascist = s.players.filter(function (p) { return p.role === 'fascist'; })[0];
  // 7p: Hitler is blind, fascists know each other + Hitler.
  ok(SH.revealInfo(s, hitler.id).knows.length === 0, '7p Hitler sees no allies');
  ok(SH.revealInfo(s, fascist.id).knows.length >= 1, '7p Fascist sees allies/Hitler');

  // 5p: Hitler knows the fascist.
  var s5 = SH.newGame(SH.defaultConfig(5), 999);
  var h5 = s5.players.filter(function (p) { return p.role === 'hitler'; })[0];
  ok(SH.revealInfo(s5, h5.id).knows.length === 1, '5p Hitler sees the single Fascist');
})();

// ---------------------------------------------------------------------------
section('targeted rules');

// Helper to elect a specific chancellor with a unanimous Ja vote.
function electUnanimous(s, chancellorId) {
  SH.nominate(s, chancellorId);
  SH.alivePlayers(s).forEach(function (p) { SH.castVote(s, p.id, 'ja'); });
  SH.resolveVotes(s);
}

// Hitler elected Chancellor after 3 Fascist Policies -> Fascists win.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 7);
  s.fascistPolicies = 3;
  s.phase = 'nomination';
  var hitler = s.players.filter(function (p) { return p.role === 'hitler'; })[0];
  // Make sure Hitler is eligible & not the president.
  if (s.currentPresidentId === hitler.id) s.currentPresidentId = s.players.filter(function (p) { return p.id !== hitler.id; })[0].id;
  s.lastElected = { president: null, chancellor: null };
  electUnanimous(s, hitler.id);
  ok(s.winner === 'fascist' && /Hitler was elected/.test(s.winReason), 'Hitler-as-Chancellor after 3F => fascist win');
})();

// Same nomination BEFORE 3 Fascist Policies is safe (no instant loss).
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 7);
  s.fascistPolicies = 2;
  s.phase = 'nomination';
  var hitler = s.players.filter(function (p) { return p.role === 'hitler'; })[0];
  if (s.currentPresidentId === hitler.id) s.currentPresidentId = s.players.filter(function (p) { return p.id !== hitler.id; })[0].id;
  s.lastElected = { president: null, chancellor: null };
  electUnanimous(s, hitler.id);
  ok(!s.winner && s.phase === 'legislative_president', 'Hitler chancellor before 3F is safe');
})();

// Executing Hitler -> Liberals win.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 3);
  var hitler = s.players.filter(function (p) { return p.role === 'hitler'; })[0];
  if (s.currentPresidentId === hitler.id) s.currentPresidentId = s.players.filter(function (p) { return p.id !== hitler.id; })[0].id;
  s.phase = 'power'; s.pendingPower = 'execution';
  SH.powerExecution(s, hitler.id);
  ok(s.winner === 'liberal' && /assassinated/.test(s.winReason), 'executing Hitler => liberal win');
})();

// Executing a non-Hitler does NOT end the game and removes them.
(function () {
  var s = SH.newGame(SH.defaultConfig(7), 4);
  var lib = s.players.filter(function (p) { return p.role === 'liberal' && p.id !== s.currentPresidentId; })[0];
  s.phase = 'power'; s.pendingPower = 'execution';
  SH.powerExecution(s, lib.id);
  ok(!s.winner && SH.getPlayer(s, lib.id).alive === false, 'executing a Liberal removes them, game continues');
})();

// Election tracker: 3 consecutive failed votes -> chaos enacts top policy & resets.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 11);
  s.phase = 'nomination';
  var before = s.liberalPolicies + s.fascistPolicies;
  for (var i = 0; i < 3 && !s.winner; i++) {
    var chanc = SH.eligibleChancellors(s)[0];
    SH.nominate(s, chanc);
    SH.alivePlayers(s).forEach(function (p) { SH.castVote(s, p.id, 'nein'); });
    SH.resolveVotes(s);
  }
  var after = s.liberalPolicies + s.fascistPolicies;
  ok(after === before + 1, 'chaos enacted exactly one policy after 3 failed votes');
  ok(s.electionTracker === 0, 'election tracker reset after chaos');
  ok(s.lastElected.president === null && s.lastElected.chancellor === null, 'term limits forgotten after chaos');
})();

// Term limits: after an election, last President & Chancellor are ineligible (>5 alive).
(function () {
  var s = SH.newGame(SH.defaultConfig(7), 22);
  s.phase = 'nomination';
  var pres = s.currentPresidentId;
  var chanc = SH.eligibleChancellors(s)[0];
  electUnanimous(s, chanc);
  // Drive to next nomination via a legislative session (enact something).
  SH.presidentDiscard(s, 0);
  if (s.phase === 'legislative_chancellor') SH.chancellorEnact(s, 0);
  // It may now be a power phase; resolve any power quickly to reach nomination.
  while (s.phase === 'power') resolveAnyPower(s);
  ok(s.phase === 'nomination', 'reached a fresh nomination');
  var elig = SH.eligibleChancellors(s);
  ok(elig.indexOf(chanc) === -1, 'last elected Chancellor is term-limited');
  // last President term-limited only because >5 alive
  ok(SH.aliveCount(s) > 5, '7 alive');
  ok(elig.indexOf(pres) === -1, 'last elected President term-limited with >5 alive');
})();

// Term-limit 5-player exception: only last Chancellor ineligible.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 31);
  // Fake a prior election result, 5 alive.
  s.lastElected = { president: s.players[0].id, chancellor: s.players[1].id };
  s.currentPresidentId = s.players[2].id;
  s.phase = 'nomination';
  var elig = SH.eligibleChancellors(s);
  ok(elig.indexOf(s.players[1].id) === -1, '5p: last Chancellor still term-limited');
  ok(elig.indexOf(s.players[0].id) !== -1, '5p exception: last President IS eligible');
})();

// Special election rotation: next normal president is left of the enactor.
(function () {
  var s = SH.newGame(SH.defaultConfig(7), 55);
  // Force a known enactor and a special election power.
  var enactor = s.players[2];
  s.currentPresidentId = enactor.id;
  s.rotationAnchorId = enactor.id;
  s.phase = 'power'; s.pendingPower = 'special_election';
  var target = s.players[5];
  SH.powerSpecialElection(s, target.id);
  ok(s.currentPresidentId === target.id, 'special-elected player becomes next President');
  // After the special round, drive one normal round end and check rotation resumes left of enactor.
  // Simulate the special president's round failing (simplest path back to startNextRound).
  s.phase = 'nomination';
  var chanc = SH.eligibleChancellors(s)[0];
  SH.nominate(s, chanc);
  SH.alivePlayers(s).forEach(function (p) { SH.castVote(s, p.id, 'nein'); });
  SH.resolveVotes(s);
  // Now currentPresident should be clockwise-next-alive after the enactor (player index 3).
  ok(s.currentPresidentId === s.players[3].id, 'rotation resumes to the left of the enactor after special election');
})();

// Veto: unlocked at 5 fascist policies, veto+consent discards agenda and advances tracker.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 77);
  s.fascistPolicies = 5; s.vetoUnlocked = true;
  s.phase = 'legislative_chancellor';
  s.chancellorPolicies = ['F', 'L'];
  s.electionTracker = 0;
  SH.chancellorRequestVeto(s);
  ok(s.phase === 'veto_consent', 'veto request awaits president consent');
  SH.presidentConsentVeto(s, true);
  ok(s.electionTracker === 1, 'agreed veto advances the election tracker');
  ok(s.phase === 'nomination', 'after veto the game moves to the next round');
})();

// A refused veto cannot be re-proposed (prevents the veto loop — ref issue #10).
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 123);
  s.fascistPolicies = 5; s.vetoUnlocked = true;
  s.phase = 'legislative_chancellor'; s.chancellorPolicies = ['F', 'F'];
  SH.chancellorRequestVeto(s);
  SH.presidentConsentVeto(s, false); // refuse
  ok(s.phase === 'legislative_chancellor' && s.vetoRefused === true, 'refused veto returns to enact and is flagged');
  throws(function () { SH.chancellorRequestVeto(s); }, 're-proposing veto after a refusal throws');
  SH.chancellorEnact(s, 0); // must be able to enact now
  ok(s.fascistPolicies === 6 && s.winner === 'fascist', 'chancellor enacts after refused veto');
})();

// Rule-set presets are always valid and apply the right safe tweaks.
(function () {
  var base = SH.defaultConfig(7);
  ok(SH.validateConfig(SH.applyRuleset(base, 'official')).ok, 'preset official valid');
  ok(SH.applyRuleset(base, 'fast').electionTrackerMax === 2, 'preset fast sets tracker 2');
  ok(SH.applyRuleset(base, 'beginner').votingMode === 'table', 'preset beginner uses table voting');
  ok(SH.applyRuleset(base, 'tense').votingMode === 'secret', 'preset tense uses secret voting');
  ['official', 'beginner', 'fast', 'tense'].forEach(function (k) {
    [5, 7, 10].forEach(function (pc) {
      ok(SH.validateConfig(SH.applyRuleset(SH.defaultConfig(pc), k)).ok, 'preset ' + k + ' valid at ' + pc + 'p');
    });
  });
})();

// Confirmed-not-Hitler: surviving the Chancellor check (threshold met) flags it.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 71);
  s.fascistPolicies = 3; s.phase = 'nomination';
  var lib = s.players.filter(function (p) { return p.role !== 'hitler' && p.id !== s.currentPresidentId; })[0];
  s.lastElected = { president: null, chancellor: null };
  electUnanimous(s, lib.id);
  ok(SH.getPlayer(s, lib.id).clearedNotHitler === true, 'non-Hitler chancellor after 3F is cleared');
})();

// Nomination never deadlocks: if term limits leave no candidate, they relax.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 90);
  // Simulate a degenerate small board: only 2 alive, the other is last Chancellor.
  s.players.forEach(function (p, i) { p.alive = (i < 2); });
  s.currentPresidentId = s.players[0].id;
  s.lastElected = { president: null, chancellor: s.players[1].id };
  s.phase = 'nomination';
  ok(SH.eligibleChancellors(s).length === 0, 'strict eligibility is empty here');
  var nc = SH.nominationCandidates(s);
  ok(nc.relaxed === true && nc.ids.indexOf(s.players[1].id) !== -1, 'term limits relax so a candidate exists');
  SH.nominate(s, s.players[1].id); // must not throw
  ok(s.phase === 'voting', 'relaxed nomination proceeds to voting');
})();

// Table (manual) voting: app is told only the outcome.
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 88);
  s.phase = 'nomination';
  var chanc = SH.eligibleChancellors(s)[0];
  SH.nominate(s, chanc);
  SH.resolveElectionManual(s, true); // pass, no count
  ok(s.phase === 'legislative_president', 'manual PASS proceeds to legislative session');
  ok(s.lastVotes && s.lastVotes.manual === true, 'manual vote is flagged in lastVotes');
})();
(function () {
  var s = SH.newGame(SH.defaultConfig(5), 89);
  s.phase = 'nomination';
  SH.nominate(s, SH.eligibleChancellors(s)[0]);
  // jaCount overrides: 2 Ja of 5 alive => fails (strict majority)
  SH.resolveElectionManual(s, true, 2);
  ok(s.phase === 'nomination' && s.electionTracker === 1, 'manual jaCount=2/5 fails and advances tracker');
})();

function resolveAnyPower(s) {
  var nonPresAlive = SH.alivePlayers(s).filter(function (p) { return p.id !== s.currentPresidentId; });
  switch (s.pendingPower) {
    case 'investigate': {
      var t = nonPresAlive.filter(function (p) { return !p.investigated; })[0] || nonPresAlive[0];
      SH.powerInvestigate(s, t.id); break;
    }
    case 'special_election': SH.powerSpecialElection(s, nonPresAlive[0].id); break;
    case 'policy_peek': SH.powerPolicyPeek(s); break;
    case 'execution': SH.powerExecution(s, nonPresAlive[0].id); break;
    case 'bugging': SH.powerBugging(s, nonPresAlive[0].id); break;
    case 'confession': SH.powerConfession(s); break;
    case 'five_year_plan': SH.powerFiveYearPlan(s); break;
    case 'radicalisation': SH.powerRadicalise(s, nonPresAlive[0].id); break;
    default: throw new Error('unknown power ' + s.pendingPower);
  }
}

// ---------------------------------------------------------------------------
section('communist (XL) expansion');

// Standard games are byte-for-byte unaffected: communists default to 0.
(function () {
  var d = SH.defaultConfig(7);
  ok(d.roles.communists === 0 && d.deck.communist === 0, 'communists off by default');
  ok(SH.validateConfig(d).ok, 'default config still valid with new fields');
})();

// enableCommunists builds a valid 3-faction config that sums and warns "experimental".
(function () {
  var c = SH.enableCommunists(SH.defaultConfig(9));
  ok(c.roles.liberals + c.roles.fascists + c.roles.communists + 1 === 9, '9p communist roles sum to 9');
  ok(c.roles.communists === 2, '9p gets 2 communists');
  var v = SH.validateConfig(c);
  ok(v.ok, 'communist config validates');
  ok(v.warnings.some(function (w) { return /experimental/.test(w); }), 'communist mode warns experimental');
})();

// Role-sum validation accounts for communists.
(function () {
  var c = SH.enableCommunists(SH.defaultConfig(7));
  c.roles.communists = 3; // now sums wrong
  ok(!SH.validateConfig(c).ok, 'wrong communist role sum is an error');
})();

ok(SH.partyOf('liberal') === 'Liberal' && SH.partyOf('communist') === 'Communist' &&
  SH.partyOf('fascist') === 'Fascist' && SH.partyOf('hitler') === 'Fascist', 'partyOf maps Hitler -> Fascist');

// Communist night knowledge: communists see each other, not fascists.
(function () {
  var s = SH.newGame(SH.enableCommunists(SH.defaultConfig(9)), 4242);
  var comms = s.players.filter(function (p) { return p.role === 'communist'; });
  ok(comms.length === 2, 'dealt 2 communists');
  var info = SH.revealInfo(s, comms[0].id);
  ok(info.knows.length === 1 && info.knows[0].label === 'Communist', 'a communist sees the other communist');
})();

// Communist policies enact onto their own track and can win.
(function () {
  var s = SH.newGame(SH.enableCommunists(SH.defaultConfig(7)), 5);
  s.communistPolicies = s.config.win.communist - 1;
  s.phase = 'legislative_chancellor';
  s.chancellorPolicies = ['C', 'L'];
  SH.chancellorEnact(s, 0); // enact the communist policy -> win
  ok(s.winner === 'communist', 'communists win at their policy threshold');
})();

// Radicalisation converts a non-Hitler; Hitler is immune.
(function () {
  var s = SH.newGame(SH.enableCommunists(SH.defaultConfig(7)), 6);
  var lib = s.players.filter(function (p) { return p.role === 'liberal' && p.id !== s.currentPresidentId; })[0];
  s.phase = 'power'; s.pendingPower = 'radicalisation';
  var okConv = SH.powerRadicalise(s, lib.id);
  ok(okConv === true && SH.getPlayer(s, lib.id).role === 'communist', 'radicalised a Liberal into a Communist');

  var s2 = SH.newGame(SH.enableCommunists(SH.defaultConfig(7)), 7);
  var hit = s2.players.filter(function (p) { return p.role === 'hitler' && p.id !== s2.currentPresidentId; })[0];
  if (hit) {
    s2.phase = 'power'; s2.pendingPower = 'radicalisation';
    var okH = SH.powerRadicalise(s2, hit.id);
    ok(okH === false && SH.getPlayer(s2, hit.id).role === 'hitler', 'Hitler is immune to radicalisation');
  } else { ok(true, 'hitler was president this seed; skip immunity check'); }
})();

// Confession reveals the President's party publicly; Five-Year Plan grows the deck.
(function () {
  var s = SH.newGame(SH.enableCommunists(SH.defaultConfig(7)), 8);
  s.phase = 'power'; s.pendingPower = 'confession';
  var presId = s.currentPresidentId; // confession finishes the power and advances the round
  var party = SH.powerConfession(s);
  ok(SH.getPlayer(s, presId).partyRevealed === party, 'confession sets public partyRevealed');

  var s2 = SH.newGame(SH.enableCommunists(SH.defaultConfig(7)), 9);
  var before = s2.deck.length;
  s2.phase = 'power'; s2.pendingPower = 'five_year_plan';
  SH.powerFiveYearPlan(s2);
  ok(s2.deck.length === before + 3, 'five-year plan adds 3 tiles to the deck');
})();

// ---------------------------------------------------------------------------
section('fuzz: full random playthroughs');

function rngInt(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rngInt(arr.length)]; }

function playRandomGame(pc, seed, cfg) {
  var s = SH.newGame(cfg || SH.defaultConfig(pc), seed);
  var communist = (s.config.roles.communists || 0) > 0;
  var label = pc + 'p' + (communist ? '/XL' : '');
  SH.beginPlay(s);
  var guard = 0;
  while (s.phase !== 'game_over' && guard++ < 5000) {
    switch (s.phase) {
      case 'nomination': {
        var elig = SH.nominationCandidates(s).ids;
        if (elig.length === 0) throw new Error('deadlock at ' + SH.aliveCount(s) + ' alive');
        SH.nominate(s, pick(elig));
        break;
      }
      case 'voting': {
        SH.alivePlayers(s).forEach(function (p) { SH.castVote(s, p.id, Math.random() < 0.6 ? 'ja' : 'nein'); });
        SH.resolveVotes(s);
        break;
      }
      case 'legislative_president':
        SH.presidentDiscard(s, rngInt(3));
        break;
      case 'legislative_chancellor':
        SH.chancellorEnact(s, rngInt(2));
        break;
      case 'veto_consent':
        SH.presidentConsentVeto(s, Math.random() < 0.5);
        break;
      case 'power':
        resolveAnyPower(s);
        break;
      default:
        throw new Error('unexpected phase ' + s.phase);
    }
  }
  ok(s.phase === 'game_over', label + ' seed ' + seed + ' terminated (guard ' + guard + ')');
  ok(['liberal', 'fascist', 'communist'].indexOf(s.winner) !== -1, label + ' produced a winner');
  ok(s.liberalPolicies <= s.config.win.liberal && s.fascistPolicies <= s.config.win.fascist, label + ' policy counts within bounds');
  if (!communist) {
    var rc = { liberal: 0, fascist: 0, hitler: 0 };
    s.players.forEach(function (p) { rc[p.role]++; });
    ok(rc.liberal === s.config.roles.liberals && rc.fascist === s.config.roles.fascists && rc.hitler === 1, label + ' roles preserved');
  }
  return s;
}

var winTally = { liberal: 0, fascist: 0 };
[5, 6, 7, 8, 9, 10].forEach(function (pc) {
  for (var g = 0; g < 40; g++) {
    var s = playRandomGame(pc, (pc * 1000 + g + 1));
    if (s.winner) winTally[s.winner]++;
  }
});
console.log('  random-play win split:', JSON.stringify(winTally), '(sanity only, not a balance claim)');

// 3-faction (Communist XL) fuzz: must also always terminate with a valid winner.
var xlTally = { liberal: 0, fascist: 0, communist: 0 };
[7, 8, 9, 10].forEach(function (pc) {
  var cfg = SH.enableCommunists(SH.defaultConfig(pc));
  for (var g = 0; g < 25; g++) {
    var s = playRandomGame(pc, (pc * 7919 + g + 1), JSON.parse(JSON.stringify(cfg)));
    if (s.winner) xlTally[s.winner]++;
  }
});
console.log('  XL random-play win split:', JSON.stringify(xlTally), '(sanity only)');

// ---------------------------------------------------------------------------
section('bot brain: full bot-vs-bot games');

function playBotGame(cfg, seed) {
  var s = SH.newGame(cfg, seed);
  SH.beginPlay(s);
  var guard = 0;
  while (s.phase !== 'game_over' && guard++ < 6000) {
    switch (s.phase) {
      case 'nomination':
        SH.nominate(s, Bot.nominate(s, s.currentPresidentId, SH.nominationCandidates(s).ids));
        break;
      case 'voting':
        SH.alivePlayers(s).forEach(function (p) { SH.castVote(s, p.id, Bot.vote(s, p.id)); });
        SH.resolveVotes(s);
        break;
      case 'legislative_president':
        SH.presidentDiscard(s, Bot.presidentDiscard(s, s.currentPresidentId));
        break;
      case 'legislative_chancellor': {
        var act = Bot.chancellorAction(s, s.nomineeChancellorId);
        if (act.veto) SH.chancellorRequestVeto(s); else SH.chancellorEnact(s, act.index);
        break;
      }
      case 'veto_consent':
        SH.presidentConsentVeto(s, Bot.vetoConsent(s, s.currentPresidentId));
        break;
      case 'power': {
        var pres = s.currentPresidentId, power = s.pendingPower;
        var targets = SH.alivePlayers(s).filter(function (p) { return p.id !== pres && !(power === 'investigate' && p.investigated); }).map(function (p) { return p.id; });
        var t = Bot.powerTarget(s, pres, power, targets);
        if (power === 'investigate') SH.powerInvestigate(s, t);
        else if (power === 'bugging') SH.powerBugging(s, t);
        else if (power === 'special_election') SH.powerSpecialElection(s, t);
        else if (power === 'execution') SH.powerExecution(s, t);
        else if (power === 'policy_peek') SH.powerPolicyPeek(s);
        else if (power === 'confession') SH.powerConfession(s);
        else if (power === 'five_year_plan') SH.powerFiveYearPlan(s);
        else if (power === 'radicalisation') SH.powerRadicalise(s, t);
        else throw new Error('unknown power ' + power);
        break;
      }
      default: throw new Error('unexpected phase ' + s.phase);
    }
  }
  ok(s.phase === 'game_over', 'bot game terminated (guard ' + guard + ')');
  ok(['liberal', 'fascist', 'communist'].indexOf(s.winner) !== -1, 'bot game produced a winner');
  return s;
}

var botTally = { liberal: 0, fascist: 0, communist: 0 };
[5, 6, 7, 8, 9, 10].forEach(function (pc) {
  for (var g = 0; g < 20; g++) botTally[playBotGame(SH.defaultConfig(pc), pc * 13 + g + 1).winner]++;
});
[8, 9, 10].forEach(function (pc) {
  for (var g = 0; g < 12; g++) botTally[playBotGame(SH.enableCommunists(SH.defaultConfig(pc)), pc * 17 + g + 1).winner]++;
});
ok(botTally.liberal > 0 && botTally.fascist > 0, 'bots produce wins for both Liberals and Fascists (not degenerate)');
console.log('  bot-vs-bot win split:', JSON.stringify(botTally), '(sanity only)');

// ---------------------------------------------------------------------------
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES PRESENT') + ': ' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail === 0 ? 0 : 1);
