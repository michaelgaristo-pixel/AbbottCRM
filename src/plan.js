/**
 * Usage:
 *   node src/plan.js --start "123 Main St, Chicago, IL"
 *   node src/plan.js --start "123 Main St, Chicago, IL" --filter "status=Active"
 *
 * After running `npm run inspect`, set ADDRESS_PROPERTY and NAME_PROPERTY below
 * to match the exact property names in your Notion database.
 */

import 'dotenv/config';
import { createClient, getAllAccounts, extractText, createSchedulePage } from './notion.js';
import { geocodeAddress, geocodeAll } from './geocode.js';
import { optimizeRoute, buildGoogleMapsUrl } from './route.js';

// ─── CONFIGURE THESE AFTER RUNNING `npm run inspect` ───────────────────────
const NAME_PROPERTY    = 'Name';       // Property that holds the account/company name
const ADDRESS_PROPERTY = 'Address';    // Property that holds the full street address
// ────────────────────────────────────────────────────────────────────────────

const token          = process.env.NOTION_TOKEN;
const dbId           = process.env.NOTION_DATABASE_ID;
const parentPageId   = process.env.NOTION_SCHEDULES_PARENT_PAGE_ID;

if (!token || !dbId) {
  console.error('Missing NOTION_TOKEN or NOTION_DATABASE_ID in .env');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const startIdx = args.indexOf('--start');
if (startIdx === -1 || !args[startIdx + 1]) {
  console.error('Usage: node src/plan.js --start "<your starting address>"');
  process.exit(1);
}
const startAddress = args[startIdx + 1];

const filterArg = args.indexOf('--filter');
let filterKey, filterValue;
if (filterArg !== -1 && args[filterArg + 1]) {
  [filterKey, filterValue] = args[filterArg + 1].split('=');
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

const client = createClient(token);

console.log(`\nAbbott CRM — Route Planner`);
console.log(`═══════════════════════════════════════`);
console.log(`Starting from: ${startAddress}\n`);

// 1. Fetch accounts
process.stdout.write('Fetching accounts from Notion… ');
const pages = await getAllAccounts(client, dbId);
console.log(`${pages.length} found`);

// 2. Extract name + address
let accounts = pages.map(page => ({
  id: page.id,
  url: page.url,
  name: extractText(page.properties[NAME_PROPERTY]) || '(unnamed)',
  address: extractText(page.properties[ADDRESS_PROPERTY]),
})).filter(a => a.address.trim());

// Optional filter
if (filterKey) {
  accounts = accounts.filter(a => {
    const val = extractText(pages.find(p => p.id === a.id)?.properties[filterKey]);
    return val?.toLowerCase().includes(filterValue.toLowerCase());
  });
  console.log(`Filtered to ${accounts.length} accounts where ${filterKey}=${filterValue}`);
}

if (!accounts.length) {
  console.error(`No accounts with an address found. Check that ADDRESS_PROPERTY="${ADDRESS_PROPERTY}" is correct.`);
  process.exit(1);
}

console.log(`Accounts with addresses: ${accounts.length}`);

// 3. Geocode starting address
process.stdout.write('\nGeocoding starting address… ');
const startCoords = await geocodeAddress(startAddress);
if (!startCoords) {
  console.error(`Could not geocode starting address: "${startAddress}"`);
  process.exit(1);
}
console.log('OK');

// 4. Geocode all accounts
console.log(`Geocoding ${accounts.length} account addresses (1/sec — Nominatim rate limit)…`);
const geocoded = await geocodeAll(accounts);
const routable = geocoded.filter(a => a.coords);
const skipped  = geocoded.filter(a => !a.coords);

if (skipped.length) {
  console.log(`\nSkipped (could not geocode): ${skipped.map(a => a.name).join(', ')}`);
}

if (!routable.length) {
  console.error('No accounts could be geocoded.');
  process.exit(1);
}

// 5. Optimize route
console.log(`\nOptimizing route for ${routable.length} stops…`);
const ordered = optimizeRoute(startCoords, routable);

// 6. Print results
console.log(`\n─── Optimized Route ────────────────────`);
console.log(`  0. [START] ${startAddress}`);
ordered.forEach((stop, i) => {
  console.log(`  ${i + 1}. ${stop.name}`);
  console.log(`     ${stop.address}`);
});
console.log(`────────────────────────────────────────`);

const mapsUrl = buildGoogleMapsUrl(startAddress, ordered);
console.log(`\nGoogle Maps (${ordered.length} stops):`);
console.log(mapsUrl);

// 7. Write schedule to Notion
if (!parentPageId) {
  console.log('\nSkipping Notion schedule page — set NOTION_SCHEDULES_PARENT_PAGE_ID in .env to enable.');
} else {
  process.stdout.write('\nCreating Notion schedule page… ');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const pageTitle = `Route Plan — ${today}`;

  const blocks = [
    heading2('Route Details'),
    paragraph(`Starting from: ${startAddress}`),
    paragraph(`Total stops: ${ordered.length}`),
    divider(),
    heading2('Stop Order'),
    ...ordered.flatMap((stop, i) => [
      {
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [bold(`${stop.name}`)],
        },
      },
      {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [text(stop.address)],
        },
      },
    ]),
    divider(),
    heading2('Google Maps Link'),
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Open route in Google Maps', link: { url: mapsUrl } },
          },
        ],
      },
    },
  ];

  if (skipped.length) {
    blocks.push(divider(), heading2('Skipped (no address)'));
    blocks.push(...skipped.map(a => paragraph(`• ${a.name}`)));
  }

  try {
    const pageUrl = await createSchedulePage(client, parentPageId, pageTitle, blocks);
    console.log('Done');
    console.log(`Notion page: ${pageUrl}`);
  } catch (err) {
    console.error(`Failed: ${err.message}`);
  }
}

// ─── Block helpers ───────────────────────────────────────────────────────────

function heading2(content) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [text(content)] },
  };
}

function paragraph(content) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [text(content)] },
  };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function text(content) {
  return { type: 'text', text: { content } };
}

function bold(content) {
  return { type: 'text', text: { content }, annotations: { bold: true } };
}
