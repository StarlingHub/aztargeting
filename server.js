const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { chromium } = require("playwright");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const PORT = 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let browser = null;
let page = null;
let running = false;
let currentIndex = -1;
let taskList = []; // Array of { keyword, targetTitle }

function parseInputData(rows) {
  // rows can come from Excel or text box.
  // Each item should have keyword and targetTitle
  return rows.map(r => ({
    keyword: String(r.keyword || r[0] || "").trim(),
    targetTitle: String(r.targetTitle || r[1] || "").trim()
  })).filter(item => item.keyword.length > 0);
}

app.post("/api/keywords", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please select an Excel file." });
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    
    let parsed = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const col0 = String(r[0] || "").trim();
      const col1 = String(r[1] || "").trim();
      if (!col0) continue;
      // Skip header row if matches keyword/search term
      if (i === 0 && /^(keyword|keywords|search term|query)$/i.test(col0)) continue;
      parsed.push({ keyword: col0, targetTitle: col1 });
    }
    res.json({ tasks: parsed });
  } catch (e) {
    res.status(400).json({ error: "Could not read that spreadsheet. Please use .xlsx or .xls." });
  }
});

app.post("/api/start", async (req, res) => {
  try {
    const incoming = req.body.tasks || [];
    if (!incoming.length) return res.status(400).json({ error: "Add at least one keyword and target listing." });

    if (browser) {
      await browser.close().catch(() => {});
      browser = null; page = null;
    }
    taskList = incoming;
    currentIndex = -1;
    running = true;

    try {
      browser = await chromium.launch({ channel: "chrome", headless: false });
    } catch (_) {
      browser = await chromium.launch({ headless: false });
    }
    page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    await page.goto("https://www.amazon.in", { waitUntil: "domcontentloaded", timeout: 60000 });
    res.json({ ok: true, total: taskList.length, message: "Browser launched. Ready to start automated workflow." });
  } catch (e) {
    running = false;
    res.status(500).json({ error: "Could not launch browser. " + e.message });
  }
});

app.post("/api/next", async (req, res) => {
  try {
    if (!running || !page) return res.status(400).json({ error: "Session not active." });
    currentIndex++;
    if (currentIndex >= taskList.length) {
      running = false;
      return res.json({ done: true, index: currentIndex, total: taskList.length, message: "All tasks completed successfully." });
    }

    const task = taskList[currentIndex];
    const keyword = task.keyword;
    const targetTitle = task.targetTitle;

    // 1. Go to Amazon search
    const searchUrl = "https://www.amazon.in/s?k=" + encodeURIComponent(keyword);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);

    let openedListingTitle = null;

    if (targetTitle) {
      // Find product card whose title starts with or matches targetTitle prefix
      // Amazon product titles are usually inside h2 a span or span.a-size-base-plus
      openedListingTitle = await page.evaluate((prefix) => {
        const items = document.querySelectorAll('div.s-result-item[data-asin]:not([data-asin=""])');
        for (const item of items) {
          const titleEl = item.querySelector('h2 a span, span.a-size-medium, span.a-size-base-plus');
          if (titleEl) {
            const fullTitle = titleEl.textContent.trim();
            if (fullTitle.toLowerCase().startsWith(prefix.toLowerCase()) || fullTitle.toLowerCase().includes(prefix.toLowerCase())) {
              const link = item.querySelector('h2 a, a.a-link-normal.s-no-outline');
              if (link) {
                link.click();
                return fullTitle;
              }
            }
          }
        }
        // Fallback: search all links
        const links = document.querySelectorAll('a.a-link-normal');
        for (const l of links) {
          const t = l.textContent.trim();
          if (t && (t.toLowerCase().startsWith(prefix.toLowerCase()) || t.toLowerCase().includes(prefix.toLowerCase()))) {
            l.click();
            return t;
          }
        }
        return null;
      }, targetTitle);
    }

    if (!openedListingTitle) {
      // If no target title specified or not found, click the first organic search result item
      openedListingTitle = await page.evaluate(() => {
        const firstItem = document.querySelector('div.s-result-item[data-asin]:not([data-asin=""]) h2 a, div.s-result-item[data-asin]:not([data-asin=""]) a.a-link-normal');
        if (firstItem) {
          const titleText = firstItem.textContent.trim();
          firstItem.click();
          return titleText || "First Result";
        }
        return null;
      });
    }

    if (openedListingTitle) {
      // Wait for product page to load
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Perform smooth scrolling simulation for 20 seconds
      // Scroll down and up slowly
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const distance = 400;
        const totalHeight = document.body.scrollHeight;
        let currentScroll = 0;
        
        // Scroll down smoothly
        while (currentScroll < Math.min(totalHeight, 1500)) {
          window.scrollBy({ top: distance, behavior: 'smooth' });
          currentScroll += distance;
          await sleep(1500);
        }
        // Scroll back up a bit
        window.scrollTo({ top: 300, behavior: 'smooth' });
        await sleep(1000);
      });

      // Ensure total dwell time is at least 20 seconds on the listing page
      await page.waitForTimeout(15000);
    }

    res.json({
      ok: true,
      keyword,
      targetTitle: targetTitle || "(First result)",
      openedListing: openedListingTitle || "None opened",
      index: currentIndex + 1,
      total: taskList.length
    });

  } catch (e) {
    res.status(500).json({ error: "Step failed: " + e.message });
  }
});

app.post("/api/stop", async (_req, res) => {
  running = false;
  if (browser) await browser.close().catch(() => {});
  browser = null; page = null;
  res.json({ ok: true, message: "Session stopped." });
});

app.get("/api/status", (_req, res) => {
  res.json({ running, index: currentIndex, total: taskList.length });
});

app.listen(PORT, () => console.log(`Amazon Keyword Assistant v2 running at http://localhost:${PORT}`));
