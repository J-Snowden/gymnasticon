#!/usr/bin/env node
/**
 * Standalone ANT+ broadcaster for Gymnasticon.
 * Receives power/cadence/speed/hr via UDP JSON and broadcasts on multiple ANT+ channels:
 *   Channel 1: Bicycle Power (0x0B)
 *   Channel 2: Bike Speed & Cadence (0x79)
 *   Channel 3: Heart Rate (0x78)
 *
 * Does NOT use noble or bleno - no Bluetooth HCI sockets needed.
 * All channels use the same single ANT+ USB stick.
 *
 * Usage: node ant-bridge.js [--port 3000] [--device-id 11234]
 */

'use strict';

var dgram = require('dgram');
var Ant = require('gd-ant-plus');

// Parse command line args
var port = 3000;
var deviceId = 11234;

for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--port' && process.argv[i + 1]) {
    port = parseInt(process.argv[++i], 10);
  } else if (process.argv[i] === '--device-id' && process.argv[i + 1]) {
    deviceId = parseInt(process.argv[++i], 10);
  }
}

// --- ANT+ Profile Constants ---

// Bicycle Power (channel 1)
var PWR_CHANNEL = 1;
var PWR_DEVICE_TYPE = 0x0b;
var PWR_PERIOD = 8182;      // ~4 Hz
var PWR_RF = 57;

// Bike Speed & Cadence (channel 2)
var BSC_CHANNEL = 2;
var BSC_DEVICE_TYPE = 0x79;
var BSC_PERIOD = 8086;      // ~4 Hz
var BSC_RF = 57;
var WHEEL_CIRCUMFERENCE_M = 2.105; // 700x25c default

// Heart Rate (channel 3)
var HR_CHANNEL = 3;
var HR_DEVICE_TYPE = 0x78;
var HR_PERIOD = 8070;       // ~4 Hz
var HR_RF = 57;

// --- State ---
var power = 0;
var cadence = 0;
var speed = 0;     // km/h
var hr = 0;

// Power channel state
var pwrEventCount = 0;
var accumulatedPower = 0;

// BSC channel state - cumulative counters
var wheelRevolutions = 0;
var wheelEventTime = 0;     // in 1/1024 s units
var crankRevolutions = 0;
var crankEventTime = 0;     // in 1/1024 s units
var lastBscTime = Date.now();

// HR channel state
var hrEventCount = 0;
var hrBeatCount = 0;
var hrBeatTime = 0;         // in 1/1024 s units

// --- ANT+ stick ---
var stick = new Ant.GarminStick3();
if (!stick.is_present()) {
  stick = new Ant.GarminStick2();
}
if (!stick.is_present()) {
  console.error('ERROR: No ANT+ USB stick found');
  process.exit(1);
}

// --- UDP server ---
var udpServer = dgram.createSocket('udp4');

udpServer.on('message', function (msg) {
  try {
    var j = JSON.parse(msg);
    if (typeof j.power === 'number') power = Math.max(0, Math.round(j.power));
    if (typeof j.cadence === 'number') cadence = Math.max(0, Math.round(j.cadence));
    if (typeof j.speed === 'number') speed = Math.max(0, j.speed);
    if (typeof j.hr === 'number') hr = Math.max(0, Math.round(j.hr));
  } catch (e) {}
});

udpServer.on('error', function (err) {
  console.error('UDP error:', err);
  process.exit(1);
});

udpServer.bind(port, '0.0.0.0', function () {
  console.log('UDP listening on port ' + port);
});

// --- Broadcast functions ---

function broadcastPower() {
  accumulatedPower = (accumulatedPower + power) & 0xffff;
  var data = [
    PWR_CHANNEL,
    0x10,
    pwrEventCount,
    0xff,
    cadence & 0xff,
    accumulatedPower & 0xff, (accumulatedPower >> 8) & 0xff,
    power & 0xff, (power >> 8) & 0xff,
  ];
  stick.write(Ant.Messages.broadcastData(data));
  pwrEventCount = (pwrEventCount + 1) & 0xff;
}

function broadcastBsc() {
  var now = Date.now();
  var dt = (now - lastBscTime) / 1000; // seconds since last update
  lastBscTime = now;

  // Accumulate wheel revolutions from speed
  // speed (km/h) -> m/s -> revolutions/s -> revolutions in dt
  var speedMs = speed / 3.6;
  var wheelRevsInDt = (speedMs / WHEEL_CIRCUMFERENCE_M) * dt;
  wheelRevolutions += wheelRevsInDt;
  if (wheelRevsInDt > 0) {
    wheelEventTime = Math.round((now / 1000) * 1024) & 0xffff;
  }

  // Accumulate crank revolutions from cadence
  // cadence (rpm) -> revolutions/s -> revolutions in dt
  var crankRevsInDt = (cadence / 60) * dt;
  crankRevolutions += crankRevsInDt;
  if (crankRevsInDt > 0) {
    crankEventTime = Math.round((now / 1000) * 1024) & 0xffff;
  }

  var cumWheel = Math.round(wheelRevolutions) & 0xffff;
  var cumCrank = Math.round(crankRevolutions) & 0xffff;

  // BSC data page format:
  // byte 0: crank event time LSB (1/1024s)
  // byte 1: crank event time MSB
  // byte 2: cumulative crank revs LSB
  // byte 3: cumulative crank revs MSB
  // byte 4: wheel event time LSB (1/1024s)
  // byte 5: wheel event time MSB
  // byte 6: cumulative wheel revs LSB
  // byte 7: cumulative wheel revs MSB
  var data = [
    BSC_CHANNEL,
    crankEventTime & 0xff, (crankEventTime >> 8) & 0xff,
    cumCrank & 0xff, (cumCrank >> 8) & 0xff,
    wheelEventTime & 0xff, (wheelEventTime >> 8) & 0xff,
    cumWheel & 0xff, (cumWheel >> 8) & 0xff,
  ];
  stick.write(Ant.Messages.broadcastData(data));
}

function broadcastHr() {
  // HR data page 0 (default)
  // byte 0: page number & page change toggle
  // byte 1-2: reserved (0xff)
  // byte 3: heart beat event time LSB (1/1024s)
  // byte 4: heart beat event time MSB
  // byte 5: heart beat count
  // byte 6: computed HR LSB
  // byte 7: computed HR MSB (always 0 for standard)
  if (hr > 0) {
    // Simulate beat timing from HR
    var beatIntervalMs = 60000 / hr;
    hrBeatTime = (hrBeatTime + Math.round((beatIntervalMs / 1000) * 1024)) & 0xffff;
    hrBeatCount = (hrBeatCount + 1) & 0xff;
  }

  var data = [
    HR_CHANNEL,
    (hrEventCount & 0x03) << 0, // page 0 + toggle
    0xff, 0xff,
    hrBeatTime & 0xff, (hrBeatTime >> 8) & 0xff,
    hrBeatCount & 0xff,
    hr & 0xff, 0x00,
  ];
  stick.write(Ant.Messages.broadcastData(data));
  hrEventCount++;
}

// --- Startup ---

stick.on('startup', function () {
  console.log('ANT+ stick opened');

  // Setup Power channel
  var pwrMsgs = [
    Ant.Messages.assignChannel(PWR_CHANNEL, 'transmit'),
    Ant.Messages.setDevice(PWR_CHANNEL, deviceId, PWR_DEVICE_TYPE, 1),
    Ant.Messages.setFrequency(PWR_CHANNEL, PWR_RF),
    Ant.Messages.setPeriod(PWR_CHANNEL, PWR_PERIOD),
    Ant.Messages.openChannel(PWR_CHANNEL),
  ];

  // Setup BSC channel (use deviceId+1 so Garmin sees them as separate sensors)
  var bscMsgs = [
    Ant.Messages.assignChannel(BSC_CHANNEL, 'transmit'),
    Ant.Messages.setDevice(BSC_CHANNEL, deviceId + 1, BSC_DEVICE_TYPE, 1),
    Ant.Messages.setFrequency(BSC_CHANNEL, BSC_RF),
    Ant.Messages.setPeriod(BSC_CHANNEL, BSC_PERIOD),
    Ant.Messages.openChannel(BSC_CHANNEL),
  ];

  // Setup HR channel (use deviceId+2)
  var hrMsgs = [
    Ant.Messages.assignChannel(HR_CHANNEL, 'transmit'),
    Ant.Messages.setDevice(HR_CHANNEL, deviceId + 2, HR_DEVICE_TYPE, 1),
    Ant.Messages.setFrequency(HR_CHANNEL, HR_RF),
    Ant.Messages.setPeriod(HR_CHANNEL, HR_PERIOD),
    Ant.Messages.openChannel(HR_CHANNEL),
  ];

  // Send all setup messages with small delays between channels
  pwrMsgs.forEach(function (m) { stick.write(m); });
  setTimeout(function () {
    bscMsgs.forEach(function (m) { stick.write(m); });
    setTimeout(function () {
      hrMsgs.forEach(function (m) { stick.write(m); });

      // Start broadcasting all channels
      setInterval(broadcastPower, Math.round((PWR_PERIOD / 32768) * 1000));
      setInterval(broadcastBsc, Math.round((BSC_PERIOD / 32768) * 1000));
      setInterval(broadcastHr, Math.round((HR_PERIOD / 32768) * 1000));

      console.log('');
      console.log('ANT+ broadcasting on 3 channels:');
      console.log('  Power meter:    device id ' + deviceId);
      console.log('  Speed/Cadence:  device id ' + (deviceId + 1));
      console.log('  Heart Rate:     device id ' + (deviceId + 2));
      console.log('');
      console.log('On Garmin, pair these sensors:');
      console.log('  Power Meter  -> id ' + deviceId);
      console.log('  Spd/Cad      -> id ' + (deviceId + 1));
      console.log('  Heart Rate   -> id ' + (deviceId + 2));
    }, 500);
  }, 500);
});

if (!stick.open()) {
  console.error('ERROR: Failed to open ANT+ stick');
  process.exit(1);
}

process.on('SIGINT', function () {
  console.log('\nShutting down...');
  try {
    stick.write(Ant.Messages.closeChannel(PWR_CHANNEL));
    stick.write(Ant.Messages.closeChannel(BSC_CHANNEL));
    stick.write(Ant.Messages.closeChannel(HR_CHANNEL));
  } catch (e) {}
  setTimeout(function () { process.exit(0); }, 500);
});
