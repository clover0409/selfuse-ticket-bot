const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../scripts/melonticket/korean-captcha.js'), 'utf8');

async function runFixture({ pageProdId = '213983', ocr = { success: true, code: 'TZXWLX' } } = {}) {
    let modalVisible = true;
    let sent = 0;
    let removed = false;
    const children = new Map();
    const modal = { querySelector: selector => children.get(selector) || null };
    const input = {
        value: '',
        dispatchEvent() {},
        insertAdjacentElement: (position, node) => children.set(`#${node.id}`, node),
    };
    const elements = {
        '#prodId': { value: pageProdId },
        '#certification': modal,
        '#captchaImg': { getAttribute: () => 'data:image/png;base64,iVBORw0KGgo=' },
        '#label-for-captcha': input,
        '#btnComplete': { click: () => { modalVisible = false; } },
    };
    const context = {
        window: { TicketBotConfig: { melon: { captchaOcr: { maxAttempts: 2, codeLength: 6 } } } },
        document: {
            querySelector: selector => elements[selector] || null,
            createElement: () => ({ style: {} }),
        },
        chrome: {
            storage: { local: {
                get: async () => ({ melonCaptchaPending: { prodId: '213983', expiresAt: Date.now() + 60000 } }),
                remove: async () => { removed = true; },
            } },
            runtime: { sendMessage: async () => { sent++; return ocr; } },
        },
        getComputedStyle: element => ({ display: element === modal && !modalVisible ? 'none' : 'block', visibility: 'visible' }),
        setTimeout,
        Date,
        Event,
        console: { warn() {} },
    };
    vm.runInNewContext(script, context);
    await new Promise(resolve => setTimeout(resolve, 20));
    return { sent, removed, input, status: children.get('#ticketBotMelonCaptchaStatus') };
}

test('enters and submits OCR text for the matching Korean Melon booking', async () => {
    const result = await runFixture();
    assert.equal(result.sent, 1);
    assert.equal(result.input.value, 'TZXWLX');
    assert.equal(result.removed, true);
});

test('leaves captcha for manual entry when local OCR is unavailable', async () => {
    const result = await runFixture({ ocr: { success: false } });
    assert.equal(result.sent, 1);
    assert.equal(result.input.value, '');
    assert.equal(result.removed, false);
    assert.match(result.status.textContent, /手动输入/);
});

test('does not handle a different event booking', async () => {
    const result = await runFixture({ pageProdId: '214042' });
    assert.equal(result.sent, 0);
    assert.equal(result.input.value, '');
});
