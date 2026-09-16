const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const candidates = [
  process.env.TYPESCRIPT_PATH,
  '/Applications/DevEco-Studio.app/Contents/tools/hvigor/hvigor/node_modules/typescript',
  '/Applications/DevEco-Studio.app/Contents/plugins/openharmony/ace-server/node_modules/typescript'
].filter(Boolean);
let ts;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    ts = require(candidate);
    break;
  }
}
if (!ts) {
  throw new Error('Set TYPESCRIPT_PATH to an existing TypeScript package directory.');
}
const sourcePath = path.resolve(__dirname, '../entry/src/main/ets/model/Card.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true,
  fileName: sourcePath
});
assert.equal(compiled.diagnostics.length, 0, 'Transpilation should have no diagnostics');
const loaded = new Module(sourcePath, module);
loaded._compile(compiled.outputText, sourcePath);
const { emptyCard, validateCard, filterCards, toVCard } = loaded.exports;

function validCard() {
  return Object.assign(emptyCard(), { id: '1', name: '张三', phone: '+86 138-0013-8000' });
}
let checks = 0;
function check(name, run) {
  run();
  checks++;
  console.log('PASS ' + name);
}

check('Empty cards are independent and require a name', () => {
  const one = emptyCard();
  one.name = 'changed';
  assert.equal(emptyCard().name, '');
  assert.match(validateCard(emptyCard()), /姓名/);
});
check('Contact validation accepts telephone or email and trims surrounding spaces', () => {
  assert.equal(validateCard(validCard()), '');
  const card = validCard();
  card.phone = ' ';
  assert.match(validateCard(card), /至少/);
  card.email = ' alice@example.com ';
  assert.equal(validateCard(card), '');
  card.email = 'alice@example';
  assert.match(validateCard(card), /邮箱/);
  card.email = 'alice@x..com';
  assert.match(validateCard(card), /邮箱/);
  card.email = '';
  card.phone = '138abc00138000';
  assert.match(validateCard(card), /电话/);
  card.phone = '123';
  assert.match(validateCard(card), /电话/);
});
check('Text length limits reject oversized input', () => {
  for (const [field, limit] of [['name', 50], ['company', 100], ['title', 100], ['group', 30], ['notes', 1000]]) {
    const card = validCard();
    card[field] = '字'.repeat(limit);
    assert.equal(validateCard(card), '');
    card[field] += '字';
    assert.notEqual(validateCard(card), '');
  }
});
check('Search, group and favorites combine without modifying input', () => {
  const first = Object.assign(validCard(), { company: 'Harmony Inc', group: '同事', favorite: true });
  const second = Object.assign(validCard(), { id: '2', name: '李四', group: '朋友', notes: '会议认识' });
  const cards = [first, second];
  assert.deepEqual(filterCards(cards, ' HARMONY ', '全部', false), [first]);
  assert.deepEqual(filterCards(cards, '会议', '朋友', false), [second]);
  assert.deepEqual(filterCards(cards, '', '朋友', true), []);
  assert.deepEqual(filterCards(cards, '', '全部', true), [first]);
  assert.deepEqual(filterCards(cards, '', '全部', false), cards);
  assert.deepEqual(cards, [first, second]);
});
check('vCard uses CRLF and escapes injected delimiters and newlines', () => {
  const card = validCard();
  card.name = '张;三,\\';
  card.notes = 'first\r\nEND:VCARD\rsecond\nthird';
  const output = toVCard(card);
  assert.ok(output.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
  assert.ok(output.endsWith('END:VCARD\r\n'));
  assert.ok(output.includes('FN:张\\;三\\,\\\\\r\n'));
  assert.ok(output.includes('NOTE:first\\nEND:VCARD\\nsecond\\nthird\r\n'));
  assert.equal(output.split('\r\n').filter(line => line === 'END:VCARD').length, 1);
});
check('vCard folds Unicode by UTF-8 byte length without losing content', () => {
  const card = validCard();
  card.notes = '名片🌟'.repeat(80);
  const output = toVCard(card);
  for (const line of output.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  }
  const unfolded = output.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('NOTE:' + card.notes + '\r\n'));
});
console.log(`${checks} domain tests passed.`);
