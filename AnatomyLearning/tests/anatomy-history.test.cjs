// 人体浏览 · 浏览历史统一记录入口测试。
// 1) bridge/HistoryRecorder.ts —— 高频合并、串行顺序、失败上报、页面退出；
// 2) 记录入口的落库去重以真实规则 model/AnatomyRules.ts 的
//    normalizeStructure / planHistoryWrite 驱动（与 AnatomyStore 用的是同一份规则），
//    因此"同一结构只更新时间、不新增行"的验证基于生产规则而非重写副本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function loadTypeScript(relativePath, imports) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
    fileName: filename.replace(/\.ets$/, '.ts')
  });
  assert.equal(result.diagnostics.length, 0,
    relativePath + ' 转译诊断: ' + JSON.stringify(result.diagnostics.map(d => d.messageText)));
  const loaded = new Module(filename, module);
  loaded.require = id => {
    assert.ok(Object.hasOwn(imports, id), 'Unexpected dependency: ' + id);
    return imports[id];
  };
  loaded._compile(result.outputText, filename);
  return loaded.exports;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let passed = 0;
async function ok(name, fn) {
  await fn();
  passed += 1;
  console.log('PASS ' + name);
}

const model = loadTypeScript('entry/src/main/ets/model/Anatomy.ts', {});
const rules = loadTypeScript('entry/src/main/ets/model/AnatomyRules.ts', { './Anatomy': model });
const recMod = loadTypeScript('entry/src/main/ets/bridge/HistoryRecorder.ts', { '../model/Anatomy': model });
const HistoryRecorder = recMod.HistoryRecorder;

// 可控时钟：让 visitedAt 的先后关系确定，便于断言顺序。
const clock = { value: 1000, now: () => clock.value, tick: (delta) => { clock.value += delta; } };

// 以真实规则驱动的内存存储：normalizeStructure 校验 + planHistoryWrite 去重。
function makeMemoryStore() {
  const rows = new Map();
  return {
    rows,
    addHistory(id, name, systemId) {
      const structure = rules.normalizeStructure(id, name, systemId);
      if (structure === null) return Promise.resolve(false);
      const existing = rows.has(structure.id) ? rows.get(structure.id) : null;
      const plan = rules.planHistoryWrite(existing, structure, clock.now());
      rows.set(plan.row.id, plan.row);
      return Promise.resolve(true);
    },
    list() { // 与 AnatomyStore.listHistory 一致：按 visitedAt 倒序
      return Array.from(rows.values()).sort((a, b) => b.visitedAt - a.visitedAt);
    }
  };
}

function countingSink(inner) {
  const calls = [];
  return {
    calls,
    addHistory(id, name, systemId) {
      calls.push([id, name, systemId]);
      return inner ? inner(id, name, systemId) : Promise.resolve(true);
    }
  };
}

async function run() {
  await ok('点选两个结构后历史顺序正确且无重复行', async () => {
    const store = makeMemoryStore();
    const sink = countingSink((id, name, systemId) => store.addHistory(id, name, systemId));
    const rec = new HistoryRecorder(sink, 0);
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    await flush();
    clock.tick(50);
    rec.record({ id: 'FJ2', name: '肺', systemId: 'respiratory' });
    await flush();
    assert.deepEqual(sink.calls.map(c => c[0]), ['FJ1', 'FJ2'], '写入顺序应与点选顺序一致');
    assert.deepEqual(store.list().map(r => r.id), ['FJ2', 'FJ1'], '最近访问在前');
    assert.equal(store.rows.size, 2);
  });

  await ok('再次选择同一结构只更新时间、不新增行', async () => {
    const store = makeMemoryStore();
    const sink = countingSink((id, name, systemId) => store.addHistory(id, name, systemId));
    const rec = new HistoryRecorder(sink, 0);
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    await flush();
    clock.tick(50);
    rec.record({ id: 'FJ2', name: '肺', systemId: 'respiratory' });
    await flush();
    clock.tick(2000);
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    await flush();
    assert.equal(sink.calls.length, 3, '三次写入');
    assert.equal(store.rows.size, 2, '库中仍是两行（同一结构未新增）');
    assert.deepEqual(store.list().map(r => r.id), ['FJ1', 'FJ2'], '重选后 FJ1 顺序更新到最前');
  });

  await ok('高频重复点选同一结构只写一次库', async () => {
    const sink = countingSink(null);
    const rec = new HistoryRecorder(sink, 800);
    const row = { id: 'FJ1', name: '心脏', systemId: 'cardiac' };
    rec.record(row);
    rec.record(row);
    rec.record(row);
    await flush();
    assert.equal(sink.calls.length, 1, '最小间隔内的连续重复被合并');
  });

  await ok('交错点选 A→B→A 三次都记录（不误合并）', async () => {
    const sink = countingSink(null);
    const rec = new HistoryRecorder(sink, 800);
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    rec.record({ id: 'FJ2', name: '肺', systemId: 'respiratory' });
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    await flush();
    assert.deepEqual(sink.calls.map(c => c[0]), ['FJ1', 'FJ2', 'FJ1']);
  });

  await ok('写入失败有明确处理且不阻断后续记录', async () => {
    let fail = true;
    const calls = [];
    const sink = {
      addHistory(id) {
        calls.push(id);
        return fail ? Promise.reject(new Error('db busy')) : Promise.resolve(true);
      }
    };
    const rec = new HistoryRecorder(sink, 0);
    const errors = [];
    rec.setOnError((selection, message) => errors.push([selection.id, message]));
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    await flush();
    assert.deepEqual(errors, [['FJ1', 'db busy']], '失败经 onError 明确上报');
    fail = false;
    rec.record({ id: 'FJ2', name: '肺', systemId: 'respiratory' });
    await flush();
    assert.deepEqual(calls, ['FJ1', 'FJ2'], '后续记录继续执行');
    assert.equal(errors.length, 1);
  });

  await ok('页面退出后不再记录、不再上报在途结果', async () => {
    const calls = [];
    const sink = {
      addHistory(id) {
        calls.push(id);
        return Promise.reject(new Error('late failure'));
      }
    };
    const rec = new HistoryRecorder(sink, 0);
    const errors = [];
    rec.setOnError((selection, message) => errors.push(message));
    rec.record({ id: 'FJ1', name: '心脏', systemId: 'cardiac' });
    rec.dispose();
    await flush();
    assert.deepEqual(calls, ['FJ1'], '已入队的一次仍执行');
    assert.equal(errors.length, 0, 'dispose 后不误报');
    rec.record({ id: 'FJ2', name: '肺', systemId: 'respiratory' });
    await flush();
    assert.deepEqual(calls, ['FJ1'], 'dispose 后不再新增记录');
  });

  await ok('空 id / 空名称被忽略', async () => {
    const sink = countingSink(null);
    const rec = new HistoryRecorder(sink, 0);
    rec.record({ id: '   ', name: '心脏', systemId: '' });
    rec.record({ id: 'FJ1', name: '   ', systemId: '' });
    await flush();
    assert.equal(sink.calls.length, 0);
  });

  await ok('规则驱动的落库去重与顺序（复用生产规则）', async () => {
    const store = makeMemoryStore();
    clock.value = 1000;
    // 直接以真实规则走一遍：同一结构两次访问 + 另一结构
    await store.addHistory('FJ1', '心脏', 'cardiac');
    clock.tick(10);
    await store.addHistory('FJ2', '肺', 'respiratory');
    clock.tick(10);
    await store.addHistory('FJ1', '心脏', 'cardiac');
    assert.equal(store.rows.size, 2);
    assert.deepEqual(store.list().map(r => [r.id, r.visitedAt]), [['FJ1', 1020], ['FJ2', 1010]]);
  });

  console.log('\n' + passed + ' anatomy history tests passed.');
}

run().catch(error => {
  console.error('FAIL ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
