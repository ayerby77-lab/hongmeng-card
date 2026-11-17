// 人体浏览模块 · 本地资源路径映射（纯函数，无 ArkWeb 依赖，可独立测试）。
//
// human-atlas 构建产物在 rawfile 中的根目录。
export const ATLAS_ROOT: string = 'human-atlas/';

// ArkWeb 禁止 file/resource 协议下的跨域访问，且 Fetch API 不支持 resource://。
// 按华为官方文档，用一个不会真正联网的 https 域名作页面源，所有请求由
// onInterceptRequest 映射回 rawfile；这样 JS 的 fetch/WebGL 都在 http(s) 源下运行。
export const ATLAS_ORIGIN: string = 'https://www.example.com/';
export const ATLAS_PAGE_URL: string = ATLAS_ORIGIN + ATLAS_ROOT + 'index.html';

// 仅供历史 resource:// 入口与本地测试兼容；正常页面不再使用 resource 协议。
const ATLAS_HOSTS: string[] = ['www.example.com', 'example.com'];

function stripHashQuery(rawUrl: string): string {
  let url: string = rawUrl === undefined || rawUrl === null ? '' : rawUrl;
  const hashAt: number = url.indexOf('#');
  if (hashAt >= 0) {
    url = url.substring(0, hashAt);
  }
  const queryAt: number = url.indexOf('?');
  if (queryAt >= 0) {
    url = url.substring(0, queryAt);
  }
  return url;
}

function schemeOf(url: string): string {
  const at: number = url.indexOf('://');
  if (at >= 0) {
    return url.substring(0, at).toLowerCase();
  }
  // data: / about: / blob: 没有双斜杠，也必须识别为协议，避免误当成相对路径。
  const colonAt: number = url.indexOf(':');
  const slashAt: number = url.indexOf('/');
  if (colonAt > 0 && (slashAt < 0 || colonAt < slashAt)) {
    return url.substring(0, colonAt).toLowerCase();
  }
  return '';
}

function hostOf(url: string): string {
  const at: number = url.indexOf('://');
  if (at < 0) {
    return '';
  }
  const rest: string = url.substring(at + 3);
  const slashAt: number = rest.indexOf('/');
  const authority: string = slashAt < 0 ? rest : rest.substring(0, slashAt);
  const colonAt: number = authority.indexOf(':');
  return (colonAt < 0 ? authority : authority.substring(0, colonAt)).toLowerCase();
}

function pathOf(url: string): string {
  const scheme: string = schemeOf(url);
  if (scheme.length === 0) {
    return url.startsWith('/') ? url.substring(1) : url;
  }
  const rest: string = url.substring(url.indexOf('://') + 3);
  const slashAt: number = rest.indexOf('/');
  return slashAt < 0 ? '' : rest.substring(slashAt + 1);
}

// 判断请求是否属于本地 Atlas。非 Atlas 请求（例如页面里的外部署名链接）
// 必须交还 Web 自己处理，不能一律返回 404 或映射到 rawfile。
export function isAtlasRequest(rawUrl: string): boolean {
  const url: string = stripHashQuery(rawUrl);
  if (url.length === 0) {
    return false;
  }
  const scheme: string = schemeOf(url);
  if (scheme.length === 0 || scheme === 'resource') {
    return true;
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return false;
  }
  const host: string = hostOf(url);
  if (ATLAS_HOSTS.indexOf(host) < 0) {
    return false;
  }
  const path: string = decodePath(pathOf(url));
  return path === ATLAS_ROOT || path.startsWith(ATLAS_ROOT) || path.startsWith('models/');
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch (e) {
    return path;
  }
}

// 将 Web 侧发出的请求 URL 归一化为 rawfile 相对路径。
// 假域名下的相对资源（./assets/*、./models/atlas.json）以及根路径分块
// （/models/body-N.bin.gz）都要映射到 ATLAS_ROOT 下。
export function mapRawfilePath(rawUrl: string): string {
  const url: string = stripHashQuery(rawUrl);
  let path: string = decodePath(pathOf(url));

  // 归一相对写法 './x'（浏览器多数情况已解析为绝对 URL，直接输入时仍需处理）。
  while (path.startsWith('./')) {
    path = path.substring(2);
  }

  if (path.length === 0 || path.indexOf('..') >= 0) {
    return '';
  }
  if (!path.startsWith(ATLAS_ROOT)) {
    path = ATLAS_ROOT + path;
  }
  return path;
}

// 按扩展名给出响应 MIME。
export function mimeOfPath(path: string): string {
  if (path.endsWith('.html')) {
    return 'text/html';
  }
  if (path.endsWith('.js')) {
    return 'text/javascript';
  }
  if (path.endsWith('.css')) {
    return 'text/css';
  }
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (path.endsWith('.gz')) {
    return 'application/gzip';
  }
  return 'application/octet-stream';
}
