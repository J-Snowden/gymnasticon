#!/usr/bin/env python3
"""Minimal test: advertise a BLE service via bluez-peripheral on Pi 3B."""
import asyncio
import struct
from bluez_peripheral.gatt.service import Service
from bluez_peripheral.gatt.characteristic import characteristic, CharacteristicFlags as CharFlags
from bluez_peripheral.advert import Advertisement
from bluez_peripheral.util import Adapter, get_message_bus
from bluez_peripheral.agent import NoIoAgent


async def get_adapter(bus):
    """Get the first Bluetooth adapter directly, bypassing buggy get_all().

    bluez-peripheral's Adapter.get_all() introspects all child nodes under
    /org/bluez and assumes they're all adapters. BlueZ 5.82 has non-adapter
    nodes (e.g. mesh) which causes InterfaceNotFoundError.
    """
    introspection = await bus.introspect("org.bluez", "/org/bluez/hci0")
    proxy = bus.get_proxy_object("org.bluez", "/org/bluez/hci0", introspection)
    return Adapter(proxy)


class TestService(Service):
    def __init__(self):
        super().__init__("180D", True)  # Heart Rate Service UUID

    @characteristic("2A37", CharFlags.NOTIFY)
    def heart_rate(self, options):
        return struct.pack("<BB", 0, 72)

async def main():
    bus = await get_message_bus()

    adapter = await get_adapter(bus)

    service = TestService()
    await service.register(bus, adapter=adapter)

    agent = NoIoAgent()
    await agent.register(bus)

    advert = Advertisement("BLE-Test", ["180D"], 0x0340, 0)
    await advert.register(bus, adapter)

    print("Advertising 'BLE-Test' as Heart Rate Service...")
    print("Check with: bluetoothctl scan on (from another device)")
    print("Ctrl+C to stop")

    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
