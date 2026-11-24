import type { Event } from '@app/base/common/event'
import type { IChannel, IServerChannel } from '@app/base/parts/ipc/common/ipc'
import { ProxyChannel } from '@app/base/parts/ipc/common/proxyChannel'
import { z } from 'zod'
import type {
  IRadioService,
  RadioAudioChunk,
  RadioDirectorySnapshot,
  RadioLogEntry,
  RadioRepeaterTalkgroup,
  RadioStateSnapshot,
} from './radio'

export const RADIO_CHANNEL_NAME = 'radio'

const talkgroupListSchema = z
  .array(z.number().int().min(1).max(9_999_999))
  .min(1)
  .max(64)
  .refine((talkgroups) => new Set(talkgroups).size === talkgroups.length, {
    message: 'Talkgroups must be unique.',
  })

export function parseRadioTalkgroups(input: unknown): number[] {
  return talkgroupListSchema.parse(input)
}

const radioDeviceIdSchema = z.string().regex(/^\d{3,}$/)

export function parseRadioDeviceId(input: unknown): string {
  return radioDeviceIdSchema.parse(input)
}

type RadioChannelTarget = Omit<
  IRadioService,
  '_serviceBrand' | 'onDidChangeState' | 'onDidReceiveAudio' | 'onDidReceiveLog'
> & {
  readonly onDidChangeState: Event<RadioStateSnapshot>
  readonly onDidReceiveAudio: Event<RadioAudioChunk>
  readonly onDidReceiveLog: Event<RadioLogEntry>
}

export function createRadioChannel(service: IRadioService): IServerChannel<number> {
  const target: RadioChannelTarget = {
    onDidChangeState: service.onDidChangeState,
    onDidReceiveAudio: service.onDidReceiveAudio,
    onDidReceiveLog: service.onDidReceiveLog,
    getSnapshot: () => service.getSnapshot(),
    getDirectory: () => service.getDirectory(),
    getRepeaterTalkgroups: (deviceId) => service.getRepeaterTalkgroups(deviceId),
    connect: (talkgroups) => service.connect(talkgroups),
    disconnect: () => service.disconnect(),
  }

  return ProxyChannel.fromService(target, {
    validators: {
      connect: (arg: unknown) => [parseRadioTalkgroups(arg)],
      getRepeaterTalkgroups: (arg: unknown) => [parseRadioDeviceId(arg)],
    },
  })
}

export class RadioChannelClient implements IRadioService {
  declare readonly _serviceBrand: undefined

  constructor(private readonly channel: IChannel) {}

  get onDidChangeState(): Event<RadioStateSnapshot> {
    return this.channel.listen<RadioStateSnapshot>('onDidChangeState')
  }

  get onDidReceiveAudio(): Event<RadioAudioChunk> {
    return this.channel.listen<RadioAudioChunk>('onDidReceiveAudio')
  }

  get onDidReceiveLog(): Event<RadioLogEntry> {
    return this.channel.listen<RadioLogEntry>('onDidReceiveLog')
  }

  getSnapshot(): Promise<RadioStateSnapshot> {
    return this.channel.call<RadioStateSnapshot>('getSnapshot')
  }

  getDirectory(): Promise<RadioDirectorySnapshot> {
    return this.channel.call<RadioDirectorySnapshot>('getDirectory')
  }

  getRepeaterTalkgroups(deviceId: string): Promise<readonly RadioRepeaterTalkgroup[]> {
    return this.channel.call<readonly RadioRepeaterTalkgroup[]>('getRepeaterTalkgroups', deviceId)
  }

  connect(talkgroups: readonly number[]): Promise<RadioStateSnapshot> {
    return this.channel.call<RadioStateSnapshot>('connect', [...talkgroups])
  }

  disconnect(): Promise<RadioStateSnapshot> {
    return this.channel.call<RadioStateSnapshot>('disconnect')
  }
}
