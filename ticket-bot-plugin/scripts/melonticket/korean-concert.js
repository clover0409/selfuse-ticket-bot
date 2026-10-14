// Korean Melon: enter the reservation flow only. Seat selection stays manual.
let koreanMelonRunning = false;
let koreanMelonRunId = 0;

const koreanMelonRunStateKey = window.TicketBotConfig?.storageKeys?.botRunState || "ticketBotRunState";
const koreanMelonStartAction = window.TicketBotConfig?.actions?.startBot || "startTicketBot";
const koreanMelonStopAction = window.TicketBotConfig?.actions?.stopBot || "stopTicketBot";

function koreanMelonConcertId() {
    return new URL(location.href).searchParams.get("prodId") || document.querySelector("#prodIdNum")?.value || "";
}

function koreanMelonSaleTime(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return NaN;
    return Date.parse(`${value}+09:00`);
}

function koreanMelonRefreshKey(config) {
    return `ticketBotMelonRefresh:${koreanMelonConcertId()}:${config.saleStartAt || "now"}`;
}

async function koreanMelonWaitUntil(timestamp, runId) {
    while (koreanMelonRunning && runId === koreanMelonRunId && Date.now() < timestamp) {
        await sleep(Math.min(timestamp - Date.now(), 1000));
    }
    return koreanMelonRunning && runId === koreanMelonRunId;
}

async function koreanMelonWaitFor(selector, runId, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (koreanMelonRunning && runId === koreanMelonRunId && Date.now() < deadline) {
        const nodes = [...document.querySelectorAll(selector)];
        if (nodes.length) return nodes;
        await sleep(100);
    }
    return [];
}

async function koreanMelonWaitForBookingPanel(runId) {
    const deadline = Date.now() + 8000;
    while (koreanMelonRunning && runId === koreanMelonRunId && Date.now() < deadline) {
        const panel = document.querySelector(".box_ticketing_process");
        if (panel && getComputedStyle(panel).display !== "none") return true;
        await sleep(200);
    }
    return false;
}

function koreanMelonTimeFromText(text) {
    const match = text.match(/(\d{1,2})\s*(?:시|:)\s*(\d{1,2})/);
    return match ? `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}` : "";
}

async function koreanMelonSelectDate(config, runId) {
    const dates = await koreanMelonWaitFor("#list_date li[data-perfday]", runId);
    const wanted = (config.date || "").replaceAll("-", "");
    const selected = wanted ? dates.find(date => date.dataset.perfday === wanted) : dates.length === 1 ? dates[0] : null;
    if (!selected?.querySelector("button")) throw new Error("找不到配置的演出日期");
    selected.querySelector("button").click();
}

async function koreanMelonSelectTime(config, runId) {
    const times = await koreanMelonWaitFor("#list_time li", runId);
    const wanted = config.time || "";
    const selected = wanted
        ? times.find(time => koreanMelonTimeFromText(time.textContent) === wanted)
        : times.length === 1 ? times[0] : null;
    if (!selected?.querySelector("button")) throw new Error("找不到配置的演出场次");
    selected.querySelector("button").click();
}

async function koreanMelonStop() {
    koreanMelonRunning = false;
    koreanMelonRunId += 1;
    await store_value(koreanMelonRunStateKey, {
        running: false,
        platform: "melon",
        concertId: koreanMelonConcertId(),
    });
}

async function koreanMelonRun(config, runId) {
    const configuredId = (config["concert-id"] || "").trim();
    const configId = /^https?:\/\//i.test(configuredId)
        ? new URL(configuredId).searchParams.get("prodId")
        : configuredId;
    if (configId !== koreanMelonConcertId()) throw new Error("当前页面与 Melon 卡片的演出 ID 不一致");

    const saleTime = koreanMelonSaleTime(config.saleStartAt);
    if (Number.isNaN(saleTime)) throw new Error("开票时间格式无效");

    const refreshKey = koreanMelonRefreshKey(config);
    if (saleTime && Date.now() < saleTime) {
        console.log("[Melon KR] 等待韩国时间", config.saleStartAt);
        if (!await koreanMelonWaitUntil(saleTime, runId)) return;
        sessionStorage.setItem(refreshKey, "1");
        location.reload();
        return;
    }

    if (!await koreanMelonWaitForBookingPanel(runId)) {
        const refreshes = Number(sessionStorage.getItem(refreshKey) || "0");
        if (saleTime && refreshes < 3 && koreanMelonRunning && runId === koreanMelonRunId) {
            sessionStorage.setItem(refreshKey, String(refreshes + 1));
            await sleep(1500);
            if (koreanMelonRunning && runId === koreanMelonRunId) location.reload();
            return;
        }
        throw new Error("韩版 Melon 预订区域仍未开放");
    }

    await koreanMelonSelectDate(config, runId);
    await koreanMelonSelectTime(config, runId);
    if (!koreanMelonRunning || runId !== koreanMelonRunId) return;

    const button = document.querySelector("#ticketReservation_Btn");
    if (!button || button.disabled || button.dataset.prodid !== koreanMelonConcertId()) {
        throw new Error("韩版 Melon 预订按钮不可用");
    }
    sessionStorage.removeItem(refreshKey);
    await koreanMelonStop();
    button.click();
    console.log("[Melon KR] 已点击预订，后续排队由网站处理");
}

function koreanMelonStart(config, fromStoredState = false) {
    if (koreanMelonRunning) return;
    if (!config || !config["concert-id"]) {
        console.error("[Melon KR] 缺少演出配置");
        return;
    }
    if (!fromStoredState) sessionStorage.removeItem(koreanMelonRefreshKey(config));
    koreanMelonRunning = true;
    const runId = ++koreanMelonRunId;
    koreanMelonRun(config, runId).catch(async error => {
        console.error("[Melon KR]", error);
        if (runId === koreanMelonRunId) await koreanMelonStop();
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === koreanMelonStartAction && request.platform === "melon") {
        koreanMelonStart(request.config);
        sendResponse({ status: "started" });
        return true;
    }
    if (request.action === koreanMelonStopAction && request.platform === "melon") {
        koreanMelonStop();
        sendResponse({ status: "stopped" });
        return true;
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    const state = changes[koreanMelonRunStateKey]?.newValue;
    if (areaName === "sync" && state &&
        (state.running === false || state.platform !== "melon" || state.concertId !== koreanMelonConcertId())) {
        koreanMelonRunning = false;
        koreanMelonRunId += 1;
    }
});

(async () => {
    const state = await get_stored_value(koreanMelonRunStateKey);
    if (state?.running && state.platform === "melon" && state.concertId === koreanMelonConcertId()) {
        koreanMelonStart(state.config, true);
    }
})();
