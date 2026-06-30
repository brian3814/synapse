import { chromium, type Page } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs/images');
const DEBUG_PORT = 9222;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reactClick(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) { (el as HTMLElement).click(); return true; }
    let fiber = (el as any)[fiberKey];
    while (fiber) {
      if (fiber.memoizedProps?.onClick) { fiber.memoizedProps.onClick(); return true; }
      fiber = fiber.return;
    }
    (el as HTMLElement).click();
    return true;
  }, selector);
}

async function save(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function main() {
  console.log('Launching Synapse...');
  const electronBin = path.join(PROJECT_ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const child = spawn(electronBin, [PROJECT_ROOT, `--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: 'pipe',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  child.stderr?.on('data', (d: Buffer) => {
    if (d.toString().includes('DevTools listening')) console.log('  CDP ready');
  });

  await sleep(6000);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  } catch {
    await sleep(4000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  }

  const page = browser.contexts()[0].pages().find((p: any) => p.url().includes('app://')) || browser.contexts()[0].pages()[0];
  console.log(`Connected: ${page.url()}`);
  await sleep(3000);

  try {
    // Open vault
    if (await page.locator('h2:has-text("Recent Vaults")').count() > 0) {
      console.log('Opening vault...');
      await page.locator('h2:has-text("Recent Vaults") + div button').first().click();
      await sleep(6000);
    }

    // ── 1. Cmd+K search bar ──
    console.log('1. Search bar (Cmd+K)');
    await reactClick(page, 'button[title="Graph"]');
    await sleep(2000);
    // Trigger Cmd+K
    await page.keyboard.press('Meta+k');
    await sleep(1500);
    // Type a search query to show results
    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('Claude');
      await sleep(1500);
    }
    await save(page, 'search-bar');
    // Close search
    await page.keyboard.press('Escape');
    await sleep(500);

    // ── 2. Open artifact viewer ──
    console.log('2. Artifact viewer');
    await reactClick(page, 'button[title="Artifacts"]');
    await sleep(2500);
    // Click the first artifact in the list to open it
    const artifactItem = page.locator('button:has-text("Knowledge Graph Dashboard"), a:has-text("Knowledge Graph Dashboard"), div:has-text("Knowledge Graph Dashboard")').first();
    if (await artifactItem.count() > 0) {
      const box = await artifactItem.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(3000);
      }
    } else {
      // Try clicking any artifact entry
      console.log('   Looking for any artifact...');
      const anyArtifact = await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="cursor-pointer"], [class*="hover:bg"]');
        for (const item of items) {
          if ((item.textContent || '').includes('Dashboard') || (item.textContent || '').includes('artifact')) {
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      if (anyArtifact) await sleep(3000);
    }
    await save(page, 'artifact-viewer');

  } finally {
    console.log('\nDone. Closing app...');
    browser.close();
    child.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
