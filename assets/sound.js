/*
 * sound.js — tiny synthesized SFX (WebAudio, no asset files). Optional/toggleable.
 * Safely no-ops where WebAudio is unavailable (e.g. the headless Node smoke test).
 * Exposes window.SHSound.
 */
(function (root) {
  'use strict';
  var ctx = null, enabled = true;

  function ac() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  function tone(freq, dur, type, gain, delay) {
    var c = ac(); if (!c) return;
    try {
      var t0 = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    } catch (e) {}
  }
  function chord(freqs, dur, type, gain) {
    for (var i = 0; i < freqs.length; i++) tone(freqs[i], dur, type, gain, 0);
  }

  var SFX = {
    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; },
    // resume() must be called from a user gesture on some browsers
    resume: function () { var c = ac(); if (c && c.resume) try { c.resume(); } catch (e) {} },
    play: function (name) {
      if (!enabled) return;
      switch (name) {
        case 'tap': tone(420, 0.05, 'square', 0.04); break;
        case 'pass': tone(300, 0.12, 'sine', 0.07); break;
        case 'reveal': tone(220, 0.16, 'sawtooth', 0.07); tone(330, 0.18, 'sine', 0.05, 0.03); break;
        case 'ja': tone(520, 0.1, 'triangle', 0.09); break;
        case 'nein': tone(180, 0.14, 'sawtooth', 0.09); break;
        case 'elected': chord([392, 523], 0.18, 'triangle', 0.08); break;
        case 'rejected': tone(200, 0.2, 'sawtooth', 0.08); break;
        case 'policyLib': chord([523, 659], 0.22, 'sine', 0.09); break;
        case 'policyFas': chord([196, 233], 0.28, 'sawtooth', 0.09); break;
        case 'power': tone(660, 0.1, 'square', 0.07); tone(880, 0.12, 'square', 0.05, 0.06); break;
        case 'execute': tone(140, 0.35, 'sawtooth', 0.11); break;
        case 'winLib': chord([392, 523, 659], 0.5, 'triangle', 0.11); break;
        case 'winFas': chord([147, 185, 220], 0.6, 'sawtooth', 0.11); break;
        default: break;
      }
    }
  };

  try { root.SHSound = SFX; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) module.exports = SFX;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
