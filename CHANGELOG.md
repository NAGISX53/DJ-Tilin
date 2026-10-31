# Cambios incluidos

## 2026-10-31 — DJ Tilin

- Conversión del bot a música exclusivamente; nombre en Discord DJ Tilin.
- Reproducción por canción/artista, enlaces YouTube y metadatos Spotify públicos.
- Cola de hasta 200 pendientes, precarga, pausa, salto, repetición, mezclar y quitar.
- Opus estéreo a bitrate adaptable y ecualizador suave con margen de audio.
- Normal, Crossfade, Smart Mix y DJ automático; fundidos de 3–15 segundos.
- Análisis de BPM, normalización y ajuste de tempo conservando el tono.
- Panel local autenticado y configuración persistente en SQLite.
- Playlists aleatorias con /play aleatorio:true; selección de la siguiente entre hasta seis candidatas compatibles para AutoMix.
- 41 pruebas automatizadas y comprobación de configuración/sintaxis/comandos.

Los fallos de análisis usan fundido sencillo; los fallos del mezclador tienen reproducción normal de respaldo. La selección musical es heurística, sin análisis de tonalidad.

## Instalación en varios servidores

- Invitación pública con permisos de música y sin Administrador.
- 14 comandos globales; se retiran las restricciones al servidor original.
- DISCORD_GUILD_ID opcional y selector de servidor en el panel local.
- Bitrate Opus por servidor con filtro tilinQuality y limpieza al desconectar.
- Pruebas de aislamiento de colas/ajustes y dos reproductores Lavalink.

## Recuperación de cola — primera mejora en validación

- Checkpoints SQLite independientes por servidor y restauración de canción, posición aproximada, cola, pausa, volumen y repetición.
- Recuperación automática con oyentes y recuperación manual con /continuar cuando no hay sesión activa.
- Cierre ordenado desde DETENER.cmd, sin revivir colas borradas con /detener.
- Pruebas de cierre forzado, duplicados, datos dañados, aislamiento, selección exacta de audio y reanudación real en los cuatro modos.
- Pendiente de confirmación auditiva en Discord antes de continuar con la siguiente mejora.
