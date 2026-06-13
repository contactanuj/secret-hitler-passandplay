/*
 * build.js — composes assets/app.html from the source modules.
 *
 *   assets/styles.css   -> inlined <style>
 *   assets/sh-engine.js -> inlined <script> (pure rules engine; also unit-tested)
 *   assets/ui.js        -> inlined <script> (pass-and-play DOM UI)
 *
 * The Expo shell (App.js) loads the single app.html string into a WebView, so
 * everything must be inlined (no external <script src>/<link href>).
 *
 * Run: node build.js   (npm run build:html)
 */
'use strict';
var fs = require('fs');
var path = require('path');

var dir = path.join(__dirname, 'assets');
function read(f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }

var css = read('styles.css');
var engine = read('sh-engine.js');
var bot = read('sh-bot.js');
var sound = read('sound.js');
var ui = read('ui.js');

// Guard: none of the inlined sources may contain a literal </script> that would
// prematurely close the tag.
[['sh-engine.js', engine], ['sh-bot.js', bot], ['sound.js', sound], ['ui.js', ui]].forEach(function (pair) {
  if (/<\/script>/i.test(pair[1])) {
    throw new Error('Refusing to build: ' + pair[0] + ' contains a literal </script>.');
  }
});

var html =
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />\n' +
'  <meta name="theme-color" content="#0f0d0b" />\n' +
'  <meta name="apple-mobile-web-app-capable" content="yes" />\n' +
'  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n' +
'  <title>Secret Hitler</title>\n' +
'  <style>\n' + css + '\n  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div id="app"></div>\n' +
'  <script>\n' + engine + '\n  </script>\n' +
'  <script>\n' + bot + '\n  </script>\n' +
'  <script>\n' + sound + '\n  </script>\n' +
'  <script>\n' + ui + '\n  </script>\n' +
'</body>\n' +
'</html>\n';

fs.writeFileSync(path.join(dir, 'app.html'), html, 'utf8');
console.log('Built assets/app.html (' + html.length + ' bytes)' +
  ' from styles.css + sh-engine.js + sh-bot.js + sound.js + ui.js.');
