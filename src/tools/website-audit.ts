import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";

export const website_audit = {
  name: "website_audit",
  description: "Analyzes a website for lead qualification. Captures a screenshot and extracts key UX/UI metrics (CTAs, SEO, performance).",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL of the website to audit." },
      companyName: { type: "string", description: "Name of the company for labeling." }
    },
    required: ["url", "companyName"]
  } as const,
  execute: async ({ url, companyName }: { url: string; companyName: string }) => {
    let browser;
    try {
      browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      
      console.log(`🔍 Auditing website: ${url}`);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      // 1. Analyze CTAs and SEO
      const auditData = await page.evaluate(() => {
        const ctas = Array.from(document.querySelectorAll("button, a"))
          .filter(el => {
            const text = el.textContent?.toLowerCase() || "";
            return text.includes("book") || text.includes("demo") || text.includes("start") || text.includes("trial") || text.includes("sign up");
          })
          .map(el => ({ text: el.textContent?.trim(), type: el.tagName }));

        const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content");
        const h1 = document.querySelector("h1")?.textContent?.trim();
        
        // Grab top 1000 chars of body text for context
        const bodyText = document.body.innerText.slice(0, 1000);

        return {
          ctaCount: ctas.length,
          primaryCTA: ctas[0]?.text || "None found",
          metaDescription: metaDescription || "Missing",
          headline: h1 || "Missing",
          title: document.title,
          contentPreview: bodyText
        };
      });

      // 2. Capture Screenshot
      const filename = `${companyName.replace(/\s+/g, "_").toLowerCase()}_audit_${Date.now()}.png`;
      const screenshotPath = path.join(process.cwd(), "public", "audits", filename);
      await page.screenshot({ path: screenshotPath });

      await browser.close();

      return {
        success: true,
        report: {
          url,
          companyName,
          ...auditData,
          screenshotUrl: `/audits/${filename}`
        }
      };
    } catch (error: any) {
      if (browser) await browser.close();
      return { success: false, error: error.message };
    }
  }
};
