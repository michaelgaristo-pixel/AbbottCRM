// Uses Nominatim (OpenStreetMap) — free, no API key required.
// Rate limit: 1 request/second. We respect this with a small delay.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function geocodeAddress(address) {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
  });

  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      'User-Agent': 'AbbottCRM-RoutePlanner/1.0',
    },
  });

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const results = await res.json();
  if (!results.length) return null;

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}

export async function geocodeAll(accounts) {
  const out = [];
  for (const account of accounts) {
    if (!account.address) {
      out.push({ ...account, coords: null });
      continue;
    }
    try {
      const coords = await geocodeAddress(account.address);
      out.push({ ...account, coords });
    } catch (err) {
      console.error(`  ✗ Failed to geocode "${account.address}": ${err.message}`);
      out.push({ ...account, coords: null });
    }
    await sleep(DELAY_MS);
  }
  return out;
}
