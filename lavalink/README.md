# Motor de audio de DJ Tilin

La instalación soportada es Windows x64 con Java 21 portable. Ejecuta PREPARAR-MUSICA.cmd después de npm ci: descarga Java 21, Lavalink 4.2.2 y yt-dlp, y compila el plugin propio tilin-audio desde el código Java incluido. No requiere Java instalado en el sistema.

El plugin aporta bitrate Opus adaptable y la fuente local del mezclador. Su compilación ejecuta EncoderSelfTest. Las licencias de Opus y opus-java están en tilin-audio/licenses; las dependencias conservan sus licencias respectivas.

El arranque normal es iniciar.cmd desde la raíz; carga las variables de música de .env y limita el servicio a localhost. No compartas la contraseña si la cambias por una propia.

docker-compose.yml es una referencia de Lavalink y requiere adaptaciones: no instala el bot, el plugin nativo Windows ni yt-dlp. El funcionamiento completo en Linux o Docker no está implementado ni validado.
