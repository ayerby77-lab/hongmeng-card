const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() { this.value = ''; this.textContent = ''; this.children = []; this.handlers = {}; this.disabled = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
}
const nodes = new Map();
const document = {
  getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
  createElement() { return new Element(); }
};
const context = { document, window: {} };
vm.createContext(context);
const html = fs.readFileSync('entry/src/main/resources/rawfile/message-board.html', 'utf8');
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const node = id => document.getElementById(id);
const submit = () => node('form').handlers.submit({ preventDefault() {} });
submit(); assert.equal(node('submit').disabled, true);
context.window.MessageBoard.renderMessages([]);
assert.equal(node('submit').disabled, false);
assert.match(node('messages').children[0].textContent, /还没有留言/);
node('name').value = ' 张三 '; node('content').value = ' 保留输入 ';
context.window.NativeBoard = { submitMessage() { return JSON.stringify({ ok: false, error: '磁盘已满' }); } };
submit(); assert.equal(node('content').value, ' 保留输入 '); assert.equal(node('status').textContent, '磁盘已满');
context.window.NativeBoard.submitMessage = () => { throw new Error('bridge unavailable'); };
submit(); assert.equal(node('content').value, ' 保留输入 '); assert.match(node('status').textContent, /连接异常/);
const payload = '<img src=x onerror="alert(1)">';
context.window.NativeBoard.submitMessage = (name, content) => {
  assert.equal(name, '张三'); assert.equal(content, '保留输入');
  context.window.MessageBoard.renderMessages([{ name, content: payload, createdAt: 100 }]);
  return JSON.stringify({ ok: true });
};
submit(); assert.equal(node('content').value, '');
assert.equal(node('messages').children[0].children[2].textContent, payload);
assert.equal(node('messages').children[0].children[2].children.length, 0);
context.window.MessageBoard.notify('原生通知'); assert.equal(node('notice').textContent, '原生通知'); assert.equal(node('notice').hidden, false);
let toast; context.window.NativeBoard.showToast = value => { toast = value; };
node('toast').handlers.click(); assert.match(toast, /鸿蒙原生/);
console.log('PASS webpage initialization, submit success/failure, safe rendering, native notification and Toast handlers (DOM stub).');
