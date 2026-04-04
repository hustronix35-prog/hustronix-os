import puppeteer from 'puppeteer';

export const definition = {
  name: "browser_read",
  description: "Launch a headless Chromium browser to deeply extract visual textual content from any URL. Best used for scraping websites, reading news articles, or parsing pages that DuckDuckGo text snippets couldn't fully capture.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The valid HTTP/HTTPS URL to scrap"
      }
    },
    required: ["url"]
  }
};

export async function handler({ url }: { url: string }): Promise<string> {
  let browser = null;
  try {
    console.log(`\n🌐 [Browser] Launching Headless Chromium to read: ${url}`);
    
    // Launch headless browser
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Pretend to be a real browser to avoid blocks
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Go to URL and wait for DOM and network idle
    console.log(`🌐 [Browser] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    // Extract text from the page body
    console.log(`🌐 [Browser] Extracting text...`);
    const pageContent = await page.evaluate(() => {
      // Basic cleanup of script and style tags before extracting text
      const scripts = document.querySelectorAll('script, style, noscript, nav, footer, iframe');
      scripts.forEach(s => s.remove());
      return document.body.innerText || "";
    });

    console.log(`🌐 [Browser] Extracted ${pageContent.length} characters.`);
    
    // Sanitize the text (remove excessive newlines and whitespace)
    const cleanText = pageContent.replace(/\n{3,}/g, '\n\n').trim();

    return `--- BROWSER EXTRACTION: ${url} ---\n\n${cleanText}`;

  } catch (err: any) {
    console.error(`❌ [Browser] Failed:`, err);
    return `[System Error: Browser failed to read ${url}. Reason: ${err.message}]`;
  } finally {
    if (browser) {
      console.log(`🌐 [Browser] Closing.`);
      await browser.close();
    }
  }
}
