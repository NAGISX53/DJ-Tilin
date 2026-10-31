import 'dotenv/config';
async function read(route) {
  const response = await fetch(`https://discord.com/api/v10${route}`, {headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`}});
  if (!response.ok) throw new Error(`Discord HTTP ${response.status} en ${route}`);
  return response.json();
}
try {
  const me = await read('/users/@me');
  const app = await read('/oauth2/applications/@me');
  const guilds = await read('/users/@me/guilds');
  console.log(JSON.stringify({bot:{id:me.id,name:me.username},application:{id:app.id,ownerId:app.owner?.id,team:app.team?.name},guilds:guilds.map(g=>({id:g.id,name:g.name,permissions:g.permissions}))},null,2));
} catch (error) {console.error(error.message); process.exitCode=1;}
