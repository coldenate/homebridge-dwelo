import {
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from 'homebridge';

import { DweloAPI } from './DweloAPI.js';

export class DweloPerimeterDoorAccessory implements AccessoryPlugin {
  private readonly lockService: Service;
  private relockTimer?: NodeJS.Timeout;
  private locked = true;

  constructor(
    private readonly log: Logging,
    private readonly api: API,
    private readonly dweloAPI: Pick<DweloAPI, 'openPerimeterDoor'>,
    public readonly name: string,
    private readonly doorId: number,
    private readonly panelId: string,
    private readonly openSeconds: number,
  ) {
    this.lockService = new api.hap.Service.LockMechanism(name);
    this.lockService.getCharacteristic(api.hap.Characteristic.LockCurrentState)
      .onGet(() => this.currentState());
    this.lockService.getCharacteristic(api.hap.Characteristic.LockTargetState)
      .onGet(() => this.targetState())
      .onSet(value => this.setTargetState(value));

    log.info(`Dwelo community door '${name}' created!`);
  }

  identify(): void {
    this.log('Identify!');
  }

  getServices(): Service[] {
    return [this.lockService];
  }

  private currentState() {
    const state = this.api.hap.Characteristic.LockCurrentState;
    return this.locked ? state.SECURED : state.UNSECURED;
  }

  private targetState() {
    const state = this.api.hap.Characteristic.LockTargetState;
    return this.locked ? state.SECURED : state.UNSECURED;
  }

  private async setTargetState(value: CharacteristicValue) {
    if (value === this.api.hap.Characteristic.LockTargetState.SECURED) {
      return;
    }

    await this.dweloAPI.openPerimeterDoor(this.doorId, this.panelId);
    this.locked = false;
    this.updateState();
    clearTimeout(this.relockTimer);
    this.relockTimer = setTimeout(() => {
      this.locked = true;
      this.updateState();
    }, this.openSeconds * 1000);
    this.log.info(`Opened community door '${this.name}'; assuming it relocks in ${this.openSeconds} seconds.`);
  }

  private updateState() {
    this.lockService.getCharacteristic(this.api.hap.Characteristic.LockCurrentState).updateValue(this.currentState());
    this.lockService.getCharacteristic(this.api.hap.Characteristic.LockTargetState).updateValue(this.targetState());
  }
}
