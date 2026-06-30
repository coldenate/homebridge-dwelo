import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSensorMap,
  clampThermostatSetpointF,
  cToF,
  fToC,
  hasNumericSensorValue,
  relativeHumidityFromSensorValue,
  thermostatAutoSetpointsF,
  sensorValue,
} from '../dist/DweloThermostatAccessory.js';

test('converts thermostat temperatures between Fahrenheit and HomeKit Celsius', () => {
  assert.equal(fToC(68), 20);
  assert.equal(cToF(20), 68);
});

test('reads thermostat sensor values using metadata and legacy sensor names', () => {
  const sensors = buildSensorMap([
    { deviceId: 1, gatewayId: 1, sensorType: 'Temperature', timeIssued: '', uid: 1, value: '72' },
    { deviceId: 1, gatewayId: 1, sensorType: 'humidity', timeIssued: '', uid: 2, value: '44' },
  ]);

  assert.equal(sensorValue(sensors, ['temperature', 'Temperature']), '72');
  assert.equal(sensorValue(sensors, ['Humidity', 'humidity']), '44');
});

test('only exposes thermostat humidity when Dwelo reports a numeric humidity sensor', () => {
  assert.equal(hasNumericSensorValue(new Map(), ['Humidity', 'humidity']), false);
  assert.equal(hasNumericSensorValue(new Map([['humidity', '']]), ['Humidity', 'humidity']), false);
  assert.equal(hasNumericSensorValue(new Map([['humidity', 'unknown']]), ['Humidity', 'humidity']), false);
  assert.equal(hasNumericSensorValue(new Map([['humidity', '0']]), ['Humidity', 'humidity']), true);
  assert.equal(hasNumericSensorValue(new Map([['humidity', '44']]), ['Humidity', 'humidity']), true);
});

test('does not convert missing thermostat humidity into zero percent', () => {
  assert.equal(relativeHumidityFromSensorValue(undefined), undefined);
  assert.equal(relativeHumidityFromSensorValue('unknown'), undefined);
  assert.equal(relativeHumidityFromSensorValue('0'), 0);
  assert.equal(relativeHumidityFromSensorValue('44.6'), 45);
  assert.equal(relativeHumidityFromSensorValue('130'), 100);
});

test('clamps outgoing setpoints to thermostat metadata limits', () => {
  const metadata = {
    heat_setpoint_low: 35,
    heat_setpoint_high: 95,
    cool_setpoint_low: 50,
    cool_setpoint_high: 95,
  };

  assert.equal(clampThermostatSetpointF('heat', 20, metadata), 35);
  assert.equal(clampThermostatSetpointF('heat', 100, metadata), 95);
  assert.equal(clampThermostatSetpointF('cool', 45, metadata), 50);
  assert.equal(clampThermostatSetpointF('cool', 100, metadata), 95);
});

test('keeps auto setpoints inside limits while preserving the minimum differential', () => {
  const metadata = {
    heat_setpoint_low: 35,
    heat_setpoint_high: 95,
    cool_setpoint_low: 50,
    cool_setpoint_high: 95,
    min_setpoint_differential: 5,
  };

  assert.deepEqual(thermostatAutoSetpointsF(94, metadata), {
    heatSetpointF: 90,
    coolSetpointF: 95,
  });
});
