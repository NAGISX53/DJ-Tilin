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
