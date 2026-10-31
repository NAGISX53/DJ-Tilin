import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } from 'discord.js';

function command(name, description, options) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild).setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  options?.(data);
  return { data, execute: interaction => interaction.client.music.run(interaction, name) };
}

export const musicCommands = [
  command('play', 'Reproduce una canción, artista o enlace de YouTube / Spotify.', data => data.addStringOption(o =>
    o.setName('busqueda').setDescription('Canción, artista, enlace de video, álbum o playlist pública').setRequired(true).setMaxLength(500))
    .addBooleanOption(o => o.setName('aleatorio').setDescription('Mezcla la playlist; Smart Mix y DJ eligen la siguiente por compatibilidad'))),
  command('pausa', 'Pausa la música.'),
  command('continuar', 'Continúa la reproducción.'),
  command('saltar', 'Salta a la siguiente canción.'),
  command('detener', 'Detiene la música, vacía la cola y sale del canal.'),
  command('reproductor', 'Muestra o mueve el reproductor fijo a este canal.'),
  command('actual', 'Muestra la canción actual y el progreso.'),
  command('calidad', 'Muestra el bitrate disponible y la calidad de audio del bot.'),
  command('automix', 'Configura transiciones, mezcla inteligente y DJ automático.', data => data
    .addStringOption(o => o.setName('modo').setDescription('Modo de reproducción').addChoices(
      { name: 'Normal, sin solapar canciones', value: 'normal' }, { name: 'Crossfade', value: 'crossfade' },
      { name: 'Smart Mix', value: 'smart' }, { name: 'DJ automático', value: 'dj' }))
    .addIntegerOption(o => o.setName('duracion').setDescription('Fundido de 3 a 15 segundos').setMinValue(3).setMaxValue(15))
    .addBooleanOption(o => o.setName('sincronizar').setDescription('Alinear ritmos cuando el análisis sea fiable'))
    .addBooleanOption(o => o.setName('normalizar').setDescription('Equilibrar el volumen entre canciones'))),
  command('ecualizador', 'Consulta o cambia el ecualizador de uso general.', data => data.addStringOption(o =>
    o.setName('modo').setDescription('Equilibrado suave u original sin ecualizar').addChoices(
      { name: 'Equilibrado suave (todos los géneros)', value: 'equilibrado' },
      { name: 'Original (sin ecualizar)', value: 'original' }
    ))),
  command('cola', 'Muestra las canciones pendientes.', data => data.addIntegerOption(o =>
    o.setName('pagina').setDescription('Página de la cola').setMinValue(1).setMaxValue(20))),
  command('volumen', 'Ajusta el volumen entre 0 y 100%.', data => data.addIntegerOption(o =>
    o.setName('nivel').setDescription('Volumen de 0 a 100').setRequired(true).setMinValue(0).setMaxValue(100))),
  command('repetir', 'Repite una canción o toda la cola.', data => data.addStringOption(o =>
    o.setName('modo').setDescription('Modo de repetición').setRequired(true).addChoices(
      { name: 'Desactivada', value: 'off' }, { name: 'Canción actual', value: 'track' }, { name: 'Toda la cola', value: 'queue' }))),
  command('mezclar', 'Mezcla las canciones pendientes.'),
  command('quitar', 'Quita una canción pendiente por su posición.', data => data.addIntegerOption(o =>
    o.setName('posicion').setDescription('Número que aparece en /cola').setRequired(true).setMinValue(1).setMaxValue(200)))
];
