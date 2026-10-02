import baseWorker, { ConsentStore, AppStore } from './production-v69-targeted-fixes.js';

export { ConsentStore, AppStore };

const RELEASE = '70';
let defaultMenuConfiguredAt = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      const expectedSecret = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
      const suppliedSecret = String(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '');
      const trusted = !expectedSecret || suppliedSecret === expectedSecret;
      let update = null;
      if (trusted) {
        try { update = await request.clone().json(); } catch {}
      }

      const response = await baseWorker.fetch(request, env, ctx);
      if (trusted && response.ok && env.TELEGRAM_BOT_TOKEN) {
        const userId = positiveInt(update?.message?.from?.id || update?.edited_message?.from?.id || update?.callback_query?.from?.id);
        const work = configureOpenButtons(env, userId, publicAppUrl(env, url.origin));
        if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
      }
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function publicAppUrl(env, origin) {
  const configured = String(env.PUBLIC_WEBAPP_URL || env.WEBAPP_URL || '').trim();
  let base = configured || 'https://bot.housecleaningspb.ru';
  try {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    base = parsed.origin + parsed.pathname.replace(/\/$/, '');
  } catch {
    base = String(origin || 'https://bot.housecleaningspb.ru').replace(/\/$/, '');
  }
  return `${base}/?demo=1&release=${RELEASE}`;
}

async function configureOpenButtons(env, userId, webAppUrl) {
  const menuButton = {
    type: 'web_app',
    text: 'Открыть',
    web_app: { url:webAppUrl },
  };
  const tasks = [];

  if (userId) {
    tasks.push(telegramSafe(env, 'setChatMenuButton', {
      chat_id:userId,
      menu_button:menuButton,
    }));
  }

  // Keep the default menu configured as well so new users get the Mini App
  // launch action before a per-chat refresh is needed.
  if (Date.now() - defaultMenuConfiguredAt > 6 * 60 * 60 * 1000) {
    defaultMenuConfiguredAt = Date.now();
    tasks.push(telegramSafe(env, 'setChatMenuButton', { menu_button:menuButton }));
  }

  await Promise.allSettled(tasks);
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

async function telegramSafe(env, method, payload) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram ${method} failed`);
    return data.result;
  } catch (error) {
    console.warn(`Telegram ${method} skipped`, error?.message || error);
    return null;
  }
}
