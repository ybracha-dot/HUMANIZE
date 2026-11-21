// US keyboard layout for Chrome DevTools Protocol key events, so every
// character arrives as a real keydown / keypress / input / keyup sequence.

const KEYS = {};
function def(ch, code, keyCode, shift = false) {
  KEYS[ch] = { key: ch, code, keyCode, shift };
}

for (let c = 97; c <= 122; c++) {
  const ch = String.fromCharCode(c);
  const up = ch.toUpperCase();
  def(ch, `Key${up}`, c - 32);
  def(up, `Key${up}`, c - 32, true);
}
const shiftedDigits = ')!@#$%^&*(';
for (let d = 0; d <= 9; d++) {
  def(String(d), `Digit${d}`, 48 + d);
  def(shiftedDigits[d], `Digit${d}`, 48 + d, true);
}
for (const [ch, code, keyCode, shift] of [
  [' ', 'Space', 32], ['-', 'Minus', 189], ['_', 'Minus', 189, true], ['=', 'Equal', 187],
  ['+', 'Equal', 187, true], ['[', 'BracketLeft', 219], ['{', 'BracketLeft', 219, true],
  [']', 'BracketRight', 221], ['}', 'BracketRight', 221, true], ['\\', 'Backslash', 220],
  ['|', 'Backslash', 220, true], [';', 'Semicolon', 186], [':', 'Semicolon', 186, true],
  ["'", 'Quote', 222], ['"', 'Quote', 222, true], [',', 'Comma', 188], ['<', 'Comma', 188, true],
  ['.', 'Period', 190], ['>', 'Period', 190, true], ['/', 'Slash', 191], ['?', 'Slash', 191, true],
  ['`', 'Backquote', 192], ['~', 'Backquote', 192, true],
]) {
  def(ch, code, keyCode, !!shift);
}

export const SPECIAL = {
  back: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
};

export function keyFor(g) {
  return KEYS[g] || null;
}

// On macOS, Chrome only performs a synthetic key's editing action (delete,
// move the caret) when the matching editing command is sent along with it.
export function macCommands(name, shift) {
  switch (name) {
    case 'back': return ['deleteBackward'];
    case 'left': return [shift ? 'moveLeftAndModifySelection' : 'moveLeft'];
    case 'right': return [shift ? 'moveRightAndModifySelection' : 'moveRight'];
    case 'docstart': return ['moveToBeginningOfDocument'];
    case 'docend': return ['moveToEndOfDocument'];
    default: return [];
  }
}
