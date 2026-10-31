import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { db, getMixSettings, saveMixSettings } from '../db.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
let discordStatus = () => false;
let musicStatus = () => false;
let musicControl;
let shutdownHandler;
export function setShutdownHandler(handler) { shutdownHandler = handler; }
export function setMusicControl(control) { musicControl = control; }
export function setDiscordStatusProvider(provider) { discordStatus = provider; }
export function setMusicStatusProvider(provider) { musicStatus = provider; }
app.get('/health', (req,res) => {
  const connected = discordStatus();
  res.status(connected ? 200 : 503).json({service:'DJ Tilin',discordConnected:connected,musicConnected:musicStatus()});
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(path.resolve('assets')));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
const oauthStates = new Map();
const localKey = crypto.randomBytes(32).toString('hex');
fs.mkdirSync(path.resolve('runtime'), { recursive: true });
fs.writeFileSync(path.resolve('runtime/panel-url.txt'), `http://127.0.0.1:${config.dashboard.port}/auth/local?key=${localKey}`);

// A local capability file lets the PC owner open the panel without requiring
// an OAuth secret. It rotates at every restart and is never served statically.
app.get('/auth/local', (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!loopback || !/^[a-f0-9]{64}$/.test(key) || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(localKey))) return res.sendStatus(403);
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { id: config.discord.ownerId, username: 'Administrador local', expires: Date.now() + 8 * 60 * 60 * 1000 });
  res.cookie('tilin_session', sid, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
  res.redirect('/');
});

// Only the local owner capability may request an orderly shutdown.
app.post('/internal/shutdown', (req, res) => {
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const key = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!loopback || !/^[a-f0-9]{64}$/.test(key) || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(localKey))) return res.sendStatus(403);
  if (!shutdownHandler) return res.sendStatus(503);
  res.json({ ok: true });
  setImmediate(() => void shutdownHandler());
});

function sessionUser(req) {
  const sid = req.headers.cookie?.match(/tilin_session=([^;]+)/)?.[1];
  const session = sid ? sessions.get(sid) : null;
  if (!session || session.expires < Date.now()) { if (sid) sessions.delete(sid); return null; }
  return session;
}

function authorized(userId, guildId = config.discord.guildId) {
  if (!userId) return false;
  if (userId === config.discord.ownerId) return true;
  return Boolean(db.prepare(`SELECT 1 FROM authorized_users WHERE guild_id=? AND user_id=?`).get(guildId, userId));
}

app.get('/auth/discord', (req, res) => {
  if (!config.discord.clientSecret || config.discord.clientSecret === 'SECRETO_OAUTH') return res.status(503).send('Configura DISCORD_CLIENT_SECRET en .env para usar el panel.');
  for (const [key, expires] of oauthStates) if (expires < Date.now()) oauthStates.delete(key);
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, Date.now() + 300000);
  res.cookie('tilin_oauth', state, {httpOnly:true, sameSite:'lax', maxAge:300000});
  const redirect = encodeURIComponent(`${config.dashboard.baseUrl}/auth/discord/callback`);
  const url = `https://discord.com/oauth2/authorize?client_id=${config.discord.clientId}&response_type=code&redirect_uri=${redirect}&scope=identify%20guilds`;
  res.redirect(`${url}&state=${state}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const state = req.query.state;
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)tilin_oauth=([^;]+)/)?.[1];
  const expires = oauthStates.get(state);
  oauthStates.delete(state);
  if (typeof state !== 'string' || state !== cookie || !expires || expires < Date.now()) return res.status(400).send('Sesión OAuth inválida. Inicia sesión de nuevo.');
  if (!req.query.code) return res.status(400).send('Falta code.');
  try {
    const body = new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code: req.query.code,
      redirect_uri: `${config.dashboard.baseUrl}/auth/discord/callback`
    });
    const token = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }).then(r => r.json());

    const user = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    }).then(r => r.json());

    if (!authorized(user.id)) return res.status(403).send('No autorizado para este panel.');

    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { id: user.id, username: user.username, expires: Date.now() + 8 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `tilin_session=${sid}; HttpOnly; SameSite=Lax; Path=/`);
    res.redirect('/');
  } catch (e) {
    res.status(500).send(`OAuth error: ${e.message}`);
  }
});

app.get('/api/me', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user });
});

function panelGuilds(userId) {
  return (musicControl?.guilds() || []).filter(guild => authorized(userId, guild.id));
}
app.get('/api/music/guilds', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  res.json({ guilds: panelGuilds(user.id), preferredGuildId: config.discord.guildId || null });
});
app.use('/api/music', (req, res, next) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const guilds = panelGuilds(user.id);
  const guildId = req.query.guildId || (guilds.some(g => g.id === config.discord.guildId) ? config.discord.guildId : guilds[0]?.id);
  if (!guilds.some(g => g.id === guildId)) return res.status(403).json({ error: 'No tienes acceso a este servidor o el bot no está instalado.' });
  req.musicGuildId = guildId;
  next();
});
app.get('/api/music/settings', (req, res) => {
  res.json({ settings: getMixSettings(req.musicGuildId), playback: musicControl?.status(req.musicGuildId) || null });
});
app.put('/api/music/settings', async (req, res) => {
  const origin = req.get('origin');
  const allowedOrigins = new Set([`http://127.0.0.1:${config.dashboard.port}`, `http://localhost:${config.dashboard.port}`, config.dashboard.baseUrl]);
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origen no autorizado' });
  try {
    const settings = musicControl ? await musicControl.configure(req.musicGuildId, req.body) : saveMixSettings(req.musicGuildId, req.body);
    res.json({ settings, playback: musicControl?.status(req.musicGuildId) || null });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.listen(config.dashboard.port, '127.0.0.1', () => {
  console.log(`[WEB] Dashboard en ${config.dashboard.baseUrl}`);
});
