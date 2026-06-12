# Gymnasticon Fork: IC4 to Garmin BLE/ANT+ Bridge

Bridges exercise bikes that broadcast FTMS (Fitness Machine Service) data to fitness watches and bike computers via standard BLE and ANT+ cycling sensor profiles. Runs on a Raspberry Pi as a headless service.

Forked from [ptx2/gymnasticon](https://github.com/ptx2/gymnasticon). The original Node.js gymnasticon codebase is still in `src/` but is not used. This fork replaces it with lightweight Python and Node.js scripts in `scripts/`.

## Two Modes

### BLE Mode (recommended)

Single Python script. No extra hardware needed.

- Reads IC4 bike data via [bleak](https://github.com/hbldh/bleak) (BLE central)
- Broadcasts as a BLE Cycling Power sensor via [bluez-peripheral](https://github.com/spacecheese/bluez_peripheral) (BLE peripheral)
- Provides **power and cadence** to the receiving device
- **Note:** Speed/distance depend on the receiving device. Some watches (e.g. Garmin 955) only pair one BLE sensor type per device, so they get power and cadence but not speed.

### ANT+ Mode

Two-process setup. Requires a [CooSpo ANT+ USB stick](https://www.amazon.com/dp/B0BG89Y7R8).

- `ble-reader.py` (Python/bleak) reads IC4 bike data over BLE, sends via UDP
- `ant-bridge.js` (Node.js/gd-ant-plus) receives UDP and broadcasts as ANT+ power meter + speed/cadence sensor
- Garmin pairs power and speed as separate ANT+ sensors
- **Full data:** power, cadence, speed, and distance all work

## Hardware Tested

- Raspberry Pi 3B (Bluetooth 4.1, supports simultaneous BLE central + peripheral)
- Schwinn IC4 / Bowflex C6 indoor bike
- Garmin Forerunner 955
- CooSpo ANT+ USB stick (ANT+ mode only)

Should work with any FTMS-compatible bike, any Raspberry Pi with BLE 4.1+, and any watch or bike computer that supports BLE or ANT+ cycling sensors.

## Setup

### Prerequisites

```bash
# Python virtual environment with bleak and bluez-peripheral
python3 -m venv ~/bleak-env
~/bleak-env/bin/pip install bleak bluez-peripheral

# Node.js and ANT+ dependencies (ANT+ mode only)
cd ~/gymnasticon
npm install
```

### Install services

```bash
sudo cp ~/gymnasticon/scripts/gymnasticon-ble-bridge.service /etc/systemd/system/
sudo cp ~/gymnasticon/scripts/gymnasticon-ble.service /etc/systemd/system/
sudo cp ~/gymnasticon/scripts/gymnasticon-ant.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Enable one mode

**BLE mode:**
```bash
sudo systemctl disable gymnasticon-ble gymnasticon-ant
sudo systemctl enable gymnasticon-ble-bridge
sudo systemctl start gymnasticon-ble-bridge
```

**ANT+ mode:**
```bash
sudo systemctl disable gymnasticon-ble-bridge
sudo systemctl enable gymnasticon-ble gymnasticon-ant
sudo systemctl start gymnasticon-ble gymnasticon-ant
```

Only run one mode at a time -- both need an exclusive BLE connection to the bike.

### Switching modes

```bash
# Switch to BLE
sudo systemctl stop gymnasticon-ble gymnasticon-ant
sudo systemctl start gymnasticon-ble-bridge

# Switch to ANT+
sudo systemctl stop gymnasticon-ble-bridge
sudo systemctl start gymnasticon-ble gymnasticon-ant
```

## Garmin Pairing

**BLE mode:** Settings > Sensors & Accessories > Add Sensor > look for the power meter (shows as adapter name, e.g. "pi3")

**ANT+ mode:** Settings > Sensors & Accessories > Add Sensor > pair both the power meter and speed/cadence sensor separately

## Checking Logs

```bash
# BLE mode
journalctl -u gymnasticon-ble-bridge -f

# ANT+ mode
journalctl -u gymnasticon-ble -f
journalctl -u gymnasticon-ant -f
```

## File Structure

```
scripts/
  ble-bridge.py                    # BLE mode: combined reader + broadcaster
  ble-reader.py                    # ANT+ mode: BLE reader, sends UDP
  ant-bridge.js                    # ANT+ mode: UDP receiver, ANT+ broadcaster
  gymnasticon-ble-bridge.service   # systemd service for BLE mode
  gymnasticon-ble.service          # systemd service for BLE reader (ANT+ mode)
  gymnasticon-ant.service          # systemd service for ANT+ bridge
  patch-noble-hci.js               # patches noble for kernel 6.12 compatibility
```

## Tags

- `v1.0-working` -- ANT+ mode working end-to-end
- `v1.1-ble-bridge` -- BLE mode added as alternative to ANT+

## License

MIT (inherited from original gymnasticon)
