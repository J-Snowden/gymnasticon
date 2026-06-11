#!/usr/bin/env node
'use strict';

// Patches @abandonware/noble to wrap the setSocketFilter call in try/catch.
//
// Why: On Linux kernel >= 6.x, the setsockopt HCI_FILTER call made by
// setFilter() is rejected with EINVAL. Per the bluetooth-hci-socket README,
// setFilter is not required when bindRaw is used. Wrapping it in try/catch
// lets noble continue normally on modern kernels.

var fs = require('fs');
var path = require('path');

var filePath = path.join(
  __dirname, '..', 'node_modules', '@abandonware', 'noble', 'lib', 'hci-socket', 'hci.js'
);

if (!fs.existsSync(filePath)) {
  console.log('patch-noble-hci: hci.js not found at ' + filePath + ', skipping');
  process.exit(0);
}

var src = fs.readFileSync(filePath, 'utf8');

// Use a multi-line needle that can only match the UNPATCHED version:
// the setFilter line followed immediately by the function closing brace.
var needle = '  this._socket.setFilter(filter);\n};';
var replacement = [
  '  try {',
  '    this._socket.setFilter(filter);',
  '  } catch (e) {',
  "    debug('setFilter failed (' + e.message + '), skipping - not required for bindRaw');",
  '  }',
  '};'
].join('\n');

if (src.indexOf(needle) === -1) {
  // Check if already patched (try/catch exists around setFilter)
  if (src.indexOf("skipping - not required for bindRaw") !== -1) {
    console.log('patch-noble-hci: already patched, skipping');
    process.exit(0);
  }
  console.error('patch-noble-hci: could not find target in ' + filePath);
  console.error('patch-noble-hci: expected to find the unpatched setSocketFilter function');
  process.exit(1);
}

var patched = src.replace(needle, replacement);
fs.writeFileSync(filePath, patched, 'utf8');
console.log('patch-noble-hci: successfully patched ' + filePath);
