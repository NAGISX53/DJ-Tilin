import { Client, GatewayIntentBits, Collection, Events, ActivityType } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';
import { createMusic } from './music/index.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const commandMap = new Collection(commands.map(c => [c.data.name, c]));
client.music = createMusic(client);
client.once(Events.ClientReady, c => {
  console.log('[DJ Tilin] Conectado como ' + c.user.tag);
  if (!c.guilds.cache.has(config.discord.guildId)) console.error('[DJ Tilin] No encuentro el servidor configurado.');
  c.user.setActivity('/play · Música y AutoMix', { type: ActivityType.Listening });
});
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.guildId !== config.discord.guildId) return;
    if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
    } else if (interaction.isButton() && interaction.customId.startsWith('music:')) {
      await client.music.handleButton(interaction);
    }
  } catch (error) {
    console.error('[INTERACCIÓN]', error.code || error.name, error.message);
    if (interaction.isRepliable() && !interaction.replied) {
      if (interaction.deferred) await interaction.editReply({content:'❌ Ocurrió un error al controlar la música.'}).catch(()=>{});
      else await interaction.reply({content:'❌ Ocurrió un error.',ephemeral:true}).catch(()=>{});
    }
  }
});
client.on(Events.Error, error => console.error('[DISCORD]', error.message));
await client.login(config.discord.token);
const { setDiscordStatusProvider, setMusicStatusProvider, setMusicControl } = await import('./web/server.js');
setDiscordStatusProvider(() => client.isReady() && client.guilds.cache.has(config.discord.guildId));
setMusicStatusProvider(client.music.isReady);
setMusicControl(client.music);

