import { Logging } from 'homebridge';

import { DweloAPI, Sensor } from './DweloAPI.js';

const DEFAULT_STATE_POLL_MS = 60000;
const MIN_STATE_POLL_MS = 10000;
const DEFAULT_PUSH_DEVICE_TYPES = ['lock', 'switch', 'thermostat'] as const;
const ON_GET_STRATEGIES = ['cached-first', 'always-live', 'cache-only'] as const;

export type DweloDeviceType = typeof DEFAULT_PUSH_DEVICE_TYPES[number];
export type OnGetStrategy = typeof ON_GET_STRATEGIES[number];

interface PollConfig {
  [key: string]: unknown;
  enablePushUpdates?: unknown;
  lockPollMs?: unknown;
  onGetStrategy?: unknown;
  pushDeviceTypes?: unknown;
  statePollMs?: unknown;
}

type SensorListener = (sensors: Sensor[]) => void;

export function shouldEnablePushUpdates(config: PollConfig): boolean {
  return config.enablePushUpdates !== false;
}

export function resolveStatePollMs(config: PollConfig): number {
  const configuredPollMs = typeof config.statePollMs === 'number'
    ? config.statePollMs
    : config.lockPollMs;
  const pollMs = typeof configuredPollMs === 'number' && Number.isFinite(configuredPollMs)
    ? configuredPollMs
    : DEFAULT_STATE_POLL_MS;
  return Math.max(pollMs, MIN_STATE_POLL_MS);
}

export function resolvePushDeviceTypes(config: PollConfig): DweloDeviceType[] {
  if (!Array.isArray(config.pushDeviceTypes)) {
    return [...DEFAULT_PUSH_DEVICE_TYPES];
  }
  return config.pushDeviceTypes.filter((deviceType): deviceType is DweloDeviceType =>
    typeof deviceType === 'string' && DEFAULT_PUSH_DEVICE_TYPES.includes(deviceType as DweloDeviceType),
  );
}

export function resolveOnGetStrategy(config: PollConfig): OnGetStrategy {
  return typeof config.onGetStrategy === 'string' && ON_GET_STRATEGIES.includes(config.onGetStrategy as OnGetStrategy)
    ? config.onGetStrategy as OnGetStrategy
    : 'cached-first';
}

export function shouldPollDeviceType(config: PollConfig, deviceType: DweloDeviceType): boolean {
  return shouldEnablePushUpdates(config) && resolvePushDeviceTypes(config).includes(deviceType);
}

export class DweloDeviceState {
  private sensors?: Sensor[];
  private updatedAt = 0;
  private pendingRead?: Promise<Sensor[]>;
  private readonly listeners = new Set<SensorListener>();

  constructor(
    private readonly deviceId: number,
    private readonly sensorReader: Pick<DweloAPI, 'sensors'>,
    private readonly cacheTtlMs = Infinity,
    private readonly onGetStrategy: OnGetStrategy = 'cached-first',
  ) { }

  onUpdate(listener: SensorListener): void {
    this.listeners.add(listener);
  }

  updateSensors(sensors: Sensor[]): void {
    const merged = new Map(this.sensors?.map(sensor => [sensor.sensorType.toLowerCase(), sensor]));
    for (const sensor of sensors) {
      merged.set(sensor.sensorType.toLowerCase(), sensor);
    }
    this.sensors = [...merged.values()];
    this.updatedAt = Date.now();
    for (const listener of this.listeners) {
      listener(this.sensors);
    }
  }

  async readSensors(): Promise<Sensor[]> {
    if (this.onGetStrategy === 'cache-only') {
      if (this.sensors) {
        return this.sensors;
      }
      throw new Error(`No cached Dwelo state for device ${this.deviceId}`);
    }

    if (this.onGetStrategy === 'cached-first' && this.sensors && Date.now() - this.updatedAt <= this.cacheTtlMs) {
      return this.sensors;
    }

    this.pendingRead ??= this.sensorReader.sensors(this.deviceId)
      .then(sensors => {
        this.updateSensors(sensors);
        return this.sensors!;
      })
      .catch(error => {
        if (this.sensors) {
          return this.sensors;
        }
        throw error;
      })
      .finally(() => {
        this.pendingRead = undefined;
      });
    return this.pendingRead;
  }

}

export class DweloStatePoller {
  private readonly deviceStates = new Map<number, DweloDeviceState>();
  private readonly polledDeviceIds = new Set<number>();
  constructor(
    private readonly dweloAPI: DweloAPI,
    private readonly log: Logging,
    private readonly pollMs: number,
    private readonly onGetStrategy: OnGetStrategy,
  ) { }

  deviceState(deviceId: number, shouldPoll = true): DweloDeviceState {
    const cached = this.deviceStates.get(deviceId);
    if (cached) {
      if (shouldPoll) {
        this.polledDeviceIds.add(deviceId);
      }
      return cached;
    }

    const state = new DweloDeviceState(deviceId, this.dweloAPI, this.pollMs * 2, this.onGetStrategy);
    this.deviceStates.set(deviceId, state);
    if (shouldPoll) {
      this.polledDeviceIds.add(deviceId);
    }
    return state;
  }

  start(): void {
    if (this.polledDeviceIds.size === 0) {
      return;
    }

    void this.pollOnce();
    setInterval(() => {
      void this.pollOnce();
    }, this.pollMs);
  }

  async pollOnce(): Promise<void> {
    try {
      const sensorsByDevice = new Map<number, Sensor[]>();
      for (const sensor of await this.dweloAPI.sensors()) {
        if (!this.polledDeviceIds.has(sensor.deviceId)) {
          continue;
        }
        const sensors = sensorsByDevice.get(sensor.deviceId) ?? [];
        sensors.push(sensor);
        sensorsByDevice.set(sensor.deviceId, sensors);
      }
      for (const [deviceId, sensors] of sensorsByDevice) {
        this.deviceStates.get(deviceId)?.updateSensors(sensors);
      }
    } catch (error) {
      this.log.warn(`Failed to poll Dwelo gateway sensors: ${this.errorMessage(error)}`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
