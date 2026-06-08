import { Client } from '@notionhq/client';

export function createClient(token) {
  return new Client({ auth: token });
}

export async function getDatabaseSchema(client, databaseId) {
  const db = await client.databases.retrieve({ database_id: databaseId });
  return {
    title: db.title?.[0]?.plain_text ?? '(untitled)',
    properties: Object.entries(db.properties).map(([name, prop]) => ({
      name,
      type: prop.type,
      id: prop.id,
    })),
  };
}

export async function getAllAccounts(client, databaseId) {
  const pages = [];
  let cursor;
  do {
    const res = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

export function extractText(property) {
  if (!property) return '';
  switch (property.type) {
    case 'title':
      return property.title?.map(t => t.plain_text).join('') ?? '';
    case 'rich_text':
      return property.rich_text?.map(t => t.plain_text).join('') ?? '';
    case 'url':
      return property.url ?? '';
    case 'email':
      return property.email ?? '';
    case 'phone_number':
      return property.phone_number ?? '';
    case 'select':
      return property.select?.name ?? '';
    case 'multi_select':
      return property.multi_select?.map(s => s.name).join(', ') ?? '';
    default:
      return '';
  }
}

export async function createSchedulePage(client, parentPageId, title, blocks) {
  const parent = parentPageId
    ? { type: 'page_id', page_id: parentPageId }
    : null;

  if (!parent) {
    throw new Error(
      'NOTION_SCHEDULES_PARENT_PAGE_ID is required to create schedule pages. ' +
      'Set it in your .env to a Notion page ID that the integration has access to.'
    );
  }

  const page = await client.pages.create({
    parent,
    properties: {
      title: {
        title: [{ type: 'text', text: { content: title } }],
      },
    },
    children: blocks,
  });

  return page.url;
}
