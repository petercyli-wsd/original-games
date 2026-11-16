// Preloaded into scripts/play.mjs (node --import) by the slot review's `play`
// command. It changes four things in play.mjs's Chrome session by rewriting
// the DevTools messages play.mjs sends, so play.mjs itself stays untouched:
//
// 1. With SLOT_PLAY_QUERY set, the page URL gets that query, e.g. the slot
//    kit's dev hooks "feature=1" or "seed=<n>". (The review's `feature` step
//    uses the kit's window.__slotDev.feature() instead, item 4, so the feature
//    can come at any point in a run.)
// 2. With SLOT_PLAY_SANDBOX=slot, the paytable stays reachable in --blind mode.
//    The Originals sandbox hides every dialog and the How-to-play / info /
//    rules buttons. The slot kit opens its paytable from that same How-to-play
//    button into a dialog, and a slot player reads the paytable. So for slots
//    only the caption under the board stays hidden. Prose of 9+ words is still
//    hidden everywhere, the paytable included.
// 3. With SLOT_PLAY_SANDBOX=slot, `text:<label>` also clicks <label> elements,
//    so the kit's Turbo toggle (a checkbox in a label, not a button) can be
//    switched like a button.
//
// If play.mjs changes so a rewrite no longer applies, the run prints
// "✗ slot sandbox patch did not apply" and the wrapper fails the call, rather
// than silently hiding the paytable.
//
// The clean fix is a --query flag and a slot sandbox in play.mjs; until then
// this hook carries both.

const query = process.env.SLOT_PLAY_QUERY ?? '';
const patchSandbox = process.env.SLOT_PLAY_SANDBOX === 'slot';

const ORIGINAL_CSS = '.og-caption, .og-info-btn, .og-modal-backdrop, [role=dialog] { display: none !important; }';
const SLOT_CSS = '.og-caption { display: none !important; }';
const ORIGINAL_BUTTONS = '/how to play|rules|info/i';
const SLOT_BUTTONS = '/(?!)/'; // matches nothing: no button is hidden by its label
const ORIGINAL_TEXT = "window.$$('button, [role=button], summary')";
const SLOT_TEXT = "window.$$('button, [role=button], summary, label')";

// 4. With SLOT_PLAY_SANDBOX=slot, two "virtual keys" run fixed expressions in the page instead of
//    a key press, so the blind player gets exactly these two powers and no free JavaScript:
//    key:SlotFeature  → the slot kit's dev hook: the next spin triggers the feature;
//    key:SlotScroll   → scrolls the open dialog (the paytable) down by most of a page.
const ROOT = "document.getElementById('root')?.shadowRoot";
const VIRTUAL_KEYS = {
  SlotFeature: 'void (window.__slotDev && window.__slotDev.feature())',
  SlotScroll: `void (() => { const r = ${ROOT}; if (!r) return; const d = r.querySelector('[role=dialog]'); if (!d) return; const s = [d, ...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible'); if (s) s.scrollTop += Math.round(s.clientHeight * 0.85); })()`,
};

const broken = (what) => console.log(`✗ slot sandbox patch did not apply (scripts/play.mjs changed its ${what})`);

const Base = globalThis.WebSocket;
if (Base) {
  globalThis.WebSocket = class SlotPlaySocket extends Base {
    send(data) {
      try {
        const msg = JSON.parse(String(data));
        let changed = false;
        if (msg.method === 'Page.navigate' && query && typeof msg.params?.url === 'string') {
          const url = new URL(msg.params.url);
          for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
          msg.params.url = url.toString();
          changed = true;
        }
        if (patchSandbox && msg.method === 'Input.dispatchKeyEvent' && Object.hasOwn(VIRTUAL_KEYS, msg.params?.key ?? '')) {
          // A slot helper step: run its fixed expression instead of pressing a key (key-up does nothing).
          const expression = msg.params.type === 'keyDown' ? VIRTUAL_KEYS[msg.params.key] : 'void 0';
          msg.method = 'Runtime.evaluate';
          msg.params = { expression, awaitPromise: true, returnByValue: true };
          data = JSON.stringify(msg);
          super.send(data);
          return;
        }
        const expr = msg.method === 'Runtime.evaluate' ? msg.params?.expression : undefined;
        if (patchSandbox && typeof expr === 'string' && expr.includes('window.$text = ')) {
          if (!expr.includes(ORIGINAL_TEXT)) broken('$text helper');
          else {
            // A replacer function: a replacement string would read "$$" as "$".
            msg.params.expression = expr.replace(ORIGINAL_TEXT, () => SLOT_TEXT);
            changed = true;
          }
        }
        if (patchSandbox && typeof expr === 'string' && expr.includes('window.__blindHide = ')) {
          if (!expr.includes(ORIGINAL_CSS) || !expr.includes(ORIGINAL_BUTTONS)) broken('blind sandbox');
          else {
            msg.params.expression = expr.replace(ORIGINAL_CSS, () => SLOT_CSS).replace(ORIGINAL_BUTTONS, () => SLOT_BUTTONS);
            changed = true;
          }
        }
        if (changed) data = JSON.stringify(msg);
      } catch {
        /* not JSON: pass through */
      }
      super.send(data);
    }
  };
}
