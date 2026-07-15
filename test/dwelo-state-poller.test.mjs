import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DweloDeviceState,
  DweloStatePoller,
  resolveOnGetStrategy,
  resolvePushDeviceTypes,
  resolveStatePollMs,
  shouldEnablePushUpdates,
  shouldPollDeviceType,
} from '../dist/DweloStatePoller.js';

const sensor = (sensorType, value, deviceId = 1) => ({
  deviceId,
  gatewayId: 1,
  sensorType,
  timeIssued: '',
  uid: 1,
  value,
});

const log = {
  debug() { },
  warn() { },
};

const reader = (...responses) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async sensors() {
      const response = responses[calls++];
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
};

test('reads cached sensors before fetching Dwelo', async () => {
  const api = reader(new Error('should not fetch when cached'));
  const state = new DweloDeviceState(1, api);

  state.updateSensors([sensor('lock', 'locked')]);

  assert.deepEqual(await state.readSensors(), [sensor('lock', 'locked')]);
  assert.equal(api.calls, 0);
});

test('always-live read strategy fetches even when cached state exists', async () => {
  const api = reader([sensor('switch', 'off')]);
  const state = new DweloDeviceState(1, api, Infinity, 'always-live');

  state.updateSensors([sensor('switch', 'on')]);

  assert.deepEqual(await state.readSensors(), [sensor('switch', 'off')]);
  assert.equal(api.calls, 1);
});

test('cache-only read strategy never fetches from Dwelo', async () => {
  const api = reader([sensor('switch', 'off')]);
  const state = new DweloDeviceState(1, api, Infinity, 'cache-only');

  await assert.rejects(() => state.readSensors(), /No cached Dwelo state/);

  state.updateSensors([sensor('switch', 'on')]);

  assert.deepEqual(await state.readSensors(), [sensor('switch', 'on')]);
  assert.equal(api.calls, 0);
});

test('fetches and caches sensors when cache is empty', async () => {
  const api = reader([sensor('switch', 'on')]);
  const state = new DweloDeviceState(1, api);

  assert.deepEqual(await state.readSensors(), [sensor('switch', 'on')]);
  assert.deepEqual(await state.readSensors(), [sensor('switch', 'on')]);
  assert.equal(api.calls, 1);
});

test('coalesces concurrent sensor reads', async () => {
  let resolveSensors;
  const api = reader(new Promise(resolve => {
    resolveSensors = resolve;
  }));
  const state = new DweloDeviceState(1, api);

  const first = state.readSensors();
  const second = state.readSensors();
  resolveSensors([sensor('switch', 'on')]);

  assert.deepEqual(await Promise.all([first, second]), [
    [sensor('switch', 'on')],
    [sensor('switch', 'on')],
  ]);
  assert.equal(api.calls, 1);
});

test('refreshes sensors when cached state is stale', async () => {
  const api = reader([sensor('switch', 'off')]);
  const state = new DweloDeviceState(1, api, -1);

  state.updateSensors([sensor('switch', 'on')]);

  assert.deepEqual(await state.readSensors(), [sensor('switch', 'off')]);
  assert.equal(api.calls, 1);
});

test('gateway poll updates every device in one request and preserves state after failure', async () => {
  const calls = [];
  const api = {
    async sensors(deviceId) {
      calls.push(deviceId);
      if (calls.length === 2) {
        throw new Error('Dwelo unavailable');
      }
      return [sensor('state', 'cooling'), sensor('switch', 'on', 2)];
    },
  };
  const poller = new DweloStatePoller(api, log, 60000, 'cached-first');
  const firstUpdates = [];
  const secondUpdates = [];
  const firstState = poller.deviceState(1);
  firstState.onUpdate(sensors => firstUpdates.push(sensors));
  poller.deviceState(2).onUpdate(sensors => secondUpdates.push(sensors));

  await poller.pollOnce();
  await poller.pollOnce();

  assert.deepEqual(calls, [undefined, undefined]);
  assert.deepEqual(firstUpdates, [[sensor('state', 'cooling')]]);
  assert.deepEqual(secondUpdates, [[sensor('switch', 'on', 2)]]);
  assert.deepEqual(await firstState.readSensors(), [sensor('state', 'cooling')]);
});

test('partial snapshots retain previously known sensor fields', async () => {
  const state = new DweloDeviceState(1, reader());
  state.updateSensors([sensor('temperature', '72'), sensor('state', 'idle')]);
  state.updateSensors([sensor('state', 'cooling')]);

  assert.deepEqual(await state.readSensors(), [sensor('temperature', '72'), sensor('state', 'cooling')]);
});

test('resolves push update configuration with backwards-compatible lock poll alias', () => {
  assert.equal(resolveStatePollMs({ statePollMs: 30000, lockPollMs: 60000 }), 30000);
  assert.equal(resolveStatePollMs({ lockPollMs: 45000 }), 45000);
  assert.equal(resolveStatePollMs({}), 60000);
  assert.equal(resolveStatePollMs({ statePollMs: 1000 }), 10000);
  assert.equal(shouldEnablePushUpdates({}), true);
  assert.equal(shouldEnablePushUpdates({ enablePushUpdates: false }), false);
});

test('resolves push device type and on-get strategy configuration', () => {
  assert.deepEqual(resolvePushDeviceTypes({}), ['lock', 'switch', 'thermostat']);
  assert.deepEqual(resolvePushDeviceTypes({ pushDeviceTypes: ['thermostat', 'unsupported'] }), ['thermostat']);
  assert.equal(shouldPollDeviceType({}, 'lock'), true);
  assert.equal(shouldPollDeviceType({ enablePushUpdates: false }, 'lock'), false);
  assert.equal(shouldPollDeviceType({ pushDeviceTypes: ['thermostat'] }, 'lock'), false);
  assert.equal(shouldPollDeviceType({ pushDeviceTypes: [] }, 'thermostat'), false);

  assert.equal(resolveOnGetStrategy({}), 'cached-first');
  assert.equal(resolveOnGetStrategy({ onGetStrategy: 'always-live' }), 'always-live');
  assert.equal(resolveOnGetStrategy({ onGetStrategy: 'cache-only' }), 'cache-only');
  assert.equal(resolveOnGetStrategy({ onGetStrategy: 'invalid' }), 'cached-first');
});
