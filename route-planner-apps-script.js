// ═══════════════════════════════════════════════════════════════
//  Abbott CRM — Route Planner  (Google Apps Script)
//
//  HOW TO USE:
//  1. Paste this into script.google.com (replace all existing code)
//  2. Fill in the CONFIG section below
//  3. Run inspectDatabase first — check the Execution Log for property names
//  4. Set ADDRESS_PROPERTY to your address field name
//  5. Set START_ADDRESS to wherever you're leaving from today
//  6. Run planRoute — it creates a Google Sheet with your route
// ═══════════════════════════════════════════════════════════════

// ─── CONFIG — edit these values ────────────────────────────────
var NOTION_TOKEN       = 'ntn_t74094359806jX5Nm1fO3e7V9Cf1e3u5yJkiC8wJU7b6iW';
var NOTION_DATABASE_ID = '3731b9a3054c808b9e66dfc877ddf5ce';
var NAME_PROPERTY      = 'Name';     // name of the property with the account name
var ADDRESS_PROPERTY   = 'Address'; // ← change this after running inspectDatabase
var START_ADDRESS      = '123 Main St, Chicago, IL'; // ← change this every day before running
// ───────────────────────────────────────────────────────────────

// Run this first — look at the Execution Log (View → Logs) to see property names
function inspectDatabase() {
  var db = notionGet('/databases/' + NOTION_DATABASE_ID);
  var dbName = db.title && db.title[0] ? db.title[0].plain_text : '(untitled)';
  Logger.log('Database: "' + dbName + '"');
  Logger.log('\nAll properties:');
  var props = db.properties;
  for (var name in props) {
    Logger.log('  ' + name + '  [' + props[name].type + ']');
  }

  var pages = queryAll();
  Logger.log('\n--- First 3 accounts ---');
  for (var i = 0; i < Math.min(3, pages.length); i++) {
    Logger.log('');
    var pageProps = pages[i].properties;
    for (var pName in pageProps) {
      var val = extractText(pageProps[pName]);
      if (val) Logger.log('  ' + pName + ': ' + val);
    }
  }
  Logger.log('\nDone. Go to View → Logs to read the output.');
}

// Run this to plan your route — results go to a new Google Sheet in your Drive
function planRoute() {
  if (!START_ADDRESS || START_ADDRESS === '123 Main St, Chicago, IL') {
    Logger.log('ERROR: Please set START_ADDRESS at the top of the script before running.');
    throw new Error('Set START_ADDRESS at the top of the script first.');
  }

  Logger.log('Starting from: ' + START_ADDRESS);
  Logger.log('Fetching accounts from Notion…');

  var pages = queryAll();
  var accounts = [];
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    var name = extractText(p.properties[NAME_PROPERTY]) || '(unnamed)';
    var address = extractText(p.properties[ADDRESS_PROPERTY]);
    if (address && address.trim()) {
      accounts.push({
        name: name,
        address: address.trim(),
        url: 'https://www.notion.so/' + p.id.replace(/-/g, '')
      });
    }
  }

  Logger.log('Found ' + accounts.length + ' accounts with addresses.');

  if (!accounts.length) {
    Logger.log('ERROR: No accounts found with the "' + ADDRESS_PROPERTY + '" property filled in.');
    Logger.log('Run inspectDatabase() and check the Logs to find the correct property name.');
    throw new Error('No accounts found. Check ADDRESS_PROPERTY setting.');
  }

  // Geocode starting address
  Logger.log('Geocoding starting address…');
  var startCoords = geocode(START_ADDRESS);
  if (!startCoords) {
    throw new Error('Could not geocode starting address: ' + START_ADDRESS);
  }

  // Geocode all accounts
  var geocoded = [];
  var skipped = [];
  for (var j = 0; j < accounts.length; j++) {
    var acc = accounts[j];
    Logger.log('Geocoding ' + (j+1) + '/' + accounts.length + ': ' + acc.name);
    var coords = geocode(acc.address);
    if (coords) {
      geocoded.push({ name: acc.name, address: acc.address, url: acc.url, coords: coords });
    } else {
      skipped.push(acc);
      Logger.log('  Could not geocode — skipping');
    }
    Utilities.sleep(1100);
  }

  if (!geocoded.length) {
    throw new Error('Could not geocode any addresses.');
  }

  Logger.log('Optimizing route for ' + geocoded.length + ' stops…');
  var ordered = twoOpt(nearestNeighbor({ coords: startCoords }, geocoded));

  // Create Google Sheet
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var ss = SpreadsheetApp.create('Route Plan ' + dateStr);
  var sheet = ss.getActiveSheet();
  sheet.setName('Route');

  sheet.appendRow(['Abbott CRM — Route Plan']);
  sheet.appendRow(['Date: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy')]);
  sheet.appendRow(['Starting from: ' + START_ADDRESS]);
  sheet.appendRow([]);
  sheet.appendRow(['Stop #', 'Account Name', 'Address', 'Notion Page']);

  for (var k = 0; k < ordered.length; k++) {
    sheet.appendRow([k + 1, ordered[k].name, ordered[k].address, ordered[k].url]);
  }

  if (skipped.length) {
    sheet.appendRow([]);
    sheet.appendRow(['SKIPPED (could not find address):']);
    for (var s = 0; s < skipped.length; s++) {
      sheet.appendRow(['', skipped[s].name, skipped[s].address]);
    }
  }

  sheet.appendRow([]);
  var mapsUrl = buildMapsUrl(START_ADDRESS, ordered);
  sheet.appendRow(['Google Maps Link:', mapsUrl]);

  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(5, 1, 1, 4).setFontWeight('bold').setBackground('#e8f0fe');
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 320);

  var sheetUrl = ss.getUrl();
  Logger.log('Done! ' + ordered.length + ' stops.');
  Logger.log('Open your Google Sheet here: ' + sheetUrl);
}

// ─── Notion helpers ─────────────────────────────────────────────
function notionGet(path) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    headers: {
      'Authorization': 'Bearer ' + NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.message || 'Notion error ' + res.getResponseCode());
  return data;
}

function notionPost(path, body) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: {
      'Authorization': 'Bearer ' + NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.message || 'Notion error ' + res.getResponseCode());
  return data;
}

function queryAll() {
  var pages = [];
  var cursor = null;
  do {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var res = notionPost('/databases/' + NOTION_DATABASE_ID + '/query', body);
    pages = pages.concat(res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return pages;
}

function extractText(prop) {
  if (!prop) return '';
  if (prop.type === 'title')        return (prop.title || []).map(function(t) { return t.plain_text; }).join('');
  if (prop.type === 'rich_text')    return (prop.rich_text || []).map(function(t) { return t.plain_text; }).join('');
  if (prop.type === 'url')          return prop.url || '';
  if (prop.type === 'email')        return prop.email || '';
  if (prop.type === 'phone_number') return prop.phone_number || '';
  if (prop.type === 'select')       return prop.select ? prop.select.name : '';
  if (prop.type === 'multi_select') return (prop.multi_select || []).map(function(s) { return s.name; }).join(', ');
  return '';
}

// ─── Geocoding ──────────────────────────────────────────────────
function geocode(address) {
  try {
    var url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(address) + '&format=json&limit=1';
    var res = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': 'AbbottCRM-RoutePlanner/1.0' },
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch(e) {
    return null;
  }
}

// ─── Routing ────────────────────────────────────────────────────
function haversine(a, b) {
  var R = 6371;
  var dLat = (b.lat - a.lat) * Math.PI / 180;
  var dLng = (b.lng - a.lng) * Math.PI / 180;
  var h = Math.pow(Math.sin(dLat/2), 2) + Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) * Math.pow(Math.sin(dLng/2), 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDist(route) {
  var d = 0;
  for (var i = 0; i < route.length - 1; i++) d += haversine(route[i].coords, route[i+1].coords);
  return d;
}

function nearestNeighbor(start, stops) {
  var unvisited = stops.slice();
  var route = [];
  var cur = start;
  while (unvisited.length) {
    var bi = 0, bd = Infinity;
    for (var i = 0; i < unvisited.length; i++) {
      var d = haversine(cur.coords, unvisited[i].coords);
      if (d < bd) { bd = d; bi = i; }
    }
    cur = unvisited.splice(bi, 1)[0];
    route.push(cur);
  }
  return route;
}

function twoOpt(route) {
  var best = route;
  var improved = true;
  while (improved) {
    improved = false;
    for (var i = 0; i < best.length - 1; i++) {
      for (var j = i + 2; j < best.length; j++) {
        var next = best.slice(0, i+1).concat(best.slice(i+1, j+1).reverse()).concat(best.slice(j+1));
        if (totalDist(next) < totalDist(best)) { best = next; improved = true; }
      }
    }
  }
  return best;
}

function buildMapsUrl(start, stops) {
  if (!stops.length) return '';
  var enc = encodeURIComponent;
  if (stops.length === 1) return 'https://www.google.com/maps/dir/' + enc(start) + '/' + enc(stops[0].address);
  var wps = stops.slice(0, -1).map(function(s) { return enc(s.address); }).join('/');
  return 'https://www.google.com/maps/dir/' + enc(start) + '/' + wps + '/' + enc(stops[stops.length-1].address);
}
