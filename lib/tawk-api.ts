const BASE_URL = "https://api.tawk.to/v1";

function getHeaders(): Record<string, string> {
  const apiKey = process.env.TAWK_API_KEY;
  if (!apiKey) throw new Error("TAWK_API_KEY not set");
  const encoded = Buffer.from(`${apiKey}:`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TawkItem {
  id?: string;
  createdOn?: string;
  [key: string]: unknown;
}

// Global queue to ensure only 1 API call runs at a time
let lastRequestTime = 0;
const MIN_GAP = 350; // ms between requests

async function throttledFetch(url: string, body: Record<string, unknown>): Promise<TawkItem[]> {
  // Enforce minimum gap between requests
  const now = Date.now();
  const wait = MIN_GAP - (now - lastRequestTime);
  if (wait > 0) await sleep(wait);
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const waitTime = 3000 * (attempt + 1);
      console.log(`Rate limited, retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
      lastRequestTime = Date.now();
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tawk API error ${res.status}: ${text}`);
    }

    const json = await res.json();
    return json.data || [];
  }

  throw new Error("Tawk API: max retries exceeded (rate limited)");
}

async function fetchAllPages(
  url: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  dateType: string,
  pageSize: number
): Promise<TawkItem[]> {
  const all: TawkItem[] = [];
  let page = 0;

  while (true) {
    const items = await throttledFetch(url, {
      propertyId,
      size: pageSize,
      page,
      startDate,
      endDate,
      deleted: false,
      sort: "co-new-old",
      dateType,
    });
    all.push(...items);

    if (items.length < pageSize) break;
    page++;
    if (page > 50) break;
  }

  return all;
}

function daysBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24);
}

async function fetchItems(
  url: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  pageSize: number
): Promise<TawkItem[]> {
  // For short ranges (≤7 days), single fetch is enough — items haven't had time to "move"
  // For longer ranges, do dual fetch (cso + cuo) to catch items updated after their creation date
  const shortRange = daysBetween(startDate, endDate) <= 7;

  const csoItems = await fetchAllPages(url, propertyId, startDate, endDate, "cso", pageSize);

  if (shortRange) return csoItems;

  // Dual fetch for longer ranges
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const cuoItems = await fetchAllPages(url, propertyId, startDate, nowIso, "cuo", pageSize);

  // Merge and deduplicate
  const seen = new Set<string>();
  const merged: TawkItem[] = [];
  for (const item of [...csoItems, ...cuoItems]) {
    const id = item.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      merged.push(item);
    }
  }

  // Filter to original date range
  const rangeStart = new Date(startDate).getTime();
  const rangeEnd = new Date(endDate).getTime();
  return merged.filter((item) => {
    if (!item.createdOn) return false;
    const created = new Date(item.createdOn).getTime();
    return created >= rangeStart && created <= rangeEnd;
  });
}

export async function getChats(propertyId: string, startDate: string, endDate: string, pageSize = 200) {
  return fetchItems(`${BASE_URL}/chat.list`, propertyId, startDate, endDate, pageSize);
}

export async function getTickets(propertyId: string, startDate: string, endDate: string, pageSize = 200) {
  return fetchItems(`${BASE_URL}/ticket.list`, propertyId, startDate, endDate, pageSize);
}
