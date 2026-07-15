import { API, StaticPlatformPlugin, PlatformConfig, AccessoryPlugin, Logging } from 'homebridge';

import { DweloAPI } from './DweloAPI.js';
import {
  DweloDeviceType,
  DweloStatePoller,
  resolveOnGetStrategy,
  resolveStatePollMs,
  shouldPollDeviceType,
} from './DweloStatePoller.js';
import { DweloLockAccessory } from './DweloLockAccessory.js';
import { DweloPerimeterDoorAccessory } from './DweloPerimeterDoorAccessory.js';
import { DweloSwitchAccessory } from './DweloSwitchAccessory.js';
import {
  buildSensorMap,
  DweloThermostatAccessory,
  DweloThermostatOptions,
  hasNumericSensorValue,
  SENSOR_ALIASES,
} from './DweloThermostatAccessory.js';

export class HomebridgePluginDweloPlatform implements StaticPlatformPlugin {
  private readonly dweloAPI: DweloAPI;
  private readonly statePoller: DweloStatePoller;
  private readonly statePollMs: number;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.dweloAPI = new DweloAPI(config.token, config.gatewayId);
    this.statePollMs = resolveStatePollMs(config);
    this.statePoller = new DweloStatePoller(
      this.dweloAPI,
      this.log,
      this.statePollMs,
      resolveOnGetStrategy(config),
    );

    this.log.info(`Finished initializing platform: ${this.config.name}`);
  }

  accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
    this.dweloAPI.devices().then(async devices => {
      const accessories = await Promise.all(devices
        .map(async (d): Promise<AccessoryPlugin | null> => {
          switch (d.deviceType) {
          case 'switch':
            return new DweloSwitchAccessory(
              this.log,
              this.api,
              this.dweloAPI,
              this.deviceState(d.uid, d.deviceType),
              d.givenName,
              d.uid,
            );
          case 'lock':
            return new DweloLockAccessory(
              this.log,
              this.api,
              this.statePollMs,
              (typeof this.config.autoLockMinutes === 'number' ? this.config.autoLockMinutes : 3),
              this.dweloAPI,
              this.deviceState(d.uid, d.deviceType),
              d.givenName,
              d.uid,
            );
          case 'thermostat': {
            const thermostatOptions = await this.thermostatOptions(d.uid);
            return new DweloThermostatAccessory(
              this.log,
              this.api,
              this.dweloAPI,
              this.deviceState(d.uid, d.deviceType),
              d.givenName,
              d.uid,
              d.device_metadata ?? {},
              thermostatOptions,
            );
          }
          default:
            this.log.warn(`Support for Dwelo accessory type: ${d.deviceType} is not implemented`);
            return null;
          }
        }));

      callback([
        ...accessories.filter((a): a is AccessoryPlugin => !!a),
        ...this.perimeterDoorAccessories(),
      ]);
      this.statePoller.start();
    });
  }

  private perimeterDoorAccessories(): AccessoryPlugin[] {
    if (!Array.isArray(this.config.perimeterDoors) || this.config.perimeterDoors.length === 0) {
      return [];
    }
    if (typeof this.config.perimeterPanelId !== 'string' || !this.config.perimeterPanelId.trim()) {
      this.log.warn('Community doors are configured but perimeterPanelId is missing; no community doors will be exposed.');
      return [];
    }

    const openSeconds = typeof this.config.perimeterDoorOpenSeconds === 'number'
      && Number.isFinite(this.config.perimeterDoorOpenSeconds)
      && this.config.perimeterDoorOpenSeconds > 0
      ? this.config.perimeterDoorOpenSeconds
      : 10;

    return this.config.perimeterDoors.flatMap((door: unknown) => {
      if (!door || typeof door !== 'object') {
        return [];
      }
      const { id, name } = door as { id?: unknown; name?: unknown };
      if (!Number.isInteger(id) || (id as number) <= 0 || typeof name !== 'string' || !name.trim()) {
        this.log.warn('Skipping invalid community door configuration. Each door needs a positive integer id and a name.');
        return [];
      }
      return [new DweloPerimeterDoorAccessory(
        this.log,
        this.api,
        this.dweloAPI,
        name.trim(),
        id as number,
        this.config.perimeterPanelId.trim(),
        openSeconds,
      )];
    });
  }

  private deviceState(deviceId: number, deviceType: DweloDeviceType) {
    return this.statePoller.deviceState(deviceId, shouldPollDeviceType(this.config, deviceType));
  }

  private async thermostatOptions(thermostatID: number): Promise<DweloThermostatOptions> {
    return {
      displayUnits: this.config.thermostatDisplayUnits === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      exposeHumidity: await this.shouldExposeThermostatHumidity(thermostatID),
      exposeBattery: this.config.exposeThermostatBattery !== false,
      logSensorInventory: this.config.logThermostatSensorInventory === true,
    };
  }

  private async shouldExposeThermostatHumidity(thermostatID: number): Promise<boolean> {
    if (this.config.exposeThermostatHumidity === false) {
      return false;
    }

    try {
      const sensors = buildSensorMap(await this.dweloAPI.sensors(thermostatID));
      return hasNumericSensorValue(sensors, SENSOR_ALIASES.humidity);
    } catch (error) {
      this.log.warn(`Could not read thermostat ${thermostatID} sensors; humidity will not be exposed: ${error}`);
      return false;
    }
  }
}
