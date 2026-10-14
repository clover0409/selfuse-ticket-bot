const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../scripts/melonticket/korean-concert.js'), 'utf8');

function startFixture(overrides = {}) {
    const clicks = [];
    const storage = new Map();
    const buttons = {
        date: { click: () => clicks.push('date') },
        time: { click: () => clicks.push('time') },
        reserve: { disabled: false, dataset: { prodid: '214042' }, click: () => clicks.push('reserve') },
    };
    const dates = [
        { dataset: { perfday: '20261017' }, querySelector: () => buttons.date },
        { dataset: { perfday: '20261018' }, querySelector: () => ({ click: () => clicks.push('wrong date') }) },
    ];
    const times = [
        { textContent: '15시 00분', querySelector: () => buttons.time },
        { textContent: '18시 00분', querySelector: () => ({ click: () => clicks.push('wrong time') }) },
    ];
    let now = overrides.now ?? Date.parse('2026-10-14T12:00:00+09:00');
    let listener;
    let reloads = 0;
    const context = {
        window: { TicketBotConfig: { storageKeys: { botRunState: 'ticketBotRunState' }, actions: { startBot: 'startTicketBot', stopBot: 'stopTicketBot' } } },
        document: {
            querySelector: selector => selector === '.box_ticketing_process' ? {} : selector === '#ticketReservation_Btn' ? buttons.reserve : null,
            querySelectorAll: selector => selector === '#list_date li[data-perfday]' ? dates : selector === '#list_time li' ? times : [],
        },
        location: { href: 'https://ticket.melon.com/performance/index.htm?prodId=214042', reload: () => { reloads += 1; } },
        sessionStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
        },
        chrome: {
            runtime: { onMessage: { addListener: callback => { listener = callback; } } },
            storage: { onChanged: { addListener() {} } },
        },
        getComputedStyle: () => ({ display: overrides.panelHidden ? 'none' : 'block' }),
        get_stored_value: async () => null,
        store_value: async (key, value) => storage.set(key, value),
        sleep: async milliseconds => { now += milliseconds; },
        Date: class extends Date { static now() { return now; } },
        URL,
        console: { log() {}, error() {} },
    };
    vm.runInNewContext(script, context);
    const config = {
        'concert-id': '214042',
        date: '2026-10-17',
        time: '15:00',
        ...overrides.config,
    };
    listener({ action: 'startTicketBot', platform: 'melon', config }, {}, () => {});
    return { clicks, storage, get reloads() { return reloads; } };
}

async function drain() {
    await new Promise(resolve => setImmediate(resolve));
}

test('selects the configured Korean performance and clicks reserve only once', async () => {
    const fixture = startFixture();
    await drain();
    assert.deepEqual(fixture.clicks, ['date', 'time', 'reserve']);
    assert.equal(fixture.storage.get('ticketBotRunState').running, false);
});

test('waits until the configured Korea time, then reloads before entering', async () => {
    const fixture = startFixture({ config: { saleStartAt: '2026-10-14T12:00:03' } });
    await drain();
    assert.equal(fixture.reloads, 1);
    assert.deepEqual(fixture.clicks, []);
});

test('does not click when the selected date is unavailable', async () => {
    const fixture = startFixture({ config: { date: '2026-10-19' } });
    await drain();
    assert.deepEqual(fixture.clicks, []);
    assert.equal(fixture.storage.get('ticketBotRunState').running, false);
});

test('does not click before the booking panel opens', async () => {
    const fixture = startFixture({ panelHidden: true });
    await drain();
    assert.deepEqual(fixture.clicks, []);
    assert.equal(fixture.storage.get('ticketBotRunState').running, false);
});
