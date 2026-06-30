import { API, StaticPlatformPlugin, PlatformConfig, AccessoryPlugin, Logging } from 'homebridge';

import { DweloAPI } from './DweloAPI.js';
import { DweloLockAccessory } from './DweloLockAccessory.js';
import { DweloSwitchAccessory } from './DweloSwitchAccessory.js';

export class HomebridgePluginDweloPlatform implements StaticPlatformPlugin {
  private readonly dweloAPI: DweloAPI;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.dweloAPI = new DweloAPI(config.token, config.gatewayId);

    this.log.info(`Finished initializing platform: ${this.config.name}`);
  }

  accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
    this.dweloAPI.devices().then(devices => {
      const accessories = devices
        .map((d): AccessoryPlugin | null => {
          switch (d.deviceType) {
          case 'switch':
            return new DweloSwitchAccessory(this.log, this.api, this.dweloAPI, d.givenName, d.uid);
          case 'lock':
            return new DweloLockAccessory(
              this.log,
              this.api,
              (typeof this.config.lockPollMs === 'number' ? this.config.lockPollMs : 60000),
              (typeof this.config.autoLockMinutes === 'number' ? this.config.autoLockMinutes : 3),
              this.dweloAPI,
              d.givenName,
              d.uid,
            );
          default:
            this.log.warn(`Support for Dwelo accessory type: ${d.deviceType} is not implemented`);
            return null;
          }
        })
        .filter((a): a is AccessoryPlugin => !!a);

      callback(accessories);
    });
  }
}
