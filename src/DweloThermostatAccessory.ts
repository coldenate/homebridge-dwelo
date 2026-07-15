import {
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from 'homebridge';

import { DweloAPI, Sensor } from './DweloAPI.js';
import { DweloDeviceState } from './DweloStatePoller.js';

type ThermostatMode = 'off' | 'heat' | 'cool' | 'auto';
type ThermostatOperatingState = 'off' | 'heat' | 'cool';
type SetpointType = 'heat' | 'cool';

export interface DweloThermostatOptions {
  displayUnits: 'celsius' | 'fahrenheit';
  exposeHumidity: boolean;
  exposeBattery: boolean;
  logSensorInventory: boolean;
}

interface ThermostatMetadata {
  heat_setpoint_low?: number;
  heat_setpoint_high?: number;
  cool_setpoint_low?: number;
  cool_setpoint_high?: number;
  min_setpoint_differential?: number;
}

interface SetpointLimits {
  low: number;
  high: number;
}

interface SetpointProps {
  minValue: number;
  maxValue: number;
  minStep: number;
}

export const SENSOR_ALIASES = {
  temperature: ['Temperature', 'temperature'],
  mode: ['ThermostatMode', 'mode'],
  operatingState: ['ThermostatOperatingState', 'state'],
  heatSetpoint: ['ThermostatHeatSetPoint', 'setToHeat'],
  coolSetpoint: ['ThermostatCoolSetPoint', 'setToCool'],
  humidity: ['Humidity', 'humidity'],
  battery: ['BatteryLevel', 'battery'],
};

function numberFromMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, '').toLowerCase() ?? '';
}

function sanitizeSensorValue(value: string): string {
  return value.length > 48 ? `${value.slice(0, 48)}...` : value;
}

function toThermostatMetadata(deviceMetadata: Record<string, unknown>): ThermostatMetadata {
  return {
    heat_setpoint_low: numberFromMetadata(deviceMetadata.heat_setpoint_low),
    heat_setpoint_high: numberFromMetadata(deviceMetadata.heat_setpoint_high),
    cool_setpoint_low: numberFromMetadata(deviceMetadata.cool_setpoint_low),
    cool_setpoint_high: numberFromMetadata(deviceMetadata.cool_setpoint_high),
    min_setpoint_differential: numberFromMetadata(deviceMetadata.min_setpoint_differential),
  };
}

function setpointLimits(setpointType: SetpointType, metadata: ThermostatMetadata): SetpointLimits {
  const defaultLow = setpointType === 'heat' ? 35 : 50;
  const defaultHigh = 95;
  return {
    low: numberFromMetadata(metadata[`${setpointType}_setpoint_low`]) ?? defaultLow,
    high: numberFromMetadata(metadata[`${setpointType}_setpoint_high`]) ?? defaultHigh,
  };
}

export function fToC(temperatureF: number): number {
  return (temperatureF - 32) * 5 / 9;
}

export function cToF(temperatureC: number): number {
  return Math.round(temperatureC * 9 / 5 + 32);
}

export function buildSensorMap(sensors: Sensor[]): Map<string, string> {
  return sensors.reduce((map, sensor) => {
    map.set(sensor.sensorType.toLowerCase(), sensor.value);
    return map;
  }, new Map<string, string>());
}

export function sensorValue(sensors: Map<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const value = sensors.get(alias.toLowerCase());
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function clampThermostatSetpointF(
  setpointType: SetpointType,
  temperatureF: number,
  metadata: ThermostatMetadata,
): number {
  const { low, high } = setpointLimits(setpointType, metadata);
  return Math.min(Math.max(temperatureF, low), high);
}

export function thermostatAutoSetpointsF(
  requestedHeatSetpointF: number,
  metadata: ThermostatMetadata,
): { heatSetpointF: number; coolSetpointF: number } {
  const heatLimits = setpointLimits('heat', metadata);
  const coolLimits = setpointLimits('cool', metadata);
  const differential = Math.max(numberFromMetadata(metadata.min_setpoint_differential) ?? 5, 5);
  let heatSetpointF = clampThermostatSetpointF('heat', requestedHeatSetpointF, metadata);
  let coolSetpointF = clampThermostatSetpointF('cool', heatSetpointF + differential, metadata);

  if (coolSetpointF - heatSetpointF < differential) {
    heatSetpointF = Math.min(heatSetpointF, coolSetpointF - differential);
    heatSetpointF = Math.min(Math.max(heatSetpointF, heatLimits.low), heatLimits.high);
  }

  if (coolSetpointF - heatSetpointF < differential) {
    coolSetpointF = Math.max(coolSetpointF, heatSetpointF + differential);
    coolSetpointF = Math.min(Math.max(coolSetpointF, coolLimits.low), coolLimits.high);
  }

  return { heatSetpointF, coolSetpointF };
}

function setpointPropsC(setpointType: SetpointType, metadata: ThermostatMetadata): SetpointProps {
  const { low, high } = setpointLimits(setpointType, metadata);
  return {
    minValue: fToC(low),
    maxValue: fToC(high),
    minStep: 0.1,
  };
}

function thermostatTargetPropsC(metadata: ThermostatMetadata): SetpointProps {
  const heatLimits = setpointLimits('heat', metadata);
  const coolLimits = setpointLimits('cool', metadata);
  return {
    minValue: fToC(Math.min(heatLimits.low, coolLimits.low)),
    maxValue: fToC(Math.max(heatLimits.high, coolLimits.high)),
    minStep: 0.1,
  };
}

function clampTemperatureC(temperatureC: number, props: SetpointProps): number {
  return Math.min(Math.max(temperatureC, props.minValue), props.maxValue);
}

function clampPercentage(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

export function hasNumericSensorValue(sensors: Map<string, string>, aliases: string[]): boolean {
  return parseNumber(sensorValue(sensors, aliases)) !== undefined;
}

export function relativeHumidityFromSensorValue(value: string | undefined): number | undefined {
  const humidity = parseNumber(value);
  return humidity === undefined ? undefined : clampPercentage(Math.round(humidity));
}

export function thermostatOperatingStateFromSensors(sensors: Map<string, string>): ThermostatOperatingState | undefined {
  const state = sensorValue(sensors, SENSOR_ALIASES.operatingState);
  if (state === undefined) {
    return undefined;
  }
  switch (normalizeText(state)) {
  case 'heat':
  case 'pendingheat':
  case 'heating':
    return 'heat';
  case 'cool':
  case 'pendingcool':
  case 'cooling':
    return 'cool';
  default:
    return 'off';
  }
}

export class DweloThermostatAccessory implements AccessoryPlugin {
  private readonly thermostatService: Service;
  private readonly humidityService?: Service;
  private readonly batteryService?: Service;
  private readonly metadata: ThermostatMetadata;
  private readonly targetTemperatureProps: SetpointProps;
  private readonly heatSetpointProps: SetpointProps;
  private readonly coolSetpointProps: SetpointProps;

  constructor(
    private readonly log: Logging,
    private readonly api: API,
    private readonly dweloAPI: DweloAPI,
    private readonly sensorState: DweloDeviceState,
    public readonly name: string,
    private readonly thermostatID: number,
    deviceMetadata: Record<string, unknown>,
    private readonly options: DweloThermostatOptions,
  ) {
    this.metadata = toThermostatMetadata(deviceMetadata);
    this.targetTemperatureProps = thermostatTargetPropsC(this.metadata);
    this.heatSetpointProps = setpointPropsC('heat', this.metadata);
    this.coolSetpointProps = setpointPropsC('cool', this.metadata);

    this.thermostatService = new api.hap.Service.Thermostat(name);
    this.thermostatService.getCharacteristic(api.hap.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));
    this.thermostatService.getCharacteristic(api.hap.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));
    this.thermostatService.getCharacteristic(api.hap.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));
    this.thermostatService.getCharacteristic(api.hap.Characteristic.TargetTemperature)
      .setProps(this.targetTemperatureProps)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));
    this.thermostatService.getCharacteristic(api.hap.Characteristic.HeatingThresholdTemperature)
      .setProps(this.heatSetpointProps)
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .onSet(this.setHeatingThresholdTemperature.bind(this));
    this.thermostatService.getCharacteristic(api.hap.Characteristic.CoolingThresholdTemperature)
      .setProps(this.coolSetpointProps)
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .onSet(this.setCoolingThresholdTemperature.bind(this));
    this.thermostatService.getCharacteristic(api.hap.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this))
      .onSet(this.setTemperatureDisplayUnits.bind(this));

    if (options.exposeHumidity) {
      this.humidityService = new api.hap.Service.HumiditySensor(`${name} Humidity`);
      this.humidityService.getCharacteristic(api.hap.Characteristic.CurrentRelativeHumidity)
        .onGet(this.getCurrentRelativeHumidity.bind(this));
      this.thermostatService.getCharacteristic(api.hap.Characteristic.CurrentRelativeHumidity)
        .onGet(this.getCurrentRelativeHumidity.bind(this));
    }

    if (options.exposeBattery) {
      this.batteryService = new api.hap.Service.Battery(name);
      this.batteryService.getCharacteristic(api.hap.Characteristic.BatteryLevel)
        .onGet(this.getBatteryLevel.bind(this));
      this.batteryService.getCharacteristic(api.hap.Characteristic.StatusLowBattery)
        .onGet(this.getStatusLowBattery.bind(this));
    }

    this.sensorState.onUpdate(sensors => this.updateCharacteristics(buildSensorMap(sensors)));

    log.info(`Dwelo Thermostat '${name}' created!`);
  }

  identify(): void {
    this.log('Identify!');
  }

  getServices(): Service[] {
    return [
      this.thermostatService,
      this.humidityService,
      this.batteryService,
    ].filter((service): service is Service => !!service);
  }

  private async getCurrentHeatingCoolingState() {
    const sensors = await this.readSensors();
    return this.currentHeatingCoolingStateFromSensors(sensors)
      ?? this.api.hap.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private async getTargetHeatingCoolingState() {
    return this.modeToHomeKit(await this.readSensorValue(SENSOR_ALIASES.mode));
  }

  private async setTargetHeatingCoolingState(value: CharacteristicValue) {
    await this.dweloAPI.setThermostatMode(this.homeKitToMode(value), this.thermostatID);
  }

  private async getCurrentTemperature() {
    return this.temperatureCFromSensorMap(await this.readSensors(), SENSOR_ALIASES.temperature, fToC(70));
  }

  private async getTargetTemperature() {
    const sensors = await this.readSensors();
    const mode = sensorValue(sensors, SENSOR_ALIASES.mode);
    if (normalizeText(mode) === 'cool') {
      return this.temperatureCFromSensorMap(sensors, SENSOR_ALIASES.coolSetpoint, this.targetTemperatureProps.minValue, this.targetTemperatureProps);
    }
    return this.temperatureCFromSensorMap(sensors, SENSOR_ALIASES.heatSetpoint, this.targetTemperatureProps.minValue, this.targetTemperatureProps);
  }

  private async setTargetTemperature(value: CharacteristicValue) {
    const temperatureF = cToF(value as number);
    const mode = normalizeText(await this.readSensorValue(SENSOR_ALIASES.mode));

    if (mode === 'cool') {
      await this.setCoolSetpointF(temperatureF);
      return;
    }

    if (mode === 'auto') {
      await this.setAutoSetpointsF(temperatureF);
      return;
    }

    await this.setHeatSetpointF(temperatureF);
  }

  private async getHeatingThresholdTemperature() {
    return this.temperatureCFromSensorMap(
      await this.readSensors(),
      SENSOR_ALIASES.heatSetpoint,
      this.heatSetpointProps.minValue,
      this.heatSetpointProps,
    );
  }

  private async setHeatingThresholdTemperature(value: CharacteristicValue) {
    await this.setHeatSetpointF(cToF(value as number));
  }

  private async getCoolingThresholdTemperature() {
    return this.temperatureCFromSensorMap(
      await this.readSensors(),
      SENSOR_ALIASES.coolSetpoint,
      this.coolSetpointProps.minValue,
      this.coolSetpointProps,
    );
  }

  private async setCoolingThresholdTemperature(value: CharacteristicValue) {
    await this.setCoolSetpointF(cToF(value as number));
  }

  private getTemperatureDisplayUnits() {
    const units = this.api.hap.Characteristic.TemperatureDisplayUnits;
    return this.options.displayUnits === 'fahrenheit' ? units.FAHRENHEIT : units.CELSIUS;
  }

  private setTemperatureDisplayUnits(value: CharacteristicValue) {
    this.log.debug(`Ignoring HomeKit thermostat display unit update for ${this.name}: ${value}`);
  }

  private async getCurrentRelativeHumidity() {
    const humidity = relativeHumidityFromSensorValue(await this.readSensorValue(SENSOR_ALIASES.humidity));
    if (humidity === undefined) {
      this.log.debug(`Thermostat ${this.name} (${this.thermostatID}) did not report humidity`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return humidity;
  }

  private async getBatteryLevel() {
    const batteryLevel = parseNumber(await this.readSensorValue(SENSOR_ALIASES.battery)) ?? 0;
    return clampPercentage(Math.round(batteryLevel));
  }

  private async getStatusLowBattery() {
    const batteryLevel = await this.getBatteryLevel();
    const lowBattery = this.api.hap.Characteristic.StatusLowBattery;
    return batteryLevel > 20 ? lowBattery.BATTERY_LEVEL_NORMAL : lowBattery.BATTERY_LEVEL_LOW;
  }

  private async setHeatSetpointF(temperatureF: number) {
    const clampedTemperatureF = clampThermostatSetpointF('heat', temperatureF, this.metadata);
    await this.dweloAPI.setThermostatHeatSetpointF(clampedTemperatureF, this.thermostatID);
  }

  private async setCoolSetpointF(temperatureF: number) {
    const clampedTemperatureF = clampThermostatSetpointF('cool', temperatureF, this.metadata);
    await this.dweloAPI.setThermostatCoolSetpointF(clampedTemperatureF, this.thermostatID);
  }

  private async setAutoSetpointsF(heatSetpointF: number) {
    const setpoints = thermostatAutoSetpointsF(heatSetpointF, this.metadata);
    await this.dweloAPI.setThermostatHeatSetpointF(setpoints.heatSetpointF, this.thermostatID);
    await this.dweloAPI.setThermostatCoolSetpointF(setpoints.coolSetpointF, this.thermostatID);
  }

  private temperatureCFromSensorMap(sensors: Map<string, string>, aliases: string[], fallback: number, props?: SetpointProps) {
    const temperatureF = parseNumber(sensorValue(sensors, aliases));
    const temperatureC = temperatureF === undefined ? fallback : fToC(temperatureF);
    return props ? clampTemperatureC(temperatureC, props) : temperatureC;
  }

  private async readSensorValue(aliases: string[]) {
    const sensors = await this.readSensors();
    return sensorValue(sensors, aliases);
  }

  private async readSensors() {
    const sensors = await this.sensorState.readSensors();
    if (this.options.logSensorInventory) {
      this.log.debug(
        `Thermostat ${this.name} (${this.thermostatID}) sensors: ${
          sensors.map(sensor => `${sensor.sensorType}=${sanitizeSensorValue(sensor.value)}`).join(', ')
        }`,
      );
    }
    return buildSensorMap(sensors);
  }

  private updateCharacteristics(sensors: Map<string, string>) {
    const operatingState = this.currentHeatingCoolingStateFromSensors(sensors);
    if (operatingState !== undefined) {
      this.thermostatService.updateCharacteristic(this.api.hap.Characteristic.CurrentHeatingCoolingState, operatingState);
    }

    const mode = sensorValue(sensors, SENSOR_ALIASES.mode);
    if (mode !== undefined) {
      this.thermostatService.updateCharacteristic(
        this.api.hap.Characteristic.TargetHeatingCoolingState,
        this.modeToHomeKit(mode),
      );
    }

    this.updateTemperatureIfPresent(sensors, SENSOR_ALIASES.temperature, this.api.hap.Characteristic.CurrentTemperature);
    const targetAliases = normalizeText(mode) === 'cool' ? SENSOR_ALIASES.coolSetpoint : SENSOR_ALIASES.heatSetpoint;
    if (mode !== undefined && hasNumericSensorValue(sensors, targetAliases)) {
      this.thermostatService.updateCharacteristic(
        this.api.hap.Characteristic.TargetTemperature,
        this.targetTemperatureFromSensors(sensors),
      );
    }
    this.updateTemperatureIfPresent(
      sensors,
      SENSOR_ALIASES.heatSetpoint,
      this.api.hap.Characteristic.HeatingThresholdTemperature,
      this.heatSetpointProps,
    );
    this.updateTemperatureIfPresent(
      sensors,
      SENSOR_ALIASES.coolSetpoint,
      this.api.hap.Characteristic.CoolingThresholdTemperature,
      this.coolSetpointProps,
    );

    if (this.options.exposeHumidity) {
      const humidity = relativeHumidityFromSensorValue(sensorValue(sensors, SENSOR_ALIASES.humidity));
      if (humidity !== undefined) {
        this.thermostatService.updateCharacteristic(this.api.hap.Characteristic.CurrentRelativeHumidity, humidity);
        this.humidityService?.updateCharacteristic(this.api.hap.Characteristic.CurrentRelativeHumidity, humidity);
      }
    }

    if (this.options.exposeBattery) {
      const batteryLevel = parseNumber(sensorValue(sensors, SENSOR_ALIASES.battery));
      if (batteryLevel !== undefined) {
        const clampedBatteryLevel = clampPercentage(Math.round(batteryLevel));
        const lowBattery = this.api.hap.Characteristic.StatusLowBattery;
        this.batteryService?.updateCharacteristic(this.api.hap.Characteristic.BatteryLevel, clampedBatteryLevel);
        this.batteryService?.updateCharacteristic(
          this.api.hap.Characteristic.StatusLowBattery,
          clampedBatteryLevel > 20 ? lowBattery.BATTERY_LEVEL_NORMAL : lowBattery.BATTERY_LEVEL_LOW,
        );
      }
    }
  }

  private currentHeatingCoolingStateFromSensors(sensors: Map<string, string>) {
    const C = this.api.hap.Characteristic.CurrentHeatingCoolingState;
    switch (thermostatOperatingStateFromSensors(sensors)) {
    case 'heat':
      return C.HEAT;
    case 'cool':
      return C.COOL;
    case undefined:
      return undefined;
    default:
      return C.OFF;
    }
  }

  private updateTemperatureIfPresent(
    sensors: Map<string, string>,
    aliases: string[],
    characteristic: typeof this.api.hap.Characteristic.CurrentTemperature,
    props?: SetpointProps,
  ) {
    if (hasNumericSensorValue(sensors, aliases)) {
      this.thermostatService.updateCharacteristic(
        characteristic,
        this.temperatureCFromSensorMap(sensors, aliases, 0, props),
      );
    }
  }

  private targetTemperatureFromSensors(sensors: Map<string, string>) {
    if (normalizeText(sensorValue(sensors, SENSOR_ALIASES.mode)) === 'cool') {
      return this.temperatureCFromSensorMap(
        sensors,
        SENSOR_ALIASES.coolSetpoint,
        this.targetTemperatureProps.minValue,
        this.targetTemperatureProps,
      );
    }
    return this.temperatureCFromSensorMap(
      sensors,
      SENSOR_ALIASES.heatSetpoint,
      this.targetTemperatureProps.minValue,
      this.targetTemperatureProps,
    );
  }

  private modeToHomeKit(mode: string | undefined) {
    const T = this.api.hap.Characteristic.TargetHeatingCoolingState;
    switch (normalizeText(mode)) {
    case 'heat':
      return T.HEAT;
    case 'cool':
      return T.COOL;
    case 'auto':
      return T.AUTO;
    default:
      return T.OFF;
    }
  }

  private homeKitToMode(value: CharacteristicValue): ThermostatMode {
    const T = this.api.hap.Characteristic.TargetHeatingCoolingState;
    switch (value) {
    case T.HEAT:
      return 'heat';
    case T.COOL:
      return 'cool';
    case T.AUTO:
      return 'auto';
    default:
      return 'off';
    }
  }
}
