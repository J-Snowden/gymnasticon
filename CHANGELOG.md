# Changelog

## v1.1-ble-bridge (2026-06-11)

- Add BLE bridge mode: single Python script reads IC4 and broadcasts to Garmin as BLE Cycling Power + Speed/Cadence sensor
- No ANT+ USB stick required for BLE mode
- Work around bluez-peripheral Adapter discovery bug on BlueZ 5.82
- Add systemd service for BLE bridge mode

## v1.0-working (2026-06-10)

- Replace original gymnasticon Node.js app with Python BLE reader + Node.js ANT+ bridge
- `ble-reader.py`: reads IC4 bike data via bleak, sends over UDP
- `ant-bridge.js`: receives UDP, broadcasts as ANT+ power meter + speed/cadence sensor
- Fix speed oscillation by interpolating revolution crossing times
- Patch noble HCI for kernel 6.12 compatibility
- Add systemd services for auto-start at boot
- Tested on Raspberry Pi 3B with Garmin 955
