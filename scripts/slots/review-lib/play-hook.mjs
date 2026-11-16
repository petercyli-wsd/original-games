// Preloaded into scripts/play.mjs (node --import) by the slot review's `play`
// command. It changes three things in play.mjs's Chrome session by rewriting
// the DevTools messages play.mjs sends, so play.mjs itself stays untouched:
//
// 1. The page URL gets the slot kit's dev query (SLOT_PLAY_QUERY, e.g.
//    "feature=1": the next spin triggers the feature).
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
