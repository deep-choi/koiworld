const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 실제 패널의 이벤트 핸들러를 불러옵니다. DOM 대신 버튼/아이콘의 소속 관계만 재현하고,
// 훅은 렌더링 없이도 각 패널이 독립적인 ref를 갖도록 대체합니다.
class ElementStub {
  constructor(button) { this.button = button; }
  closest() { return this.button; }
}
const filename = path.join(__dirname, '../components/KoiActionPanel.tsx');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const moduleStub = { exports: {} };
let resetPress;
vm.runInNewContext(compiled, {
  exports: moduleStub.exports,
  module: moduleStub,
  Element: ElementStub,
  window: {
    addEventListener: (_name, handler) => { resetPress = handler; },
    removeEventListener: () => {},
  },
  require: name => name === 'react'
    ? { useRef: current => ({ current }), useEffect: effect => { effect(); } }
    : require(name),
}, { filename });

const createPanel = () => moduleStub.exports.KoiActionPanel({ className: '', children: null }).props;
const createButton = () => {
  const button = new ElementStub();
  button.button = button;
  return button;
};
const click = (panel, target, detail = 1) => {
  let prevented = false;
  let stopped = false;
  panel.onClickCapture({
    target, detail,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  });
  assert.equal(prevented, stopped);
  return !stopped;
};

test('a selecting touch cannot activate any newly shown koi action', () => {
  for (const action of ['breed', 'sell', 'move']) {
    assert.equal(click(createPanel(), createButton()), false, action);
  }
});

test('a fresh press immediately after selection activates the intended button once', () => {
  const panel = createPanel();
  const sell = createButton();
  assert.equal(click(panel, sell), false);
  panel.onPointerDownCapture({ target: sell });
  assert.equal(click(panel, sell), true);
  assert.equal(click(panel, sell), false);
});

test('pressing an icon and releasing on its button is allowed', () => {
  const panel = createPanel();
  const button = createButton();
  panel.onPointerDownCapture({ target: new ElementStub(button) });
  assert.equal(click(panel, button), true);
});

test('a press on a different button or panel background cannot sell a koi', () => {
  const panel = createPanel();
  const sell = createButton();
  for (const target of [createButton(), new ElementStub(null)]) {
    panel.onPointerDownCapture({ target });
    assert.equal(click(panel, sell), false);
  }
});

test('canceled pointer input cannot activate an action', () => {
  const panel = createPanel();
  const button = createButton();
  panel.onPointerDownCapture({ target: button });
  panel.onPointerCancelCapture();
  assert.equal(click(panel, button), false);
});

test('a new pond press clears an unfinished earlier button press', () => {
  const panel = createPanel();
  const sell = createButton();
  panel.onPointerDownCapture({ target: sell });
  // 버튼 밖으로 손을 떼어 click이 오지 않은 뒤, 다시 코이를 고르는 경우입니다.
  resetPress();
  assert.equal(click(panel, sell), false);
  resetPress();
  panel.onPointerDownCapture({ target: sell });
  assert.equal(click(panel, sell), true);
});

test('keyboard and assistive clicks remain available without a pointer press', () => {
  assert.equal(click(createPanel(), createButton(), 0), true);
});
