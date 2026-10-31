import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

export function maximumBitrate(guild) {
  const features = guild.features || [];
  if (features.includes('VIP_REGIONS')) return 384000;
  const featureRates = features.map(feature => /^AUDIO_BITRATE_(\d+)_KBPS$/.exec(feature))
    .filter(Boolean).map(match => Number(match[1]) * 1000);
  if (featureRates.length) return Math.min(384000, Math.max(...featureRates));
  return Math.min(384000, guild.maximumBitrate || [96000, 128000, 256000, 384000][guild.premiumTier] || 96000);
}

export async function qualityRequest(method, data) {
  const scheme = config.lavalink.secure ? 'https' : 'http';
  const response = await fetch(`${scheme}://${config.lavalink.host}:${config.lavalink.port}/v4/tilin/audio`, {
    method,
    headers: { Authorization: config.lavalink.password, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw Error('No pude configurar la calidad del audio. Revisa que el motor de música esté actualizado.');
  return response.json();
}

export class AudioQuality {
  constructor(request = qualityRequest) { this.request = request; }
  async synchronize(channel) {
    const maximum = maximumBitrate(channel.guild);
    let bitrate = Math.min(channel.bitrate || 64000, maximum);
    const me = channel.guild.members.me;
    const canManage = me && channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels);
    if (canManage && bitrate !== maximum) {
      const updated = await channel.setBitrate(maximum, 'DJ Tilin: máxima calidad de música disponible');
      bitrate = Math.min(updated.bitrate, maximum);
    }
    const encoder = await this.request('PUT', { bitrate });
    if (encoder.bitrate !== bitrate) throw Error('El motor no confirmó el bitrate solicitado.');
    return { maximum, bitrate, sampleRate: encoder.sampleRate, channels: encoder.channels, canManage: Boolean(canManage) };
  }
}
