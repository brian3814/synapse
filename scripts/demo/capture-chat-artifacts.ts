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
  const filepath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function sendChat(page: Page, message: string) {
  const input = page.locator('input[placeholder*="Ask about your knowledge graph"]');
  if (await input.count() === 0) {
    console.log('   Chat input not found');
    return false;
  }
  await input.fill(message);
  await sleep(300);
  // Click the Ask button
  const askBtn = page.locator('button:has-text("Ask")');
  if (await askBtn.count() > 0) {
    await askBtn.click();
    return true;
  }
  return false;
}

async function waitForResponse(page: Page, timeoutMs: number = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Check if the Ask button is enabled again (not showing "...")
    const btnText = await page.locator('form button[type="submit"]').textContent().catch(() => '');
    if (btnText === 'Ask') return true;
    await sleep(2000);
    if ((Date.now() - start) % 10000 < 2000) {
      console.log(`   ... waiting (${Math.round((Date.now() - start) / 1000)}s)`);
    }
  }
  return false;
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

    // ── 1. Open chat via the FAB button (bottom-right) ──
    console.log('1. Opening chat...');
    // The "Ask your graph" button is a floating action button
    const fabBtn = page.locator('button[title="Ask your graph"]');
    if (await fabBtn.count() > 0) {
      const box = await fabBtn.boundingBox();
      if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    } else {
      // Fallback: click chat sidebar then "Start a new chat" or "+ New"
      await reactClick(page, 'button[title="Chat History"]');
      await sleep(1500);
      const newChatLink = page.locator('a:has-text("Start a new chat"), button:has-text("New")');
      if (await newChatLink.count() > 0) await newChatLink.first().click();
    }
    await sleep(2000);

    // Check if chat input is visible
    const chatInput = page.locator('input[placeholder*="Ask about your knowledge graph"]');
    console.log(`   Chat input found: ${await chatInput.count() > 0}`);

    if (await chatInput.count() > 0) {
      // ── 2. Send first message ──
      console.log('2. Asking about the graph...');
      const sent = await sendChat(page, 'What are the main entities and relationships in my knowledge graph? Give me a brief overview.');
      if (sent) {
        console.log('   Message sent, waiting for response...');
        const responded = await waitForResponse(page, 90000);
        if (responded) {
          console.log('   Response received!');
          await sleep(1000);
          await save(page, 'chat-response');
        } else {
          console.log('   Response timed out, capturing anyway');
          await save(page, 'chat-response');
        }
      }

      // ── 3. Ask for a dashboard artifact ──
      console.log('3. Asking for dashboard artifact...');
      const sent2 = await sendChat(page, 'Create an interactive HTML dashboard that visualizes the key clusters and central entities in my graph. Use charts and cards with a dark theme.');
      if (sent2) {
        console.log('   Message sent, waiting for artifact...');
        const responded2 = await waitForResponse(page, 120000);
        if (responded2) {
          console.log('   Artifact response received!');
          await sleep(2000);
          await save(page, 'chat-artifact');
        } else {
          console.log('   Timed out, capturing anyway');
          await save(page, 'chat-artifact');
        }
      }
    }

    // ── 4. Agents panel ──
    console.log('4. Agents panel');
    await reactClick(page, 'button[title="Agents"]');
    await sleep(2500);
    await save(page, 'agents-panel');

    // ── 5. Artifacts browser ──
    console.log('5. Artifacts browser');
    await reactClick(page, 'button[title="Artifacts"]');
    await sleep(2500);
    await save(page, 'artifacts-panel');

  } finally {
    console.log('\nDone. Closing app...');
    browser.close();
    child.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
