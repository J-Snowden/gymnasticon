#!/usr/bin/env python3
"""
BLE Bridge for Schwinn IC4 / Bowflex C6.
Reads bike data via bleak (BLE central) and broadcasts to Garmin
as Cycling Power + Speed/Cadence services via bluez-peripheral (BLE peripheral).
"""
import asyncio
import struct
import sys
import time

# FTMS Indoor Bike Data
INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
BIKE_NAME = "IC Bike"

# IC4 FTMS data format (flags 0x0244):
# bytes 0-1: flags, 2-3: speed (uint16, 0.01 km/h), 4-5: cadence (uint16, 0.5 rpm)
# bytes 6-7: power (sint16, watts), byte 8: heart rate (uint8)
IBD_MAGIC = 0x44
IDX_SPEED = 2
IDX_CADENCE = 4
IDX_POWER = 6
IDX_HR = 8

WHEEL_CIRCUMFERENCE_M = 1.0  # 1m = 1000mm, must match Garmin wheel size if using CSC


def parse_indoor_bike_data(data):
    """Parse FTMS Indoor Bike Data characteristic value."""
    if data[0] != IBD_MAGIC:
        return None
    speed_raw = struct.unpack_from('<H', data, IDX_SPEED)[0]
    speed_kmh = speed_raw * 0.01
    power = struct.unpack_from('<h', data, IDX_POWER)[0]
    cadence = round(struct.unpack_from('<H', data, IDX_CADENCE)[0] / 2)
    hr = data[IDX_HR] if len(data) > IDX_HR else 0
    return {"power": power, "cadence": cadence, "speed": round(speed_kmh, 2), "hr": hr}


from bluez_peripheral.gatt.service import Service
from bluez_peripheral.gatt.characteristic import characteristic, CharacteristicFlags as CharFlags


class CyclingPowerService(Service):
    """BLE Cycling Power Service (0x1818)."""

    def __init__(self):
        super().__init__("1818", True)
        self._power = 0
        self._crank_revs = 0
        self._crank_event_time = 0

    @characteristic("2A63", CharFlags.NOTIFY)
    def cycling_power_measurement(self, options):
        """Cycling Power Measurement characteristic."""
        return self._build_power_measurement()

    @characteristic("2A65", CharFlags.READ)
    def cycling_power_feature(self, options):
        """Cycling Power Feature: crank revolution data supported (bit 3)."""
        return struct.pack("<I", 0x00000008)

    @characteristic("2A5D", CharFlags.READ)
    def sensor_location(self, options):
        """Sensor Location: rear hub (0x0D)."""
        return struct.pack("<B", 0x0D)

    def _build_power_measurement(self):
        # Flags: bit 5 = crank revolution data present
        flags = 0x0020
        return struct.pack("<hh HH",
            flags,
            self._power,
            self._crank_revs & 0xFFFF,
            self._crank_event_time & 0xFFFF,
        )

    def update(self, power, crank_revs, crank_event_time):
        self._power = power
        self._crank_revs = crank_revs
        self._crank_event_time = crank_event_time
        self.cycling_power_measurement.changed(self._build_power_measurement())


class CyclingSpeedCadenceService(Service):
    """BLE Cycling Speed & Cadence Service (0x1816)."""

    def __init__(self):
        super().__init__("1816", True)
        self._crank_revs = 0
        self._crank_event_time = 0

    @characteristic("2A5B", CharFlags.NOTIFY)
    def csc_measurement(self, options):
        """CSC Measurement characteristic."""
        return self._build_csc_measurement()

    @characteristic("2A5C", CharFlags.READ)
    def csc_feature(self, options):
        """CSC Feature: crank revolution data supported (bit 1)."""
        return struct.pack("<H", 0x0002)

    def _build_csc_measurement(self):
        # Flags: bit 1 = crank revolution data present
        flags = 0x02
        return struct.pack("<B HH",
            flags,
            self._crank_revs & 0xFFFF,
            self._crank_event_time & 0xFFFF,
        )

    def update(self, crank_revs, crank_event_time):
        self._crank_revs = crank_revs
        self._crank_event_time = crank_event_time
        self.csc_measurement.changed(self._build_csc_measurement())


class RevolutionTracker:
    """Track cumulative revolutions and interpolate event times.

    Converts a continuous rate (speed or cadence) into integer revolution
    counts with precise event timestamps, avoiding quantization-induced
    speed oscillation on the receiving device.
    """

    def __init__(self):
        self.revolutions = 0.0       # fractional accumulator
        self.last_whole_revs = 0     # last integer count
        self.event_time = 0          # in 1/1024 s units
        self.last_time = time.monotonic()

    def update(self, revs_per_second):
        """Accumulate revolutions and return (cumulative_revs, event_time_1024s).

        Args:
            revs_per_second: current revolution rate

        Returns:
            (int, int): cumulative whole revolutions (uint16), event time in 1/1024s (uint16)
        """
        now = time.monotonic()
        dt = now - self.last_time
        prev_time = self.last_time
        self.last_time = now

        prev_accum = self.revolutions
        self.revolutions += revs_per_second * dt

        cum = int(self.revolutions) & 0xFFFF

        if cum != self.last_whole_revs:
            # Interpolate when the last integer boundary was crossed
            last_crossing = int(self.revolutions)
            d_revs = self.revolutions - prev_accum
            if d_revs > 0:
                fraction = (last_crossing - prev_accum) / d_revs
            else:
                fraction = 1.0
            crossing_time = prev_time + fraction * (now - prev_time)
            self.event_time = round(crossing_time * 1024) & 0xFFFF
            self.last_whole_revs = cum

        return cum, self.event_time


from bluez_peripheral.advert import Advertisement
from bluez_peripheral.util import Adapter, get_message_bus
from bluez_peripheral.agent import NoIoAgent


async def scan_for_bike(BleakScanner):
    """Scan indefinitely until the bike is found."""
    print(f"Scanning for {BIKE_NAME}...")
    while True:
        device = await BleakScanner.find_device_by_name(BIKE_NAME, timeout=10)
        if device:
            print(f"Found: {device.name} ({device.address})")
            return device


async def main():
    from bleak import BleakClient, BleakScanner

    # --- Set up BLE peripheral (GATT server + advertising) ---
    bus = await get_message_bus()

    cps = CyclingPowerService()
    await cps.register(bus)

    csc = CyclingSpeedCadenceService()
    await csc.register(bus)

    agent = NoIoAgent()
    await agent.register(bus)

    adapter = await Adapter.get_first(bus)
    advert = Advertisement("Gymnasticon", ["1818", "1816"], 0x0480, 0)
    await advert.register(bus, adapter)

    print("BLE peripheral advertising as 'Gymnasticon'")

    # --- Revolution trackers ---
    crank_tracker = RevolutionTracker()
    wheel_tracker = RevolutionTracker()

    # --- Main loop: scan, connect, read, broadcast ---
    while True:
        try:
            device = await scan_for_bike(BleakScanner)

            async with BleakClient(device, timeout=30) as client:
                print(f"Connected to {device.name}")

                def on_bike_data(sender, data):
                    parsed = parse_indoor_bike_data(data)
                    if not parsed:
                        return

                    power = max(0, parsed["power"])
                    cadence = max(0, parsed["cadence"])
                    speed = max(0, parsed["speed"])

                    # Convert to revolutions/second
                    crank_rps = cadence / 60.0
                    wheel_rps = (speed / 3.6) / WHEEL_CIRCUMFERENCE_M

                    # Update trackers
                    crank_revs, crank_time = crank_tracker.update(crank_rps)
                    wheel_revs, wheel_time = wheel_tracker.update(wheel_rps)

                    # Update BLE services and notify
                    cps.update(power, crank_revs, crank_time)
                    csc.update(crank_revs, crank_time)

                    print(f"Power: {power}W  Cadence: {cadence}rpm  "
                          f"Speed: {speed}km/h  HR: {parsed['hr']}bpm")

                await client.start_notify(INDOOR_BIKE_DATA_UUID, on_bike_data)
                print("Listening for bike data... pedal to begin!")

                while client.is_connected:
                    await asyncio.sleep(1)

                print("Bike disconnected, scanning again...")

        except Exception as e:
            print(f"Error: {e}, retrying in 5s...")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
