const SITE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://propeller.absmach.eu";
const KEY = process.env.INDEXNOW_KEY;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

if (!KEY) {
  console.error("INDEXNOW_KEY env var is not set — skipping submission.");
  process.exit(0);
}

async function fetchSitemapUrls() {
  const res = await fetch(`${SITE_URL}/sitemap.xml`);
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`);
  const xml = await res.text();
  const matches = xml.matchAll(/<loc>(.*?)<\/loc>/g);
  return [...matches].map((m) => m[1]);
}

async function submit(urls) {
  const body = {
    host: new URL(SITE_URL).hostname,
    key: KEY,
    keyLocation: `${SITE_URL}/${KEY}.txt`,
    urlList: urls,
  };

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  if (res.ok || res.status === 202) {
    console.log(
      `IndexNow: submitted ${urls.length} URLs (status ${res.status})`,
    );
  } else {
    const text = await res.text();
    console.error(`IndexNow: submission failed (${res.status}): ${text}`);
    process.exit(1);
  }
}

const urls = await fetchSitemapUrls();
if (urls.length === 0) {
  console.log("IndexNow: no URLs found in sitemap — skipping.");
  process.exit(0);
}

await submit(urls);
