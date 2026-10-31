import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';
import { validateConfig } from './validate-config.js';

validateConfig(config);

const rest = new REST({ version: '10' }).setToken(config.discord.token);
await rest.put(
  Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
  { body: commands.map(c => c.data.toJSON()) }
);
console.log(`Registrados ${commands.length} comandos en ${config.discord.guildId}.`);
