const fetch = require('node-fetch');
const cheerio = require('cheerio');
const Pusher = require('pusher');

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const UNIT_NAMES = {
  farmer: 'Wiejska', sword: 'Templariusz', spear: 'Giermek',
  axe: 'WW', bow: 'Łucznik', spy: 'Szpieg',
  light: 'Krzyżowiec', heavy: 'Czarny', ram: 'Taran',
  kata: 'Katapulta', snob: 'Hrabia'
};

const UNIT_SPEED = {
  farmer: 20, sword: 22, spear: 18, axe: 18, bow: 18,
  spy: 9, light: 10, heavy: 11, ram: 30, kata: 30, snob: 35
};

let sessionCache = {
  sessionId: null,
  villageId: null,
  serverSpeed: 1,
  expiresAt: 0
};

// Logowanie przez GameForge
async function login() {
  console.log('[SCRAPER] Logowanie przez GameForge...');
  
  // 1. Logowanie do GameForge lobby
  const loginRes = await fetch('https://lobby.kingsage.gameforge.com/api/v1/auth/studios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: process.env.KA_USERNAME,  // Email GameForge
      password: process.env.KA_PASSWORD,  // Hasło GameForge
      locale: 'pl'
    })
  });
  
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  
  const loginData = await loginRes.json();
  const sessionId = loginData.id;
  
  // 2. Pobierz listę dostępnych kont/serwerów
  const accountsRes = await fetch(`https://lobby.kingsage.gameforge.com/api/v1/auth/sessions/${sessionId}/accounts`);
  const accounts = await accountsRes.json();
  
  // 3. Znajdź nasz serwer (np. s64-pl)
  const serverLang = process.env.KA_SERVER.match(/s\d+-([a-z]+)/)?.[1] || 'pl';
  const targetAccount = accounts.find(acc => acc.language === serverLang);
  
  if (!targetAccount) {
    throw new Error(`Nie znaleziono serwera ${serverLang}. Dostępne: ${accounts.map(a => a.language).join(', ')}`);
  }
  
  // 4. Zaloguj do konkretnego serwera
  const serverLoginRes = await fetch(`https://lobby.kingsage.gameforge.com/api/v1/auth/sessions/${sessionId}/accounts/${targetAccount.id}/login?locale=pl`, {
    method: 'POST'
  });
  
  const serverLoginData = await serverLoginRes.json();
  
  // 5. Przekierowanie do gry - pobierz cookies
  const gameRes = await fetch(serverLoginData.url, {
    redirect: 'manual'
  });
  
  // 6. Wyciągnij sid z cookies
  const cookies = gameRes.headers.raw()['set-cookie'] || [];
  const sidCookie = cookies.find(c => c.includes('sid='));
  
  if (!sidCookie) {
    throw new Error('Brak sid cookie po logowaniu');
  }
  
  sessionCache.sessionId = sidCookie.match(/sid=([^;]+)/)?.[1];
  
  // 7. Pobierz villageId
  const homeRes = await fetch(process.env.KA_SERVER + '/game.php?village=0', {
    headers: { 'Cookie': `sid=${sessionCache.sessionId}` },
    redirect: 'follow'
  });
  
  const homeHtml = await homeRes.text();
  const match = homeHtml.match(/village=(\d+)/);
  
  if (match) {
    sessionCache.villageId = match[1];
  }
  
  // 8. Pobierz szybkość serwera
  await fetchServerSpeed();
  
  sessionCache.expiresAt = Date.now() + 25 * 60 * 1000;
  
  console.log(`[SCRAPER] ✅ Zalogowano (village=${sessionCache.villageId}, speed=${sessionCache.serverSpeed})`);
  return true;
}

async function fetchServerSpeed() {
  try {
    const res = await fetch(`${process.env.KA_SERVER}/help.php?m=worldinfo`, {
      headers: { 'Cookie': `sid=${sessionCache.sessionId}` }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    
    $('table.borderlist tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const label = $(cells[0]).text().toLowerCase();
        if (label.includes('szybko') || label.includes('prędko') || label.includes('speed')) {
          sessionCache.serverSpeed = parseFloat($(cells[1]).text().replace(',', '.')) || 1;
        }
      }
    });
  } catch (e) {
    console.error('[SCRAPER] Błąd szybkości:', e.message);
  }
}

function parseFlag(html) {
  const $ = cheerio.load(html);
  const attacks = [];
  
  const table = $('#kcs_attacks_table').length ? $('#kcs_attacks_table') : $('table.borderlist').last();
  
  table.find('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;
    
    const checkbox = $(cells[0]).find('input[type="checkbox"]');
    const tm = parseInt(checkbox.attr('tm'));
    if (!tm) return;
    
    const descCell = $(cells[1]);
    const unitImgs = descCell.find('img[src*="unit_"]');
    const units = [];
    let slowestUnit = 'farmer';
    let slowestSpeed = 0;
    
    unitImgs.each((_, img) => {
      const src = $(img).attr('src') || '';
      const match = src.match(/unit_(\w+)\.png/);
      if (match && UNIT_NAMES[match[1]]) {
        units.push({ type: match[1], name: UNIT_NAMES[match[1]] });
        const speed = UNIT_SPEED[match[1]] || 0;
        if (speed > slowestSpeed) {
          slowestSpeed = speed;
          slowestUnit = match[1];
        }
      }
    });
    
    const targetCell = $(cells[2]);
    const targetPlayer = targetCell.find('a[href*="info_player"]').first().text().trim();
    const targetCoordsMatch = targetCell.html().match(/x=(\d+)[^y]*y=(\d+)/);
    const targetCoords = targetCoordsMatch ? `${targetCoordsMatch[1]}|${targetCoordsMatch[2]}` : '???';
    
    const sourceCell = $(cells[3]);
    const sourcePlayer = sourceCell.find('a[href*="info_player"]').first().text().trim();
    const sourceCoordsMatch = sourceCell.html().match(/x=(\d+)[^y]*y=(\d+)/);
    const sourceCoords = sourceCoordsMatch ? `${sourceCoordsMatch[1]}|${sourceCoordsMatch[2]}` : '???';
    const sourceAlly = sourceCell.find('a[href*="info_ally"]').first().text().trim();
    
    let returnDate = null;
    if (targetCoords !== '???' && sourceCoords !== '???' && units.length > 0) {
      const [tx, ty] = targetCoords.split('|').map(Number);
      const [sx, sy] = sourceCoords.split('|').map(Number);
      const dist = Math.sqrt((sx - tx) ** 2 + (sy - ty) ** 2);
      if (dist > 0) {
        const travelSec = (dist * slowestSpeed / sessionCache.serverSpeed) * 60;
        returnDate = new Date(tm + travelSec * 1000).toLocaleString('pl-PL');
      }
    }
    
    attacks.push({
      id: String(tm),
      units,
      slowestUnit,
      targetPlayer,
      targetCoords,
      sourcePlayer,
      sourceCoords,
      sourceAlly,
      arrivalDate: new Date(tm).toLocaleString('pl-PL'),
      returnDate,
      arrivalMs: tm,
      hasSnob: units.some(u => u.type === 'snob')
    });
  });
  
  return attacks;
}

async function fetchFlag() {
  if (!sessionCache.sessionId || !sessionCache.villageId || Date.now() > sessionCache.expiresAt) {
    await login();
  }
  
  const url = `${process.env.KA_SERVER}/game.php?village=${sessionCache.villageId}&s=ally&m=attacks`;
  const res = await fetch(url, {
    headers: { 'Cookie': `sid=${sessionCache.sessionId}` }
  });
  
  if (res.status === 401 || res.status === 302) {
    console.log('[SCRAPER] Sesja wygasła - ponowne logowanie');
    sessionCache.sessionId = null;
    await login();
    return [];
  }
  
  const html = await res.text();
  return parseFlag(html);
}

module.exports = async (req, res) => {
  try {
    const attacks = await fetchFlag();
    
    pusher.trigger('flaga-channel', 'update', {
      attacks,
      lastUpdate: new Date().toISOString()
    });
    
    res.status(200).json({
      ok: true,
      count: attacks.length,
      lastUpdate: new Date().toISOString()
    });
  } catch (e) {
    console.error('[SCRAPER] Błąd:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
