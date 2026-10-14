// Korean Melon booking popup: solve the text challenge only for a booking this extension started.
(async () => {
    const pendingKey = 'melonCaptchaPending';
    const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const options = window.TicketBotConfig?.melon?.captchaOcr || {};
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
    const codeLength = Number(options.codeLength) || 6;

    function visible(element) {
        if (!element) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function showStatus(message) {
        const modal = document.querySelector('#certification');
        if (!modal) return;
        let status = modal.querySelector('#ticketBotMelonCaptchaStatus');
        if (!status) {
            status = document.createElement('p');
            status.id = 'ticketBotMelonCaptchaStatus';
            status.style.cssText = 'margin:8px 0;color:#555;font-size:13px;text-align:center';
            document.querySelector('#label-for-captcha')?.insertAdjacentElement('afterend', status);
        }
        status.textContent = message;
    }

    async function waitForImage(previous = '', deadline = Date.now() + 10000) {
        while (Date.now() < deadline) {
            const modal = document.querySelector('#certification');
            const image = document.querySelector('#captchaImg')?.getAttribute('src') || '';
            if (visible(modal) && image.startsWith('data:image/png;base64,') && image !== previous) {
                return image;
            }
            await pause(250);
        }
        return '';
    }

    const stored = (await chrome.storage.local.get(pendingKey))[pendingKey];
    if (!stored || !/^\d+$/.test(stored.prodId) || Date.now() >= stored.expiresAt) return;

    // The booking page is opened by Melon itself and can be delayed by its queue.
    while (Date.now() < stored.expiresAt) {
        const pageProdId = document.querySelector('#prodId')?.value;
        if (pageProdId && pageProdId !== stored.prodId) return;
        if (pageProdId === stored.prodId && visible(document.querySelector('#certification'))) break;
        await pause(500);
    }
    if (Date.now() >= stored.expiresAt) return;

    let image = await waitForImage();
    for (let attempt = 0; attempt < maxAttempts && image; attempt++) {
        showStatus('正在识别验证码…');
        let result;
        try {
            result = await chrome.runtime.sendMessage({ action: 'melonCaptchaOcr', image });
        } catch (error) {
            result = { success: false, error: error.message };
        }
        const code = String(result?.code || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (!result?.success || code.length !== codeLength) {
            const reason = result?.error || `识别到 ${code.length} 位字符，需要 ${codeLength} 位`;
            showStatus(`自动识别失败：${reason}。请手动输入验证码。`);
            return;
        }

        const input = document.querySelector('#label-for-captcha');
        const complete = document.querySelector('#btnComplete');
        if (!visible(document.querySelector('#certification')) || !input || !complete) return;
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const errorMessage = document.querySelector('#errorMessage');
        if (errorMessage) errorMessage.style.display = 'none';
        showStatus('已自动输入验证码，正在确认…');
        complete.click();

        const checkDeadline = Date.now() + 5000;
        while (Date.now() < checkDeadline) {
            if (!visible(document.querySelector('#certification'))) {
                await chrome.storage.local.remove(pendingKey);
                return;
            }
            if (visible(document.querySelector('#errorMessage'))) break;
            await pause(250);
        }
        if (attempt + 1 >= maxAttempts) break;
        const reload = document.querySelector('#btnReload');
        if (!reload) break;
        reload.click();
        image = await waitForImage(image);
    }
    showStatus('自动识别未通过，请手动输入验证码。');
})().catch(error => console.warn('[Melon KR] Captcha:', error));
