const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

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
const arkUtil = {
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
const model = loadTypeScript('../entry/src/main/ets/model/Card.ts', {});
const { CardStore } = loadTypeScript('../entry/src/main/ets/store/CardStore.ets', {
  '../model/Card': model,
  '@kit.CoreFileKit': { fileIo },
  '@kit.ArkTS': { util: arkUtil }
});
function card(id) {
  return Object.assign(model.emptyCard(), {
    id, name: '名片 ' + id, phone: '13800138000', notes: '中文与 🌟', createdAt: 100, updatedAt: 100
  });
}
let checks = 0;
function check(name, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'card-store-test-'));
  failure = '';
  maximumWrite = Infinity;
  try {
    run(directory, new CardStore(directory));
    assert.equal(handles.size, 0, 'File handles must be closed');
    checks++;
    console.log('PASS ' + name);
  } finally {
    for (const fd of handles) fs.closeSync(fd);
    handles.clear();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
check('An empty installation loads an empty list', (directory, store) => {
  assert.deepEqual(store.load(), []);
});
check('Snapshots survive new store instances and persist updates and deletion', (directory, store) => {
  const cards = [card('1'), card('2')];
  store.save(cards);
  assert.deepEqual(new CardStore(directory).load(), cards);
  cards[0].name = '已更新';
  cards[0].favorite = true;
  cards[0].updatedAt = 200;
  store.save(cards);
  assert.deepEqual(new CardStore(directory).load(), cards);
  cards.splice(1, 1);
  store.save(cards);
  assert.deepEqual(new CardStore(directory).load(), cards);
  store.save([]);
  assert.deepEqual(new CardStore(directory).load(), []);
  assert.equal(fs.existsSync(path.join(directory, 'cards.json.tmp')), false);
});
check('Partial writes preserve the complete Unicode snapshot', (directory, store) => {
  maximumWrite = 7;
  const cards = [card('1')];
  store.save(cards);
  assert.deepEqual(new CardStore(directory).load(), cards);
});
check('Malformed JSON, invalid records and duplicate IDs are rejected without changing the file', (directory, store) => {
  const invalid = [
    '{broken', '{}', 'null', '[null]', '[{}]',
    JSON.stringify([Object.assign(card('1'), { favorite: 'yes' })]),
    JSON.stringify([Object.assign(card('1'), { name: '' })]),
    JSON.stringify([Object.assign(card('1'), { phone: 'oops' })]),
    JSON.stringify([Object.assign(card('1'), { updatedAt: null })]),
    JSON.stringify([card('1'), card('1')])
  ];
  for (const content of invalid) {
    const filename = path.join(directory, 'cards.json');
    fs.writeFileSync(filename, content);
    assert.throws(() => store.load());
    assert.equal(fs.readFileSync(filename, 'utf8'), content);
  }
});
for (const fault of ['write', 'zero-write', 'fsync', 'rename']) {
  check(fault + ' failure retains the last saved snapshot and allows retry', (directory, store) => {
    const original = [card('1')];
    store.save(original);
    const filename = path.join(directory, 'cards.json');
    const originalBytes = fs.readFileSync(filename);
    failure = fault;
    assert.throws(() => store.save([card('2')]));
    assert.equal(handles.size, 0);
    assert.deepEqual(fs.readFileSync(filename), originalBytes);
    assert.deepEqual(new CardStore(directory).load(), original);
    assert.deepEqual(original, [card('1')]);
    failure = '';
    store.save([card('3')]);
    assert.deepEqual(new CardStore(directory).load(), [card('3')]);
  });
}
console.log(`${checks} persistence tests passed.`);
