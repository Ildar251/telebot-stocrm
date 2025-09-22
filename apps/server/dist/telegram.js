import crypto from 'crypto';
/**
 * Verify Telegram WebApp initData according to docs:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export function verifyInitData(initData, botToken) {
    try {
        const parsed = Object.fromEntries(new URLSearchParams(initData));
        const hash = parsed['hash'];
        if (!hash)
            return { ok: false };
        // data_check_string
        const entries = Object.entries(parsed)
            .filter(([k]) => k !== 'hash')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
        const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const _hash = crypto.createHmac('sha256', secret).update(entries).digest('hex');
        if (_hash !== hash)
            return { ok: false };
        const userStr = parsed['user'];
        if (!userStr)
            return { ok: false };
        const user = JSON.parse(userStr);
        return { ok: true, userId: user?.id };
    }
    catch {
        return { ok: false };
    }
}
