import 'dotenv/config';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OWNER_ID'];
for (const key of required) {
  if (!process.env[key]) console.warn(`[CONFIG] Falta ${key}.`);
}

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    ownerId: process.env.OWNER_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET
  },
  dashboard: {
    port: Number(process.env.DASHBOARD_PORT || 3000),
    baseUrl: process.env.DASHBOARD_BASE_URL || 'http://localhost:3000',
    sessionSecret: process.env.SESSION_SECRET || 'change-me'
  },
  lavalink: {
    host: process.env.LAVALINK_HOST || '127.0.0.1',
    port: Number(process.env.LAVALINK_PORT || 2333),
    password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: process.env.LAVALINK_SECURE === 'true'
  }
};
