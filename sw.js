// Network first so each daily update shows up; falls back to the last copy when offline
const C = 'courtside-v8';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if(e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});

/* ---- Notifications: every alert goes out from here ----
   The page works out what happened (a favourite ruled out or back, an A-grade game, game start / halftime / final for a starred team,
   home runs, touchdowns, goals and assists, pitcher wins, no-hitters, hat tricks, 50-point games) and posts it; this shows it.
   With no window open, periodic sync (where the browser allows it) checks starred teams' games itself. */
const show = (title, opt) => self.registration.showNotification(title, Object.assign({icon:'icon-192.png', badge:'icon-192.png'}, opt || {}));
self.addEventListener('message', e => { const d = e.data || {}; if(d.type==='cs-notify' && d.title) e.waitUntil(show(d.title, d.opt).catch(() => {})); });
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope)); if(c){ c.postMessage({type:'cs-open', url}); return c.focus(); }
    return self.clients.openWindow(url); }));
});

// Background check: favourites live in the page's IndexedDB ('courtside' / 'kv' / 'favs'); the last state of each game is kept beside them
const PATHS = {nba:'basketball/nba', nfl:'football/nfl', mlb:'baseball/mlb', mcbb:'basketball/mens-college-basketball', cfb:'football/college-football'};
const NBA_AB = {GS:'GSW', NO:'NOP', NY:'NYK', SA:'SAS', UTAH:'UTA', WSH:'WAS'};
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('courtside', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kvGet = async k => { const db = await idb(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }); };
const kvSet = async (k, v) => { const db = await idb(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); };
async function bgCheck(){
  const open = await self.clients.matchAll({type:'window'}); if(open.some(c => c.visibilityState==='visible')) return;   // the open app handles its own alerts
  const pref = await kvGet('notif'); if(pref && pref.on===false) return;   // muted with the bell in the app
  const favs = await kvGet('favs') || {}, st = await kvGet('swst') || {}, teams = {};
  Object.keys(favs).forEach(k => { const [kind, lg, id] = k.split('|'); if(kind==='t') (teams[lg] = teams[lg] || new Set()).add(id); });
  for(const lg of Object.keys(teams)){ const path = PATHS[lg] || (/\./.test(lg) ? 'soccer/' + lg : null); if(!path) continue;
    let j; try{ j = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`, {cache:'no-store'})).json(); }catch(e){ continue; }
    for(const ev of j.events || []){ const c = (ev.competitions||[])[0]; if(!c) continue; const h = c.competitors.find(x => x.homeAway==='home'), a = c.competitors.find(x => x.homeAway==='away'); if(!h || !a) continue;
      const ab = t => lg==='nba' ? (NBA_AB[t.team.abbreviation] || t.team.abbreviation) : t.team.abbreviation; if(!teams[lg].has(ab(h)) && !teams[lg].has(ab(a))) continue;
      const s = c.status.type, prev = st[ev.id], board = `${a.team.abbreviation} ${a.score ?? ''}–${h.score ?? ''} ${h.team.abbreviation}`; st[ev.id] = s.state;
      if(!prev) continue;
      if(prev==='pre' && s.state==='in') await show(`🟢 Game on: ${a.team.shortDisplayName} at ${h.team.shortDisplayName}`, {tag:'ms-' + ev.id, body:'Underway now'});
      if(prev!=='post' && s.state==='post') await show(`🏁 Final: ${board}`, {tag:'ms-' + ev.id, body:s.detail || 'Final'}); } }
  const keep = {}; Object.keys(st).slice(-300).forEach(k => keep[k] = st[k]); await kvSet('swst', keep); }
self.addEventListener('periodicsync', e => { if(e.tag==='cs-watch') e.waitUntil(bgCheck().catch(() => {})); });
