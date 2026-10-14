const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');

function fixture() {
    let listener;
    const calls = [];
    const child = {};
    const button = {
        disabled: false,
        dataset: { prodid: '213983' },
        scrollIntoView() {},
        getBoundingClientRect: () => ({ left: 20, top: 40, width: 100, height: 50 }),
        contains: hit => hit === child,
    };
    const chrome = {
        runtime: { onMessage: { addListener: callback => { listener = callback; } } },
        scripting: { executeScript: async ({ func, args }) => [{ result: func(...args) }] },
        debugger: {
            attach: async () => calls.push('attach'),
            sendCommand: async (target, method, payload) => calls.push(payload.type),
            detach: async () => calls.push('detach'),
        },
    };
    vm.runInNewContext(script, {
        chrome, URL,
        document: { querySelector: () => button, elementFromPoint: () => child },
    });
    const request = sender => new Promise(resolve => {
        listener({ action: 'melonTrustedClick', prodId: '213983' }, sender, resolve);
    });
    return { calls, request };
}

test('dispatches a browser mouse press and release for the matching Melon event', async () => {
    const { calls, request } = fixture();
    const result = await request({ tab: { id: 11 }, url: 'https://ticket.melon.com/performance/index.htm?prodId=213983' });
    assert.equal(result.success, true);
    assert.deepEqual(calls, ['attach', 'mouseMoved', 'mousePressed', 'mouseReleased', 'detach']);
});

test('rejects a click request from another site', async () => {
    const { calls, request } = fixture();
    const result = await request({ tab: { id: 11 }, url: 'https://tkglobal.melon.com/performance/index.htm?prodId=213983' });
    assert.equal(result.success, false);
    assert.deepEqual(calls, []);
});
