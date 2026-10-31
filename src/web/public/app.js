function musicSettingsUrl() { return '/api/music/settings?guildId=' + encodeURIComponent(document.getElementById('music_guild').value); }
async function api(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) throw new Error('unauthorized');
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'No se pudo guardar la configuración.');
  return data;
}

async function load() {
  try {
    const me = await api('/api/me');
    if (!me.authenticated) return;
    document.querySelector('#login').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    const available = await api('/api/music/guilds');
    const select = document.getElementById('music_guild');
    for (const guild of available.guilds) {
      const option = document.createElement('option'); option.value = guild.id; option.textContent = guild.name; select.appendChild(option);
    }
    if (available.guilds.some(g => g.id === available.preferredGuildId)) select.value = available.preferredGuildId;
    if (!available.guilds.length) {
      document.getElementById('mix_status').textContent = 'Añade DJ Tilin a un servidor para configurar su música.';
      document.getElementById('mix_save').disabled = true; return;
    }
    select.addEventListener('change', loadMix);
    await loadMix();
  } catch {}
}

function mixStatus(data) {
  const status = document.getElementById('mix_status');
  const playback = data.playback;
  if (!playback) { status.textContent = 'Guardado. No hay reproducción activa.'; return; }
  if (playback.mixingDisabled) { status.textContent = 'El mezclador no está disponible; el bot utiliza reproducción normal de respaldo.'; return; }
  const transition = playback.transition;
  status.textContent = playback.paused ? 'Reproducción en pausa.' : 'Reproducción activa.';
  if (transition) status.textContent += ` Última transición: ${transition.type} (${transition.seconds.toFixed(1)} s). ${transition.fallback || ''}`;
}
async function loadMix() {
  try {
    const selected = document.getElementById('music_guild').value;
    const data = await api(musicSettingsUrl());
    if (selected !== document.getElementById('music_guild').value) return;
    const value = data.settings;
    document.getElementById('mix_mode').value = value.mode;
    document.getElementById('mix_seconds').value = value.seconds;
    document.getElementById('mix_seconds_value').value = value.seconds;
    document.getElementById('mix_sync').checked = value.syncBpm;
    document.getElementById('mix_normalize').checked = value.normalize;
    mixStatus(data);
  } catch (error) { document.getElementById('mix_status').textContent = error.message; }
}
document.getElementById('mix_seconds').addEventListener('input', event => {
  document.getElementById('mix_seconds_value').value = event.target.value;
});
document.getElementById('mix_refresh').addEventListener('click', loadMix);
document.getElementById('mix_save').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const data = await api(musicSettingsUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      mode: document.getElementById('mix_mode').value,
      seconds: Number(document.getElementById('mix_seconds').value),
      syncBpm: document.getElementById('mix_sync').checked,
      normalize: document.getElementById('mix_normalize').checked
    }) });
    mixStatus(data);
  } catch (error) { document.getElementById('mix_status').textContent = error.message; }
  finally { event.target.disabled = false; }
});

load();
