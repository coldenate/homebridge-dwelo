import assert from 'node:assert/strict';
import test from 'node:test';

import { DweloPerimeterDoorAccessory } from '../dist/DweloPerimeterDoorAccessory.js';

class FakeCharacteristic {
  onGet(handler) {
    this.getHandler = handler;
    return this;
  }

  onSet(handler) {
    this.setHandler = handler;
    return this;
  }

  updateValue(value) {
    this.value = value;
    return this;
  }
}

class FakeLockMechanism {
  characteristics = new Map();

  getCharacteristic(type) {
    const characteristic = this.characteristics.get(type) ?? new FakeCharacteristic();
    this.characteristics.set(type, characteristic);
    return characteristic;
  }
}

test('opens a configured community door and assumes it relocks', async () => {
  const LockCurrentState = { SECURED: 1, UNSECURED: 0 };
  const LockTargetState = { SECURED: 1, UNSECURED: 0 };
  const api = {
    hap: {
      Characteristic: { LockCurrentState, LockTargetState },
      Service: { LockMechanism: FakeLockMechanism },
    },
  };
  const calls = [];
  const dweloAPI = {
    async openPerimeterDoor(id, panelId) {
      calls.push([id, panelId]);
    },
  };
  const log = Object.assign(() => {}, { info() {} });
  const accessory = new DweloPerimeterDoorAccessory(log, api, dweloAPI, 'Pool', 19, 'panel', 0.01);
  const service = accessory.getServices()[0];
  const current = service.getCharacteristic(LockCurrentState);
  const target = service.getCharacteristic(LockTargetState);

  await target.setHandler(LockTargetState.UNSECURED);

  assert.deepEqual(calls, [[19, 'panel']]);
  assert.equal(current.value, LockCurrentState.UNSECURED);
  assert.equal(target.value, LockTargetState.UNSECURED);

  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(current.value, LockCurrentState.SECURED);
  assert.equal(target.value, LockTargetState.SECURED);
});
