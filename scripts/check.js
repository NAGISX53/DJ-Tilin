import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateConfig } from '../src/validate-config.js';

const root = process.cwd();
function syntax(dir) {
  for (const entry of readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) syntax(file);
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check',file], {encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    }
  }
}
syntax(path.join(root,'src'));
if (process.platform === 'win32') {
  const parse = 'Get-ChildItem -LiteralPath scripts -Filter *.ps1 | ForEach-Object { $parseErrors=$null; $parseTokens=$null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$parseTokens,[ref]$parseErrors) | Out-Null; if ($parseErrors.Count) { $parseErrors | ForEach-Object { Write-Output $_.Message }; exit 1 } }';
  const result = spawnSync('powershell.exe',['-NoProfile','-Command',parse],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout + result.stderr);
}

assert.throws(() => validateConfig({discord:{},dashboard:{port:3000}}), /DISCORD_TOKEN/);
const dir = mkdtempSync(path.join(tmpdir(),'tilin-check-'));
process.chdir(dir);
try {
  const {db,getMusicEqualizer,setMusicEqualizer,getMixSettings,saveMixSettings} = await import('../src/db.js');
  const {commands} = await import('../src/commands/index.js');
  assert.equal(commands.length, 19);
  assert(!commands.some(c => /setup|ticket|rol|stats|moder/.test(c.data.name)));
  const serialized = commands.map(command => command.data.toJSON());
  for (const cmd of serialized) { assert.deepEqual(cmd.contexts,[0]);assert.deepEqual(cmd.integration_types,[0]); }
  assert.equal(new Set(serialized.map(c=>c.name)).size, commands.length);
  assert.equal(getMusicEqualizer('test'), 'equilibrado');
  assert.equal(getMixSettings('test').mode, 'smart');
  saveMixSettings('test', { mode: 'dj', seconds: 8 });
  saveMixSettings('test', { normalize: false });
  assert.deepEqual(getMixSettings('test'), { mode: 'dj', seconds: 8, syncBpm: true, normalize: false });
  saveMixSettings('other', { mode: 'crossfade', seconds: 4 });
  assert.equal(getMixSettings('test').mode, 'dj');
  assert.equal(getMixSettings('other').mode, 'crossfade');
  setMusicEqualizer('test', 'original');
  assert.equal(getMusicEqualizer('other'), 'equilibrado');
  assert.equal(getMusicEqualizer('test'), 'original');
  setMusicEqualizer('test', 'equilibrado');
  assert.equal(getMusicEqualizer('test'), 'equilibrado');
  db.close();
  console.log(`OK: sintaxis, configuración, SQLite musical y ${commands.length} comandos.`);
} finally { process.chdir(root); rmSync(dir,{recursive:true,force:true}); }
