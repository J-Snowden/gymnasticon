#!/usr/bin/env python3
"""
BLE reader for Schwinn IC4 / Bowflex C6 bike.
Connects via bleak (BlueZ D-Bus) and sends power/cadence as JSON over UDP.
"""
import asyncio
import json
import socket
import struct
import sys

INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
BIKE_NAME = "IC Bike"
UDP_HOST = "127.0.0.1"
UDP_PORT = 3000

# IC4 always sends this fixed format (flags 0x0244):
# bytes 0-1: flags
# bytes 2-3: instantaneous speed (uint16, 0.01 km/h)
# bytes 4-5: instantaneous cadence (uint16, 0.5 rpm)
# bytes 6-7: instantaneous power (int16, watts)
# byte 8:    heart rate (uint8)
IBD_MAGIC = 0x44
IDX_SPEED = 2
IDX_CADENCE = 4
IDX_POWER = 6
IDX_HR = 8

def parse_indoor_bike_data(data):
    if data[0] != IBD_MAGIC:
        return None
    speed_raw = struct.unpack_from('<H', data, IDX_SPEED)[0]
    speed_kmh = speed_raw * 0.01
    power = struct.unpack_from('<h', data, IDX_POWER)[0]
    cadence = round(struct.unpack_from('<H', data, IDX_CADENCE)[0] / 2)
    hr = data[IDX_HR] if len(data) > IDX_HR else 0
    return {"power": power, "cadence": cadence, "speed": round(speed_kmh, 2), "hr": hr}

async def main():
    from bleak import BleakClient, BleakScanner

    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    print(f"Scanning for {BIKE_NAME}...")
    device = await BleakScanner.find_device_by_name(BIKE_NAME, timeout=30)
    if not device:
        print(f"ERROR: {BIKE_NAME} not found. Is it powered on?")
        sys.exit(1)

    print(f"Found: {device.name} ({device.address})")

    while True:
        try:
            async with BleakClient(device, timeout=30) as client:
                print(f"Connected to {device.name}")

                def callback(sender, data):
                    parsed = parse_indoor_bike_data(data)
                    if parsed:
                        msg = json.dumps(parsed).encode()
                        udp.sendto(msg, (UDP_HOST, UDP_PORT))
                        print(f"Power: {parsed['power']}W  Cadence: {parsed['cadence']}rpm  Speed: {parsed['speed']}km/h  HR: {parsed['hr']}bpm")

                await client.start_notify(INDOOR_BIKE_DATA_UUID, callback)
                print("Listening for bike data... pedal to begin!")

                # Keep running until disconnected
                while client.is_connected:
                    await asyncio.sleep(1)

                print("Bike disconnected, reconnecting...")

        except Exception as e:
            print(f"Error: {e}, retrying in 3s...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    asyncio.run(main())
