#!/usr/bin/env node
'use strict';

// Patches @abandonware/noble to remove the setSocketFilter() call.
//
// Why: On Linux kernel >= 6.x, the setsockopt HCI_FILTER call triggers an
// EINVAL error that surfaces asynchronously via the socket 'error' event,
// killing the HCI connection. Per the bluetooth-hci-socket README,
// setFilter is not required when bindRaw is used. Removing the call
// lets noble work on modern kernels.

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

// Remove the setSocketFilter() call from pollIsDevUp.
// The call appears as a line "      this.setSocketFilter();" right before
// "      this.setEventMask();".
var needle = '      this.setSocketFilter();\n      this.setEventMask();';
var replacement = '      this.setEventMask();';

if (src.indexOf(needle) === -1) {
  if (src.indexOf('this.setSocketFilter()') === -1) {
    console.log('patch-noble-hci: setSocketFilter call already removed, skipping');
    process.exit(0);
  }
  console.error('patch-noble-hci: could not find expected pattern in ' + filePath);
  console.error('patch-noble-hci: expected: ' + JSON.stringify(needle));
  process.exit(1);
}

var patched = src.replace(needle, replacement);
fs.writeFileSync(filePath, patched, 'utf8');
console.log('patch-noble-hci: successfully patched ' + filePath);
