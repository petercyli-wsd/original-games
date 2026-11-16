// Preloaded into scripts/play.mjs (node --import) by the slot review's `play`
// command. It changes two things in play.mjs's Chrome session, by rewriting
// the DevTools messages play.mjs sends, so play.mjs itself stays untouched:
//
// 1. The page URL gets the slot kit's dev query (SLOT_PLAY_QUERY, e.g.
//    "feature=1": the next spin triggers the feature).
// 2. In --blind mode the paytable sheet stays visible. The Originals sandbox
//    hides every dialog and any "info"/"rules" button; a slot player reads the
//    paytable, so for slots only the How-to-play button and captions stay
//    hidden. Prose of 9+ words is still hidden everywhere, the paytable included.
//
// If play.mjs's sandbox text changes so the rewrite no longer applies, the run
// prints "✗ slot sandbox patch did not apply" and the wrapper fails the call,
// rather than silently hiding the paytable.
//
// The clean fix is a --query flag and a slot sandbox in play.mjs; until then
// this hook carries both.

const query = process.env.SLOT_PLAY_QUERY ?? '';
const patchSandbox = process.env.SLOT_PLAY_SANDBOX === 'slot';

const ORIGINAL_CSS = '.og-caption, .og-info-btn, .og-modal-backdrop, [role=dialog] { display: none !important; }';
const SLOT_CSS = '.og-caption { display: none !important; }';
const ORIGINAL_BUTTONS = '/how to play|rules|info/i';
const SLOT_BUTTONS = '/how to play/i';

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
        if (patchSandbox && typeof expr === 'string' && expr.includes('window.__blindHide = ')) {
          if (!expr.includes(ORIGINAL_CSS) || !expr.includes(ORIGINAL_BUTTONS)) {
            console.log('✗ slot sandbox patch did not apply (scripts/play.mjs changed its blind sandbox)');
            process.exitCode = 3;
          } else {
            msg.params.expression = expr.replace(ORIGINAL_CSS, SLOT_CSS).replace(ORIGINAL_BUTTONS, SLOT_BUTTONS);
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
