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

Los fallos de análisis usan fundido sencillo; los fallos del mezclador tienen reproducción normal de respaldo. La selección musical inicial es heurística; la sexta mejora incorpora tonalidad estimada.

## Instalación en varios servidores

- Invitación pública con permisos de música y sin Administrador.
- 14 comandos globales; se retiran las restricciones al servidor original.
- DISCORD_GUILD_ID opcional y selector de servidor en el panel local.
- Bitrate Opus por servidor con filtro tilinQuality y limpieza al desconectar.
- Pruebas de aislamiento de colas/ajustes y dos reproductores Lavalink.

## Recuperación de cola — primera mejora verificada

- Checkpoints SQLite independientes por servidor y restauración de canción, posición aproximada, cola, pausa, volumen y repetición.
- Recuperación automática con oyentes y recuperación manual con /continuar cuando no hay sesión activa.
- Cierre ordenado desde DETENER.cmd, sin revivir colas borradas con /detener.
- Pruebas de cierre forzado, duplicados, datos dañados, aislamiento, selección exacta de audio y reanudación real en los cuatro modos.
- Reinicio real verificado y confirmado por el usuario: canción, posición aproximada, dos pendientes y volumen conservados.

## Reproductor fijo — segunda mejora verificada

- Un mensaje persistente por servidor con portada, progreso, siguiente canción y ajustes de audio.
- Controles privados, selector de AutoMix y /reproductor para mostrar o mover el panel.
- Actualizaciones serializadas; reemplazo de mensajes borrados y reutilización tras reiniciar.
- 68 pruebas aprobadas y controles confirmados por el usuario en Discord.

## Elegir versiones — tercera mejora verificada

- /buscar con cinco coincidencias, duración, artista, enlaces y filtros de versión.
- Menús privados, ligados al usuario/servidor/canal de voz, con caducidad y selección única.
- Se conserva el identificador exacto del resultado elegido y se utiliza la cola musical existente.
- Las búsquedas no mantienen bloqueados los controles de reproducción; las respuestas antiguas no sustituyen búsquedas nuevas.
- 80 pruebas aprobadas; el usuario confirmó que /buscar aparece y permite seleccionar una versión.

- Disponibilidad de /buscar: el despliegue conserva los comandos globales y sincroniza una copia idéntica en el servidor configurado para publicación inmediata.

## Biblioteca personal — cuarta mejora verificada

- Favoritos con botón en el reproductor y comandos guardar/lista/reproducir/quitar.
- Playlists personales con guardar/ver/lista/reproducir/borrar, autocompletado y orden aleatorio compatible con AutoMix.
- Persistencia en SQLite, aislamiento por usuario, protección frente a reemplazos accidentales y límites de capacidad.
- 94 pruebas aprobadas y favoritos/playlists confirmados por el usuario.

## Rol DJ y votación — quinta mejora verificada

- Configuración persistente por servidor con /dj configurar, estado y desactivar; controles abiertos de forma predeterminada.
- Permisos musicales comunes para comandos y botones, con acceso de Administración del servidor.
- Saltos por mayoría estricta de oyentes humanos, votos únicos por canción, limpieza al salir y protección frente a saltos duplicados.
- Panel con rol y progreso de votos; 104 pruebas aprobadas, incluida la autorización del router real.

- El usuario confirmó que funcionan los permisos DJ y la votación.

## Análisis musical — sexta mejora verificada

- Tonalidad y energía estimadas con análisis espectral en worker y caché v4.
- Selección de candidatas por ritmo, compatibilidad armónica y cercanía de energía.
- Solapamientos breves ante tonalidades alejadas o cambios grandes de energía.
- /analisis y datos estimados en el reproductor; 20 comandos y 114 pruebas aprobadas.
- Sin cambios de orden para peticiones manuales; respaldo si el análisis es incierto o falla.

- El usuario confirmó los datos de análisis y las transiciones sin cortes ni distorsión. Las seis mejoras de experiencia quedan verificadas.
