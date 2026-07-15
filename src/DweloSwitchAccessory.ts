import {
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from 'homebridge';

import { DweloAPI } from './DweloAPI.js';
import { DweloDeviceState } from './DweloStatePoller.js';

export class DweloSwitchAccessory implements AccessoryPlugin {
  name: string;

  private readonly log: Logging;
  private readonly service: Service;

  constructor(
    log: Logging,
    private readonly api: API,
    dweloAPI: DweloAPI,
    sensorState: DweloDeviceState,
    name: string,
    switchID: number,
  ) {
    this.log = log;
    this.name = name;

    this.service = new this.api.hap.Service.Switch(this.name);
    this.service.getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        const isOn = this.isOn(await sensorState.readSensors()) ?? false;
        log.debug(`Current state of the switch was returned: ${isOn ? 'ON' : 'OFF'}`);
        return isOn;
      })
      .onSet(async value => {
        await dweloAPI.toggleSwitch(value as boolean, switchID);
        this.updateOn(value);
        log.debug(`Switch state was set to: ${value ? 'ON' : 'OFF'}`);
      });

    sensorState.onUpdate(sensors => {
      const isOn = this.isOn(sensors);
      if (isOn !== undefined) {
        this.updateOn(isOn);
      }
    });

    log.info(`Dwelo Switch '${name} ' created!`);
  }

  identify(): void {
    this.log('Identify!');
  }

  getServices(): Service[] {
    return [this.service];
  }

  private updateOn(value: CharacteristicValue) {
    this.service.getCharacteristic(this.api.hap.Characteristic.On)
      .updateValue(value);
  }

  private isOn(sensors: Awaited<ReturnType<DweloAPI['sensors']>>) {
    const sensor = sensors.find(sensor => ['switch', 'state'].includes(sensor.sensorType.toLowerCase()));
    return sensor ? sensor.value === 'on' : undefined;
  }
}
