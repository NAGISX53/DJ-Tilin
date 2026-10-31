import { Client, GatewayIntentBits, Collection, Events, ActivityType } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';
import { createMusic } from './music/index.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const commandMap = new Collection(commands.map(c => [c.data.name, c]));
client.music = createMusic(client);
client.once(Events.ClientReady, c => {
  console.log('[DJ Tilin] Conectado como ' + c.user.tag);
  console.log('[DJ Tilin] Disponible en ' + c.guilds.cache.size + ' servidor(es).');
  c.user.setActivity('/play · Música y AutoMix', { type: ActivityType.Listening });
});
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!interaction.inGuild()) return;
    if (interaction.isAutocomplete()) {
      await client.music.handleAutocomplete(interaction);
    } else if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
    } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('music:')) {
      await client.music.handleSelect(interaction);
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
const { setDiscordStatusProvider, setMusicStatusProvider, setMusicControl, setShutdownHandler } = await import('./web/server.js');
setDiscordStatusProvider(() => client.isReady());
setMusicStatusProvider(client.music.isReady);
setMusicControl(client.music);


let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  client.music.checkpoint();
  const deadline = setTimeout(() => process.exit(1), 8000).unref();
  try { await client.music.close({ preserve: true }); client.destroy(); }
  catch (error) { console.error('[CIERRE]', error.message); }
  finally { clearTimeout(deadline); process.exit(0); }
}
setShutdownHandler(shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
