import { createHash } from 'node:crypto';
import { savedTrack } from './recovery.js';
export const LIBRARY_LIMITS=Object.freeze({favorite:100,playlist:30,tracks:201});
const validId=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
export function libraryName(value){
 if(typeof value!=='string')throw Error('Escribe un nombre para guardarlo.');
 const name=value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
 if(!name||name.length>80)throw Error('El nombre debe tener entre 1 y 80 caracteres.');
 return {name,key:name.toLocaleLowerCase('es')};
}
export function libraryTrack(track){const value=savedTrack(track);if(!value)throw Error('Canción inválida.');const {requester,shuffleGroup,...portable}=value;return portable;}
function sourceKey(track){
 const info=track.audioInfo || track.info;
 return createHash('sha256').update(JSON.stringify([info.sourceName,info.identifier || '',info.identifier?'':info.title,info.identifier?'':info.author])).digest('hex');
}
export class MusicLibrary {
 constructor(db){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS music_library (
 owner_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('favorite','playlist')),name_key TEXT NOT NULL,name TEXT NOT NULL,
 tracks_json TEXT NOT NULL,track_count INTEGER NOT NULL,favorite_key TEXT,updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,kind,name_key));
 CREATE UNIQUE INDEX IF NOT EXISTS music_library_favorite ON music_library(owner_id,favorite_key) WHERE kind='favorite' AND favorite_key IS NOT NULL;`);}
 validate(owner,kind){if(!validId(owner)||!['favorite','playlist'].includes(kind))throw Error('Biblioteca inválida.');}
 save(owner,kind,label,tracks,{replace=false}={}){
  this.validate(owner,kind);const {name,key}=libraryName(label);
  if(!Array.isArray(tracks)||!tracks.length||tracks.length>LIBRARY_LIMITS.tracks||(kind==='favorite'&&tracks.length!==1))throw Error('Guarda entre 1 y 201 canciones; un favorito contiene una sola canción.');
  const portable=tracks.map(libraryTrack),favorite=kind==='favorite'?sourceKey(portable[0]):null;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(favorite){const duplicate=this.db.prepare("SELECT name FROM music_library WHERE owner_id=? AND kind='favorite' AND favorite_key=?").get(owner,favorite);if(duplicate){this.db.exec('COMMIT');return {name:duplicate.name,count:1,duplicate:true,replaced:false};}}
   const existing=this.db.prepare('SELECT 1 FROM music_library WHERE owner_id=? AND kind=? AND name_key=?').get(owner,kind,key);
   if(existing&&!replace)throw Error('Ya existe ese nombre. Elige otro o usa reemplazar:true.');
   if(!existing&&this.db.prepare('SELECT COUNT(*) AS n FROM music_library WHERE owner_id=? AND kind=?').get(owner,kind).n>=LIBRARY_LIMITS[kind])throw Error('Llegaste al límite de '+LIBRARY_LIMITS[kind]+' elementos de este tipo.');
   this.db.prepare('INSERT INTO music_library(owner_id,kind,name_key,name,tracks_json,track_count,favorite_key,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,kind,name_key) DO UPDATE SET name=excluded.name,tracks_json=excluded.tracks_json,track_count=excluded.track_count,favorite_key=excluded.favorite_key,updated_at=excluded.updated_at')
    .run(owner,kind,key,name,JSON.stringify(portable),portable.length,favorite,Date.now());
   this.db.exec('COMMIT');return {name,count:portable.length,duplicate:false,replaced:Boolean(existing)};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 get(owner,kind,label){
  this.validate(owner,kind);const {key}=libraryName(label);
  const row=this.db.prepare('SELECT name,tracks_json FROM music_library WHERE owner_id=? AND kind=? AND name_key=?').get(owner,kind,key);
  if(!row)throw Error('No encontré ese nombre en tu biblioteca. Usa lista para consultar lo que guardaste.');
  try{const tracks=JSON.parse(row.tracks_json);if(!Array.isArray(tracks)||!tracks.length||tracks.length>LIBRARY_LIMITS.tracks||(kind==='favorite'&&tracks.length!==1))throw Error();return {name:row.name,tracks:tracks.map(libraryTrack)};}
  catch{throw Error('No pude leer esta lista guardada. Las demás canciones y listas se conservan.');}
 }
 list(owner,kind){this.validate(owner,kind);return this.db.prepare('SELECT name,track_count AS count FROM music_library WHERE owner_id=? AND kind=? ORDER BY updated_at DESC,name_key ASC').all(owner,kind);}
 names(owner,kind,query=''){const part=String(query).normalize('NFKC').toLocaleLowerCase('es');return this.list(owner,kind).filter(row=>row.name.toLocaleLowerCase('es').includes(part)).slice(0,25).map(row=>({name:(row.name+' · '+row.count+' canción(es)').slice(0,100),value:row.name}));}
 remove(owner,kind,label){this.validate(owner,kind);const {key}=libraryName(label);return this.db.prepare('DELETE FROM music_library WHERE owner_id=? AND kind=? AND name_key=?').run(owner,kind,key).changes>0;}
}
