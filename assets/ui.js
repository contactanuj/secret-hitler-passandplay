/*
 * ui.js — pass-and-play UI for Secret Hitler. Browser-only (uses the DOM).
 * Depends on the SH engine (window.SH), inlined before this script by build.js.
 *
 * One device is passed around the table. All hidden information (roles, votes,
 * drawn policies, investigation results) is shown only behind a "pass the device
 * to X" gate so the holder sees it privately.
 */
(function () {
  'use strict';
  var SH = window.SH;
  var Bot = window.SHBot;
  var app = document.getElementById('app');
  var KEY = 'sh_state_v1';
  var BOT_DELAY = 650; // ms pause before a bot acts, so humans can follow

  var G = null;        // engine game state (or null)
  var draft = null;    // setup config being edited
  var view = 'home';   // 'home' | 'setup' | 'rules' | 'game' | 'log'
  var ui = {};         // transient per-screen UI state (not persisted meaningfully)
  var lastScreenKey = null; // for scroll-to-top only on real screen changes
  var revealTimer = null;   // setInterval handle for the timed secret reveal
  var REVEAL_SECONDS = 8;   // a revealed role auto-hides after this many seconds

  // Inline SVG icons (render identically across WebViews, unlike emoji).
  var GEAR_SVG = '<svg class="ic" viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M19.4 13c.04-.33.06-.66.06-1s-.02-.67-.06-1l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.3 7.3 0 0 0-1.73-1l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.5.42l-.38 2.65c-.63.26-1.21.6-1.73 1l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64L4.6 11c-.04.33-.06.66-.06 1s.02.67.06 1l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.42.32.6.22l2.49-1c.52.4 1.1.74 1.73 1l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.63-.26 1.21-.6 1.73-1l2.49 1c.18.1.46.02.6-.22l2-3.46a.5.5 0 0 0-.12-.64L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>';

  var SETTINGS_KEY = 'sh_settings_v1';
  var STATS_KEY = 'sh_stats_v1';

  // ---- persistence -------------------------------------------------------
  function save() { try { if (G) localStorage.setItem(KEY, JSON.stringify(G)); } catch (e) {} }
  function loadSaved() { try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSaved() { try { localStorage.removeItem(KEY); } catch (e) {} }

  var settings = { sound: true, tips: false, markers: true };
  function loadSettings() {
    try { var s = localStorage.getItem(SETTINGS_KEY); if (s) { var o = JSON.parse(s); for (var k in o) settings[k] = o[k]; } } catch (e) {}
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }

  function loadStats() { try { var s = localStorage.getItem(STATS_KEY); return s ? JSON.parse(s) : { games: 0, liberal: 0, fascist: 0 }; } catch (e) { return { games: 0, liberal: 0, fascist: 0 }; } }
  function recordResult(winner) {
    var st = loadStats();
    st.games++; st[winner] = (st[winner] || 0) + 1;
    try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch (e) {}
  }

  // ---- sound (guarded; no-ops without WebAudio, e.g. in tests) -----------
  function sfx(name) { try { if (settings.sound && window.SHSound) window.SHSound.play(name); } catch (e) {} }
  function soundAfterVote() { if (!G || G.phase === 'game_over') return; sfx(G.phase === 'legislative_president' ? 'elected' : 'rejected'); }

  // ---- small helpers -----------------------------------------------------
  function esc(s) {
    return ('' + (s == null ? '' : s)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function seed() { return ((Date.now() >>> 0) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0; }
  function nameOf(id) { return G ? SH.nameOf(G, id) : '?'; }
  function setUiPhase() {
    // reset per-phase transient state when the engine phase changes
    if (ui.phase !== G.phase) {
      ui.phase = G.phase;
      ui.gate = true;          // most phases start gated behind a handoff
      ui.voteIdx = 0;
      ui.voterGate = true;
      ui.showResult = false;
      ui.confirm = null;
      ui.openVotes = null;     // 'open' voting selections
      ui.jaCount = null;       // 'table' voting exact-tally stepper
      // NOTE: ui.powerResult is intentionally NOT reset here. A power (investigate/
      // peek) advances the engine to the next round immediately, so the private
      // result must survive that phase change until the President taps "continue".
    }
  }

  // ===========================================================================
  // RENDER DISPATCH
  // ===========================================================================
  function render() {
    if (view === 'game' && G) { setUiPhase(); }
    // Centralized game-over side effects (recorded once per game).
    if (view === 'game' && G && G.phase === 'game_over' && !G._recorded) {
      G._recorded = true; recordResult(G.winner); sfx(G.winner === 'liberal' ? 'winLib' : 'winFas'); save();
    }
    var html;
    if (view === 'home') html = renderHome();
    else if (view === 'setup') html = renderSetup();
    else if (view === 'rules') html = renderRules();
    else if (view === 'log') html = renderLog();
    else if (view === 'settings') html = renderSettings();
    else if (view === 'recap') html = renderRecap();
    else if (view === 'game') html = renderGame();
    else html = renderHome();
    app.innerHTML = html;
    // Only jump to the top on a genuine screen change — NOT on every re-render —
    // so input within a screen (steppers, votes, board taps) keeps your scroll spot.
    var key = screenKey();
    if (key !== lastScreenKey) {
      app.scrollTop = 0;
      try { window.scrollTo(0, 0); } catch (e) {}
      lastScreenKey = key;
    }
    scheduleBots();
  }

  // Identifies "which screen" is shown, so re-renders of the same screen don't scroll.
  function screenKey() {
    if (view !== 'game' || !G) return view;
    var u = ui;
    return 'game:' + G.phase +
      (u.gate ? ':g' : '') + (u.voterGate ? ':vg' : '') +
      (u.revealIntro ? ':in' : '') + (u.revealShown ? ':sh' : '') +
      (u.powerResult ? ':pr' : '') + (u.conversionReveal ? ':cr' : '') +
      (u.gameMenu ? ':menu' : '') +
      (u.recheck ? ':rc' + u.recheck.stage + (u.recheck.pid || '') : '') +
      (u.revealIdx != null ? ':r' + u.revealIdx : '') +
      (u.voteIdx != null ? ':v' + u.voteIdx : '');
  }

  // ===========================================================================
  // BOT AUTO-PLAY
  // ===========================================================================
  function castBotVotes() {
    if (!G || G.phase !== 'voting') return false;
    var any = false;
    SH.alivePlayers(G).forEach(function (p) {
      if (p.isBot && !G.votes[p.id]) { SH.castVote(G, p.id, Bot.vote(G, p.id)); any = true; }
    });
    return any;
  }

  function botTargets(power) {
    var pres = G.currentPresidentId;
    return G.players.filter(function (p) {
      return p.alive && p.id !== pres && !(power === 'investigate' && p.investigated);
    }).map(function (p) { return p.id; });
  }

  function applyBotPower(pres) {
    var power = G.pendingPower;
    switch (power) {
      case 'investigate': SH.powerInvestigate(G, Bot.powerTarget(G, pres.id, power, botTargets(power))); break;
      case 'bugging': SH.powerBugging(G, Bot.powerTarget(G, pres.id, power, botTargets(power))); break;
      case 'special_election': SH.powerSpecialElection(G, Bot.powerTarget(G, pres.id, power, botTargets(power))); break;
      case 'execution': SH.powerExecution(G, Bot.powerTarget(G, pres.id, power, botTargets(power))); break;
      case 'policy_peek': SH.powerPolicyPeek(G); break;
      case 'confession': SH.powerConfession(G); break;
      case 'five_year_plan': SH.powerFiveYearPlan(G); break;
      case 'radicalisation': {
        var tgt = Bot.powerTarget(G, pres.id, power, botTargets(power));
        var success = SH.powerRadicalise(G, tgt);
        var tp = SH.getPlayer(G, tgt);
        if (tp && !tp.isBot) ui.conversionReveal = { targetId: tgt, success: success, gate: true };
        break;
      }
    }
    sfx('power');
  }

  // Is the current required actor a bot (so the app should auto-play)?
  function botCanAct() {
    if (!G || view !== 'game' || G.phase === 'game_over') return false;
    if (ui.powerResult || ui.conversionReveal) return false; // human must dismiss a private reveal
    var hasHumans = G.players.some(function (p) { return !p.isBot; });
    if (G.phase === 'reveal') return !hasHumans;
    var pres = SH.getPlayer(G, G.currentPresidentId);
    switch (G.phase) {
      case 'nomination': return pres.isBot;
      case 'voting': {
        var humanAlive = SH.alivePlayers(G).filter(function (p) { return !p.isBot; });
        var botsPending = SH.alivePlayers(G).some(function (p) { return p.isBot && !G.votes[p.id]; });
        return botsPending || humanAlive.length === 0;
      }
      case 'legislative_president': return pres.isBot;
      case 'legislative_chancellor': return SH.getPlayer(G, G.nomineeChancellorId).isBot;
      case 'veto_consent': return pres.isBot;
      case 'power': return pres.isBot;
      default: return false;
    }
  }

  // Perform ONE automatic step; returns true if it acted.
  function botStep() {
    if (!botCanAct()) return false;
    var hasHumans = G.players.some(function (p) { return !p.isBot; });
    if (G.phase === 'reveal') {
      if (ui.revealIntro) { ui.revealIntro = false; render(); return true; }
      SH.beginPlay(G); ui = {}; save(); render(); return true;
    }
    var pres = SH.getPlayer(G, G.currentPresidentId);
    switch (G.phase) {
      case 'nomination':
        SH.nominate(G, Bot.nominate(G, pres.id, SH.nominationCandidates(G).ids)); sfx('tap'); save(); render(); return true;
      case 'voting': {
        if (castBotVotes()) { save(); render(); return true; }
        var humanAlive = SH.alivePlayers(G).filter(function (p) { return !p.isBot; });
        if (humanAlive.length === 0) { SH.resolveVotes(G); soundAfterVote(); save(); render(); return true; }
        return false;
      }
      case 'legislative_president':
        SH.presidentDiscard(G, Bot.presidentDiscard(G, pres.id)); sfx('tap'); save(); render(); return true;
      case 'legislative_chancellor': {
        var ch = SH.getPlayer(G, G.nomineeChancellorId);
        var act = Bot.chancellorAction(G, ch.id);
        if (act.veto) { SH.chancellorRequestVeto(G); }
        else { var col = G.chancellorPolicies[act.index]; SH.chancellorEnact(G, act.index); sfx(col === 'L' ? 'policyLib' : (col === 'C' ? 'power' : 'policyFas')); if (G.phase === 'power') sfx('power'); }
        save(); render(); return true;
      }
      case 'veto_consent':
        SH.presidentConsentVeto(G, Bot.vetoConsent(G, pres.id)); soundAfterVote(); save(); render(); return true;
      case 'power':
        applyBotPower(pres); save(); render(); return true;
      default: return false;
    }
  }

  function scheduleBots() {
    if (ui._botTimer) { try { clearTimeout(ui._botTimer); } catch (e) {} ui._botTimer = null; }
    if (botCanAct()) {
      ui._botTimer = setTimeout(function () { ui._botTimer = null; botStep(); }, BOT_DELAY);
    }
  }

  // ===========================================================================
  // HOME
  // ===========================================================================
  function renderHome() {
    var saved = loadSaved();
    var resume = (saved && saved.phase !== 'game_over')
      ? '<button class="btn primary" data-action="resume">Resume game (' + esc(saved.players.length) + ' players)</button>'
      : '';
    var st = loadStats();
    var statsLine = st.games > 0
      ? '<p class="small muted center">' + st.games + ' games played · Liberals ' + (st.liberal || 0) + ' · Fascists ' + (st.fascist || 0) + (st.communist ? ' · Communists ' + st.communist : '') + '</p>'
      : '';
    return [
      '<div class="center hero" style="padding-top:30px">',
      '<div class="emblem"><svg viewBox="0 0 124 100" width="108" height="88" font-family="system-ui, -apple-system, sans-serif">' +
      '<g transform="rotate(-14 54 56)"><rect x="34" y="26" width="40" height="60" rx="6" fill="#3478bc" stroke="#7ab0e0" stroke-width="2.4"/><text x="54" y="62" text-anchor="middle" font-size="26" font-weight="800" fill="#efe7da">L</text></g>' +
      '<g transform="rotate(14 70 56)"><rect x="50" y="26" width="40" height="60" rx="6" fill="#c64232" stroke="#e27a6a" stroke-width="2.4"/><text x="70" y="62" text-anchor="middle" font-size="26" font-weight="800" fill="#efe7da">F</text></g>' +
      '</svg></div>',
      '<h1>SECRET HITLER</h1>',
      '<p class="muted">Pass-and-play · one device · 5–10 players</p>',
      '</div>',
      '<div class="spacer"></div>',
      resume,
      '<button class="btn primary" data-action="newgame">New game</button>',
      '<button class="btn" data-action="rules">How to play</button>',
      '<button class="btn ghost" data-action="openSettings">Settings</button>',
      statsLine,
      '<div class="spacer"></div>',
      '<p class="small muted center">A hidden-role game of deception. The app deals roles and runs the board, deck, powers, and win conditions — you bring the table talk.</p>',
      '<p class="small muted center">Secret Hitler © its creators · CC BY-NC-SA 4.0 · non-commercial.</p>'
    ].join('');
  }

  // ===========================================================================
  // SETTINGS
  // ===========================================================================
  function renderSettings() {
    var st = loadStats();
    function row(key, label, desc) {
      return '<div class="row" style="margin:14px 0"><div class="grow"><div>' + esc(label) + '</div><div class="small muted">' + esc(desc) + '</div></div>' +
        '<button class="iconbtn" data-action="toggleSetting" data-arg="' + key + '">' + (settings[key] ? 'On' : 'Off') + '</button></div>';
    }
    return [
      topbar('Settings', '<button class="iconbtn" data-action="backFromSettings">Done</button>'),
      '<div class="panel">',
      row('sound', 'Sound effects', 'Subtle synthesized cues for votes, policies, and powers.'),
      row('tips', 'Guidance tips', 'Extra on-screen hints explaining each phase — great for new groups.'),
      row('markers', 'Confirmed-not-Hitler markers', 'Mark players proven not to be Hitler (elected Chancellor after 3 Fascist policies).'),
      '</div>',
      '<div class="panel"><h3>This device</h3>',
      '<div class="kv"><span>Games played</span><span>' + st.games + '</span></div>',
      '<div class="kv"><span>Liberal wins</span><span>' + (st.liberal || 0) + '</span></div>',
      '<div class="kv"><span>Fascist wins</span><span>' + (st.fascist || 0) + '</span></div>',
      '</div>'
    ].join('');
  }

  // ===========================================================================
  // SETUP + CONFIGURATION (with live validation)
  // ===========================================================================
  function newDraft(pc) {
    var names = (draft && draft.playerNames) ? draft.playerNames.slice() : [];
    var d = SH.defaultConfig(pc, names.length ? names : null);
    return d;
  }

  function resizeNames(d) {
    while (d.playerNames.length < d.playerCount) d.playerNames.push('Player ' + (d.playerNames.length + 1));
    d.playerNames.length = d.playerCount;
  }

  function applyBotSeats(d) {
    var humanCount = d.playerCount - (d.bots || 0);
    for (var i = humanCount; i < d.playerCount; i++) d.playerNames[i] = 'Bot ' + (i - humanCount + 1);
  }

  function renderSetup() {
    if (!draft) draft = newDraft(7);
    resizeNames(draft);
    applyBotSeats(draft);
    var v = SH.validateConfig(draft);
    var adv = !!ui.advanced;
    var humanCount = draft.playerCount - (draft.bots || 0);

    var nameInputs = draft.playerNames.map(function (n, i) {
      if (i >= humanCount) return '<div class="kv small"><span class="muted">Seat ' + (i + 1) + '</span><span>' + esc(n) + ' <span class="badge ai">AI</span></span></div>';
      return '<input type="text" data-name-idx="' + i + '" value="' + esc(n) + '" placeholder="Player ' + (i + 1) + '" maxlength="16" />';
    }).join('');

    var advHtml = adv ? renderAdvanced(draft) : '';

    return [
      topbar('New game', '<button class="iconbtn" data-action="home">Cancel</button>'),
      renderPresetChips(),
      '<div class="panel">',
      '<h3>Players</h3>',
      stepperRow('Number of players', 'playerCount', draft.playerCount, 5, 10),
      stepperRow('Bots (AI players)', 'bots', draft.bots || 0, 0, draft.playerCount - 1),
      (draft.bots || 0) > 0 ? '<p class="small muted">AI seats play automatically. With bots, voting is on-device (table voting needs all-human).</p>' : '',
      '<label>Human names (seating order)</label>',
      nameInputs,
      '</div>',

      '<div class="panel">',
      '<div class="collapse-h" data-action="toggleAdvanced">',
      '<h3 style="margin:0">Advanced configuration</h3>',
      '<span class="iconbtn">' + (adv ? 'Hide ▲' : 'Show ▼') + '</span>',
      '</div>',
      adv ? '<p class="small muted" style="margin-top:10px">Everything below is fully editable. Invalid combinations are blocked; off-spec but playable ones are warned. Defaults match the official rules for ' + draft.playerCount + ' players.</p>' : '',
      advHtml,
      '</div>',

      renderValidation(v),

      '<button class="btn primary" data-action="startGame"' + (v.ok ? '' : ' disabled') + '>' +
        (v.ok ? 'Deal roles &amp; start' : 'Fix ' + v.errors.length + ' issue' + (v.errors.length === 1 ? '' : 's') + ' to start') + '</button>',
      '<button class="btn ghost" data-action="resetDefaults">Reset to official defaults</button>'
    ].join('');
  }

  function renderPresetChips() {
    var chips = Object.keys(SH.RULESETS).map(function (k) {
      var rs = SH.RULESETS[k];
      return '<button class="chip' + (ui.preset === k ? ' on' : '') + '" data-action="applyPreset" data-arg="' + k + '">' + esc(rs.name) + '</button>';
    }).join('');
    var desc = (ui.preset && SH.RULESETS[ui.preset]) ? SH.RULESETS[ui.preset].desc : 'Tap a rule set for a one-tap start, then tweak anything in Advanced.';
    return '<div class="panel"><h3>Rule set</h3><div class="chips">' + chips + '</div><p class="small muted">' + esc(desc) + '</p></div>';
  }

  function renderValidation(v) {
    if (v.ok && v.warnings.length === 0) {
      return '<div class="note small">Configuration is valid and matches a playable game.</div>';
    }
    var out = [];
    v.errors.forEach(function (e) { out.push('<div class="err"><span class="vtag err-tag">Blocked</span> ' + esc(e) + '</div>'); });
    v.warnings.forEach(function (w) { out.push('<div class="warn"><span class="vtag warn-tag">Note</span> ' + esc(w) + '</div>'); });
    return '<div style="margin:12px 0">' + out.join('') + '</div>';
  }

  function renderAdvanced(d) {
    var powerOptions = function (sel, isLast) {
      var opts = [['none', 'No power'], ['investigate', 'Investigate Loyalty'],
        ['special_election', 'Special Election'], ['policy_peek', 'Policy Peek'], ['execution', 'Execution']];
      if (isLast) return '<select disabled><option>Fascists win</option></select>';
      return '<select data-board-idx>' + opts.map(function (o) {
        var val = o[0] === 'none' ? 'null' : o[0];
        return '<option value="' + val + '"' + ((sel || 'null') === val ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>';
    };
    var boardRows = d.board.map(function (p, i) {
      var isLast = i === d.board.length - 1;
      return '<div class="kv"><span>' + (i + 1) + (ord(i + 1)) + ' Fascist policy</span><span style="min-width:160px">' +
        powerOptionsIndexed(p, isLast, i) + '</span></div>';
    }).join('');
    var commOn = (d.roles.communists || 0) > 0;
    var fascMax = Math.max(1, d.playerCount - (d.roles.communists || 0) - 2); // keep Liberals >= 1

    return [
      '<div class="spacer"></div>',
      '<h3>Roles</h3>',
      '<p class="small muted">Liberals fill the rest automatically, so the roles always match the player count.</p>',
      '<div class="kv"><span>Liberals <span class="muted">(auto)</span></span><span><b>' + d.roles.liberals + '</b></span></div>',
      stepperRow('Fascists (excl. Hitler)', 'roles.fascists', d.roles.fascists, 1, fascMax),
      commOn ? '<div class="kv"><span>Communists</span><span><b>' + d.roles.communists + '</b> <span class="small muted">(set below)</span></span></div>' : '',
      '<div class="kv"><span>Hitler</span><span>1</span></div>',
      '<div class="kv small"><span>Total</span><span>' + d.playerCount + ' / ' + d.playerCount + '</span></div>',
      checkboxRow('Hitler knows the Fascists (night phase)', 'hitlerKnowsFascists', d.hitlerKnowsFascists),

      '<div class="spacer"></div>',
      '<h3>Policy deck</h3>',
      stepperRow('Liberal tiles', 'deck.liberal', d.deck.liberal, 0, 40),
      stepperRow('Fascist tiles', 'deck.fascist', d.deck.fascist, 0, 40),

      '<div class="spacer"></div>',
      '<h3>Win conditions</h3>',
      stepperRow('Liberal policies to win', 'win.liberal', d.win.liberal, 1, 20),
      stepperRow('Fascist policies to win', 'win.fascist', d.win.fascist, 1, 20),
      stepperRow('Hitler-as-Chancellor loss after N Fascist policies', 'hitlerChancellorThreshold', d.hitlerChancellorThreshold, 0, 20),

      '<div class="spacer"></div>',
      '<h3>Other</h3>',
      stepperRow('Failed elections before chaos', 'electionTrackerMax', d.electionTrackerMax, 1, 10),
      stepperRow('Veto unlocks at N Fascist policies', 'vetoUnlockAt', d.vetoUnlockAt, 1, 20),

      '<div class="spacer"></div>',
      '<h3>Voting</h3>',
      '<label>How the table votes</label>',
      '<select data-cfg-select="votingMode">',
      votingOption('table', 'Table vote — vote IRL, app records the result', d.votingMode),
      votingOption('open', 'Open — tap each vote on one shared screen', d.votingMode),
      votingOption('secret', 'Secret — pass the device to vote privately', d.votingMode),
      '</select>',
      checkboxRow('Reveal individual votes (official: on)', 'revealVotes', d.revealVotes),
      '<p class="small muted">The phone is still passed for hidden info (roles, the policy draw, investigate/peek). Only the public vote can be taken at the table.</p>',

      '<div class="spacer"></div>',
      '<h3>Fascist board powers</h3>',
      '<p class="small muted">One slot per Fascist policy up to the win threshold. The last slot is always the Fascist win.</p>',
      boardRows,

      '<div class="spacer"></div>',
      '<h3>Communist faction (XL)</h3>',
      '<div class="row" style="margin-top:8px"><div class="grow small">Add a third Communist faction — experimental</div><button class="iconbtn" data-action="toggleCommunists">' + (commOn ? 'On' : 'Off') + '</button></div>',
      commOn ? stepperRow('Communists', 'roles.communists', d.roles.communists, 1, Math.max(1, d.playerCount - d.roles.fascists - 2)) : '',
      commOn ? stepperRow('Communist tiles in deck', 'deck.communist', d.deck.communist, 0, 30) : '',
      commOn ? stepperRow('Communist policies to win', 'win.communist', d.win.communist, 1, 12) : '',
      commOn ? checkboxRow('Communists know each other', 'communistsKnowEachOther', d.communistsKnowEachOther) : '',
      commOn ? '<p class="small muted">A fun but experimental variant — balance is not officially tuned. Powers: Bugging, Radicalisation, Confession, Five-Year Plan.</p>' : ''
    ].join('');
  }

  // board power selects need indexes; render explicitly
  function powerOptionsIndexed(sel, isLast, idx) {
    if (isLast) return '<select disabled><option>Fascists win</option></select>';
    var opts = [['null', 'No power'], ['investigate', 'Investigate Loyalty'],
      ['special_election', 'Special Election'], ['policy_peek', 'Policy Peek'], ['execution', 'Execution']];
    var cur = (sel == null) ? 'null' : sel;
    return '<select data-board-idx="' + idx + '">' + opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select>';
  }

  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return (s[(v - 20) % 10] || s[v] || s[0]); }

  function votingOption(val, label, cur) {
    return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function stepperRow(label, path, val, min, max) {
    return [
      '<label>' + esc(label) + '</label>',
      '<div class="stepper" data-stepper="' + path + '" data-min="' + min + '" data-max="' + max + '">',
      '<button data-step="-1">−</button>',
      '<div class="val">' + val + '</div>',
      '<button data-step="1">+</button>',
      '</div>'
    ].join('');
  }
  function checkboxRow(label, path, val) {
    return '<div class="row" style="margin-top:12px"><div class="grow small">' + esc(label) + '</div>' +
      '<button class="iconbtn" data-toggle="' + path + '">' + (val ? 'On' : 'Off') + '</button></div>';
  }

  // ===========================================================================
  // GAME
  // ===========================================================================
  function renderGame() {
    if (G.phase === 'reveal') return renderReveal();
    if (G.phase === 'game_over') return renderGameOver();
    if (ui.gameMenu) return renderGameMenu();
    if (ui.recheck) return renderRecheck();

    // A resolved power (investigate/peek) has already advanced the engine to the
    // next round, but its PRIVATE result must still be shown to the President.
    if (ui.powerResult) {
      return [
        topbar('Round ' + G.round, ''),
        renderBoard(),
        '<div class="panel center"><h2>' + esc(ui.powerResult.title) + '</h2>' + ui.powerResult.body +
        '<button class="btn primary" data-action="powerDone">Hide &amp; continue</button></div>'
      ].join('');
    }

    // Radicalisation result is private to the TARGET (passed the device), not the President.
    if (ui.conversionReveal) {
      var cr = ui.conversionReveal;
      var t = SH.getPlayer(G, cr.targetId);
      if (cr.gate) {
        return [topbar('Round ' + G.round, ''), renderBoard(),
          passScreen(t.name, 'A power targets you — make sure only you can see the screen.', 'I am ' + esc(t.name), 'convReveal')].join('');
      }
      var cbody = cr.success
        ? '<div class="rolecard communist flip"><div class="muted">' + esc(t.name) + ', you have been</div><div class="big">RADICALISED</div><div class="small">You are now a Communist — you win with the Communist team.</div></div><p class="small muted">Keep it secret and pursue the Communist agenda.</p>'
        : '<div class="rolecard hitler flip"><div class="muted">' + esc(t.name) + '</div><div class="big">IMMUNE</div><div class="small">You cannot be radicalised — your secret role is unchanged.</div></div>';
      return [topbar('Round ' + G.round, ''), renderBoard(),
        '<div class="panel center">' + cbody + '<button class="btn primary" data-action="convDone">Hide &amp; continue</button></div>'].join('');
    }

    var body;
    switch (G.phase) {
      case 'nomination': body = renderNomination(); break;
      case 'voting': body = renderVoting(); break;
      case 'legislative_president': body = renderLegPresident(); break;
      case 'legislative_chancellor': body = renderLegChancellor(); break;
      case 'veto_consent': body = renderVetoConsent(); break;
      case 'power': body = renderPower(); break;
      default: body = '<div class="panel">Unknown phase: ' + esc(G.phase) + '</div>';
    }
    return [
      topbar('Round ' + G.round, '<button class="iconbtn" data-action="viewLog">Log</button> <button class="iconbtn" data-action="menu">Menu</button>'),
      renderBoard(),
      body
    ].join('');
  }

  function policyName(c) { return c === 'L' ? 'Liberal' : 'Fascist'; }

  function renderBoard() {
    var c = G.config;
    // Liberal track
    var lib = [];
    for (var i = 0; i < c.win.liberal; i++) {
      lib.push('<div class="slot lib' + (i < G.liberalPolicies ? ' filled' : '') + '">' + (i < G.liberalPolicies ? 'L' : '') + '</div>');
    }
    // Fascist track with powers
    var fas = [];
    for (var j = 0; j < c.win.fascist; j++) {
      var pw = c.board[j];
      var lbl = (j === c.win.fascist - 1) ? 'WIN' : powerShort(pw);
      fas.push('<div class="slot fas' + (j < G.fascistPolicies ? ' filled' : '') + '">' +
        (j < G.fascistPolicies ? 'F' : '<span class="pw">' + lbl + '</span>') + '</div>');
    }
    // Communist track (XL) — only when the expansion is enabled
    var commEnabled = (c.roles.communists || 0) > 0;
    var comm = [];
    if (commEnabled) {
      for (var ci = 0; ci < c.win.communist; ci++) {
        var cpw = c.communistBoard[ci];
        var clbl = (ci === c.win.communist - 1) ? 'WIN' : powerShort(cpw);
        comm.push('<div class="slot comm' + (ci < G.communistPolicies ? ' filled' : '') + '">' +
          (ci < G.communistPolicies ? 'C' : '<span class="pw">' + clbl + '</span>') + '</div>');
      }
    }

    // tracker dots
    var dots = [];
    for (var k = 0; k < c.electionTrackerMax; k++) dots.push('<div class="dot' + (k < G.electionTracker ? ' on' : '') + '"></div>');

    // players
    var pls = G.players.map(function (p) {
      var badges = '';
      if (p.isBot) badges += '<span class="badge ai">AI</span>';
      if (p.id === G.currentPresidentId) badges += '<span class="badge pres">PRES</span>';
      if (p.id === G.nomineeChancellorId && G.phase === 'voting') badges += '<span class="badge chanc">nominee</span>';
      if (G.lastElected && p.id === G.lastElected.chancellor) badges += '<span class="badge chanc">last Chanc</span>';
      if (settings.markers && p.clearedNotHitler && p.alive) badges += '<span class="badge">not Hitler</span>';
      if (p.partyRevealed && p.alive) badges += '<span class="badge party-' + p.partyRevealed.toLowerCase() + '">' + esc(p.partyRevealed) + '</span>';
      return '<div class="pl' + (p.alive ? '' : ' dead') + '"><span class="grow">' + esc(p.name) + '</span>' + badges + '</div>';
    }).join('');

    return [
      '<div class="panel tight">',
      '<div class="row"><div class="grow"><h3 style="margin:0">Liberal ' + G.liberalPolicies + '/' + c.win.liberal + '</h3></div></div>',
      '<div class="track">' + lib.join('') + '</div>',
      '<div class="row"><div class="grow"><h3 style="margin:0">Fascist ' + G.fascistPolicies + '/' + c.win.fascist + '</h3></div>',
      (G.vetoUnlocked ? '<span class="tag">veto unlocked</span>' : '') + '</div>',
      '<div class="track">' + fas.join('') + '</div>',
      commEnabled ? '<div class="row"><div class="grow"><h3 style="margin:0">Communist ' + G.communistPolicies + '/' + c.win.communist + '</h3></div></div>' : '',
      commEnabled ? '<div class="track">' + comm.join('') + '</div>' : '',
      '<div class="row" style="margin-top:8px"><span class="small muted grow">Election tracker</span><div class="tracker-dots">' + dots.join('') + '</div></div>',
      '<div class="small muted center" style="margin-top:8px">Liberals need ' + Math.max(0, c.win.liberal - G.liberalPolicies) + ' more · Fascists need ' + Math.max(0, c.win.fascist - G.fascistPolicies) + ' more' +
        (commEnabled ? ' · Communists need ' + Math.max(0, c.win.communist - G.communistPolicies) + ' more' : '') +
        (G.fascistPolicies >= G.config.hitlerChancellorThreshold ? ' · <b class="danger-text">Hitler as Chancellor now loses</b>' : '') + '</div>',
      '</div>',
      '<div class="panel tight"><div class="players">' + pls + '</div></div>'
    ].join('');
  }

  function tip(text) { return settings.tips ? '<div class="note small"><span class="tiptag">Tip</span> ' + esc(text) + '</div>' : ''; }

  function powerShort(p) {
    return { investigate: 'INVEST.', special_election: 'SP. ELEC', policy_peek: 'PEEK', execution: 'EXECUTE',
      bugging: 'BUG', radicalisation: 'RADICAL', confession: 'CONFESS', five_year_plan: '5-YR', win: 'WIN' }[p] || '—';
  }

  // ---- Reveal (night phase) ---------------------------------------------
  function renderReveal() {
    if (ui.revealIdx == null) { ui.revealIdx = 0; ui.revealShown = false; ui.revealIntro = true; }

    if (ui.revealIntro) {
      var nComm = G.config.roles.communists || 0;
      var compo = G.config.roles.liberals + ' Liberals · ' + G.config.roles.fascists + ' Fascist' +
        (G.config.roles.fascists === 1 ? '' : 's') +
        (nComm > 0 ? ' · ' + nComm + ' Communist' + (nComm === 1 ? '' : 's') : '') +
        ' · 1 Hitler';
      return [
        topbar('Secret roles', ''),
        '<div class="panel center">',
        '<h2>Pass the device around</h2>',
        '<p class="muted">Each player privately views their secret role. Hand the phone to the first player and don\'t let anyone else see the screen.</p>',
        '<div class="note">This game: ' + esc(compo) + '.</div>',
        G.config.hitlerKnowsFascists
          ? '<p class="small muted">Small game: Hitler will see the Fascists, and the Fascists will see Hitler.</p>'
          : '<p class="small muted">Fascists will see each other and Hitler. Hitler will <b>not</b> know who the Fascists are.</p>',
        nComm > 0 ? '<p class="small muted">Communists are a <b>third team</b> with their own track — they will see each other.</p>' : '',
        '</div>',
        '<button class="btn primary" data-action="revealStart">Begin role reveal</button>'
      ].join('');
    }

    var players = G.players.filter(function (p) { return !p.isBot; }); // bots have no reveal
    if (ui.revealIdx >= players.length) {
      return [
        topbar('Secret roles', ''),
        '<div class="panel center"><h2>' + (players.length ? 'Everyone has their role' : 'Roles dealt') + '</h2>',
        '<p class="muted">Put the device down where the table can see it. ' + esc(nameOf(G.currentPresidentId)) + ' is the first Presidential Candidate.</p></div>',
        '<button class="btn primary" data-action="beginPlay">Start the game</button>'
      ].join('');
    }

    var p = players[ui.revealIdx];
    if (!ui.revealShown) {
      return passScreen(p.name, 'Make sure only ' + esc(p.name) + ' can see the screen.', 'I am ' + esc(p.name) + ' — show my role', 'revealShow');
    }
    return [
      topbar('Secret roles', ''),
      roleCardContent(p),
      countdownBar(),
      '<button class="btn primary" data-action="revealNext">Hide &amp; pass to next</button>'
    ].join('');
  }

  // Private role-card content — used by the night reveal AND the in-game re-check.
  function roleCardContent(p) {
    var info = SH.revealInfo(G, p.id);
    var roleLabel = info.role === 'hitler' ? 'HITLER' : info.role.toUpperCase();
    var knows = '';
    if (info.knows.length) {
      knows = '<div class="note"><b>You know:</b><br>' + info.knows.map(function (k) { return esc(k.name) + ' — ' + esc(k.label); }).join('<br>') + '</div>';
    } else if (info.role === 'hitler') {
      knows = '<div class="note">You do not know your Fascists. Earn their trust and stay hidden.</div>';
    } else if (info.role === 'liberal') {
      knows = '<div class="note">You know no one. Deduce who the Fascists are.</div>';
    } else if (info.role === 'communist') {
      knows = '<div class="note">You are the lone Communist — pursue your own agenda.</div>';
    }
    var teamNote;
    if (info.role === 'liberal') teamNote = 'You win by enacting ' + G.config.win.liberal + ' Liberal Policies or by killing Hitler.';
    else if (info.role === 'communist') teamNote = 'You win by enacting ' + G.config.win.communist + ' Communist Policies — a third team, neither Liberal nor Fascist.';
    else teamNote = 'You win by enacting ' + G.config.win.fascist + ' Fascist Policies, or by electing Hitler Chancellor after ' + G.config.hitlerChancellorThreshold + ' Fascist Policies.';
    var teamLabel = info.role === 'liberal' ? 'Liberal team' : (info.role === 'communist' ? 'Communist team' : 'Fascist team');
    return [
      '<div class="rolecard ' + info.role + ' flip">',
      '<div class="muted">' + esc(p.name) + ', you are</div>',
      '<div class="big">' + roleLabel + '</div>',
      '<div class="small">' + teamLabel + '</div>',
      '</div>',
      knows,
      '<p class="small muted">' + teamNote + '</p>'
    ].join('');
  }

  function countdownBar() {
    var n = ui.revealCount != null ? ui.revealCount : REVEAL_SECONDS;
    return '<div class="countdown"><span class="cd-num">' + n + '</span> hides automatically for privacy</div>';
  }
  function startRevealCountdown(onExpire) {
    stopRevealCountdown();
    ui.revealCount = REVEAL_SECONDS;
    revealTimer = setInterval(function () {
      ui.revealCount = (ui.revealCount || 1) - 1;
      if (ui.revealCount <= 0) { stopRevealCountdown(); onExpire(); }
      else render();
    }, 1000);
  }
  function stopRevealCountdown() {
    if (revealTimer) { try { clearInterval(revealTimer); } catch (e) {} revealTimer = null; }
    ui.revealCount = null;
  }
  function doRevealNext() { stopRevealCountdown(); ui.revealIdx++; ui.revealShown = false; render(); }
  function doRecheckDone() { stopRevealCountdown(); ui.recheck = null; render(); }

  // ---- In-game re-check (safe: gated, single human, timed, bots excluded) ----
  function renderRecheck() {
    var r = ui.recheck;
    if (r.stage === 'pick') {
      var btns = G.players.filter(function (p) { return !p.isBot; }).map(function (p) {
        return '<button class="btn" data-action="recheckPick" data-arg="' + p.id + '">' + esc(p.name) + (p.alive ? '' : ' <span class="small muted">(out)</span>') + '</button>';
      }).join('');
      return [
        topbar('Check a role', '<button class="iconbtn" data-action="recheckCancel">Cancel</button>'),
        '<div class="panel"><h2>Whose role?</h2><p class="muted">Tap your own name — your role shows privately and auto-hides. (AI seats are hidden.)</p>' + btns + '</div>'
      ].join('');
    }
    var p = SH.getPlayer(G, r.pid);
    if (r.stage === 'gate') {
      return [topbar('Check a role', '<button class="iconbtn" data-action="recheckCancel">Cancel</button>'),
        passScreen(p.name, 'Make sure only ' + esc(p.name) + ' can see the screen.', 'I am ' + esc(p.name) + ' — show my role', 'recheckReveal')].join('');
    }
    return [topbar('Check a role', ''), roleCardContent(p), countdownBar(),
      '<button class="btn primary" data-action="recheckDone">Hide</button>'].join('');
  }

  function renderGameMenu() {
    return [
      topbar('Menu', '<button class="iconbtn" data-action="closeMenu">Close</button>'),
      '<button class="btn" data-action="recheckStart">Check a role</button>',
      '<button class="btn" data-action="viewLog">Event log</button>',
      '<button class="btn" data-action="openSettings">Settings</button>',
      '<button class="btn ghost" data-action="quitHome">Quit to home (game is saved)</button>'
    ].join('');
  }

  // ---- Nomination -------------------------------------------------------
  function renderNomination() {
    var pres = G.currentPresidentId;
    var nc = SH.nominationCandidates(G);
    var elig = nc.ids;
    var buttons = G.players.filter(function (p) { return p.alive && p.id !== pres; }).map(function (p) {
      var ok = elig.indexOf(p.id) !== -1;
      var reason = '';
      if (!ok) {
        if (G.lastElected.chancellor === p.id) reason = ' (last Chancellor)';
        else if (G.lastElected.president === p.id) reason = ' (last President)';
        else reason = ' (ineligible)';
      }
      return '<button class="btn' + (ok ? '' : ' ghost') + '"' + (ok ? ' data-action="nominate" data-arg="' + p.id + '"' : ' disabled') +
        '>' + esc(p.name) + (ok ? '' : '<span class="small muted">' + reason + '</span>') + '</button>';
    }).join('');
    return [
      '<div class="panel">',
      '<h2>' + esc(nameOf(pres)) + ' is President</h2>',
      '<p class="muted">Discuss, then nominate a Chancellor.' + (nc.relaxed ? '' : ' Term-limited players are greyed out.') + '</p>',
      nc.relaxed ? '<div class="warn small">No term-eligible candidate remained, so term limits are relaxed for this election.</div>' : '',
      tip('The whole table will vote Ja/Nein on this pair. Pick someone you can get approved — and watch who objects.'),
      buttons,
      '</div>'
    ].join('');
  }

  // ---- Voting (mode-dependent) ------------------------------------------
  function renderVoting() {
    castBotVotes(); // AI seats vote programmatically
    var alive = SH.alivePlayers(G);
    var humanAlive = alive.filter(function (p) { return !p.isBot; });
    var govLine = 'President ' + esc(nameOf(G.currentPresidentId)) + ' · Chancellor ' + esc(nameOf(G.nomineeChancellorId));
    var mode = G.config.votingMode;
    if (mode === 'table' && (G.config.bots || 0) > 0) mode = 'secret'; // bots can't vote at the table

    // Shared "votes are in" reveal once all HUMANS have voted (bots already have).
    if ((mode === 'secret' || mode === 'open') && ui.voteIdx >= humanAlive.length) {
      return renderTally(alive, govLine);
    }
    if (mode === 'table') return renderTableVote(alive, govLine);
    if (mode === 'open') return renderOpenVote(humanAlive, govLine);
    return renderSecretVote(humanAlive, govLine);
  }

  function renderTally(alive, govLine) {
    var ja = 0, nein = 0, rows = '';
    alive.forEach(function (p) {
      var vt = G.votes[p.id];
      if (vt === 'ja') ja++; else nein++;
      rows += '<div class="kv"><span>' + esc(p.name) + '</span><span class="' + (vt === 'ja' ? '' : 'muted') + '">' +
        (G.config.revealVotes ? (vt === 'ja' ? 'JA' : 'NEIN') : '•') + '</span></div>';
    });
    var passed = ja * 2 > alive.length;
    return [
      '<div class="panel">',
      '<h2>Votes are in</h2>',
      '<p class="muted">' + govLine + '</p>',
      G.config.revealVotes ? rows : '<p class="small muted">Individual votes are hidden (house rule).</p>',
      '<div class="kv"><b>' + ja + ' Ja / ' + nein + ' Nein</b><b class="' + (passed ? '' : 'muted') + '">' + (passed ? 'ELECTED' : 'REJECTED') + '</b></div>',
      '<button class="btn primary" data-action="resolveVotes">Continue</button>',
      '</div>'
    ].join('');
  }

  function renderTableVote(alive, govLine) {
    if (ui.jaCount == null) ui.jaCount = 0;
    return [
      '<div class="panel">',
      '<h2>Table vote</h2>',
      '<p class="muted">' + govLine + '</p>',
      '<div class="note small">Everyone votes out loud or with Ja/Nein cards at the same time. Then record the result.</div>',
      tip('A tie FAILS — you need strictly more Ja than Nein. Three failed elections in a row triggers chaos.'),
      '<div class="row" style="gap:12px;margin-top:6px">',
      '<button class="btn lib grow" data-action="quickResult" data-arg="pass">PASSED</button>',
      '<button class="btn fas grow" data-action="quickResult" data-arg="fail">FAILED</button>',
      '</div>',
      '<p class="small muted center" style="margin-top:14px">or log the exact tally</p>',
      '<div class="row" style="justify-content:center;gap:10px">',
      '<button class="iconbtn" data-action="jaDec">−</button>',
      '<div style="min-width:130px;text-align:center"><b>' + ui.jaCount + '</b> Ja / ' + (alive.length - ui.jaCount) + ' Nein</div>',
      '<button class="iconbtn" data-action="jaInc">+</button>',
      '</div>',
      '<button class="btn ghost" data-action="quickCount">Record this tally</button>',
      '</div>'
    ].join('');
  }

  function renderOpenVote(alive, govLine) {
    if (!ui.openVotes) ui.openVotes = {};
    var rows = alive.map(function (p) {
      var sel = ui.openVotes[p.id];
      return '<div class="pl"><span class="grow">' + esc(p.name) + '</span>' +
        '<button class="btn sm ' + (sel === 'ja' ? 'lib' : 'ghost') + '" data-action="openSet" data-arg="' + p.id + ':ja">Ja</button>' +
        '<button class="btn sm ' + (sel === 'nein' ? 'fas' : 'ghost') + '" data-action="openSet" data-arg="' + p.id + ':nein">Nein</button>' +
        '</div>';
    }).join('');
    var allSet = alive.every(function (p) { return ui.openVotes[p.id]; });
    return [
      '<div class="panel">',
      '<h2>Open vote</h2>',
      '<p class="muted">' + govLine + '</p>',
      '<div class="note small">Tap each player\'s public vote. Everyone can see this screen.</div>',
      '<div class="players">' + rows + '</div>',
      '<button class="btn primary" data-action="openSubmit"' + (allSet ? '' : ' disabled') + '>Reveal result</button>',
      '</div>'
    ].join('');
  }

  function renderSecretVote(alive, govLine) {
    var voter = alive[ui.voteIdx];
    if (ui.voterGate) {
      return passScreen(voter.name, 'Vote on: ' + govLine, 'I am ' + esc(voter.name) + ' — vote', 'voteReveal');
    }
    return [
      '<div class="panel center">',
      '<h3>' + esc(voter.name) + ', vote on the government</h3>',
      '<p class="muted">' + govLine + '</p>',
      '<div class="row" style="gap:12px">',
      '<button class="btn lib grow" data-action="vote" data-arg="ja">JA!</button>',
      '<button class="btn fas grow" data-action="vote" data-arg="nein">NEIN</button>',
      '</div>',
      '<p class="small muted">' + (ui.voteIdx + 1) + ' of ' + alive.length + ' voting privately</p>',
      '</div>'
    ].join('');
  }

  // ---- Legislative: President -------------------------------------------
  function renderLegPresident() {
    if (ui.gate) {
      return passScreen(nameOf(G.currentPresidentId), 'Legislative session — President only. No talking during this phase.',
        'I am ' + esc(nameOf(G.currentPresidentId)) + ' (President)', 'ungate');
    }
    var tiles = G.drawnPolicies.map(function (c, i) {
      return '<div class="tile ' + c + ' pick" data-action="presDiscard" data-arg="' + i + '">' + policyName(c).toUpperCase() + '<span class="small">discard</span></div>';
    }).join('');
    return [
      '<div class="panel">',
      '<h2>President: discard one</h2>',
      '<p class="muted">You drew 3 policies. Tap one to <b>discard</b> it; the other two pass to Chancellor ' + esc(nameOf(G.nomineeChancellorId)) + '. Nobody sees what you discard.</p>',
      tip('Afterward you may claim anything about what you drew. Fascists exploit this — and so can a desperate Liberal.'),
      '<div class="tiles">' + tiles + '</div>',
      '</div>'
    ].join('');
  }

  // ---- Legislative: Chancellor ------------------------------------------
  function renderLegChancellor() {
    if (ui.gate) {
      return passScreen(nameOf(G.nomineeChancellorId), 'Legislative session — Chancellor only. No talking.',
        'I am ' + esc(nameOf(G.nomineeChancellorId)) + ' (Chancellor)', 'ungate');
    }
    var tiles = G.chancellorPolicies.map(function (c, i) {
      return '<div class="tile ' + c + ' pick" data-action="chancEnact" data-arg="' + i + '">' + policyName(c).toUpperCase() + '<span class="small">enact</span></div>';
    }).join('');
    var veto = (G.vetoUnlocked && !G.vetoRefused)
      ? '<button class="btn ghost" data-action="requestVeto">Propose veto (discard both)</button>'
      : '';
    return [
      '<div class="panel">',
      '<h2>Chancellor: enact one</h2>',
      '<p class="muted">Tap a policy to <b>enact</b> it. The other is discarded secretly.</p>',
      tip('If you were only handed Fascist policies, you must enact one — but you can blame the President. They might be lying too.'),
      '<div class="tiles">' + tiles + '</div>',
      veto,
      '</div>'
    ].join('');
  }

  function renderVetoConsent() {
    if (ui.gate) {
      return passScreen(nameOf(G.currentPresidentId), 'The Chancellor proposed a veto.',
        'I am ' + esc(nameOf(G.currentPresidentId)) + ' (President)', 'ungate');
    }
    return [
      '<div class="panel center">',
      '<h2>Veto proposed</h2>',
      '<p class="muted">Chancellor ' + esc(nameOf(G.nomineeChancellorId)) + ' wants to discard the entire agenda. Do you agree? (This advances the election tracker.)</p>',
      '<div class="row" style="gap:12px">',
      '<button class="btn danger grow" data-action="consentVeto" data-arg="1">Agree to veto</button>',
      '<button class="btn grow" data-action="consentVeto" data-arg="0">Refuse</button>',
      '</div></div>'
    ].join('');
  }

  // ---- Powers -----------------------------------------------------------
  function powerButtonPanel(title, help, action, btnLabel) {
    return [
      '<div class="panel center">',
      '<h2>' + esc(title) + '</h2>',
      '<p class="muted">' + esc(help) + '</p>',
      '<button class="btn primary" data-action="' + action + '">' + esc(btnLabel) + '</button>',
      '</div>'
    ].join('');
  }

  function renderPower() {
    var pres = G.currentPresidentId;
    if (ui.gate) {
      return passScreen(nameOf(pres), 'Presidential power: ' + SH.POWER_LABELS[G.pendingPower] + '.',
        'I am ' + esc(nameOf(pres)) + ' (President)', 'ungate');
    }

    var power = G.pendingPower;

    // no-target powers
    if (power === 'policy_peek') return powerButtonPanel('Policy Peek', 'Secretly view the top 3 policies (order preserved).', 'doPeek', 'Reveal top 3');
    if (power === 'confession') return powerButtonPanel('Confession', 'Your Party will be revealed publicly to the whole table — and shown on the board.', 'doConfess', 'Confess publicly');
    if (power === 'five_year_plan') return powerButtonPanel('Five-Year Plan', 'Shuffle 2 Communist and 1 Liberal policy into the deck.', 'doFiveYear', 'Enact the plan');

    // target-picker powers
    var meta = {
      investigate: { label: 'Investigate Loyalty', help: 'Choose a player to inspect. You (only) see their Party — Liberal or Fascist. Each player can be investigated once.', act: 'doInvestigate', noInvestigated: true },
      bugging: { label: 'Bugging', help: 'Choose a player to bug. You (only) see their Party — Liberal, Fascist, or Communist.', act: 'doBugging' },
      special_election: { label: 'Call Special Election', help: 'Choose any player to be the next Presidential Candidate. Rotation resumes to your left afterward.', act: 'doSpecial' },
      execution: { label: 'Execution', help: 'Choose a player to execute. They are out of the game. If they are Hitler, the Liberals win.', act: 'doExecute', danger: true },
      radicalisation: { label: 'Radicalisation', help: 'Choose a player to convert to the Communist party. Hitler cannot be converted. The result is shown privately to them.', act: 'doRadicalise' }
    }[power];

    var list = G.players.filter(function (p) {
      return p.alive && p.id !== pres && !(meta.noInvestigated && p.investigated);
    }).map(function (p) {
      return '<button class="' + (meta.danger ? 'btn danger' : 'btn') + '" data-action="' + meta.act + '" data-arg="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');

    return ['<div class="panel">', '<h2>' + esc(meta.label) + '</h2>', '<p class="muted">' + esc(meta.help) + '</p>', tip(power === 'radicalisation' ? 'A converted player switches sides for the rest of the game — and will be shown the other Communists at the next Congress (future).' : 'You may lie about anything you learn.'), list, '</div>'].join('');
  }

  // ---- Game over --------------------------------------------------------
  function roleName(role) {
    return role === 'hitler' ? 'Hitler' : (role === 'fascist' ? 'Fascist' : (role === 'communist' ? 'Communist' : 'Liberal'));
  }

  function renderGameOver() {
    var win = G.winner; // 'liberal' | 'fascist' | 'communist'
    var rows = G.players.map(function (p) {
      return '<div class="kv"><span class="' + (p.alive ? '' : 'muted') + '">' + esc(p.name) + (p.alive ? '' : ' (executed)') +
        (p.converted ? ' <span class="tag">radicalised</span>' : '') + '</span><span class="' +
        (p.role === 'liberal' ? '' : 'tag') + '">' + roleName(p.role) + '</span></div>';
    }).join('');
    var st = loadStats();
    var winLabel = { liberal: 'LIBERALS WIN', fascist: 'FASCISTS WIN', communist: 'COMMUNISTS WIN' }[win];
    var winColor = { liberal: '#7db4e6', fascist: '#e0796d', communist: '#e6b074' }[win];
    var statLine = st.games + ' games · Liberals ' + (st.liberal || 0) + ' · Fascists ' + (st.fascist || 0) + (st.communist ? ' · Communists ' + st.communist : '');
    return [
      topbar('Game over', ''),
      '<div class="banner ' + win + ' pop"><h1 style="margin:0;color:' + winColor + '">' + winLabel + '</h1><p class="muted" style="margin:8px 0 0">' + esc(G.winReason) + '</p></div>',
      '<div class="panel"><h3>Full role reveal</h3>' + rows + '</div>',
      '<button class="btn" data-action="recap">View recap &amp; timeline</button>',
      '<button class="btn primary" data-action="rematch">Rematch (same players)</button>',
      '<button class="btn" data-action="newgame">New game (new setup)</button>',
      '<button class="btn ghost" data-action="home">Home</button>',
      '<p class="small muted center" style="margin-top:10px">' + statLine + '</p>'
    ].join('');
  }

  // ===========================================================================
  // RECAP (post-game timeline)
  // ===========================================================================
  function renderRecap() {
    var keyTypes = /enacted|ELECTED|REJECTED|executed|investigated|Special Election|Policy Peek|chaos|WIN|veto/i;
    var items = G.log.filter(function (e) { return keyTypes.test(e.text); }).map(function (e) {
      return '<div class="li">R' + e.round + ' · ' + esc(e.text) + '</div>';
    }).join('');
    var libP = G.liberalPolicies, fasP = G.fascistPolicies;
    var dead = G.players.filter(function (p) { return !p.alive; }).length;
    return [
      topbar('Recap', '<button class="iconbtn" data-action="backFromRecap">Back</button>'),
      '<div class="banner ' + G.winner + '"><h2 style="margin:0">' + (G.winner === 'liberal' ? 'Liberals' : 'Fascists') + ' won</h2><p class="muted" style="margin:6px 0 0">' + esc(G.winReason) + '</p></div>',
      '<div class="panel tight"><div class="kv"><span>Policies enacted</span><span>' + libP + ' Liberal / ' + fasP + ' Fascist</span></div>' +
      '<div class="kv"><span>Players executed</span><span>' + dead + '</span></div>' +
      '<div class="kv"><span>Rounds</span><span>' + G.round + '</span></div></div>',
      '<div class="panel"><h3>How it unfolded</h3><div class="log-list">' + (items || '<span class="muted">No key events.</span>') + '</div></div>'
    ].join('');
  }

  // ---- Log --------------------------------------------------------------
  function renderLog() {
    var items = G.log.slice().reverse().map(function (e) {
      return '<div class="li">R' + e.round + ' · ' + esc(e.text) + '</div>';
    }).join('');
    return [
      topbar('Event log (public)', '<button class="iconbtn" data-action="backToGame">Back</button>'),
      '<div class="panel"><div class="log-list">' + (items || '<span class="muted">No events yet.</span>') + '</div></div>'
    ].join('');
  }

  // ---- shared bits ------------------------------------------------------
  function topbar(title, right) {
    return '<div class="topbar"><span class="title">' + esc(title) + '</span><span>' + (right || '') + '</span></div>';
  }
  function passScreen(name, instruction, buttonLabel, action) {
    return [
      '<div class="panel pass-screen">',
      '<p class="muted">Pass the device to</p>',
      '<div class="who">' + esc(name) + '</div>',
      '<p class="small muted">' + esc(instruction) + '</p>',
      '<button class="btn primary" data-action="' + action + '">' + buttonLabel + '</button>',
      '</div>'
    ].join('');
  }

  // ===========================================================================
  // ACTIONS
  // ===========================================================================
  function handle(action, arg, node) {
    // Unlock WebAudio on the first user gesture.
    try { if (settings.sound && window.SHSound) window.SHSound.resume(); } catch (e) {}
    switch (action) {
      // navigation
      case 'home': stopRevealCountdown(); view = 'home'; G = null; render(); break;
      case 'rules': view = 'rules'; render(); break;
      case 'newgame': draft = null; ui = {}; view = 'setup'; render(); break;
      case 'resume': G = loadSaved(); ui = {}; view = 'game'; render(); break;
      case 'menu': ui.gameMenu = true; render(); break;
      case 'viewLog': ui._returnView = 'game'; view = 'log'; render(); break;
      case 'backToGame': view = 'game'; render(); break;
      case 'backFromRules': view = (G ? 'game' : 'home'); render(); break;
      case 'openSettings': view = 'settings'; render(); break;
      case 'backFromSettings': view = G ? 'game' : 'home'; render(); break;
      case 'toggleSetting': settings[arg] = !settings[arg]; saveSettings(); if (arg === 'sound' && settings.sound) { try { window.SHSound.resume(); } catch (e) {} sfx('tap'); } render(); break;
      case 'applyPreset': applyPreset(arg); sfx('tap'); render(); break;
      case 'recap': view = 'recap'; render(); break;
      case 'backFromRecap': view = 'game'; render(); break;

      // setup
      case 'toggleAdvanced': ui.advanced = !ui.advanced; render(); break;
      case 'resetDefaults': { var pc = draft.playerCount; var names = draft.playerNames.slice(); draft = SH.defaultConfig(pc, names); render(); break; }
      case 'toggleCommunists': {
        if ((draft.roles.communists || 0) > 0) {
          draft.roles.liberals += draft.roles.communists;
          draft.roles.communists = 0;
          draft.deck.communist = 0;
        } else {
          draft = SH.enableCommunists(draft);
        }
        render(); break;
      }
      case 'startGame': startGame(); break;

      // reveal
      case 'revealStart': ui.revealIntro = false; render(); break;
      case 'revealShow': ui.revealShown = true; sfx('reveal'); startRevealCountdown(doRevealNext); render(); break;
      case 'revealNext': doRevealNext(); break;
      case 'beginPlay': stopRevealCountdown(); SH.beginPlay(G); save(); ui = {}; render(); break;
      // in-game re-check of one's own role (safe: gated + timed + bots excluded)
      case 'recheckStart': ui.gameMenu = false; ui.recheck = { stage: 'pick' }; render(); break;
      case 'recheckPick': ui.recheck = { stage: 'gate', pid: arg }; render(); break;
      case 'recheckReveal': ui.recheck.stage = 'show'; sfx('reveal'); startRevealCountdown(doRecheckDone); render(); break;
      case 'recheckDone': doRecheckDone(); break;
      case 'recheckCancel': stopRevealCountdown(); ui.recheck = null; render(); break;
      case 'closeMenu': ui.gameMenu = false; render(); break;
      case 'quitHome': if (confirm('Quit this game and return home? Progress is saved and resumable.')) { stopRevealCountdown(); ui = {}; view = 'home'; render(); } break;

      // generic gate
      case 'ungate': ui.gate = false; sfx('pass'); render(); break;

      // nomination
      case 'nominate': SH.nominate(G, arg); sfx('tap'); save(); render(); break;

      // voting — secret (pass-and-play)
      case 'voteReveal': ui.voterGate = false; sfx('pass'); render(); break;
      case 'vote': { var ha = SH.alivePlayers(G).filter(function (p) { return !p.isBot; }); SH.castVote(G, ha[ui.voteIdx].id, arg); sfx(arg === 'ja' ? 'ja' : 'nein'); ui.voteIdx++; ui.voterGate = true; render(); break; }
      case 'resolveVotes': SH.resolveVotes(G); soundAfterVote(); save(); render(); break;
      // voting — table (IRL)
      case 'quickResult': SH.resolveElectionManual(G, arg === 'pass'); soundAfterVote(); save(); render(); break;
      case 'jaInc': ui.jaCount = Math.min(SH.aliveCount(G), (ui.jaCount || 0) + 1); render(); break;
      case 'jaDec': ui.jaCount = Math.max(0, (ui.jaCount || 0) - 1); render(); break;
      case 'quickCount': SH.resolveElectionManual(G, null, ui.jaCount || 0); soundAfterVote(); save(); render(); break;
      // voting — open (one shared screen)
      case 'openSet': { var parts = arg.split(':'); if (!ui.openVotes) ui.openVotes = {}; ui.openVotes[parts[0]] = parts[1]; render(); break; }
      case 'openSubmit': {
        var ha = SH.alivePlayers(G).filter(function (p) { return !p.isBot; });
        ha.forEach(function (p) { SH.castVote(G, p.id, ui.openVotes[p.id]); });
        ui.voteIdx = ha.length; // jump to the shared tally screen (bots already voted)
        render(); break;
      }

      // legislative
      case 'presDiscard': SH.presidentDiscard(G, parseInt(arg, 10)); sfx('tap'); save(); render(); break;
      case 'chancEnact': {
        var col = G.chancellorPolicies[parseInt(arg, 10)];
        SH.chancellorEnact(G, parseInt(arg, 10));
        sfx(col === 'L' ? 'policyLib' : 'policyFas');
        if (G.phase === 'power') sfx('power');
        save(); render(); break;
      }
      case 'requestVeto': SH.chancellorRequestVeto(G); save(); render(); break;
      case 'consentVeto': SH.presidentConsentVeto(G, arg === '1'); soundAfterVote(); save(); render(); break;

      // powers
      case 'doInvestigate': {
        var party = SH.powerInvestigate(G, arg);
        sfx('power');
        ui.powerResult = { title: 'Investigation result', body: '<div class="rolecard ' + (party === 'Liberal' ? 'liberal' : 'fascist') + ' flip"><div class="muted">' + esc(nameOf(arg)) + ' is a</div><div class="big">' + party.toUpperCase() + '</div></div><p class="small muted">You may tell the table the truth — or lie.</p>' };
        save(); render(); break;
      }
      case 'doSpecial': SH.powerSpecialElection(G, arg); sfx('power'); save(); render(); break;
      case 'doExecute':
        if (ui.confirm !== arg) { ui.confirm = arg; alertConfirm(arg); break; }
        SH.powerExecution(G, arg); ui.confirm = null; save(); render(); break;
      case 'doPeek': {
        var top = SH.powerPolicyPeek(G);
        sfx('power');
        var tiles = top.map(function (c) { return '<div class="tile ' + c + '">' + policyName(c).toUpperCase() + '</div>'; }).join('');
        ui.powerResult = { title: 'Top 3 policies', body: '<div class="tiles">' + tiles + '</div><p class="small muted">Next to be drawn, top to bottom. You may lie about this.</p>' };
        save(); render(); break;
      }
      case 'powerDone': ui.powerResult = null; save(); render(); break;

      // communist (XL) powers
      case 'doBugging': {
        var bparty = SH.powerBugging(G, arg);
        sfx('power');
        ui.powerResult = { title: 'Bugging result', body: '<div class="rolecard ' + partyClass(bparty) + ' flip"><div class="muted">' + esc(nameOf(arg)) + ' is a</div><div class="big">' + bparty.toUpperCase() + '</div></div><p class="small muted">Only you saw this. Truth or lie — your call.</p>' };
        save(); render(); break;
      }
      case 'doRadicalise': {
        var success = SH.powerRadicalise(G, arg);
        sfx('power');
        ui.conversionReveal = { targetId: arg, success: success, gate: true };
        save(); render(); break;
      }
      case 'doConfess': {
        var cparty = SH.powerConfession(G);
        sfx('power');
        ui.powerResult = { title: 'Confession', body: '<div class="rolecard ' + partyClass(cparty) + '"><div class="muted">You publicly revealed yourself as</div><div class="big">' + cparty.toUpperCase() + '</div></div><p class="small muted">The whole table now knows — it is shown on the board.</p>' };
        save(); render(); break;
      }
      case 'doFiveYear': {
        SH.powerFiveYearPlan(G);
        sfx('power');
        ui.powerResult = { title: 'Five-Year Plan', body: '<p class="muted">2 Communist and 1 Liberal policy were shuffled into the deck.</p>' };
        save(); render(); break;
      }
      case 'convReveal': ui.conversionReveal.gate = false; sfx('reveal'); render(); break;
      case 'convDone': ui.conversionReveal = null; save(); render(); break;

      // end
      case 'rematch': rematch(); break;
    }
  }

  function partyClass(party) { return party === 'Liberal' ? 'liberal' : (party === 'Communist' ? 'communist' : 'fascist'); }

  function alertConfirm(targetId) {
    if (confirm('Execute ' + nameOf(targetId) + '? This cannot be undone.')) {
      SH.powerExecution(G, targetId); sfx('execute'); ui.confirm = null; save(); render();
    } else { ui.confirm = null; }
  }

  function applyPreset(key) {
    ui.preset = key;
    var pc = draft ? draft.playerCount : 7;
    var names = draft ? draft.playerNames.slice() : null;
    draft = SH.applyRuleset(SH.defaultConfig(pc, names), key);
    var feel = (SH.RULESETS[key] || {}).feel || {};
    if (typeof feel.tips === 'boolean') { settings.tips = feel.tips; saveSettings(); }
  }

  function startGame() {
    var v = SH.validateConfig(draft);
    if (!v.ok) { render(); return; }
    G = SH.newGame(draft, seed());
    ui = {};
    view = 'game';
    save();
    render();
  }

  function rematch() {
    var cfg = JSON.parse(JSON.stringify(G.config));
    G = SH.newGame(cfg, seed());
    ui = {};
    save();
    render();
  }

  // ===========================================================================
  // INPUT WIRING (delegated)
  // ===========================================================================
  app.addEventListener('click', function (e) {
    // steppers
    var stepBtn = e.target.closest('.stepper button');
    if (stepBtn) { onStep(stepBtn); return; }
    var toggle = e.target.closest('[data-toggle]');
    if (toggle) { onToggle(toggle.getAttribute('data-toggle')); return; }
    var act = e.target.closest('[data-action]');
    if (act) { handle(act.getAttribute('data-action'), act.getAttribute('data-arg'), act); return; }
  });

  // text name inputs (no re-render to keep focus; patch draft + validation panel)
  app.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-name-idx')) {
      var i = parseInt(t.getAttribute('data-name-idx'), 10);
      draft.playerNames[i] = t.value;
    }
  });
  // board power selects
  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-board-idx')) {
      var i = parseInt(t.getAttribute('data-board-idx'), 10);
      draft.board[i] = t.value === 'null' ? null : t.value;
      render();
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-cfg-select')) {
      setPath(draft, t.getAttribute('data-cfg-select'), t.value);
      render();
      return;
    }
  });

  function getPath(obj, path) { var ks = path.split('.'); for (var i = 0; i < ks.length; i++) obj = obj[ks[i]]; return obj; }
  function setPath(obj, path, val) { var ks = path.split('.'); for (var i = 0; i < ks.length - 1; i++) obj = obj[ks[i]]; obj[ks[ks.length - 1]] = val; }

  function onStep(btn) {
    var wrap = btn.closest('.stepper');
    var path = wrap.getAttribute('data-stepper');
    var min = parseInt(wrap.getAttribute('data-min'), 10);
    var max = parseInt(wrap.getAttribute('data-max'), 10);
    var delta = parseInt(btn.getAttribute('data-step'), 10);
    var cur = getPath(draft, path);
    var next = Math.max(min, Math.min(max, cur + delta));
    setPath(draft, path, next);

    if (path === 'playerCount') {
      // rebuild from preset for the new count, keep entered names
      var names = draft.playerNames.slice();
      draft = SH.defaultConfig(next, names);
      ui.advanced = ui.advanced; // keep
    }
    if (path === 'win.fascist') {
      SH.reconcileBoard(draft); // resize board to match
    }
    if (path === 'roles.fascists') {
      draft.roles.liberals = Math.max(1, draft.playerCount - next - (draft.roles.communists || 0) - 1);
    }
    if (path === 'roles.communists') {
      // keep the head-count summing by taking from / giving back to Liberals
      draft.roles.liberals = Math.max(1, draft.playerCount - draft.roles.fascists - next - 1);
    }
    if (path === 'win.communist') {
      reconcileCommunistBoard(draft);
    }
    if (path === 'bots' && next > 0 && draft.votingMode === 'table') {
      draft.votingMode = 'secret'; // bots can't vote at the table
    }
    render();
  }

  function reconcileCommunistBoard(d) {
    var n = d.win.communist;
    var src = d.communistBoard || [];
    var out = [];
    for (var i = 0; i < n; i++) {
      out[i] = (i === n - 1) ? 'win' : (i < src.length && src[i] !== 'win' ? src[i] : (SH.COMMUNIST_BOARD[i] || null));
    }
    d.communistBoard = out;
  }

  function onToggle(path) {
    setPath(draft, path, !getPath(draft, path));
    render();
  }

  // ===========================================================================
  // RULES SCREEN
  // ===========================================================================
  function renderRules() {
    return [
      topbar('How to play', '<button class="iconbtn" data-action="backFromRules">Back</button>'),
      '<div class="panel"><h2>Goal</h2>',
      '<p class="small"><b>Liberals</b> win by enacting 5 Liberal Policies <i>or</i> assassinating Hitler. <b>Fascists</b> win by enacting 6 Fascist Policies <i>or</i> by getting Hitler elected Chancellor after 3 Fascist Policies are in play.</p></div>',
      '<div class="panel"><h2>Each round</h2>',
      '<p class="small">1. The <b>President</b> nominates a <b>Chancellor</b>. Everyone votes Ja/Nein — a strict majority elects them (ties fail).</p>',
      '<p class="small">2. If elected, the President draws 3 policies, secretly discards 1, and passes 2 to the Chancellor, who enacts 1.</p>',
      '<p class="small">3. Some Fascist policies grant the President a one-time power: investigate, special election, policy peek, or execution.</p>',
      '<p class="small">3 failed elections in a row = chaos: the top policy is enacted automatically.</p></div>',
      '<div class="panel"><h2>Lying</h2><p class="small">You may lie about anything hidden (your role, policies you drew, investigation results) — except a player who is Hitler must admit it if assassinated or elected Chancellor after the 3rd Fascist policy.</p></div>',
      '<div class="panel"><h2>This app</h2><p class="small">Pass the device when prompted so each player sees their secret info privately. The app tracks the board, deck, powers, term limits, and win conditions automatically.</p></div>',
      '<button class="btn primary" data-action="backFromRules">Got it</button>'
    ].join('');
  }

  // ===========================================================================
  // BOOT
  // ===========================================================================
  function boot() {
    loadSettings();
    try { if (window.SHSound) window.SHSound.setEnabled(settings.sound); } catch (e) {}
    render();
  }

  // Test hook: lets the headless smoke test drive UI actions directly, bypassing
  // the DOM event layer. No effect in the browser beyond exposing window.__SHUI.
  var hook = {
    handle: handle,
    render: render,
    state: function () { return { view: view, G: G, draft: draft, ui: ui }; },
    setView: function (v) { view = v; },
    setDraft: function (d) { draft = d; },
    botStep: function () { return botStep(); },
    botCanAct: function () { return botCanAct(); }
  };
  try { window.__SHUI = hook; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) module.exports = hook;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
