// Sends keystrokes to a tab through chrome.debugger. The browser treats these as
// real key presses, so they work in Google Docs, Word online, Notion, plain text
// boxes and anything else that accepts typing.

import { withDeadline } from './recovery.js';
import { keyFor, SPECIAL, macCommands } from './keys.js';

export class CdpDriver {
  constructor(tabId, { mac = false } = {}) {
    this.target = { tabId };
    this.mac = mac;
    this.shiftDown = false;
    this.attached = false;
  }

  async attach() {
    await chrome.debugger.attach(this.target, '1.3');
    this.attached = true;
    // Lets the page keep receiving keys while you click around the side panel.
    try {
      await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch {
      /* not available in every Chrome version */
    }
  }

  async detach() {
    if (!this.attached) return;
    try {
      await this.setShift(false);
    } catch {
      /* tab may be gone */
    }
    this.attached = false;
    try {
      await chrome.debugger.detach(this.target);
    } catch {
      /* already detached */
    }
  }

  send(method, params = {}) {
    return withDeadline(chrome.debugger.sendCommand(this.target, method, params), 15000,
      'the editor did not answer within 15 seconds. Inspect the document before resuming');
  }

  async setShift(down) {
    if (this.shiftDown === down) return;
    const k = SPECIAL.shift;
    await this.send('Input.dispatchKeyEvent', {
      type: down ? 'rawKeyDown' : 'keyUp',
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.keyCode,
      nativeVirtualKeyCode: k.keyCode,
      location: k.location,
      modifiers: down ? 8 : 0,
    });
    this.shiftDown = down;
  }

  async press(k, { text, shift = false, commands } = {}) {
    const base = {
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.keyCode,
      nativeVirtualKeyCode: k.keyCode,
      modifiers: shift ? 8 : 0,
    };
    const down = { ...base, type: text ? 'keyDown' : 'rawKeyDown' };
    if (text) {
      down.text = text;
      down.unmodifiedText = text;
    }
    if (commands?.length) down.commands = commands;
    await this.send('Input.dispatchKeyEvent', down);
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  async type(g) {
    const k = keyFor(g);
    if (!k) {
      // Accents, curly quotes, dashes, emoji: insert like a keyboard layout would.
      await this.setShift(false);
      await this.send('Input.insertText', { text: g });
      return;
    }
    await this.setShift(k.shift);
    await this.press(k, { text: g, shift: k.shift });
    if (k.shift) await this.setShift(false);
  }

  async key(name, shift = false) {
    await this.setShift(shift);
    await this.press(SPECIAL[name], { shift, commands: this.mac ? macCommands(name, shift) : undefined });
  }

  // Jump to the very start or end of the document: Command+Up/Down on a Mac,
  // Ctrl+Home/End everywhere else (Google Docs and plain text boxes alike).
  async jump(where) {
    await this.setShift(false);
    const mod = this.mac ? SPECIAL.meta : SPECIAL.control;
    const flag = this.mac ? 4 : 2;
    const key = this.mac ? (where === 'docstart' ? SPECIAL.up : SPECIAL.down) : (where === 'docstart' ? SPECIAL.home : SPECIAL.end);
    const modEvent = (type, modifiers) => this.send('Input.dispatchKeyEvent', {
      type, key: mod.key, code: mod.code, windowsVirtualKeyCode: mod.keyCode, nativeVirtualKeyCode: mod.keyCode, location: mod.location, modifiers,
    });
    await modEvent('rawKeyDown', flag);
    const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode, modifiers: flag };
    const down = { ...base, type: 'rawKeyDown' };
    if (this.mac) down.commands = macCommands(where, false);
    await this.send('Input.dispatchKeyEvent', down);
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    await modEvent('keyUp', 0);
  }

  async enter() {
    await this.setShift(false);
    await this.press(SPECIAL.enter, { text: '\r' });
  }

  exec(a) {
    switch (a.k) {
      case 'type': return this.type(a.g);
      case 'back': return this.key('back');
      case 'left': return this.key('left', !!a.sh);
      case 'right': return this.key('right', !!a.sh);
      case 'enter': return this.enter();
      case 'docstart':
      case 'docend': return this.jump(a.k);
      default: return Promise.resolve();
    }
  }

  releaseKeys() {
    return this.attached ? this.setShift(false) : Promise.resolve();
  }

  // For plain text boxes, read back what's there so we can confirm an exact match.
  async readFocusedText() {
    const res = await this.send('Runtime.evaluate', {
      expression: `(() => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        if (el && typeof el.value === 'string' && /^(TEXTAREA|INPUT)$/.test(el.tagName)) return el.value;
        return null;
      })()`,
      returnByValue: true,
    });
    return res?.result?.value ?? null;
  }

  // Runs an expression in the page (awaiting it) and returns its value.
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Page script failed');
    return res?.result?.value ?? null;
  }
}
