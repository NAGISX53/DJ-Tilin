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
  command('buscar', 'Busca varias versiones y elige cuál añadir a la cola.', data => data
    .addStringOption(o => o.setName('consulta').setDescription('Nombre de la canción y artista').setRequired(true).setMaxLength(450))
    .addStringOption(o => o.setName('version').setDescription('Tipo de versión que quieres encontrar').addChoices(
      {name:'Todas',value:'all'},{name:'Estudio / oficial',value:'original'},{name:'Remix',value:'remix'},
      {name:'En directo',value:'live'},{name:'Extendida',value:'extended'},{name:'Instrumental',value:'instrumental'}))),
  command('favoritos', 'Guarda y reproduce tus canciones favoritas.', data => data
    .addSubcommand(s=>s.setName('guardar').setDescription('Guarda la canción actual.').addStringOption(o=>o.setName('nombre').setDescription('Nombre opcional para reconocerla').setMaxLength(80)).addBooleanOption(o=>o.setName('reemplazar').setDescription('Permitir reemplazar un nombre que ya existe')))
    .addSubcommand(s=>s.setName('lista').setDescription('Muestra tus favoritos.').addIntegerOption(o=>o.setName('pagina').setDescription('Página').setMinValue(1).setMaxValue(10)))
    .addSubcommand(s=>s.setName('reproducir').setDescription('Añade un favorito a la cola.').addStringOption(o=>o.setName('nombre').setDescription('Tu favorito').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s=>s.setName('quitar').setDescription('Elimina uno de tus favoritos.').addStringOption(o=>o.setName('nombre').setDescription('Tu favorito').setRequired(true).setAutocomplete(true)))),
  command('playlist', 'Guarda y recupera tus propias listas de canciones.', data => data
    .addSubcommand(s=>s.setName('guardar').setDescription('Guarda canción actual y cola pendiente.').addStringOption(o=>o.setName('nombre').setDescription('Nombre de tu playlist').setRequired(true).setMaxLength(80)).addBooleanOption(o=>o.setName('reemplazar').setDescription('Permitir reemplazar una lista existente')))
    .addSubcommand(s=>s.setName('lista').setDescription('Muestra tus playlists guardadas.').addIntegerOption(o=>o.setName('pagina').setDescription('Página').setMinValue(1).setMaxValue(10)))
    .addSubcommand(s=>s.setName('ver').setDescription('Consulta las canciones de una playlist.').addStringOption(o=>o.setName('nombre').setDescription('Tu playlist').setRequired(true).setAutocomplete(true)).addIntegerOption(o=>o.setName('pagina').setDescription('Página').setMinValue(1).setMaxValue(21)))
    .addSubcommand(s=>s.setName('reproducir').setDescription('Añade una playlist a la cola.').addStringOption(o=>o.setName('nombre').setDescription('Tu playlist').setRequired(true).setAutocomplete(true)).addBooleanOption(o=>o.setName('aleatorio').setDescription('Aleatorio compatible con Smart Mix y DJ')))
    .addSubcommand(s=>s.setName('borrar').setDescription('Borra una de tus playlists guardadas.').addStringOption(o=>o.setName('nombre').setDescription('Tu playlist').setRequired(true).setAutocomplete(true)))),
  command('dj', 'Configura quién controla la música y los votos para saltar.', data => data
    .addSubcommand(s=>s.setName('estado').setDescription('Consulta el rol DJ y la votación de este servidor.'))
    .addSubcommand(s=>s.setName('configurar').setDescription('Solo Administrar servidor: configura el rol DJ.').addRoleOption(o=>o.setName('rol').setDescription('Rol que podrá controlar la reproducción').setRequired(true)).addBooleanOption(o=>o.setName('votacion').setDescription('Permitir que los demás oyentes voten para saltar (predeterminado: sí)')))
    .addSubcommand(s=>s.setName('desactivar').setDescription('Solo Administrar servidor: devuelve los controles a todos.'))),
  command('pausa', 'Pausa la música.'),
  command('continuar', 'Continúa la reproducción.'),
  command('saltar', 'Salta o vota para pasar a la siguiente canción.'),
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
