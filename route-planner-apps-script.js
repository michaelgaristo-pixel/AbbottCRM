// ═══════════════════════════════════════════════════════════════
//  Abbott CRM — Route Planner  (Google Apps Script)
//
//  Setup:
//  1. Go to https://script.google.com and create a new project
//  2. Paste this entire file, replacing any existing code
//  3. Fill in your NOTION_TOKEN and NOTION_DATABASE_ID below
//  4. Fill in your ADDRESS_PROPERTY (run inspectDatabase() first if unsure)
//  5. Click Run → planRoute
//  6. Check the Google Sheet that opens automatically
// ═══════════════════════════════════════════════════════════════

// ─── CONFIG — fill these in ─────────────────────────────────────
const NOTION_TOKEN       = 'ntn_t74094359806jX5Nm1fO3e7V9Cf1e3u5yJkiC8wJU7b6iW';
const NOTION_DATABASE_ID = '3731b9a3054c808b9e66dfc877ddf5ce';
const NAME_PROPERTY      = 'Name';     // property that holds the company/account name
const ADDRESS_PROPERTY   = 'Address'; // property that holds the address — run inspectDatabase() to find it
// ────────────────────────────────────────────────────────────────

// ── Run this first to see all your property names ────────────────
function inspectDatabase() {
  const db = notionGet(`/databases/${NOTION_DATABASE_ID}`);
  const lines = [`Database: "${db.title?.[0]?.plain_text}"\n\nProperties:`];
  for (const [name, prop] of Object.entries(db.properties)) {
    lines.push(`  ${name}  [${prop.type}]`);
  }

  // Show first 3 accounts as sample
  const pages = queryAll();
  lines.push('\n--- Sample accounts ---');
  for (const page of pages.slice(0, 3)) {
    lines.push('');
    for (const [name, prop] of Object.entries(page.properties)) {
      const val = extractText(prop);
      if (val) lines.push(`  ${name}: ${val}`);
    }
  }

  Logger.log(lines.join('\n'));
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

// ── Main: plan the route ─────────────────────────────────────────
function planRoute() {
  const ui = SpreadsheetApp.getUi();
  const startResp = ui.prompt('Starting Address', 'Enter the address you are leaving from today:', ui.ButtonSet.OK_CANCEL);
  if (startResp.getSelectedButton() !== ui.Button.OK) return;
  const startAddress = startResp.getResponseText().trim();
  if (!startAddress) { ui.alert('No starting address entered.'); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('Abbott CRM Route Plans');
  const sheetName = `Route ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')}`;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) sheet.clear(); else sheet = ss.insertSheet(sheetName);

  sheet.appendRow(['Abbott CRM — Route Plan']);
  sheet.appendRow([`Date: ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy')}`]);
  sheet.appendRow([`Starting from: ${startAddress}`]);
  sheet.appendRow([]);
  sheet.appendRow(['Stop #', 'Account Name', 'Address', 'Notion Page']);

  // 1. Fetch accounts
  Logger.log('Fetching accounts…');
  const pages = queryAll();
  const accounts = pages.map(p => ({
    name: extractText(p.properties[NAME_PROPERTY]) || '(unnamed)',
    address: extractText(p.properties[ADDRESS_PROPERTY]),
    url: `https://www.notion.so/${p.id.replace(/-/g, '')}`,
  })).filter(a => a.address.trim());

  if (!accounts.length) {
    ui.alert(`No accounts found with the "${ADDRESS_PROPERTY}" property filled in.\n\nRun inspectDatabase() first to find the correct property name, then update ADDRESS_PROPERTY in the script.`);
    return;
  }
  Logger.log(`Found ${accounts.length} accounts with addresses`);

  // 2. Geocode start
  Logger.log('Geocoding starting address…');
  const startCoords = geocode(startAddress);
  if (!startCoords) { ui.alert(`Could not find starting address: "${startAddress}"`); return; }

  // 3. Geocode accounts
  const geocoded = [];
  const skipped = [];
  for (const acc of accounts) {
    Logger.log(`Geocoding: ${acc.name}`);
    const coords = geocode(acc.address);
    if (coords) geocoded.push({ ...acc, coords });
    else skipped.push(acc);
    Utilities.sleep(1100); // Nominatim rate limit
  }

  if (!geocoded.length) { ui.alert('Could not geocode any addresses.'); return; }

  // 4. Optimize
  Logger.log('Optimizing route…');
  const ordered = twoOpt(nearestNeighbor({ coords: startCoords }, geocoded));

  // 5. Write to sheet
  ordered.forEach((stop, i) => {
    sheet.appendRow([i + 1, stop.name, stop.address, stop.url]);
  });

  if (skipped.length) {
    sheet.appendRow([]);
    sheet.appendRow(['SKIPPED (no address found):']);
    skipped.forEach(s => sheet.appendRow(['', s.name, s.address]));
  }

  sheet.appendRow([]);
  const mapsUrl = buildMapsUrl(startAddress, ordered);
  sheet.appendRow(['Google Maps Link:', mapsUrl]);

  // Format
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(5, 1, 1, 4).setFontWeight('bold').setBackground('#e8f0fe');
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 300);
  sheet.autoResizeColumn(2);

  // Activate
  ss.setActiveSheet(sheet);
  SpreadsheetApp.flush();

  ui.alert(`Done! ${ordered.length} stops planned.\n\nCheck the "${sheetName}" tab.\nGoogle Maps link is at the bottom of the sheet.`);
}

// ─── Notion helpers ──────────────────────────────────────────────
function notionGet(path) {
  const res = UrlFetchApp.fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
    },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.message || `Notion error ${res.getResponseCode()}`);
  return data;
}

function notionPost(path, body) {
  const res = UrlFetchApp.fetch(`https://api.notion.com/v1${path}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
    },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.message || `Notion error ${res.getResponseCode()}`);
  return data;
}

function queryAll() {
  const pages = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = notionPost(`/databases/${NOTION_DATABASE_ID}/query`, body);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return pages;
}

function extractText(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return (prop.title || []).map(t => t.plain_text).join('');
    case 'rich_text':    return (prop.rich_text || []).map(t => t.plain_text).join('');
    case 'url':          return prop.url || '';
    case 'email':        return prop.email || '';
    case 'phone_number': return prop.phone_number || '';
    case 'select':       return prop.select ? prop.select.name : '';
    case 'multi_select': return (prop.multi_select || []).map(s => s.name).join(', ');
    default:             return '';
  }
}

// ─── Geocoding (Nominatim) ───────────────────────────────────────
function geocode(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': 'AbbottCRM-RoutePlanner/1.0' },
      muteHttpExceptions: true,
    });
    const data = JSON.parse(res.getContentText());
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch(e) {
    return null;
  }
}

// ─── Routing ────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.pow(Math.sin(dLat/2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng/2), 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDist(route) {
  let d = 0;
  for (let i = 0; i < route.length - 1; i++) d += haversine(route[i].coords, route[i+1].coords);
  return d;
}

function nearestNeighbor(start, stops) {
  const unvisited = stops.slice(), route = [];
  let cur = start;
  while (unvisited.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const d = haversine(cur.coords, unvisited[i].coords);
      if (d < bd) { bd = d; bi = i; }
    }
    cur = unvisited.splice(bi, 1)[0];
    route.push(cur);
  }
  return route;
}

function twoOpt(route) {
  let best = route, improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const next = best.slice(0, i+1).concat(best.slice(i+1, j+1).reverse()).concat(best.slice(j+1));
        if (totalDist(next) < totalDist(best)) { best = next; improved = true; }
      }
    }
  }
  return best;
}

function buildMapsUrl(start, stops) {
  const enc = s => encodeURIComponent(s);
  if (!stops.length) return '';
  if (stops.length === 1) return `https://www.google.com/maps/dir/${enc(start)}/${enc(stops[0].address)}`;
  const wps = stops.slice(0, -1).map(s => enc(s.address)).join('/');
  return `https://www.google.com/maps/dir/${enc(start)}/${wps}/${enc(stops[stops.length-1].address)}`;
}
