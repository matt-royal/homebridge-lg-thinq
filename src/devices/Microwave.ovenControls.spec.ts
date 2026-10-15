import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Logger, PlatformAccessory } from 'homebridge';
import Microwave from './Microwave.js';
import { AccessoryContext } from '../baseDevice.js';
import { LGThinQHomebridgePlatform } from '../platform.js';
import { Device, DeviceData } from '../lib/Device.js';
import { CHARACTERISTIC, createFakeAccessory, FakeService, SERVICE } from './testSupport/fakeHap.js';

/**
 * The microwave publishes far more than a fan and a light: a Television with
 * nine input sources, fourteen switches, two timer valves, a thermostat and a
 * power dimmer, thirty-one services in one accessory. Home shows that as an
 * Apple TV and lists it in the iPhone remote. `oven_controls: false` keeps
 * only the fan and the light.
 */

const DEVICE_ID = '72cab768-be92-1f73-b459-805b651ff676';

function ovenState(overrides: Record<string, unknown> = {}) {
  return {
    LWOState: 'INITIAL',
    LWOManualCookName: 'STANDBY',
    LWOTargetTemperatureUnit: 'FAHRENHEIT',
    LWORemainTimeHour: 0,
    LWORemainTimeMinute: 0,
    LWORemainTimeSecond: 0,
    LWOTimerHour: 0,
    LWOTimerMinute: 0,
    LWOTimerSecond: 0,
    LWOTargetTimeHour: 0,
    LWOTargetTimeMinute: 0,
    LWOTargetTimeSecond: 0,
    LWOMGTPowerLevel: '0',
    mwoVentSpeedLevel: 0,
    mwoLampLevel: 0,
    ...overrides,
  };
}

function microwaveDevice(state = ovenState()) {
  const deviceData: DeviceData = {
    deviceId: DEVICE_ID,
    alias: 'Microwave',
    deviceType: 302,
    modelJsonUri: 'https://example.com/model.json',
    modelName: 'WMHES1738',
    snapshot: { online: true, ovenState: state },
    online: true,
  };
  return new Device(deviceData);
}

/** Services as Homebridge restores them from the cache of an earlier run that
 * published everything. */
function seedCachedServices(addService: (type: unknown, name?: unknown, subtype?: string) => FakeService) {
  addService(SERVICE.AccessoryInformation);
  addService(SERVICE.Fanv2, 'Microwave Fan', 'YourUniqueIdentifier-59F');
  addService(SERVICE.Lightbulb, 'Microwave Light', 'YourUniqueIdentifier-59L');
  addService(SERVICE.Lightbulb, 'Microwave Power', 'YourUniqueIdentifier-59SP');
  addService(SERVICE.Switch, 'Turn Off Microwave', 'CataNicoGaTa-Control8Off');
  addService(SERVICE.Television, undefined, 'NicoCataGaTa-OvenOven7');
  addService(SERVICE.InputSource, 'Microwave Status', 'NicoCataGaTa-Oven1003');
  addService(SERVICE.Valve, 'Microwave Timer', 'NicoCataGaTa-OvenT32');
  addService(SERVICE.Switch, 'Microwave Mode', 'CataNicoGaTa-80M');
  addService(SERVICE.Thermostat, 'Microwave Oven Temperature Control', 'NicoCataGaTa-OvenTC');
}

describe('Microwave oven controls option', () => {
  let logger: Logger;
  let updatePlatformAccessories: jest.Mock;
  let deviceControl: jest.Mock;
  let fake: ReturnType<typeof createFakeAccessory>;

  beforeEach(() => {
    jest.useFakeTimers();
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
    updatePlatformAccessories = jest.fn();
    deviceControl = jest.fn(() => new Promise<void>(() => undefined));
    fake = createFakeAccessory();
  });

  function build(deviceConfig: Record<string, unknown> | null, device = microwaveDevice()) {
    const accessory = {
      context: { device },
      services: fake.serviceList,
      getService: fake.getService,
      getServiceById: fake.getServiceById,
      addService: fake.addService,
      removeService: fake.removeService,
    } as unknown as PlatformAccessory<AccessoryContext>;

    const platform = {
      Characteristic: CHARACTERISTIC,
      Service: SERVICE,
      log: logger,
      config: { devices: deviceConfig ? [{ id: DEVICE_ID, ...deviceConfig }] : [] },
      api: {
        updatePlatformAccessories,
        hap: {
          HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
          HapStatusError: class HapStatusError extends Error {
            constructor(public status: number) {
              super(String(status));
            }
          },
        },
      },
      ThinQ: { deviceControl },
    } as unknown as LGThinQHomebridgePlatform;

    return new Microwave(platform, accessory, logger);
  }

  const publishedTypes = () => fake.serviceList.map(service => service.UUID);

  it('publishes the whole oven by default, as it always has', () => {
    build(null);

    expect(publishedTypes()).toContain('Television');
    expect(fake.services.has('Microwave Power')).toBe(true);
    expect(fake.services.has('Microwave Oven Temperature Control')).toBe(true);
    expect(publishedTypes().filter(type => type === 'Switch').length).toBeGreaterThan(10);
  });

  it('publishes the whole oven when the option is true or the device has other settings only', () => {
    build({ oven_controls: true });
    expect(publishedTypes()).toContain('Television');
  });

  it('publishes only the fan and the light when oven_controls is false', () => {
    build({ oven_controls: false });

    expect(publishedTypes()).toEqual(['AccessoryInformation', 'Fanv2', 'Lightbulb']);
    expect(fake.services.has('Microwave Fan')).toBe(true);
    expect(fake.services.has('Microwave Light')).toBe(true);
  });

  it('never adds a Television when oven_controls is false', () => {
    build({ oven_controls: false });

    const addedTypes = fake.addService.mock.calls.map(call => String(call[0]));
    expect(addedTypes).not.toContain('Television');
    expect(addedTypes).not.toContain('InputSource');
  });

  it('removes the oven services an earlier run left in the cache', () => {
    seedCachedServices(fake.addService);

    build({ oven_controls: false });

    expect(publishedTypes()).toEqual(['AccessoryInformation', 'Fanv2', 'Lightbulb']);
  });

  it('keeps the cached fan and light themselves, not copies of them', () => {
    seedCachedServices(fake.addService);
    const cachedFan = fake.services.get('Microwave Fan');
    const cachedLight = fake.services.get('Microwave Light');

    build({ oven_controls: false });

    expect(fake.services.get('Microwave Fan')).toBe(cachedFan);
    expect(fake.services.get('Microwave Light')).toBe(cachedLight);
  });

  it('saves the accessory once after removing services, so the removal survives a restart', () => {
    seedCachedServices(fake.addService);

    build({ oven_controls: false });

    expect(updatePlatformAccessories).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite the cache when there was nothing to remove', () => {
    build({ oven_controls: false });

    expect(updatePlatformAccessories).not.toHaveBeenCalled();
  });

  it('publishes the oven again when oven_controls goes back to true', () => {
    // What an earlier run with oven_controls false left in the cache.
    fake.addService(SERVICE.AccessoryInformation);
    fake.addService(SERVICE.Fanv2, 'Microwave Fan', 'YourUniqueIdentifier-59F');
    fake.addService(SERVICE.Lightbulb, 'Microwave Light', 'YourUniqueIdentifier-59L');

    build({ oven_controls: true });

    expect(publishedTypes()).toContain('Television');
    expect(publishedTypes().filter(type => type === 'InputSource')).toHaveLength(9);
  });

  it('leaves the cached oven services alone when oven_controls is not false', () => {
    seedCachedServices(fake.addService);
    const before = publishedTypes().length;

    build(null);

    expect(fake.removeService).not.toHaveBeenCalled();
    expect(publishedTypes().length).toBeGreaterThanOrEqual(before);
  });

  it('still drives the fan when oven_controls is false', async () => {
    build({ oven_controls: false });
    const hood = fake.services.get('Microwave Fan')!;

    await hood.getCharacteristic(CHARACTERISTIC.RotationSpeed).triggerSet(3);
    await jest.advanceTimersByTimeAsync(250);

    expect(deviceControl).toHaveBeenCalledTimes(1);
    const [, payload] = deviceControl.mock.calls[0] as [unknown, { dataSetList: { ovenState: Record<string, unknown> } }];
    expect(payload.dataSetList.ovenState.mwoVentSpeedLevel).toBe(3);
  });

  it('still shows the device state on the fan and the light when oven_controls is false', () => {
    const microwave = build({ oven_controls: false });
    const light = fake.services.get('Microwave Light')!;
    const hood = fake.services.get('Microwave Fan')!;

    microwave.updateAccessoryCharacteristic(microwaveDevice(ovenState({ mwoLampLevel: 2, mwoVentSpeedLevel: 3 })));

    expect(light.getCharacteristic(CHARACTERISTIC.On).value).toBe(true);
    expect(light.getCharacteristic(CHARACTERISTIC.Brightness).value).toBe(2);
    expect(hood.getCharacteristic(CHARACTERISTIC.Active).value).toBe(1);
    expect(hood.getCharacteristic(CHARACTERISTIC.RotationSpeed).value).toBe(3);
  });
});
