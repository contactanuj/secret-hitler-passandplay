/*
 * make-icon.js - generates assets/icon.png (1024x1024) with NO dependencies.
 *
 * Design: a gold "watchful eye" emblem (secrecy / deduction) inside a thin ring,
 * on the app's warm-dark brand background with a soft vignette. Clean, professional,
 * reads at launcher size. Rendered with 3x3 supersampling for smooth edges, encoded
 * as a PNG by hand (Node's built-in zlib for the pixel stream).
 *
 * Run: node tools/make-icon.js   (npm run icon)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var SIZE = 1024;
var SS = 3; // supersample factor (SSxSS samples per pixel)

// palette (warm dark bg + the game's blue & red policy colours)
var BLUE = [52, 120, 188];
var BLUE_HI = [122, 176, 224];
var RED = [198, 66, 52];
var RED_HI = [228, 122, 106];
var CREAM = [238, 230, 216];
var CENTER = [40, 30, 19];
var EDGE = [9, 8, 6];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

// Signed distance to a rotated rounded rectangle; also returns local coords.
function rrect(px, py, cx, cy, ang, hx, hy, cr) {
  var dx = px - cx, dy = py - cy;
  var ca = Math.cos(-ang), sa = Math.sin(-ang);
  var lx = dx * ca - dy * sa;
  var ly = dx * sa + dy * ca;
  var qx = Math.abs(lx) - (hx - cr);
  var qy = Math.abs(ly) - (hy - cr);
  var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  var sdf = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - cr;
  return { sdf: sdf, lx: lx, ly: ly };
}

function inRect(x, y, x0, x1, y0, y1) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; }

// Blocky 'L' / 'F' letterforms in a card's local frame (upper area).
function inLetter(letter, lx, ly) {
  var ux = lx, uy = ly - 0.15;
  if (letter === 'L') {
    if (inRect(ux, uy, -0.052, -0.014, -0.085, 0.085)) return true; // stem
    if (inRect(ux, uy, -0.052, 0.054, -0.085, -0.05)) return true;  // foot
  } else {
    if (inRect(ux, uy, -0.052, -0.014, -0.085, 0.085)) return true; // stem
    if (inRect(ux, uy, -0.052, 0.05, 0.05, 0.085)) return true;     // top bar
    if (inRect(ux, uy, -0.052, 0.032, -0.018, 0.018)) return true;  // mid bar
  }
  return false;
}

function cardColor(base, hi, hit, letter) {
  var t = clamp((hit.ly + 0.32) / 0.64, 0, 1);   // 0 bottom .. 1 top
  var c = lerp3(base, hi, t * 0.45);             // subtle top sheen
  if (hit.sdf > -0.052 && hit.sdf < -0.03) c = hi; // inner frame band
  if (inLetter(letter, hit.lx, hit.ly)) c = CREAM; // L / F
  return c;
}

function scene(nx, ny) {
  // ny is already flipped so +ny points up
  var r = Math.sqrt(nx * nx + ny * ny);

  // warm background + soft glow behind the cards (inviting)
  var col = lerp3(CENTER, EDGE, clamp(r / 0.85, 0, 1));
  var glow = clamp(1 - r / 0.62, 0, 1);
  col = [col[0] + glow * 14, col[1] + glow * 9, col[2] + glow * 3];

  var hx = 0.205, hy = 0.32, cr = 0.05;
  var blue = rrect(nx, ny, -0.115, 0.03, 0.26, hx, hy, cr); // left card, tilted
  var red = rrect(nx, ny, 0.115, 0.03, -0.26, hx, hy, cr);  // right card, tilted

  if (blue.sdf < 0) col = cardColor(BLUE, BLUE_HI, blue, 'L');

  // soft contact shadow cast by the top (red) card
  if (red.sdf > 0 && red.sdf < 0.055) {
    var sh = (1 - red.sdf / 0.055) * 0.5;
    col = [col[0] * (1 - sh), col[1] * (1 - sh), col[2] * (1 - sh)];
  }
  if (red.sdf < 0) col = cardColor(RED, RED_HI, red, 'F');

  return col;
}

// ---- render with supersampling ----
var rgb = Buffer.alloc(SIZE * SIZE * 3);
for (var y = 0; y < SIZE; y++) {
  for (var x = 0; x < SIZE; x++) {
    var rr = 0, gg = 0, bb = 0;
    for (var sy = 0; sy < SS; sy++) {
      for (var sx = 0; sx < SS; sx++) {
        var fx = (x + (sx + 0.5) / SS) / SIZE * 2 - 1;
        var fy = (y + (sy + 0.5) / SS) / SIZE * 2 - 1;
        var c = scene(fx, -fy); // flip y so +up
        rr += c[0]; gg += c[1]; bb += c[2];
      }
    }
    var n = SS * SS, o = (y * SIZE + x) * 3;
    rgb[o] = Math.round(rr / n); rgb[o + 1] = Math.round(gg / n); rgb[o + 2] = Math.round(bb / n);
  }
}

// ---- encode PNG (color type 2, 8-bit RGB) ----
var CRC_TABLE = (function () {
  var t = [], c, n, k;
  for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var tb = Buffer.from(type, 'ascii');
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

var ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

var stride = SIZE * 3;
var raw = Buffer.alloc(SIZE * (1 + stride));
for (var ry = 0; ry < SIZE; ry++) {
  raw[ry * (1 + stride)] = 0; // filter: none
  rgb.copy(raw, ry * (1 + stride) + 1, ry * stride, ry * stride + stride);
}
var idat = zlib.deflateSync(raw, { level: 9 });

var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

var out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, png);
console.log('Wrote ' + out + ' (' + SIZE + 'x' + SIZE + ', ' + png.length + ' bytes)');
