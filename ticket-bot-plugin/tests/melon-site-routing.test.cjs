const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../popup/mainPage/script.js'), 'utf8')
    .replace(/^import .*;\r?\n/, '');

function fixture(activeUrl = '') {
    const opened = [];
    const messages = [];
    const states = [];
    const context = {
        window: {
            TicketBotConfig: { storageKeys: { autoBooking: 'autoBooking', botRunState: 'ticketBotRunState' } },
            open: url => opened.push(url),
        },
        document: { getElementById: () => ({ innerHTML: '', textContent: '' }) },
        chrome: {
            tabs: {
                query: (options, callback) => {
                    const tabs = [{ id: 1, url: activeUrl }];
                    if (callback) callback(tabs);
                    return Promise.resolve(tabs);
                },
                sendMessage: (id, message, callback) => { messages.push(message); callback({ status: 'started' }); },
                create: ({ url }) => opened.push(url),
            },
            runtime: { lastError: null },
        },
        get_stored_value: async () => null,
        store_value: async (key, value) => states.push({ key, value }),
        URL,
        console: { error() {} },
    };
    vm.runInNewContext(script, context);
    return { context, opened, messages, states };
}

test('legacy global Melon cards retain the global entry URL', async () => {
    const { context, opened } = fixture();
    const card = { platform: 'melon', 'concert-id': '123456' };
    assert.equal(context.getMelonSite(card), 'global');
    context.openBookingUrl('melon', '123456', context.getMelonSite(card));
    assert.equal(opened[0], 'https://tkglobal.melon.com/performance/index.htm?langCd=EN&prodId=123456');
});

test('Korean cards and matching Korean tabs route to the Korean content script', async () => {
    const url = 'https://ticket.melon.com/performance/index.htm?prodId=213983';
    const { context, messages, states } = fixture(url);
    const card = { platform: 'melon', 'concert-id': '213983', saleStartAt: '' };
    assert.equal(context.getMelonSite(card), 'korean');
    await context.startBooking(card, { textContent: '' });
    assert.equal(states[0].value.platform, 'melonKorean');
    assert.equal(messages[0].platform, 'melonKorean');
});

test('an existing global card starts on a matching global tab', async () => {
    const url = 'https://tkglobal.melon.com/performance/index.htm?langCd=EN&prodId=123456';
    const { context, messages, states } = fixture(url);
    const card = { platform: 'melon', 'concert-id': '123456' };
    await context.startBooking(card, { textContent: '' });
    assert.equal(states[0].value.platform, 'melon');
    assert.equal(messages[0].platform, 'melon');
});

test('explicit Global selection overrides a previously saved Korean sale field', () => {
    const { context } = fixture();
    assert.equal(context.getMelonSite({ platform: 'melon', 'concert-id': '123456', saleStartAt: '', melonSite: 'global' }), 'global');
});
