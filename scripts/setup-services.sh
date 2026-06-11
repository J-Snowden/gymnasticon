#!/bin/bash
# Install and enable Gymnasticon systemd services.
# Run once on the Pi: sudo bash scripts/setup-services.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing systemd services..."
cp "$SCRIPT_DIR/gymnasticon-ant.service" /etc/systemd/system/
cp "$SCRIPT_DIR/gymnasticon-ble.service" /etc/systemd/system/

echo "Reloading systemd..."
systemctl daemon-reload

echo "Enabling services to start at boot..."
systemctl enable gymnasticon-ant.service
systemctl enable gymnasticon-ble.service

echo ""
echo "Done. Services will start automatically on boot."
echo ""
echo "Manual commands:"
echo "  Start both:   sudo systemctl start gymnasticon-ant gymnasticon-ble"
echo "  Stop both:    sudo systemctl stop gymnasticon-ble gymnasticon-ant"
echo "  View logs:    journalctl -u gymnasticon-ant -u gymnasticon-ble -f"
echo "  Check status: systemctl status gymnasticon-ant gymnasticon-ble"
