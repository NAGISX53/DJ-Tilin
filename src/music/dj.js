import { PermissionFlagsBits } from 'discord.js';

export class DjSettings {
  constructor(db) {
    this.db=db;
    db.exec('CREATE TABLE IF NOT EXISTS music_dj (guild_id TEXT PRIMARY KEY, role_id TEXT NOT NULL, voting INTEGER NOT NULL DEFAULT 1)');
  }
  get(guildId) {
    const row=this.db.prepare('SELECT role_id,voting FROM music_dj WHERE guild_id=?').get(guildId);
    return {roleId:row?.role_id || null,voting:Boolean(row?.voting)};
  }
  save(guildId,roleId,voting=true) {
    this.db.prepare('INSERT INTO music_dj(guild_id,role_id,voting) VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET role_id=excluded.role_id,voting=excluded.voting').run(guildId,roleId,Number(voting));
    return this.get(guildId);
  }
  clear(guildId) { this.db.prepare('DELETE FROM music_dj WHERE guild_id=?').run(guildId); }
}

export function managesMusic(member,guild) {
  return member.id===guild.ownerId || Boolean(member.permissions?.has(PermissionFlagsBits.ManageGuild));
}
export function controlsMusic(member,guild,settings) {
  return !settings.roleId || managesMusic(member,guild) || Boolean(member.roles?.cache.has(settings.roleId));
}

export function isDjControl(action,options) {
  return ['pausa','continuar','toggle','detener','volumen','repetir','mezclar','quitar','panel-mode','panel-repeat','panel-volume-down','panel-volume-up','reproductor'].includes(action)
    || action==='automix'&&['modo','duracion','sincronizar','normalizar'].some(name=>options.data.some(option=>option.name===name))
    || action==='ecualizador'&&Boolean(options.getString('modo'));
}

// Votes live only for this occurrence of a song, never across recovery/repeat.
// Claim before awaiting Discord so simultaneous clicks cannot skip twice.
export class SkipVotes {
  constructor() { this.reset(); }
  reset() { this.voters=new Set();this.pending=false;this.generation=(this.generation || 0)+1; }
  tally(listeners) {
    const present=new Set(listeners);
    for(const id of this.voters)if(!present.has(id))this.voters.delete(id);
    const needed=Math.floor(present.size/2)+1;
    return {count:this.voters.size,needed,passed:present.size>0&&this.voters.size>=needed,pending:this.pending};
  }
  vote(userId,listeners) {
    if(!listeners.includes(userId))throw Error('Debes estar en el canal de voz del bot para votar.');
    const duplicate=this.voters.has(userId);
    if(!this.pending)this.voters.add(userId);
    return {...this.tally(listeners),duplicate};
  }
  claim() { if(this.pending)return null;this.pending=true;return this.generation; }
  release(generation) { if(generation===this.generation)this.pending=false; }
}
