/**
 * Run: npm run inspect
 * Prints the schema of your Notion accounts database so you can identify
 * which property names hold the address/location data, then configure plan.js.
 */

import 'dotenv/config';
import { createClient, getDatabaseSchema, getAllAccounts, extractText } from './notion.js';

const token = process.env.NOTION_TOKEN;
const dbId = process.env.NOTION_DATABASE_ID;

if (!token || !dbId) {
  console.error('Missing NOTION_TOKEN or NOTION_DATABASE_ID in .env');
  process.exit(1);
}

const client = createClient(token);

console.log('Fetching database schema…\n');
const schema = await getDatabaseSchema(client, dbId);

console.log(`Database: "${schema.title}"`);
console.log('\nProperties:');
for (const prop of schema.properties) {
  console.log(`  ${prop.name.padEnd(30)} [${prop.type}]`);
}

console.log('\nFetching first 3 accounts as sample…\n');
const pages = await getAllAccounts(client, dbId);
const sample = pages.slice(0, 3);

for (const page of sample) {
  console.log('---');
  for (const prop of schema.properties) {
    const val = extractText(page.properties[prop.name]);
    if (val) console.log(`  ${prop.name}: ${val}`);
  }
}

console.log(`\nTotal accounts: ${pages.length}`);
console.log('\nOnce you know which property holds the address, update ADDRESS_PROPERTY in src/plan.js');
