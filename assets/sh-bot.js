/*
 * sh-bot.js — bot "brain" for Secret Hitler. Pure, no DOM. Decides legal moves
 * for AI-controlled seats based on the bot's legitimate knowledge (its role +
 * faction allies it would know at night) and a simple public-suspicion heuristic
 * computed from the enactment history. Faction-aware and works in 3-faction (XL)
 * games too. Decisions are deliberately "decent, not genius" (like the reference
 * online game's bots) — the goal is fun seat-filling, not perfect play.
 *
 * The caller (UI) supplies candidate/target lists from the engine so the bot never
 * has to re-implement eligibility rules — it only ranks among legal options.
 */
(function (root, factory) {
  var SHBot = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = SHBot;
  if (root) root.SHBot = SHBot;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function player(state, id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }
  function team(role) { return role === 'liberal' ? 'liberal' : (role === 'communist' ? 'communist' : 'fascist'); }
  function rnd() { return Math.random(); }

  // What this bot legitimately knows from the night phase.
  function knowledge(state, botId) {
    var me = player(state, botId), cfg = state.config, allies = {}, i, p;
    if (me.role === 'fascist') {
      for (i = 0; i < state.players.length; i++) { p = state.players[i]; if (p.id !== me.id && (p.role === 'fascist' || p.role === 'hitler')) allies[p.id] = true; }
    } else if (me.role === 'hitler' && cfg.hitlerKnowsFascists) {
      for (i = 0; i < state.players.length; i++) { p = state.players[i]; if (p.role === 'fascist') allies[p.id] = true; }
    } else if (me.role === 'communist' && cfg.communistsKnowEachOther) {
      for (i = 0; i < state.players.length; i++) { p = state.players[i]; if (p.id !== me.id && p.role === 'communist') allies[p.id] = true; }
    }
    return { me: me, role: me.role, team: team(me.role), allies: allies };
  }

  // Public "looks fascist" score from enactment history (higher = more suspicious).
  function lean(state, id) {
    var s = 0;
    (state.enactments || []).forEach(function (e) {
      if (e.chaos) return;
      if (e.presidentId === id) s += (e.color === 'F' ? 1.0 : (e.color === 'L' ? -0.5 : 0.2));
      if (e.chancellorId === id) s += (e.color === 'F' ? 1.6 : (e.color === 'L' ? -1.1 : 0.3));
    });
    var p = player(state, id);
    if (p && p.partyRevealed === 'Fascist') s += 3;
    if (p && p.partyRevealed === 'Liberal') s -= 3;
    return s;
  }

  function pickExtreme(ids, scoreFn, wantMax) {
    var best = null, bestScore = null;
    for (var i = 0; i < ids.length; i++) {
      var sc = scoreFn(ids[i]);
      if (best === null || (wantMax ? sc > bestScore : sc < bestScore)) { best = ids[i]; bestScore = sc; }
    }
    return best;
  }

  function nominate(state, botId, eligibleIds) {
    if (!eligibleIds || !eligibleIds.length) return null;
    var k = knowledge(state, botId), cfg = state.config;
    if (k.team === 'fascist') {
      if (state.fascistPolicies >= cfg.hitlerChancellorThreshold) {
        for (var i = 0; i < eligibleIds.length; i++) if (player(state, eligibleIds[i]).role === 'hitler') return eligibleIds[i];
      }
      var allyIds = eligibleIds.filter(function (id) { return k.allies[id]; });
      if (allyIds.length) return allyIds[Math.floor(rnd() * allyIds.length)];
      return pickExtreme(eligibleIds, function (id) { return lean(state, id); }, false);
    }
    if (k.team === 'communist') {
      var cAlly = eligibleIds.filter(function (id) { return k.allies[id]; });
      if (cAlly.length) return cAlly[Math.floor(rnd() * cAlly.length)];
      return pickExtreme(eligibleIds, function (id) { return lean(state, id); }, false);
    }
    return pickExtreme(eligibleIds, function (id) { return lean(state, id) + rnd() * 0.3; }, false);
  }

  function vote(state, botId) {
    var k = knowledge(state, botId), cfg = state.config;
    var presId = state.currentPresidentId, chancId = state.nomineeChancellorId;
    var chanc = player(state, chancId);
    var total = state.liberalPolicies + state.fascistPolicies + state.communistPolicies;
    if (k.team === 'fascist') {
      if (chanc.role === 'hitler' && state.fascistPolicies >= cfg.hitlerChancellorThreshold) return 'ja';
      if (k.allies[chancId] || k.allies[presId]) return 'ja';
      if (state.fascistPolicies >= 4) return rnd() < 0.5 ? 'ja' : 'nein';
      return rnd() < 0.75 ? 'ja' : 'nein';
    }
    var badness = lean(state, chancId) * 1.4 + lean(state, presId) * 0.6;
    if (total === 0) return 'ja';
    if (badness > 1.2) return 'nein';
    if (badness < -0.3) return 'ja';
    return rnd() < 0.7 ? 'ja' : 'nein';
  }

  function discardByOrder(tiles, order) {
    for (var o = 0; o < order.length; o++) for (var i = 0; i < tiles.length; i++) if (tiles[i] === order[o]) return i;
    return 0;
  }

  // index in state.drawnPolicies to DISCARD
  function presidentDiscard(state, botId) {
    var k = knowledge(state, botId);
    var order = k.team === 'liberal' ? ['F', 'C', 'L'] : (k.team === 'communist' ? ['F', 'L', 'C'] : ['L', 'C', 'F']);
    return discardByOrder(state.drawnPolicies, order);
  }

  // {veto:true} or {index}
  function chancellorAction(state, botId) {
    var k = knowledge(state, botId);
    var tiles = state.chancellorPolicies;
    var want = k.team === 'liberal' ? 'L' : (k.team === 'communist' ? 'C' : 'F');
    var idx = tiles.indexOf(want);
    if (idx === -1 && k.team === 'communist') idx = tiles.indexOf('L');
    if (idx === -1) {
      if (state.vetoUnlocked && !state.vetoRefused) return { veto: true };
      idx = 0; // veto unavailable: must enact
    }
    return { index: idx };
  }

  function vetoConsent(state, botId) {
    var k = knowledge(state, botId);
    var want = k.team === 'liberal' ? 'L' : (k.team === 'communist' ? 'C' : 'F');
    return state.chancellorPolicies.indexOf(want) === -1;
  }

  function powerTarget(state, botId, power, targetIds) {
    if (!targetIds || !targetIds.length) return null;
    var k = knowledge(state, botId);
    var nonAlly = targetIds.filter(function (id) { return !k.allies[id]; });
    var pool = nonAlly.length ? nonAlly : targetIds;
    switch (power) {
      case 'execution':
        return pickExtreme(pool, function (id) { return lean(state, id); }, k.team !== 'fascist');
      case 'investigate':
      case 'bugging':
        return pickExtreme(pool, function (id) { return lean(state, id); }, true);
      case 'special_election':
        if (k.team !== 'liberal') { var a = targetIds.filter(function (id) { return k.allies[id]; }); if (a.length) return a[0]; }
        return pickExtreme(targetIds, function (id) { return lean(state, id); }, false);
      case 'radicalisation':
        return pickExtreme(pool, function (id) { return lean(state, id); }, k.team !== 'communist');
      default:
        return pool[0];
    }
  }

  return {
    nominate: nominate,
    vote: vote,
    presidentDiscard: presidentDiscard,
    chancellorAction: chancellorAction,
    vetoConsent: vetoConsent,
    powerTarget: powerTarget,
    _lean: lean
  };
});
