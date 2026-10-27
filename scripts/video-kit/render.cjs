// Renders a scene (scene.html) to frames at 30 fps, one screenshot per frame, by seeking its
// animations. Writes <scene dir>/frames/*.jpg and starts.json (when each line starts).
//
//   node scripts/video-kit/render.cjs <scene dir>
//
// The scene reads window.DURS (from durs.txt, made by voice.py) and exposes window.TOTAL,
// window.STARTS and window.seek(t). Needs Playwright with Chromium.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const dir = path.resolve(process.argv[2] || ".");
const durs = fs.readFileSync(path.join(dir, "durs.txt"), "utf8").trim().split(/\s+/).map(Number);
const FPS = 30;

(async () => {
  fs.rmSync(path.join(dir, "frames"), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  await page.addInitScript((d) => {
    window.DURS = d;
  }, durs);
  await page.goto("file://" + path.join(dir, "scene.html"));
  await page.waitForTimeout(800);
  const total = await page.evaluate(() => window.TOTAL);
  const frames = Math.ceil(total * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS);
    await page.screenshot({ path: path.join(dir, "frames", `f${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  }
  fs.writeFileSync(path.join(dir, "starts.json"), JSON.stringify(await page.evaluate(() => window.STARTS)));
  fs.writeFileSync(path.join(dir, "total.txt"), String(total));
  console.log(`${frames} frames, ${total.toFixed(2)}s`);
  await browser.close();
})();
