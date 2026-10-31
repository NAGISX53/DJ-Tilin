# DJ Tilin

Bot exclusivo de música para Discord, compatible con varios servidores. Conserva reproducción por canción/artista/YouTube/Spotify, cola, precarga, bitrate adaptable, ecualizador equilibrado y AutoMix.

## Instalación desde este repositorio (Windows x64)

1. Instala Node.js 24.17 o posterior y Git si quieres clonar el repositorio. La instalación actual se probó con Node.js 26.
2. Descarga o clona el código y abre una terminal en su carpeta.
3. Ejecuta npm ci para instalar las versiones fijadas en package-lock.json (incluye FFmpeg).
4. Copia .env.example como .env y completa DISCORD_TOKEN, DISCORD_CLIENT_ID y OWNER_ID con los datos de tu bot. DISCORD_GUILD_ID es opcional: selecciona el servidor inicial del panel y permite publicar allí una copia inmediata de los comandos; no limita dónde funciona. No compartas el token. Discord OAuth y las credenciales Spotify son opcionales.
5. Ejecuta PREPARAR-MUSICA.cmd. Requiere Internet: descarga Java 21, Lavalink, yt-dlp y las dependencias del plugin, y compila/prueba el codificador.
6. En el portal de Discord activa Bot público, desactiva Requiere concesión de código y habilita solo Instalación en servidor con los alcances bot y applications.commands. Invita la aplicación con los permisos musicales. Permisos musicales: Ver canales, Enviar mensajes, Insertar enlaces, Conectar y Hablar; Gestionar canales permite subir el bitrate del canal. No necesita Administrador ni los intents privilegiados de miembros o mensajes.
7. Ejecuta registrar-comandos.cmd y luego iniciar.cmd. Entra a un canal de voz y usa /play.
8. ABRIR-PANEL.cmd abre el panel local. DETENER.cmd detiene ambos servicios.

El ZIP y Git contienen el código y la configuración de ejemplo. No incluyen tu .env, bases de datos, canciones, cachés, node_modules, ejecutables descargados ni claves de sesión. No arranques otra copia simultánea con el mismo token: usa una sola instalación activa.

La carpeta del repositorio puede tener cualquier nombre; los accesos se resuelven desde su ubicación. La instalación ya activa sigue en Desktop/TILINbot. No se requiere reinstalarla para consultar este repositorio.

## Estructura

- src/music: reproducción, cola, descargas, análisis y mezclador.
- src/commands: los 18 comandos musicales.
- src/web: panel y acceso local/OAuth.
- lavalink/tilin-audio/src: código Java del plugin y su prueba nativa.
- scripts: instalación, compilación, arranque y verificaciones.
- test: pruebas automáticas de audio, playlists, selección inteligente y controles.

## Uso
Entra a voz y usa /play busqueda:Daft Punk Get Lucky.
Comandos: /favoritos, /playlist, /buscar, /reproductor, /play, /pausa, /continuar, /saltar, /detener, /actual, /calidad, /automix, /ecualizador, /cola, /volumen, /repetir, /mezclar y /quitar.

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
Usa /play busqueda:ENLACE aleatorio:true con una playlist pública de YouTube o Spotify. La primera canción se elige al azar y se baraja únicamente el nuevo bloque agregado, respetando la cola previa. En Smart Mix y DJ, con sincronización activada, se analizan anticipadamente hasta seis candidatas del mismo bloque y se elige una transición compatible por BPM (considerando mitad/doble tempo), confianza, tonalidad y energía estimadas y, sin normalización, cercanía de sonoridad. Se usa el tempo efectivo de la canción saliente. Sin ritmo fiable todavía puede usar tonalidad o energía si están disponibles; sin datos útiles conserva el orden aleatorio y el fundido de respaldo. No garantiza la mejor transición de toda la playlist.

Sin aleatorio:true se respeta el orden original. /mezclar baraja toda la cola pendiente y permite esta selección inteligente. Normal, Crossfade o sincronizar:false mantienen el orden barajado. /cola muestra el orden provisional; AutoMix puede ajustar la siguiente cuando termine el análisis. Repetir canción conserva la actual; saltar la omite. Cada canción permanece en la cola hasta consumirse o quitarse, incluido si el mismo título aparece varias veces. Se mantiene el límite de 200 pendientes y la advertencia de listas Spotify parcialmente disponibles.

## Invitar DJ Tilin a otros servidores

[Invitar al bot oficial](https://discord.com/oauth2/authorize?client_id=1548060851263770745&permissions=3165184&integration_type=0&scope=bot%20applications.commands)

Necesitas Gestionar servidor para instalarlo. Después de autorizarlo, entra a un canal de voz y usa /play. Los 18 comandos se registran globalmente, solo para servidores; DISCORD_GUILD_ID ya no restringe el uso. La instalación en una cuenta personal no incorpora al bot a canales de voz. Cada servidor conserva su cola, volumen de reproducción, repetición, ecualizador y AutoMix independientes. Una sola instancia puede servir a varios servidores; la capacidad depende de la PC y de su conexión.

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

Paso 2 verificado por el usuario: los controles funcionan y actualizan el mismo mensaje.

## Elegir versiones — paso 3

Usa /buscar consulta:Daft Punk Get Lucky version:Remix desde el canal de voz. Puedes elegir Todas, Estudio/oficial, Remix, En directo, Extendida o Instrumental. Se muestran hasta cinco resultados de YouTube con título, artista, duración y enlace. La búsqueda es privada y no modifica la cola hasta que selecciones una canción. /play conserva la reproducción directa y sigue admitiendo enlaces y playlists.

El menú dura cinco minutos, pertenece únicamente a quien lo pidió y se usa una sola vez. Una búsqueda nueva reemplaza la anterior del mismo usuario en ese servidor. Para elegir debes seguir en el canal de voz de la búsqueda y, si el bot ya está activo, en el mismo canal que el bot. Al elegir, se usa el identificador exacto del video seleccionado y se añade a la cola normal, conservando AutoMix, precarga, recuperación y el panel fijo. Cancelar o dejar caducar una búsqueda no añade nada. Si el bot reinicia, vuelve a usar /buscar.

Los filtros añaden términos a la búsqueda y las etiquetas se deducen del título; no certifican que un resultado sea una versión oficial, original o extendida. El usuario decide con la información de cada resultado. No se descargan las cinco alternativas: solo la elegida.

Paso 3 verificado por el usuario: el comando aparece y permite elegir la versión.

Si los comandos globales nuevos tardan en aparecer, registrar-comandos.cmd también sincroniza una copia idéntica en DISCORD_GUILD_ID, cuando está configurado. El resto de servidores conserva los comandos globales.

## Favoritos y playlists guardadas — paso 4

La biblioteca pertenece a tu usuario de Discord y puedes utilizarla en los servidores donde esté instalado el bot. Los listados, el autocompletado y las confirmaciones son privados. Se guarda en SQLite; no contiene archivos de audio y no se publica en GitHub.

- /favoritos guardar: guarda la canción actual; nombre es opcional. También puedes pulsar ♡ Favorita en el reproductor. Guardar la misma versión otra vez no crea un duplicado.
- /favoritos lista, /favoritos reproducir nombre:… y /favoritos quitar nombre:… administran tus canciones.
- /playlist guardar nombre:Fiesta: guarda la canción actual y las pendientes, en su orden y con los duplicados que haya.
- /playlist lista y /playlist ver nombre:Fiesta: consultan tus listas y sus canciones, por páginas.
- /playlist reproducir nombre:Fiesta: añade la lista a la cola; aleatorio:true permite la selección compatible con AutoMix.
- /playlist borrar nombre:Fiesta: elimina tu lista guardada.

Los nombres se autocompletan y no distinguen mayúsculas. No se sobrescribe una lista con el mismo nombre salvo que indiques reemplazar:true. Cada usuario puede guardar hasta 100 favoritos y 30 playlists de hasta 201 canciones (la actual y 200 pendientes). Los identificadores de versiones ya resueltas se conservan; Spotify pendiente de resolver mantiene su búsqueda de audio. Al reproducir se respeta la capacidad restante de la cola y se informa de cualquier omisión. Una lista de 201 canciones puede iniciarse completa cuando el reproductor está vacío. El orden aleatorio se activa al reproducir y no modifica el contenido guardado.

Guardar canciones o colas y reproducirlas requiere estar en voz; si el bot está activo, en su mismo canal. Consultar o eliminar tu biblioteca no requiere entrar a voz. Nadie puede acceder mediante estos comandos a la biblioteca de otro usuario.

Paso 4 verificado por el usuario: favoritos y playlists se guardan y vuelven a añadirse correctamente.

## Rol DJ y votación — paso 5

Por defecto todos los oyentes conservan los controles. Un usuario con **Administrar servidor** puede activar la protección con `/dj configurar rol:@DJ votacion:true`. `/dj estado` muestra la configuración y `/dj desactivar` vuelve a abrir los controles. No se crea ni asigna ningún rol automáticamente.

Con un rol configurado, quienes lo tienen y quienes administran el servidor pueden pausar, detener, recuperar, cambiar volumen, repetición, orden, AutoMix y ecualizador, quitar canciones o mover el reproductor. Los demás pueden pedir música, usar búsquedas y bibliotecas y consultar los ajustes. `/saltar` y el botón **Saltar / Votar** registran un voto por persona; se necesita más de la mitad de los oyentes humanos del mismo canal. DJ y administradores saltan directamente. Con `votacion:false`, solo ellos pueden saltar.

Los votos se reinician por canción, incluso al repetir, y tras reiniciar el bot. Se retiran los votos de quienes salen y se vuelve a comprobar la mayoría al cambiar los oyentes. La configuración se guarda por servidor. Si se elimina el rol, Administrar servidor permite corregirlo. El panel local conserva su autorización independiente de propietario/usuarios autorizados.

Paso 5 verificado por el usuario: funcionan los permisos del rol DJ y los votos para saltar.

## Análisis musical avanzado — paso 6

El análisis local añade tonalidad mayor/menor e intensidad estimadas al BPM, silencios y sonoridad existentes. `/analisis` muestra la canción actual, la siguiente candidata y la transición prevista; el reproductor también muestra los datos disponibles. La siguiente candidata puede cambiar al terminar la precarga.

En playlists aleatorias, Smart Mix y DJ con sincronización activada valoran entre hasta seis candidatas preparadas: misma tonalidad, relativa mayor/menor o vecina en el círculo de quintas, energía parecida y tempo compatible. Las peticiones manuales conservan su posición. Una tonalidad incierta no se usa para decidir compatibilidad. El fundido se limita a tres segundos cuando las tonalidades detectadas están alejadas o la diferencia estimada de energía es grande. Normal y Crossfade mantienen su comportamiento. No hay transposición de notas; DJ mantiene su ajuste de tempo existente.

El espectro se procesa en un worker, con hasta 96 ventanas mono de 8192 muestras a 11025 Hz, espaciadas según la duración conocida (mínimo dos segundos). Si falta la duración, se muestrean los primeros minutos. La correlación de cromas utiliza perfiles Krumhansl-Schmuckler y descarta resultados ambiguos; no es un análisis musical certificado. Energía es un índice heurístico 0–100 que combina brillo, actividad de la envolvente y compresión, no una medida de volumen ni un dato de Spotify. El cálculo tonal se serializa, tiene tiempo límite y admite respaldo sin tonalidad. Caché v4 para regenerar análisis anteriores.

Referencia del método de correlación: [documentación oficial de Key en Essentia](https://essentia.upf.edu/reference/std_Key.html). La implementación FFT/cromas es independiente y no añade Essentia como dependencia.

Paso 6: 114 pruebas aprobadas, incluidos FFmpeg, worker, caché, progresiones mayores/menores, selección y mezcla real con límites de pico. Verificado por el usuario: los datos aparecen y las transiciones se escuchan bien, sin cortes ni distorsión.

## Reproductor al final del chat

Al comenzar una canción, tanto por cambio automático como por salto o repetición, el bot publica una tarjeta nueva al final del canal y borra la anterior. También vuelve a publicar el estado cuando termina la cola. Primero confirma el envío nuevo para conservar el panel anterior si falla el envío. Si no puede borrar la tarjeta antigua, intenta retirar sus controles. Los cambios de volumen, pausa y progreso editan la tarjeta actual sin reenviarla. El identificador nuevo queda guardado para las siguientes actualizaciones.
