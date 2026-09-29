const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');

const candidates = [
  process.env.TYPESCRIPT_PATH,
  '/Applications/DevEco-Studio.app/Contents/tools/hvigor/hvigor/node_modules/typescript',
  '/Applications/DevEco-Studio.app/Contents/plugins/openharmony/ace-server/node_modules/typescript'
].filter(Boolean);
const compilerPath = candidates.find(candidate => fs.existsSync(candidate));
if (!compilerPath) throw new Error('Set TYPESCRIPT_PATH to an existing TypeScript package directory.');
const ts = require(compilerPath);
let failure = '';
let maximumWrite = Infinity;
const handles = new Set();
const fileIo = {
  OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
  accessSync: file => fs.existsSync(file),
  readTextSync: file => fs.readFileSync(file, 'utf8'),
  openSync(file, flags) {
    assert.equal(flags, 7);
    const fd = fs.openSync(file, 'w');
    handles.add(fd);
    return { fd };
  },
  writeSync(fd, buffer) {
    if (failure === 'write') throw new Error('Injected write failure');
    if (failure === 'zero-write') return 0;
    const bytes = Buffer.from(buffer);
    return fs.writeSync(fd, bytes, 0, Math.min(bytes.length, maximumWrite));
  },
  fsyncSync(fd) {
    if (failure === 'fsync') throw new Error('Injected fsync failure');
    fs.fsyncSync(fd);
  },
  closeSync(file) {
    fs.closeSync(file.fd);
    handles.delete(file.fd);
  },
  renameSync(from, to) {
    if (failure === 'rename') throw new Error('Injected rename failure');
    fs.renameSync(from, to);
  }
};
let uuid = 0;
const arkUtil = {
  generateRandomUUID: () => 'message-' + (++uuid),
  TextEncoder: class {
    encodeInto(value) { return Uint8Array.from(Buffer.from(value, 'utf8')); }
  }
};
function loadTypeScript(relativePath, imports) {
  const filename = path.resolve(__dirname, relativePath);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
    fileName: filename.replace(/\.ets$/, '.ts')
  });
  assert.equal(result.diagnostics.length, 0);
  const loaded = new Module(filename, module);
  loaded.require = id => {
    assert.ok(Object.hasOwn(imports, id), 'Unexpected dependency: ' + id);
    return imports[id];
  };
  loaded._compile(result.outputText, filename);
  return loaded.exports;
}
const model = loadTypeScript('../entry/src/main/ets/model/Message.ts', {});
const storeModule = loadTypeScript('../entry/src/main/ets/store/MessageStore.ets', {
  '../model/Message': model,
  '@kit.CoreFileKit': { fileIo },
  '@kit.ArkTS': { util: arkUtil }
});
const { MessageStore } = storeModule;
const { MessageBridge } = loadTypeScript('../entry/src/main/ets/bridge/MessageBridge.ets', {
  '../model/Message': model,
  '../store/MessageStore': storeModule,
  '@kit.ArkTS': { util: arkUtil }
});
function message(id) {
  return { id, name: '访客 ' + id, content: '中文与 🌟', createdAt: 100 };
}
let checks = 0;
function check(name, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'message-test-'));
  failure = '';
  maximumWrite = Infinity;
  try {
    run(directory, new MessageStore(directory));
    assert.equal(handles.size, 0, 'File handles must be closed');
    checks++;
    console.log('PASS ' + name);
  } finally {
    for (const fd of handles) fs.closeSync(fd);
    handles.clear();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
check('Input validation enforces types, nonblank text and length boundaries', () => {
  assert.equal(model.validateInput('名'.repeat(30), '文'.repeat(500)), '');
  for (const [name, content] of [
    ['', 'text'], ['  ', 'text'], ['a'.repeat(31), 'text'], ['a', ''],
    ['a', '  '], ['a', 'x'.repeat(501)], [null, 'text'], ['a', {}]
  ]) assert.ok(model.validateInput(name, content));
});
check('Snapshots survive partial Unicode writes and reopening', (directory, store) => {
  assert.deepEqual(store.load(), []);
  maximumWrite = 7;
  const messages = [message('1'), message('2')];
  store.save(messages);
  assert.deepEqual(new MessageStore(directory).load(), messages);
  assert.equal(fs.existsSync(path.join(directory, 'messages.json.tmp')), false);
});
check('Corrupt records are rejected and original file bytes are preserved', (directory, store) => {
  const invalid = [
    '{broken', '{}', 'null', '[null]', '[{}]',
    JSON.stringify([{ ...message('1'), name: '' }]),
    JSON.stringify([{ ...message('1'), content: 42 }]),
    JSON.stringify([{ ...message('1'), createdAt: -1 }]),
    JSON.stringify([{ ...message('1'), createdAt: null }]),
    JSON.stringify([message('1'), message('1')]),
    JSON.stringify(Array.from({ length: 501 }, (_, index) => message(String(index))))
  ];
  for (const content of invalid) {
    const filename = path.join(directory, 'messages.json');
    fs.writeFileSync(filename, content);
    assert.throws(() => store.load());
    assert.equal(fs.readFileSync(filename, 'utf8'), content);
  }
  assert.throws(() => model.validateMessages([{ ...message('1'), createdAt: Infinity }]));
});
for (const fault of ['write', 'zero-write', 'fsync', 'rename']) {
  check(fault + ' failure preserves saved data and bridge state, then permits retry', (directory, store) => {
    const original = [message('1')];
    store.save(original);
    const filename = path.join(directory, 'messages.json');
    const bytes = fs.readFileSync(filename);
    const bridge = new MessageBridge();
    let callbacks = 0;
    bridge.initialize(directory, () => { callbacks++; }, () => {});
    failure = fault;
    assert.equal(JSON.parse(bridge.submitMessage('访客', '新留言')).ok, false);
    assert.equal(callbacks, 0);
    assert.equal(handles.size, 0);
    assert.deepEqual(fs.readFileSync(filename), bytes);
    assert.deepEqual(bridge.snapshot(), original);
    assert.deepEqual(new MessageStore(directory).load(), original);
    failure = '';
    assert.equal(JSON.parse(bridge.submitMessage('访客', '重试')).ok, true);
    assert.equal(callbacks, 1);
    assert.equal(new MessageStore(directory).load()[0].content, '重试');
  });
}
check('Bridge validates lifecycle and inputs, persists before callback and isolates UI failures', (directory) => {
  const bridge = new MessageBridge();
  assert.equal(JSON.parse(bridge.submitMessage('a', 'b')).ok, false);
  let callbacks = 0;
  let persistedAtCallback;
  let callbackMessages;
  let toasts = 0;
  bridge.initialize(directory, messages => {
    callbacks++;
    persistedAtCallback = new MessageStore(directory).load();
    callbackMessages = messages;
    throw new Error('Injected render failure');
  }, () => { toasts++; throw new Error('Injected toast failure'); });
  assert.equal(JSON.parse(bridge.submitMessage(' ', 'b')).ok, false);
  assert.equal(callbacks, 0);
  assert.equal(JSON.parse(bridge.submitMessage('  名字  ', '  内容  ')).ok, true);
  assert.equal(callbacks, 1);
  assert.equal(toasts, 1);
  assert.deepEqual(persistedAtCallback, callbackMessages);
  assert.equal(persistedAtCallback.length, 1);
  assert.equal(bridge.snapshot()[0].name, '名字');
  assert.equal(bridge.snapshot()[0].content, '内容');
  const snapshot = bridge.snapshot();
  snapshot.pop();
  assert.equal(bridge.snapshot().length, 1);
  bridge.showToast('');
  bridge.showToast('x'.repeat(101));
  assert.equal(toasts, 1);
  bridge.close();
  assert.equal(JSON.parse(bridge.submitMessage('a', 'b')).ok, false);
});
check('Corrupt history blocks submissions and retains original bytes', (directory) => {
  const filename = path.join(directory, 'messages.json');
  fs.writeFileSync(filename, '{broken');
  const bridge = new MessageBridge();
  assert.throws(() => bridge.initialize(directory, () => {}, () => {}));
  assert.equal(JSON.parse(bridge.submitMessage('a', 'b')).ok, false);
  assert.equal(fs.readFileSync(filename, 'utf8'), '{broken');
});
check('Bridge enforces the persisted 500-message capacity', (directory, store) => {
  store.save(Array.from({ length: 500 }, (_, index) => message(String(index))));
  const bridge = new MessageBridge();
  bridge.initialize(directory, () => assert.fail('Unexpected update'), () => {});
  assert.equal(JSON.parse(bridge.submitMessage('a', 'b')).ok, false);
  assert.equal(new MessageStore(directory).load().length, 500);
});
check('Page calls round-trip hostile text as data and reject unknown methods', () => {
  const hostile = '\'); globalThis.pwned = true; // </script> " \\ \n \u2028 \u2029';
  for (const [method, value] of [
    ['notify', hostile], ['renderMessages', [{ ...message('1'), content: hostile }]]
  ]) {
    let received;
    const context = { window: { MessageBoard: { [method]: data => { received = data; } } } };
    const source = model.pageCall(method, value);
    assert.equal(source.includes('\u2028'), false);
    assert.equal(source.includes('\u2029'), false);
    vm.runInNewContext(source, context);
    assert.equal(context.pwned, undefined);
    assert.equal(JSON.stringify(received), JSON.stringify(value));
  }
  assert.throws(() => model.pageCall('notify;alert', 'text'));
});
console.log(`${checks} message board tests passed.`);
