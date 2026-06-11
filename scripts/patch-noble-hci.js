#!/usr/bin/env node
'use strict';

// Patches @abandonware/noble to build the correct HCI socket filter buffer
// for the running architecture.
//
// Why: Noble's setSocketFilter builds a 14-byte filter buffer assuming 32-bit
// unsigned long (4 bytes). On 64-bit platforms (arm64, x64), the kernel's
// struct hci_filter uses 8-byte unsigned long fields, making it 26 bytes.
// Passing 14 bytes to setsockopt on a 64-bit kernel returns EINVAL.
//
// Fix: Replace the setSocketFilter function with one that detects the
// architecture and builds the correctly-sized buffer.

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

var marker = 'PATCHED_FOR_64BIT_HCI_FILTER';

if (src.indexOf(marker) !== -1) {
  console.log('patch-noble-hci: already patched, skipping');
  process.exit(0);
}

// The original setSocketFilter function (must match exactly)
var needle = [
  'Hci.prototype.setSocketFilter = function () {',
  '  const filter = Buffer.alloc(14);',
  '  const typeMask = (1 << HCI_COMMAND_PKT) | (1 << HCI_EVENT_PKT) | (1 << HCI_ACLDATA_PKT);',
  '  const eventMask1 = (1 << EVT_DISCONN_COMPLETE) | (1 << EVT_ENCRYPT_CHANGE) | (1 << EVT_CMD_COMPLETE) | (1 << EVT_CMD_STATUS);',
  '  const eventMask2 = (1 << (EVT_LE_META_EVENT - 32));',
  '  const opcode = 0;',
  '',
  '  filter.writeUInt32LE(typeMask, 0);',
  '  filter.writeUInt32LE(eventMask1, 4);',
  '  filter.writeUInt32LE(eventMask2, 8);',
  '  filter.writeUInt16LE(opcode, 12);',
  '',
  "  debug(`setting filter to: ${filter.toString('hex')}`);",
  '  this._socket.setFilter(filter);',
  '};'
].join('\n');

var replacement = [
  '// ' + marker,
  'Hci.prototype.setSocketFilter = function () {',
  '  var os = require("os");',
  '  var arch = os.arch();',
  '  var is64 = (arch === "arm64" || arch === "x64" || arch === "ppc64" || arch === "s390x");',
  '  var longSize = is64 ? 8 : 4;',
  '  // struct hci_filter: type_mask (unsigned long) + event_mask[2] (unsigned long) + opcode (uint16)',
  '  var filterLen = longSize + (2 * longSize) + 2;',
  '  var filter = Buffer.alloc(filterLen);',
  '  var offset = 0;',
  '',
  '  var typeMask = (1 << HCI_COMMAND_PKT) | (1 << HCI_EVENT_PKT) | (1 << HCI_ACLDATA_PKT);',
  '  var eventMask1 = (1 << EVT_DISCONN_COMPLETE) | (1 << EVT_ENCRYPT_CHANGE) | (1 << EVT_CMD_COMPLETE) | (1 << EVT_CMD_STATUS);',
  '  var eventMask2 = (1 << (EVT_LE_META_EVENT - 32));',
  '  var opcode = 0;',
  '',
  '  // Write type_mask (unsigned long)',
  '  filter.writeUInt32LE(typeMask, offset);',
  '  offset += longSize;',
  '',
  '  // Write event_mask[0] (unsigned long)',
  '  filter.writeUInt32LE(eventMask1, offset);',
  '  offset += longSize;',
  '',
  '  // Write event_mask[1] (unsigned long)',
  '  filter.writeUInt32LE(eventMask2, offset);',
  '  offset += longSize;',
  '',
  '  // Write opcode (uint16)',
  '  filter.writeUInt16LE(opcode, offset);',
  '',
  "  debug(`setting filter to: ${filter.toString('hex')} (arch=${arch}, longSize=${longSize})`);",
  '  this._socket.setFilter(filter);',
  '};'
].join('\n');

if (src.indexOf(needle) === -1) {
  console.error('patch-noble-hci: could not find the original setSocketFilter function in ' + filePath);
  console.error('patch-noble-hci: the file may have been modified or the noble version changed');
  process.exit(1);
}

var patched = src.replace(needle, replacement);
fs.writeFileSync(filePath, patched, 'utf8');
console.log('patch-noble-hci: successfully patched ' + filePath);
