import { search, SafeSearchType } from "duck-duck-scrape";
import puppeteer from 'puppeteer';

export const definition = {
  name: "web_search",
  description: "Search the public internet for up-to-date information, news, or facts. Uses DDG with a robust Puppeteer fallback if blocked.",
  parameters: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "The search query to look up." },
      queries: { type: "array", items: { type: "string" }, description: "Alternative: a list of queries. If provided, the total context will be searched." }
    },
    required: []
  }
};

/**
 * Fallback to Google Search using Puppeteer if DuckDuckGo blocks the request.
 */
async function fallbackGoogleSearch(query: string): Promise<string> {
  console.log(`  🔍 [Fallback] Attempting Google Search via Puppeteer for: "${query}"`);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div.g'));
      return items.slice(0, 5).map(el => {
        const title = el.querySelector('h3')?.innerText || 'No Title';
        const link = el.querySelector('a')?.href || 'No Link';
        const snippet = (el.querySelector('div.VwiC3b') as HTMLElement)?.innerText || '';
        return `Title: ${title}\nURL: ${link}\nSnippet: ${snippet}`;
      }).join('\n\n');
    });

    return results || "Google Search returned no results.";
  } catch (err: any) {
    console.error(`  ❌ [Fallback] Google Search failed:`, err.message);
    return `Search failed on both DDG and Google. Error: ${err.message}`;
  } finally {
    if (browser) await browser.close();
  }
}

export async function handler(args: { query?: string; queries?: string[] }): Promise<string> {
  const query = args.query || (args.queries && args.queries.length > 0 ? args.queries[0] : "");
  
  if (!query) {
    return "Error: No search query provided.";
  }

  console.log(`  🌐 Searching web for: "${query}"`);
  
  try {
    const results = await search(query, {
      safeSearch: SafeSearchType.MODERATE
    });
    
    if (results.results && results.results.length > 0) {
      return results.results.slice(0, 5).map(r => 
        `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.description}`
      ).join("\n\n");
    }

    // If DDG returns empty, it might be blocking us or just no results
    return await fallbackGoogleSearch(query);

  } catch (err: any) {
    const msg = String(err.message || err);
    console.warn(`  ⚠️ DDG Search failed: ${msg}. Trying Google fallback...`);
    
    // Anomaly, rate limit, or technical error — try Puppeteer fallback
    if (msg.includes("anomaly") || msg.includes("quickly") || msg.includes("403") || msg.includes("Many Requests") || msg.includes("status 429")) {
      return await fallbackGoogleSearch(query);
    }

    return `Search completely failed: ${msg}`;
  }
}
