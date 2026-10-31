# DJ Tilin

Bot exclusivo de música para TILINES community. Conserva reproducción por canción/artista/YouTube/Spotify, cola, precarga, bitrate adaptable, ecualizador equilibrado y AutoMix.

## Instalación desde este repositorio (Windows x64)

1. Instala Node.js 24.17 o posterior y Git si quieres clonar el repositorio. La instalación actual se probó con Node.js 26.
2. Descarga o clona el código y abre una terminal en su carpeta.
3. Ejecuta npm ci para instalar las versiones fijadas en package-lock.json (incluye FFmpeg).
4. Copia .env.example como .env y completa DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID y OWNER_ID con los datos de tu bot. No compartas el token. Discord OAuth y las credenciales Spotify son opcionales.
5. Ejecuta PREPARAR-MUSICA.cmd. Requiere Internet: descarga Java 21, Lavalink, yt-dlp y las dependencias del plugin, y compila/prueba el codificador.
6. Invita tu aplicación de Discord con los alcances bot y applications.commands. Permisos musicales: Ver canales, Enviar mensajes, Insertar enlaces, Conectar y Hablar; Gestionar canales permite subir el bitrate del canal. No necesita Administrador ni los intents privilegiados de miembros o mensajes.
7. Ejecuta registrar-comandos.cmd y luego iniciar.cmd. Entra a un canal de voz y usa /play.
8. ABRIR-PANEL.cmd abre el panel local. DETENER.cmd detiene ambos servicios.

El ZIP y Git contienen el código y la configuración de ejemplo. No incluyen tu .env, bases de datos, canciones, cachés, node_modules, ejecutables descargados ni claves de sesión. No arranques otra copia simultánea con el mismo token: usa una sola instalación activa.

La carpeta del repositorio puede tener cualquier nombre; los accesos se resuelven desde su ubicación. La instalación ya activa sigue en Desktop/TILINbot. No se requiere reinstalarla para consultar este repositorio.

## Estructura

- src/music: reproducción, cola, descargas, análisis y mezclador.
- src/commands: los 14 comandos musicales.
- src/web: panel y acceso local/OAuth.
- lavalink/tilin-audio/src: código Java del plugin y su prueba nativa.
- scripts: instalación, compilación, arranque y verificaciones.
- test: pruebas automáticas de audio, playlists, selección inteligente y controles.

## Uso
Entra a voz y usa /play busqueda:Daft Punk Get Lucky.
Comandos: /play, /pausa, /continuar, /saltar, /detener, /actual, /calidad, /automix, /ecualizador, /cola, /volumen, /repetir, /mezclar y /quitar.

AutoMix ofrece normal, crossfade, smart y dj; fundidos de 3–15 segundos, sincronización de ritmos compatibles y normalización. Conserva el tono al ajustar el tempo. El análisis es heurístico y usa crossfade si la sincronización no resulta fiable. Configuración inicial: Smart Mix, 6 segundos, sincronización y normalización activadas. Los ajustes y el ecualizador persisten en SQLite.

Abre ABRIR-PANEL.cmd para configurar la música desde esta PC. El acceso local se guarda en runtime/panel-url.txt y cambia al reiniciar; no compartas ese archivo. OAuth opcional mediante .env.

iniciar.cmd inicia el bot y Lavalink en segundo plano; DETENER.cmd los detiene. Mantén la PC encendida y conectada. La carpeta operativa sigue siendo Desktop/TILINbot para conservar las rutas de arranque.

## Alcance
Sin moderación, tickets, verificación, roles, sorteos, estadísticas ni vigilancia de mensajes/miembros. Solo solicita los eventos Guilds y GuildVoiceStates. Los datos anteriores se conservan como historial inactivo; se creó además un respaldo antes de la conversión. No modifica ni borra canales, roles o mensajes existentes del servidor.

## Audio
Precarga dos canciones. EQ suave con margen previo, estéreo, Opus y bitrate según canal/servidor. La mezcla local utiliza FFmpeg y Lavalink; no requiere API de IA. DJ limita el ajuste de tempo a ±8%. Si falla el mezclador se usa reproducción normal. Una canción agregada al último instante puede necesitar cargar. El contenedor continuo tiene un límite aproximado de seis horas por sesión; detener y volver a reproducir inicia otra sesión.

## Validación
npm test y npm run check. No publiques .env, datos, runtime o claves del panel.


## Playlists aleatorias compatibles con AutoMix
Usa /play busqueda:ENLACE aleatorio:true con una playlist pública de YouTube o Spotify. La primera canción se elige al azar y se baraja únicamente el nuevo bloque agregado, respetando la cola previa. En Smart Mix y DJ, con sincronización activada, se analizan anticipadamente hasta seis candidatas del mismo bloque y se elige una transición compatible por BPM (considerando mitad/doble tempo), confianza y, sin normalización, cercanía de sonoridad. Se usa el tempo efectivo de la canción saliente. Si no hay un ritmo fiable/compatible disponible, conserva el orden aleatorio y el fundido de respaldo. No identifica tonalidades ni garantiza la mejor transición de toda la playlist.

Sin aleatorio:true se respeta el orden original. /mezclar baraja toda la cola pendiente y permite esta selección inteligente. Normal, Crossfade o sincronizar:false mantienen el orden barajado. /cola muestra el orden provisional; AutoMix puede ajustar la siguiente cuando termine el análisis. Repetir canción conserva la actual; saltar la omite. Cada canción permanece en la cola hasta consumirse o quitarse, incluido si el mismo título aparece varias veces. Se mantiene el límite de 200 pendientes y la advertencia de listas Spotify parcialmente disponibles.
