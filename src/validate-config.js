export function validateConfig(config) {
  const missing = [];
  if (!config.discord.token || /PEGA_AQUI|TOKEN_DEL_BOT/.test(config.discord.token)) missing.push('DISCORD_TOKEN');
  for (const [field, name] of [['clientId','DISCORD_CLIENT_ID'],['ownerId','OWNER_ID']]) {
    if (!/^\d{17,20}$/.test(config.discord[field] || '')) missing.push(name);
  }
  if (config.discord.guildId && !/^\d{17,20}$/.test(config.discord.guildId)) missing.push('DISCORD_GUILD_ID (opcional; debe ser un ID válido)');
  if (missing.length) throw new Error(`Completa .env con: ${missing.join(', ')}. No compartas el token en el chat.`);
  if (!Number.isInteger(config.dashboard.port) || config.dashboard.port < 1 || config.dashboard.port > 65535) throw new Error('DASHBOARD_PORT debe estar entre 1 y 65535.');
}
