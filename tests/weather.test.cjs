const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require(process.env.TYPESCRIPT_PATH || '/Applications/DevEco-Studio.app/Contents/tools/hvigor/hvigor/node_modules/typescript');
function load(relative, imports) {
  const filename = path.resolve(__dirname, relative);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true, fileName: filename.replace(/\.ets$/, '.ts')
  });
  assert.equal(result.diagnostics.length, 0);
  const loaded = new Module(filename, module);
  loaded.require = id => { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; };
  loaded._compile(result.outputText, filename);
  return loaded.exports;
}
const model = load('../entry/src/main/ets/model/Weather.ts', {});
function fixture() {
  return { current: { time: '2026-09-29T10:00', temperature_2m: 24.5, relative_humidity_2m: 65,
    wind_speed_10m: 12, wind_direction_10m: 180, weather_code: 2 }, daily: {
    time: ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
    temperature_2m_min: Array(7).fill(18), temperature_2m_max: Array(7).fill(28),
    weather_code: Array(7).fill(61), precipitation_probability_max: Array(7).fill(80) } };
}
const payload = fixture();
const parsed = model.parseWeather(JSON.stringify(payload));
assert.equal(parsed.temperature, 24.5);
assert.equal(parsed.humidity, 65);
assert.equal(parsed.windSpeed, 12);
assert.equal(parsed.windDirection, 180);
assert.equal(parsed.days.length, 7);
assert.deepEqual(parsed.days[0], { date: '2026-09-29', min: 18, max: 28, code: 61, rainProbability: 80 });
for (const input of ['null', '{}', '{broken', JSON.stringify({ current: {} })]) assert.throws(() => model.parseWeather(input));
for (const mutate of [p => p.current.temperature_2m = null, p => p.current.relative_humidity_2m = 101,
  p => p.current.wind_speed_10m = -1, p => p.current.wind_direction_10m = 361,
  p => p.daily.time.pop(), p => p.daily.temperature_2m_min = null,
  p => p.daily.temperature_2m_max[0] = 5, p => p.daily.precipitation_probability_max[0] = null,
  p => p.daily.precipitation_probability_max[0] = 101]) {
  const p = fixture(); mutate(p); assert.throws(() => model.parseWeather(JSON.stringify(p)));
}
assert.equal(model.weatherText(0), '晴');
assert.equal(model.weatherText(99), '雷雨伴冰雹');
assert.equal(model.weatherText(1000), '天气未知');
assert.deepEqual([0, 1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118].map(model.windLevel), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
let online = true;
let throwProbe = false;
let syncThrow = false;
const calls = [];
const http = { RequestMethod: { GET: 1 }, HttpDataType: { STRING: 1 }, createHttp() {
  const call = { destroyed: 0 };
  calls.push(call);
  return { destroy() { call.destroyed++; }, request(url, options) {
    if (syncThrow) throw new Error('native synchronous error');
    call.url = url; call.options = options;
    return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
  } };
} };
const connection = { hasDefaultNetSync() { if (throwProbe) throw new Error('probe failed'); return online; } };
const { WeatherService } = load('../entry/src/main/ets/service/WeatherService.ets', {
  '@kit.NetworkKit': { http, connection }, '../model/Weather': model
});
const response = () => ({ responseCode: 200, result: JSON.stringify(fixture()) });
async function run() {
  const service = new WeatherService();
  let pending = service.fetch(31, 121);
  let call = calls.at(-1);
  assert.match(call.url, /forecast_days=7/);
  assert.match(call.url, /timezone=Asia%2FShanghai/);
  assert.match(call.url, /wind_speed_unit=kmh/);
  assert.equal(call.options.usingCache, false);
  call.resolve(response());
  assert.equal((await pending).temperature, 24.5);
  assert.equal(call.destroyed, 1);
  online = false;
  const count = calls.length;
  await assert.rejects(service.fetch(31, 121), /无网络/);
  assert.equal(calls.length, count);
  online = true;
  await assert.rejects(service.fetch(NaN, 121), /坐标/);
  for (const [reply, expected] of [ [{ responseCode: 429 }, /频繁/], [{ responseCode: 503 }, /暂时不可用/],
    [{ responseCode: 200, result: '{broken' }, /数据不完整/] ]) {
    pending = service.fetch(31, 121); call = calls.at(-1); call.resolve(reply);
    await assert.rejects(pending, expected); assert.equal(call.destroyed, 1);
  }
  pending = service.fetch(31, 121); call = calls.at(-1); call.reject({ code: 2300028 });
  await assert.rejects(pending, /超时/); assert.equal(call.destroyed, 1);
  pending = service.fetch(31, 121); call = calls.at(-1); online = false; call.reject({ code: 1 });
  await assert.rejects(pending, /无网络/); online = true;
  const stale = service.fetch(31, 121); const staleCall = calls.at(-1);
  const staleCheck = assert.rejects(stale, /取消/);
  const latest = service.fetch(40, 116); const latestCall = calls.at(-1);
  staleCall.resolve(response());
  await staleCheck;
  await Promise.resolve();
  service.cancel();
  await assert.rejects(latest, /取消/);
  assert.equal(staleCall.destroyed, 1); assert.equal(latestCall.destroyed, 1);
  // Destroy need not resolve the native promise: cancellation still settles callers.
  pending = service.fetch(31, 121); service.cancel(); await assert.rejects(pending, /取消/);
  syncThrow = true;
  await assert.rejects(service.fetch(31, 121), /连接天气服务失败/);
  assert.equal(calls.at(-1).destroyed, 1); syncThrow = false;
  throwProbe = true;
  pending = service.fetch(31, 121); calls.at(-1).resolve(response()); await pending; throwProbe = false;
  // Exercise the independent total timeout without waiting 15 seconds.
  const saved = global.setTimeout;
  global.setTimeout = callback => saved(callback, 1);
  pending = service.fetch(31, 121); call = calls.at(-1);
  global.setTimeout = saved;
  await assert.rejects(pending, /超时/); assert.equal(call.destroyed, 1);
  // A retry after failure receives fresh data and a fresh request.
  pending = service.fetch(31, 121); calls.at(-1).resolve(response()); await pending;
  assert.ok(calls.every(c => c.destroyed === 1), 'Every HTTP instance must be destroyed exactly once');
  console.log('PASS weather parsing, codes, wind boundaries, success, offline, HTTP errors, timeout, cancellation races and retry');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
