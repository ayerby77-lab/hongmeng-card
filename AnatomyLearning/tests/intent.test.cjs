const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || '/Applications/DevEco-Studio.app/Contents/tools/hvigor/hvigor/node_modules/typescript');
const root = require('node:path').join(__dirname, '../entry/src/main/ets/');
const data = new Map();
let listener = () => {};
const AppStorage = {
  get: key => data.get(key),
  setOrCreate(key, value) { data.set(key, value); listener(); }
};
function load(source, extra = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sandbox = { exports: {}, AppStorage, ...extra };
  vm.runInNewContext(code, sandbox);
  return sandbox.exports;
}
const { ArkAFIntent: intent } = load(fs.readFileSync(root + 'model/ArkAFIntent.ets', 'utf8'));
let count = 0;
function test(name, run) { listener = () => {}; intent.clearPendingQuestion(); run(); count++; console.log('PASS ' + name); }
test('同步监听读取完整请求', () => {
  let observed;
  listener = () => { observed = intent.consumePendingQuestion(); };
  intent.publishQuestion('问题', false, 'atomic');
  assert.equal(observed.requestId, 'atomic');
  assert.equal(observed.autoSubmit, false);
});
test('A B A 跨页面消费后仍去重', () => {
  for (const id of ['a', 'b']) { intent.publishQuestion('问题', true, id); intent.acknowledge(id); }
  intent.publishQuestion('问题', true, 'a');
  assert.equal(intent.hasPending(), false);
});
test('同问题新 requestId 可提交', () => {
  intent.publishQuestion('问题', true, 'new');
  assert.equal(intent.consumePendingQuestion().requestId, 'new');
});
test('初始化失败时读取保留请求', () => {
  intent.publishQuestion('问题', true, 'retry');
  assert.equal(intent.consumePendingQuestion().requestId, 'retry');
  assert.equal(intent.consumePendingQuestion().requestId, 'retry');
});
test('旧请求确认不会清掉新请求', () => {
  intent.publishQuestion('问题', true, 'latest');
  intent.acknowledge('older');
  assert.equal(intent.consumePendingQuestion().requestId, 'latest');
});
test('空问题不发布', () => { intent.publishQuestion('  '); assert.equal(intent.hasPending(), false); });
// 从实际 ArkUI 页面提取方法，通过替身验证调度；不复制实现逻辑。
const source = fs.readFileSync(root + 'pages/KnowledgeQA.ets', 'utf8');
function method(name) {
  const start = source.indexOf('  private ' + name + '(');
  assert.ok(start >= 0);
  const brace = source.indexOf('{', start);
  let level = 1, end = brace + 1;
  while (level) { if (source[end] === '{') level++; if (source[end] === '}') level--; end++; }
  return source.slice(start, end);
}
const { Harness } = load('export class Harness {\n' + ['acceptIntent', 'submitPendingIntent', 'onPendingStorageChange'].map(method).join('\n') + '\n}', { ArkAFIntent: intent });
function page(ready) {
  const p = new Harness();
  Object.assign(p, { pageVisible: true, pendingQuestion: '', pendingFromStorage: '', lastProcessedRequestId: '',
    runtime: { indexStatus: () => ({ ready, pendingCount: ready ? 0 : 1 }) },
    isBusy: () => false, isQuerying: () => false, submitted: [],
    submitQuestion(q) { this.submitted.push(q); }
  });
  return p;
}
test('已就绪页面收到热启动直接提交一次', () => {
  const p = page(true); const req = { question: '心脏', requestId: 'hot', autoSubmit: true };
  p.acceptIntent(req); p.acceptIntent(req);
  assert.deepEqual(p.submitted, ['心脏']);
});
test('索引完成前保留，完成后自动提交', () => {
  const p = page(false);
  p.acceptIntent({ question: '心脏', requestId: 'wait', autoSubmit: true });
  assert.equal(p.submitted.length, 0);
  p.runtime = { indexStatus: () => ({ ready: true, pendingCount: 0 }) };
  p.submitPendingIntent(); p.submitPendingIntent();
  assert.deepEqual(p.submitted, ['心脏']);
});
test('autoSubmit=false 仅回填', () => {
  const p = page(true); p.acceptIntent({ question: '心脏', requestId: 'fill', autoSubmit: false });
  assert.equal(p.inputText, '心脏'); assert.equal(p.submitted.length, 0);
});
test('隐藏页面不会消费通知', () => {
  const p = page(true); p.pageVisible = false;
  intent.publishQuestion('新问题', true, 'hidden'); p.pendingFromStorage = 'notification';
  p.onPendingStorageChange();
  assert.equal(p.submitted.length, 0); assert.equal(intent.hasPending(), true);
});
console.log(count + ' intent tests passed.');
