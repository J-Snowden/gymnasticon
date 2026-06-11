#!/bin/bash
# Start the Gymnasticon BLE-to-ANT+ bridge.
# Runs the Python BLE reader and Node.js ANT+ broadcaster together.
#
# Usage: sudo ./start-bridge.sh
#
# Requirements:
#   - bluetoothd must be running (for bleak/D-Bus)
#   - Python venv with bleak at ~/bleak-env
#   - Node 12 via nvm
#   - ANT+ USB stick plugged in

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Ensure bluetooth service is running (bleak needs bluetoothd for D-Bus)
systemctl is-active --quiet bluetooth || systemctl start bluetooth

echo "=== Gymnasticon BLE-to-ANT+ Bridge ==="
echo ""
echo "Starting ANT+ broadcaster..."

# Start ANT+ broadcaster in background
NODE_PATH="$REPO_DIR/node_modules" node "$SCRIPT_DIR/ant-bridge.js" "$@" &
ANT_PID=$!

# Give ANT+ a moment to initialize
sleep 2

echo "Starting BLE reader..."

# Start BLE reader (foreground so we see bike data)
~/bleak-env/bin/python "$SCRIPT_DIR/ble-reader.py" &
BLE_PID=$!

# Handle shutdown
cleanup() {
    echo ""
    echo "Stopping..."
    kill $BLE_PID 2>/dev/null
    kill $ANT_PID 2>/dev/null
    wait 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# Wait for either process to exit
wait -n 2>/dev/null || true
cleanup
