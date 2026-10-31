import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';
import { validateConfig } from './validate-config.js';
validateConfig(config);
const rest = new REST({ version: '10' }).setToken(config.discord.token);
await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands.map(c => c.data.toJSON()) });
// Mirror the same definitions in the home/test guild for immediate availability.
// Other servers keep using the global commands. These fields are global-only.
if (config.discord.guildId) {
  const guildCommands=commands.map(c=>{ const {contexts,integration_types,dm_permission,...data}=c.data.toJSON();return data; });
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId,config.discord.guildId),{body:guildCommands});
  console.log('Sincronizados ' + guildCommands.length + ' comandos inmediatos en el servidor configurado.');
}
console.log('Registrados ' + commands.length + ' comandos globales para todos los servidores.');
