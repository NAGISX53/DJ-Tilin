# DJ Tilin

Bot exclusivo de música para Discord, compatible con varios servidores. Conserva reproducción por canción/artista/YouTube/Spotify, cola, precarga, bitrate adaptable, ecualizador equilibrado y AutoMix.

## Instalación desde este repositorio (Windows x64)

1. Instala Node.js 24.17 o posterior y Git si quieres clonar el repositorio. La instalación actual se probó con Node.js 26.
2. Descarga o clona el código y abre una terminal en su carpeta.
3. Ejecuta npm ci para instalar las versiones fijadas en package-lock.json (incluye FFmpeg).
4. Copia .env.example como .env y completa DISCORD_TOKEN, DISCORD_CLIENT_ID y OWNER_ID con los datos de tu bot. DISCORD_GUILD_ID es opcional y solo selecciona el servidor inicial del panel; no limita dónde funciona. No compartas el token. Discord OAuth y las credenciales Spotify son opcionales.
5. Ejecuta PREPARAR-MUSICA.cmd. Requiere Internet: descarga Java 21, Lavalink, yt-dlp y las dependencias del plugin, y compila/prueba el codificador.
6. En el portal de Discord activa Bot público, desactiva Requiere concesión de código y habilita solo Instalación en servidor con los alcances bot y applications.commands. Invita la aplicación con los permisos musicales. Permisos musicales: Ver canales, Enviar mensajes, Insertar enlaces, Conectar y Hablar; Gestionar canales permite subir el bitrate del canal. No necesita Administrador ni los intents privilegiados de miembros o mensajes.
7. Ejecuta registrar-comandos.cmd y luego iniciar.cmd. Entra a un canal de voz y usa /play.
8. ABRIR-PANEL.cmd abre el panel local. DETENER.cmd detiene ambos servicios.

El ZIP y Git contienen el código y la configuración de ejemplo. No incluyen tu .env, bases de datos, canciones, cachés, node_modules, ejecutables descargados ni claves de sesión. No arranques otra copia simultánea con el mismo token: usa una sola instalación activa.

La carpeta del repositorio puede tener cualquier nombre; los accesos se resuelven desde su ubicación. La instalación ya activa sigue en Desktop/TILINbot. No se requiere reinstalarla para consultar este repositorio.

## Estructura

- src/music: reproducción, cola, descargas, análisis y mezclador.
- src/commands: los 15 comandos musicales.
- src/web: panel y acceso local/OAuth.
- lavalink/tilin-audio/src: código Java del plugin y su prueba nativa.
- scripts: instalación, compilación, arranque y verificaciones.
- test: pruebas automáticas de audio, playlists, selección inteligente y controles.

## Uso
Entra a voz y usa /play busqueda:Daft Punk Get Lucky.
Comandos: /reproductor, /play, /pausa, /continuar, /saltar, /detener, /actual, /calidad, /automix, /ecualizador, /cola, /volumen, /repetir, /mezclar y /quitar.

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

## Invitar DJ Tilin a otros servidores

[Invitar al bot oficial](https://discord.com/oauth2/authorize?client_id=1548060851263770745&permissions=3165184&integration_type=0&scope=bot%20applications.commands)

Necesitas Gestionar servidor para instalarlo. Después de autorizarlo, entra a un canal de voz y usa /play. Los 15 comandos se registran globalmente, solo para servidores; DISCORD_GUILD_ID ya no restringe el uso. La instalación en una cuenta personal no incorpora al bot a canales de voz. Cada servidor conserva su cola, volumen de reproducción, repetición, ecualizador y AutoMix independientes. Una sola instancia puede servir a varios servidores; la capacidad depende de la PC y de su conexión.

Los permisos predeterminados son Ver canales, Enviar mensajes, Insertar enlaces, Conectar y Hablar. Gestionar canales es opcional y permite al bot elevar el bitrate del canal; sin él respeta el configurado. No solicita Administrador. En el panel local, el dueño puede seleccionar un servidor instalado; los accesos autorizados antiguos se limitan a su propio servidor. Los demás usuarios configuran la música con los comandos de Discord desde su canal de voz.

El plugin tilinQuality aplica un perfil Opus por reproductor/servidor y mantiene los filtros del ecualizador. Se verificaron dos reproductores Lavalink con audio real simultáneo a 96/384 kbps y un cambio en vivo a 64/384 kbps. El guion scripts/probar-multiservidor.js repite esta comprobación sin conectarse a voz en Discord (requiere una canción en caché).

## Recuperación de cola — paso 1 de las mejoras de experiencia

La sesión se guarda en SQLite después de los controles y cada tres segundos: canción actual, posición aproximada, canciones pendientes (incluidos duplicados y orden aleatorio), solicitantes, canal, volumen, pausa y repetición. El ecualizador y AutoMix ya se guardan por servidor en sus tablas correspondientes.

Al iniciar o reconectar Lavalink, recupera automáticamente las sesiones con oyentes en el canal original. Si no hay oyentes, conserva la cola y permite verla con /cola y recuperarla con /continuar desde un canal de voz. /play también recupera una cola pendiente antes de agregar canciones nuevas. Una sesión que estaba pausada mantiene la pausa al recuperarse automáticamente. Una desconexión manual del canal conserva la cola pero requiere /continuar para volver a entrar. /detener borra la sesión guardada deliberadamente; la cola terminada también limpia la sesión. Si el canal se queda vacío, sale pero conserva las canciones para /continuar.

DETENER.cmd solicita un cierre ordenado y guarda antes de salir; si no puede contactar al proceso, usa el último checkpoint disponible. Un cierre forzado puede repetir o adelantar algunos segundos por el intervalo de guardado y el búfer de audio. Durante un fundido se recupera una pista principal, sin reconstruir el solapamiento anterior; las emisiones en vivo se reconectan al directo. Se guardan identificadores públicos, sin archivos de audio, rutas privadas, flujos temporales ni credenciales. Los archivos SQLite se mantienen fuera de Git.

Paso 1 verificado: se reinició el proceso y el motor, se recuperó la canción cerca de 1:19 con sus dos pendientes y volumen de 35%, y el usuario confirmó que se escuchaba correctamente.

## Reproductor fijo — paso 2

El bot mantiene un mensaje por servidor con portada, progreso (actualizado cada 15 segundos), canción siguiente, volumen, repetición, AutoMix, ecualizador y bitrate. Los cambios de canción editan ese mensaje. Los botones permiten pausar/continuar, saltar, ver cola, detener, volumen ±5, repetir, aleatorio y actualizar. El menú cambia el modo Normal/Crossfade/Smart/DJ. Las confirmaciones de botones y menús son privadas; los cambios de reproducción exigen estar en el mismo canal de voz.

Usa /reproductor desde voz para mostrarlo o trasladarlo a otro canal de texto. Al moverlo se desactivan los controles del mensaje anterior. El identificador se guarda en SQLite para reutilizarlo después de reiniciar; si el mensaje ya no existe, se crea un reemplazo. No necesita leer el historial para editar su propio mensaje. Cuando la cola se guarda, muestra Recuperar cola; al detenerla, desactiva los controles. Los permisos de texto necesarios son Ver canal, Enviar mensajes e Insertar enlaces. Un fallo del panel no detiene el audio.

Estado de paso 2: 68 pruebas automáticas aprobadas y panel publicado en Discord; pendiente de confirmar los controles con el usuario antes de empezar la búsqueda de versiones. Favoritos, rol DJ/votaciones y análisis de tonalidad siguen pendientes.
