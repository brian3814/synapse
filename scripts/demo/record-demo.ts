import { chromium, type Page, type Browser } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs/videos');
const DEBUG_PORT = 9222;

let stepNum = 0;

async function screenshot(page: Page, name: string) {
  stepNum++;
  const filename = `frame-${String(stepNum).padStart(2, '0')}-${name}.png`;
  const filepath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`  📸 ${filename}`);
  return filepath;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Click a button by invoking its React onClick handler via the fiber tree.
// This bypasses CDP click issues with Electron's app:// protocol.
async function reactClick(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) {
      (el as HTMLElement).click();
      return true;
    }
    let fiber = (el as any)[fiberKey];
    while (fiber) {
      if (fiber.memoizedProps?.onClick) {
        fiber.memoizedProps.onClick();
        return true;
      }
      fiber = fiber.return;
    }
    (el as HTMLElement).click();
    return true;
  }, selector);
}

function framesToMp4(outPath: string, frameDuration: number = 2) {
  const pngs = fs.readdirSync(OUT_DIR)
    .filter(f => f.startsWith('frame-') && f.endsWith('.png'))
    .sort()
    .map(f => path.join(OUT_DIR, f));

  if (pngs.length === 0) {
    console.error('No frames captured!');
    return;
  }

  const concatFile = path.join(OUT_DIR, 'frames.txt');
  const concatContent = pngs
    .map(p => `file '${p}'\nduration ${frameDuration}`)
    .join('\n') + `\nfile '${pngs[pngs.length - 1]}'`;
  fs.writeFileSync(concatFile, concatContent);

  try {
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatFile}" ` +
      `-vf "scale=1280:-2:flags=lanczos" ` +
      `-c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p ` +
      `"${outPath}"`,
      { stdio: 'inherit' },
    );
    console.log(`\n✅ Video saved to: ${outPath}`);
  } catch (e) {
    console.error('ffmpeg failed:', e);
  } finally {
    fs.unlinkSync(concatFile);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Clean previous frames
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.startsWith('frame-') && f.endsWith('.png')) {
      fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }

  // ── Launch Electron ──
  console.log('Launching Synapse with CDP...');
  const electronBin = path.join(PROJECT_ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const child = spawn(electronBin, [PROJECT_ROOT, `--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: 'pipe',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });

  child.stderr?.on('data', (d: Buffer) => {
    const line = d.toString();
    if (line.includes('DevTools listening')) console.log('  CDP ready');
  });

  await sleep(6000);

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  } catch {
    await sleep(4000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  }

  const page = browser.contexts()[0].pages().find(p => p.url().includes('app://')) || browser.contexts()[0].pages()[0];
  console.log(`Connected to: ${page.url()}`);
  await sleep(3000);

  try {
    // ── Open vault ──
    if (await page.locator('h2:has-text("Recent Vaults")').count() > 0) {
      console.log('Opening vault...');
      await page.locator('h2:has-text("Recent Vaults") + div button').first().click();
      await sleep(6000);
    }

    // ── 1. Graph overview ──
    console.log('1. Graph overview');
    await reactClick(page, 'button[title="Graph"]');
    await sleep(2000);
    try { await page.waitForSelector('canvas', { timeout: 5000 }); } catch {}
    await sleep(1500);
    await screenshot(page, 'graph-overview');

    // ── 2. Click a node ──
    console.log('2. Select node');
    const canvas = await page.$('canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.35);
        await sleep(2000);
        await screenshot(page, 'node-selected');
      }
    }

    // ── 3. Extract tab ──
    console.log('3. Extract tab');
    const extractClicked = await reactClick(page, 'button[title="Extract"]');
    console.log(`   reactClick result: ${extractClicked}`);
    await sleep(2500);
    await screenshot(page, 'extract-tab');

    // Check if URL input appeared
    const urlCount = await page.locator('input[type="url"]').count();
    console.log(`   URL inputs: ${urlCount}`);
    if (urlCount > 0) {
      await page.locator('input[type="url"]').fill('https://example.com/article');
      await sleep(500);
      await screenshot(page, 'extract-url');
    }

    // ── 4. Chat sidebar ──
    console.log('4. Chat');
    await reactClick(page, 'button[title="Chat History"]');
    await sleep(2000);
    await screenshot(page, 'chat-sidebar');

    // ── 5. Intelligence ──
    console.log('5. Intelligence');
    await reactClick(page, 'button[title="Intelligence"]');
    await sleep(2000);
    await screenshot(page, 'intelligence');

    // ── 6. Settings → MCP ──
    console.log('6. Settings');
    // Settings gear: find button inside header by SVG path content
    const settingsOpened = await page.evaluate(() => {
      const btns = document.querySelectorAll('header button');
      for (const btn of btns) {
        const pathEl = btn.querySelector('svg path');
        if (pathEl?.getAttribute('d')?.includes('12.22')) {
          const key = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
          if (key) {
            let fiber = (btn as any)[key];
            while (fiber) {
              if (fiber.memoizedProps?.onClick) {
                fiber.memoizedProps.onClick();
                return true;
              }
              fiber = fiber.return;
            }
          }
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    console.log(`   Settings opened: ${settingsOpened}`);
    await sleep(1500);
    await screenshot(page, 'settings-general');

    // Click MCP tab
    const mcpTab = page.locator('nav button:has-text("MCP")');
    if (await mcpTab.count() > 0) {
      await mcpTab.click();
      await sleep(1500);
      await screenshot(page, 'settings-mcp');
    }

    // Close settings
    await page.keyboard.press('Escape');
    await sleep(500);

    // ── 7. Back to graph ──
    console.log('7. Final graph');
    await reactClick(page, 'button[title="Graph"]');
    await sleep(2000);
    await screenshot(page, 'graph-final');

  } finally {
    console.log('\nClosing app...');
    browser.close();
    child.kill();
  }

  // ── Generate MP4 ──
  console.log('\nGenerating MP4...');
  framesToMp4(path.join(OUT_DIR, 'synapse-demo.mp4'), 2.5);

  // Clean up frames
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.startsWith('frame-') && f.endsWith('.png')) {
      fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }
}

main().catch((e) => {
  console.error('Recording failed:', e);
  process.exit(1);
});
