import baseWorker, { ConsentStore, AppStore } from './production-v69-targeted-fixes.js';

export { ConsentStore, AppStore };

const RELEASE = '70';
const CONSENT_VERSION = '2026-09-09-v1';

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
        if (userId) {
          const work = syncOpenButtonForConsent(env, userId, publicAppUrl(env, url.origin));
          if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
        }
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

async function syncOpenButtonForConsent(env, userId, webAppUrl) {
  const consent = await getConsent(env, userId);
  const accepted = consent?.status === 'accepted' && consent?.version === CONSENT_VERSION;
  if (accepted) {
    await telegramSafe(env, 'setChatMenuButton', {
      chat_id:userId,
      menu_button:{
        type:'web_app',
        text:'Открыть',
        web_app:{ url:webAppUrl },
      },
    });
    return;
  }

  // A user who has not accepted (or has declined) must not get a Web App
  // shortcut that bypasses the existing consent gate.
  await telegramSafe(env, 'setChatMenuButton', {
    chat_id:userId,
    menu_button:{ type:'commands' },
  });
}

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const response = await env.CONSENT_STORE.get(id).fetch('https://consent.internal/record');
    return response.ok ? await response.json().catch(() => null) : null;
  } catch {
    return null;
  }
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
