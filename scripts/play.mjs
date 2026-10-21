// Plays a game in headless Chrome and screenshots it, for checking the UI
// without a person at the keyboard. Starts the game's standalone Vite server,
// drives it over the Chrome DevTools Protocol, and reports console errors.
//
//   node scripts/play.mjs <id> [--steps "<steps>"] [--out <dir>] [--size 1280x800]
//
// Steps are separated by ";" and run in order:
//   shot:<name>          screenshot to <out>/<id>-<name>.png
//   text:<label>         click the first enabled button whose text contains <label>
//   click:<selector>     click the first element matching <selector> (searches shadow roots)
//   key:<key>            press a key: Space, Escape, Enter, c, ...
//   wait:<ms>            sleep
//   until:<js>[@<ms>]    wait until the expression is truthy (default 10 s)
//   log:<js>             print the expression's value
//   dump                 print the game's visible text
//   size:<w>x<h>         resize the viewport
//   mouse:<x>,<y>        real mouse click at page coordinates
//
// Inside expressions: $(sel) finds one element and $$(sel) all of them,
// searching through shadow roots; $text(label) finds a button by its text.
//
// Exits 2 if the page threw or logged errors.

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    steps: { type: 'string', default: 'shot:idle' },
    out: { type: 'string', default: join(tmpdir(), 'originals-shots') },
    size: { type: 'string', default: '1280x800' },
  },
});

const id = positionals[0];
const root = resolve(import.meta.dirname, '..');
const gameDir = join(root, 'games', id ?? '');
if (!id || !existsSync(join(gameDir, 'index.html'))) {
  console.error('Usage: node scripts/play.mjs <game-id> [--steps "..."] [--out dir]');
  process.exit(1);
}
mkdirSync(values.out, { recursive: true });

const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [w0, h0] = values.size.split('x').map(Number);
const vitePort = await freePort();
const server = await createServer({
  root: gameDir,
  configFile: join(gameDir, 'vite.config.ts'),
  logLevel: 'error',
  server: { port: vitePort, strictPort: true, host: '127.0.0.1' },
  clearScreen: false,
});
await server.listen();

const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'originals-chrome-'));
const chrome = spawn(
  chromePath(),
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--window-size=${w0},${h0}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const errors = [];
let exitCode = 0;

async function cleanup() {
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' });
    else chrome.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  await server.close().catch(() => {});
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold files briefly */
  }
}

try {
  // Find the page target.
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    if (!wsUrl) await sleep(100);
  }
  if (!wsUrl) throw new Error('Could not connect to Chrome');

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { res, rej } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) rej(new Error(data.error.message));
      else res(data.result);
    } else if (data.method) {
      for (const fn of listeners.get(data.method) ?? []) fn(data.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const msgId = ++seq;
      pending.set(msgId, { res, rej });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);

  on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`));
  on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'assert') {
      errors.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
  });
  on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error' && !/favicon/.test(p.entry.url ?? '')) errors.push(`log: ${p.entry.text} ${p.entry.url ?? ''}`);
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w0, height: h0, deviceScaleFactor: 1, mobile: false });

  const HELPERS = `
    window.$$ = (sel) => { const out = []; const walk = (r) => { r.querySelectorAll(sel).forEach((e) => out.push(e)); r.querySelectorAll('*').forEach((e) => e.shadowRoot && walk(e.shadowRoot)); }; walk(document); return out; };
    window.$ = (sel) => window.$$(sel)[0] ?? null;
    window.$text = (label) => window.$$('button, [role=button], summary').find((e) => !e.disabled && e.textContent.toLowerCase().includes(label.toLowerCase())) ?? null;
    window.$click = (el) => { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, view: window })); return true; };
    window.$dump = () => { const host = document.getElementById('root'); const r = host?.shadowRoot ?? document; return [...r.children].map((c) => c.innerText ?? '').join('\\n'); };
  `;
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  const loaded = new Promise((res) => on('Page.loadEventFired', res));
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` });
  await loaded;
  await evaluate(HELPERS);
  // Wait for the game to render into its shadow root.
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`!!(document.getElementById('root')?.shadowRoot?.querySelector('*:not(style)'))`)) break;
    await sleep(100);
  }
  await sleep(400);

  const keyCodes = { Space: [' ', 'Space', 32], Escape: ['Escape', 'Escape', 27], Enter: ['Enter', 'Enter', 13] };
  for (const raw of values.steps.split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = raw.indexOf(':');
    const cmd = i < 0 ? raw : raw.slice(0, i);
    const arg = i < 0 ? '' : raw.slice(i + 1);
    switch (cmd) {
      case 'shot': {
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(values.out, `${id}-${arg || 'shot'}.png`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        console.log(`shot  ${file}`);
        break;
      }
      case 'text': {
        const ok = await evaluate(`$click($text(${JSON.stringify(arg)}))`);
        console.log(`text  ${arg} ${ok ? '✓' : '✗ (no enabled button)'}`);
        if (!ok) exitCode = Math.max(exitCode, 1);
        break;
      }
      case 'click': {
        const ok = await evaluate(`$click($(${JSON.stringify(arg)}))`);
        console.log(`click ${arg} ${ok ? '✓' : '✗ (not found)'}`);
        if (!ok) exitCode = Math.max(exitCode, 1);
        break;
      }
      case 'mouse': {
        const [x, y] = arg.split(',').map(Number);
        for (const type of ['mousePressed', 'mouseReleased']) {
          await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        }
        break;
      }
      case 'key': {
        const [key, code, kc] = keyCodes[arg] ?? [arg, `Key${arg.toUpperCase()}`, arg.toUpperCase().charCodeAt(0)];
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: kc, text: key.length === 1 ? key : undefined });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: kc });
        break;
      }
      case 'wait':
        await sleep(Number(arg) || 0);
        break;
      case 'until': {
        const [expr, ms] = arg.includes('@') ? [arg.slice(0, arg.lastIndexOf('@')), Number(arg.slice(arg.lastIndexOf('@') + 1))] : [arg, 10000];
        const t0 = Date.now();
        let ok = false;
        while (Date.now() - t0 < ms) {
          try {
            if (await evaluate(expr)) {
              ok = true;
              break;
            }
          } catch {
            /* keep waiting */
          }
          await sleep(50);
        }
        console.log(`until ${expr} ${ok ? '✓' : `✗ (timed out after ${ms} ms)`}`);
        if (!ok) exitCode = Math.max(exitCode, 1);
        break;
      }
      case 'log':
        console.log(`log   ${arg} =>`, JSON.stringify(await evaluate(arg)));
        break;
      case 'dump':
        console.log('----- visible text -----\n' + (await evaluate('$dump()')) + '\n------------------------');
        break;
      case 'size': {
        const [w, h] = arg.split('x').map(Number);
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
        await sleep(200);
        break;
      }
      default:
        throw new Error(`Unknown step "${raw}"`);
    }
  }
  ws.close();
} catch (err) {
  console.error(String(err?.stack ?? err));
  exitCode = 1;
} finally {
  await cleanup();
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} page error(s):\n  ${errors.join('\n  ')}`);
  exitCode = 2;
} else {
  console.log('\n✓ no page errors');
}
process.exit(exitCode);
