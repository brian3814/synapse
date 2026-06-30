import { chromium, type Page } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
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

async function save(page: Page, name: string) {
  const filepath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
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

    // Graph overview
    console.log('graph-overview');
    await reactClick(page, 'button[title="Graph"]');
    await sleep(2000);
    try { await page.waitForSelector('canvas', { timeout: 5000 }); } catch {}
    await sleep(1500);
    await save(page, 'graph-overview');

    // Intelligence panel
    console.log('intelligence-panel');
    await reactClick(page, 'button[title="Intelligence"]');
    await sleep(2500);
    await save(page, 'intelligence-panel');

    // Chat sidebar
    console.log('chat-sidebar');
    await reactClick(page, 'button[title="Chat History"]');
    await sleep(2000);
    await save(page, 'chat-sidebar');

    // Settings general
    console.log('settings');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('header button');
      for (const btn of btns) {
        const pathEl = btn.querySelector('svg path');
        if (pathEl?.getAttribute('d')?.includes('12.22')) {
          const key = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
          if (key) {
            let fiber = (btn as any)[key];
            while (fiber) {
              if (fiber.memoizedProps?.onClick) { fiber.memoizedProps.onClick(); return; }
              fiber = fiber.return;
            }
          }
        }
      }
    });
    await sleep(1500);
    await save(page, 'settings-general');

    // MCP tab
    const mcpTab = page.locator('nav button:has-text("MCP")');
    if (await mcpTab.count() > 0) {
      await mcpTab.click();
      await sleep(1500);
      await save(page, 'settings-mcp');
    }

    // Close settings, back to graph
    await page.keyboard.press('Escape');
    await sleep(500);
    await reactClick(page, 'button[title="Graph"]');
    await sleep(2000);

  } finally {
    console.log('\nDone. Closing app...');
    browser.close();
    child.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
