/*
 * ui.smoke.test.js — headless smoke test for ui.js.
 *
 * Stubs a minimal DOM, loads the real engine + UI, and drives complete games
 * through the actual UI action handlers (not the engine directly). This catches
 * UI<->engine wiring bugs: wrong action names, arg parsing, gating/handoff logic,
 * and the post-power private-result screen — none of which the engine test sees.
 *
 * Run: node tests/ui.smoke.test.js
 */
'use strict';

// ---- minimal DOM / browser stubs (must exist before requiring the modules) --
var appEl = { innerHTML: '', scrollTop: 0, addEventListener: function () {} };
var store = {};
global.window = { addEventListener: function () {}, scrollTo: function () {} };
global.document = {
  getElementById: function () { return appEl; },
  addEventListener: function () {},
  readyState: 'complete'
};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
global.confirm = function () { return true; };

var SH = require('../assets/sh-engine.js');
global.window.SH = SH;
var Bot = require('../assets/sh-bot.js');
global.window.SHBot = Bot;
var UI = require('../assets/ui.js');

var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL: ' + msg); } }
function rint(n) { return Math.floor(Math.random() * n); }
function pick(a) { return a[rint(a.length)]; }

function expectRendered(label) {
  ok(typeof appEl.innerHTML === 'string' && appEl.innerHTML.length > 0, label + ': produced HTML');
}

function driveVoting(G, u, mode) {
  var alive = SH.alivePlayers(G);
  if (mode === 'table') {
    if (Math.random() < 0.25) { // sometimes exercise the exact-tally path
      var target = rint(alive.length + 1);
      var cur = (UI.state().ui.jaCount || 0);
      while (cur < target) { UI.handle('jaInc'); cur++; }
      UI.handle('quickCount');
    } else {
      UI.handle('quickResult', Math.random() < 0.6 ? 'pass' : 'fail');
    }
    return;
  }
  if (mode === 'open') {
    if (u.voteIdx >= alive.length) { UI.handle('resolveVotes'); return; }
    alive.forEach(function (p) { UI.handle('openSet', p.id + ':' + (Math.random() < 0.6 ? 'ja' : 'nein')); });
    UI.handle('openSubmit');
    return;
  }
  // secret
  if (u.voteIdx >= alive.length) { UI.handle('resolveVotes'); return; }
  if (u.voterGate) UI.handle('voteReveal');
  else UI.handle('vote', Math.random() < 0.6 ? 'ja' : 'nein');
}

function drivePower(G, u) {
  if (u.gate) { UI.handle('ungate'); return; }
  var pres = G.currentPresidentId;
  var others = G.players.filter(function (p) { return p.alive && p.id !== pres; });
  switch (G.pendingPower) {
    case 'investigate': {
      var t = others.filter(function (p) { return !p.investigated; })[0] || others[0];
      UI.handle('doInvestigate', t.id); break;
    }
    case 'bugging': UI.handle('doBugging', pick(others).id); break;
    case 'special_election': UI.handle('doSpecial', pick(others).id); break;
    case 'policy_peek': UI.handle('doPeek'); break;
    case 'execution': UI.handle('doExecute', pick(others).id); break;
    case 'radicalisation': UI.handle('doRadicalise', pick(others).id); break;
    case 'confession': UI.handle('doConfess'); break;
    case 'five_year_plan': UI.handle('doFiveYear'); break;
    default: throw new Error('unknown power ' + G.pendingPower);
  }
}

function playUI(pc, mode, revealVotes, communist) {
  var d = SH.defaultConfig(pc);
  d.votingMode = mode;
  if (revealVotes === false) d.revealVotes = false;
  if (communist) d = SH.enableCommunists(d);
  var label = pc + 'p/' + mode + (communist ? '/XL' : '');
  UI.setDraft(d);
  UI.handle('startGame');
  expectRendered(label + ' start');

  // reveal (night phase)
  UI.handle('revealStart');
  var n = UI.state().G.players.length;
  for (var i = 0; i < n; i++) { UI.handle('revealShow'); UI.handle('revealNext'); }
  UI.handle('beginPlay');

  var sawPowerResult = false, sawConversion = false;
  var guard = 0;
  while (true) {
    var st = UI.state(); var G = st.G; var u = st.ui;
    if (G.phase === 'game_over') break;
    if (guard++ > 8000) { ok(false, label + ' UI loop guard tripped'); break; }
    // private overlays exist regardless of engine phase — dismiss them faithfully
    if (u.powerResult) { sawPowerResult = true; UI.handle('powerDone'); expectRendered(label + ' powerResult'); continue; }
    if (u.conversionReveal) { sawConversion = true; UI.handle(u.conversionReveal.gate ? 'convReveal' : 'convDone'); expectRendered(label + ' conversion'); continue; }
    switch (G.phase) {
      case 'nomination': {
        var elig = SH.nominationCandidates(G).ids;
        ok(elig.length > 0, label + ' has a chancellor candidate');
        UI.handle('nominate', pick(elig));
        break;
      }
      case 'voting': driveVoting(G, u, mode); break;
      case 'legislative_president':
        if (u.gate) UI.handle('ungate'); else UI.handle('presDiscard', String(rint(3)));
        break;
      case 'legislative_chancellor':
        if (u.gate) UI.handle('ungate'); else UI.handle('chancEnact', String(rint(2)));
        break;
      case 'veto_consent':
        if (u.gate) UI.handle('ungate'); else UI.handle('consentVeto', Math.random() < 0.5 ? '1' : '0');
        break;
      case 'power': drivePower(G, u); break;
      default: ok(false, 'unexpected phase ' + G.phase); guard = 9999; break;
    }
    expectRendered(label + ' step');
  }
  var fin = UI.state().G;
  ok(['liberal', 'fascist', 'communist'].indexOf(fin.winner) !== -1, label + ' produced a winner');
  expectRendered(label + ' game over');
  return { sawPowerResult: sawPowerResult, sawConversion: sawConversion, winner: fin.winner };
}

console.log('# headless UI smoke test');

// static screens render without a game
UI.setView('home'); UI.render(); expectRendered('home');
UI.setView('rules'); UI.render(); expectRendered('rules');
UI.setView('home'); UI.render();

var anyPowerResult = false;
['table', 'open', 'secret'].forEach(function (mode) {
  [5, 7, 9].forEach(function (pc) {
    for (var g = 0; g < 8; g++) {
      var r = playUI(pc, mode, true);
      if (r.sawPowerResult) anyPowerResult = true;
    }
  });
});
// a game with anonymous votes (revealVotes=false) should still play through
playUI(7, 'secret', false);

// Communist (XL) 3-faction games through the full UI (incl. new power screens).
var anyConversion = false;
['table', 'secret'].forEach(function (mode) {
  [8, 9, 10].forEach(function (pc) {
    for (var g = 0; g < 6; g++) {
      var r = playUI(pc, mode, true, true);
      if (r.sawConversion) anyConversion = true;
      if (r.sawPowerResult) anyPowerResult = true;
    }
  });
});
ok(anyConversion, 'an XL game exercised the radicalisation conversion reveal');

// ---- bot play -------------------------------------------------------------
console.log('# bot play');

// All-bot games fully driven by the bot auto-player (botStep).
function playBotUI(pc, communist) {
  var d = SH.defaultConfig(pc);
  if (communist) d = SH.enableCommunists(d);
  d.bots = pc; // every seat is AI
  UI.setDraft(d);
  UI.handle('startGame');
  var label = pc + 'p all-bot' + (communist ? '/XL' : '');
  var guard = 0;
  while (UI.state().G.phase !== 'game_over') {
    if (guard++ > 9000) { ok(false, label + ' loop guard'); break; }
    if (!UI.botStep()) { ok(false, label + ' stuck at ' + UI.state().G.phase); break; }
    expectRendered(label + ' step');
  }
  ok(UI.state().G.phase === 'game_over', label + ' terminated');
  ok(['liberal', 'fascist', 'communist'].indexOf(UI.state().G.winner) !== -1, label + ' winner');
}
[5, 7, 9].forEach(function (pc) { for (var g = 0; g < 4; g++) playBotUI(pc, false); });
[8, 9].forEach(function (pc) { for (var g = 0; g < 3; g++) playBotUI(pc, true); });

// Mixed human+bot game driven by botStep + a human fallback for the human seats.
function playMixedUI(pc, bots) {
  var d = SH.defaultConfig(pc); d.bots = bots; d.votingMode = 'secret';
  UI.setDraft(d);
  UI.handle('startGame');
  var label = pc + 'p+' + bots + 'bots';
  UI.handle('revealStart');
  var humans = pc - bots;
  for (var i = 0; i < humans; i++) { UI.handle('revealShow'); UI.handle('revealNext'); }
  UI.handle('beginPlay');
  var guard = 0;
  while (UI.state().G.phase !== 'game_over') {
    if (guard++ > 9000) { ok(false, label + ' loop guard'); break; }
    if (UI.botStep()) { expectRendered(label + ' bot'); continue; }
    var st = UI.state(), G = st.G, u = st.ui;
    if (u.powerResult) { UI.handle('powerDone'); continue; }
    if (u.conversionReveal) { UI.handle(u.conversionReveal.gate ? 'convReveal' : 'convDone'); continue; }
    switch (G.phase) {
      case 'nomination': UI.handle('nominate', pick(SH.nominationCandidates(G).ids)); break;
      case 'voting': {
        var ha = SH.alivePlayers(G).filter(function (p) { return !p.isBot; });
        if (u.voteIdx >= ha.length) { UI.handle('resolveVotes'); break; }
        if (u.voterGate) UI.handle('voteReveal'); else UI.handle('vote', Math.random() < 0.6 ? 'ja' : 'nein');
        break;
      }
      case 'legislative_president': if (u.gate) UI.handle('ungate'); else UI.handle('presDiscard', String(rint(3))); break;
      case 'legislative_chancellor': if (u.gate) UI.handle('ungate'); else UI.handle('chancEnact', String(rint(2))); break;
      case 'veto_consent': if (u.gate) UI.handle('ungate'); else UI.handle('consentVeto', '1'); break;
      case 'power': if (u.gate) UI.handle('ungate'); else drivePower(G, u); break;
      default: ok(false, label + ' unexpected ' + G.phase); guard = 9999;
    }
    expectRendered(label + ' human');
  }
  ok(UI.state().G.phase === 'game_over', label + ' terminated');
}
playMixedUI(7, 3);
playMixedUI(9, 5);
playMixedUI(8, 2);

ok(anyPowerResult, 'at least one game surfaced a private power-result screen (investigate/peek path works)');

// new polish screens render without throwing
UI.handle('recap'); expectRendered('recap'); UI.handle('backFromRecap'); expectRendered('back from recap');
UI.setView('settings'); UI.render(); expectRendered('settings');
UI.handle('toggleSetting', 'tips'); expectRendered('toggle tips');
UI.handle('toggleSetting', 'sound'); expectRendered('toggle sound');
UI.setView('home'); UI.render();
UI.handle('newgame'); UI.handle('applyPreset', 'fast'); expectRendered('apply preset');
ok(UI.state().draft.electionTrackerMax === 2, 'fast preset applied to draft');

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES PRESENT') + ': ' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail === 0 ? 0 : 1);
