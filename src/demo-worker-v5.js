import baseWorker from './demo-worker-v4.js';

const CONSENT_VERSION = '2026-09-09-v1';
const OPERATOR = 'ИП Царегородцева Евгения Андреевна';
const OPERATOR_INN = '781157991880';
const OPERATOR_OGRNIP = '325784700025441';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/privacy' && request.method === 'GET') {
      return privacyPage(url.origin);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      const message = update?.message || update?.edited_message;
      const text = String(message?.text || '').trim().toLowerCase();

      if (text.startsWith('/start')) {
        await handleStart(message, env, url.origin);
        return new Response('OK');
      }

      if (text === '/privacy') {
        await sendPrivacyLink(message?.chat?.id, env, url.origin);
        return new Response('OK');
      }

      if (text === '/revoke') {
        await revokeConsent(message, env, url.origin);
        return new Response('OK');
      }

      const query = update?.callback_query;
      if (query && String(query.data || '').startsWith('pd:')) {
        await handleConsentCallback(query, env, url.origin);
        return new Response('OK');
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleStart(message, env, origin) {
  const chatId = Number(message?.chat?.id || 0);
  const userId = Number(message?.from?.id || 0);
  if (!chatId || !userId) return;

  const consent = await getConsent(env, userId);
  if (consent?.status === 'accepted' && consent?.version === CONSENT_VERSION) {
    await sendMainMenu(message, env, origin);
    return;
  }

  const firstName = escapeHtml(message?.from?.first_name || 'клиент');
  const text = [
    '<b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${firstName}.`,
    '',
    'Для записи на уборку нам необходимо обрабатывать персональные данные, необходимые для оформления и выполнения заказа:',
    '• данные Telegram (ID, имя, username — если указан);',
    '• имя и номер телефона;',
    '• адрес объекта и сведения о заказе;',
    '• фотографии объекта, которые вы самостоятельно добавите.',
    '',
    `Оператор: <b>${OPERATOR}</b>.`,
    '',
    'Согласие является добровольным. Без согласия оформление заявки через бота недоступно. Полный текст политики можно открыть отдельной кнопкой.',
  ].join('\n');

  await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Согласен на обработку персональных данных', callback_data: `pd:accept:${CONSENT_VERSION}` }],
        [{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }],
        [{ text: 'Не согласен', callback_data: `pd:decline:${CONSENT_VERSION}` }],
      ],
    },
  });
}

async function handleConsentCallback(query, env, origin) {
  const match = /^pd:(accept|decline):(.+)$/.exec(String(query?.data || ''));
  if (!match) return;

  const action = match[1];
  const version = match[2];
  const userId = Number(query?.from?.id || 0);
  if (!userId) return;

  if (version !== CONSENT_VERSION) {
    await safeTelegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Текст согласия обновлён. Нажмите /start и подтвердите актуальную версию.',
      show_alert: true,
    });
    return;
  }

  if (action === 'decline') {
    await persistConsent(env, query.from, 'declined');
    await logConsentToAdmins(env, query.from, 'ОТКАЗ', origin);
    await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Согласие не предоставлено' });
    await safeTelegram(env, 'editMessageText', {
      chat_id: query.message?.chat?.id,
      message_id: query.message?.message_id,
      text: '<b>HOUSE CLEANING</b>\n\nВы не предоставили согласие на обработку персональных данных. Оформление заявки через бота недоступно.\n\nЕсли передумаете — отправьте /start.',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }]] },
    });
    return;
  }

  await persistConsent(env, query.from, 'accepted');
  await logConsentToAdmins(env, query.from, 'СОГЛАСИЕ', origin);
  await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Согласие сохранено' });

  if (query.message?.chat?.id && query.message?.message_id) {
    await safeTelegram(env, 'editMessageText', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: '<b>HOUSE CLEANING</b>\n\nСогласие на обработку персональных данных принято. Теперь можно оформить заявку.',
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(env, query.from.id, origin),
    });
  }
}

async function sendMainMenu(message, env, origin) {
  const firstName = escapeHtml(message?.from?.first_name || 'клиент');
  await safeTelegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: [
      '<b>HOUSE CLEANING</b>',
      '',
      `Здравствуйте, ${firstName}.`,
      '',
      'Профессиональная уборка квартиры, дома или офиса — прямо в Telegram.',
      '',
      'Нажмите кнопку ниже, чтобы оформить заявку.',
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(env, message.from.id, origin),
  });
}

function mainKeyboard(env, userId, origin) {
  const rows = [[{
    text: 'Заказать уборку',
    web_app: { url: `${origin}/?demo=1` },
  }]];

  if (isAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
    }]);
  }

  rows.push([{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }]);
  return { inline_keyboard: rows };
}

async function revokeConsent(message, env, origin) {
  const userId = Number(message?.from?.id || 0);
  if (!userId || !message?.chat?.id) return;

  await persistConsent(env, message.from, 'revoked');
  await logConsentToAdmins(env, message.from, 'ОТЗЫВ СОГЛАСИЯ', origin);

  await safeTelegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: [
      '<b>Согласие отозвано</b>',
      '',
      'Мы зафиксировали отзыв согласия на дальнейшую обработку персональных данных.',
      'Обработка может продолжаться только в случаях, когда это допускается или требуется законом, например для исполнения уже заключённого договора или обязательного хранения документов.',
      '',
      'Для повторного использования записи отправьте /start.',
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }]] },
  });
}

async function sendPrivacyLink(chatId, env, origin) {
  if (!chatId) return;
  await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: '<b>Политика обработки персональных данных</b>\n\nОткройте полный текст по кнопке ниже. Для отзыва согласия используйте команду /revoke.',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть политику', url: `${origin}/privacy` }]] },
  });
}

async function getConsent(env, userId) {
  try {
    if (env.CONSENTS?.get) {
      return await env.CONSENTS.get(`pd:${userId}`, { type: 'json' });
    }
  } catch (error) {
    console.error('Consent KV read failed', error);
  }

  try {
    if (env.DB?.prepare) {
      await ensureConsentTable(env);
      return await env.DB.prepare('SELECT status, version, accepted_at, revoked_at FROM personal_data_consents WHERE telegram_id = ?')
        .bind(userId).first();
    }
  } catch (error) {
    console.error('Consent D1 read failed', error);
  }

  return null;
}

async function persistConsent(env, user, status) {
  const now = new Date().toISOString();
  const record = {
    telegram_id: Number(user?.id || 0),
    username: user?.username || null,
    first_name: user?.first_name || '',
    last_name: user?.last_name || null,
    status,
    version: CONSENT_VERSION,
    accepted_at: status === 'accepted' ? now : null,
    revoked_at: status === 'revoked' ? now : null,
    updated_at: now,
  };

  try {
    if (env.CONSENTS?.put) {
      await env.CONSENTS.put(`pd:${record.telegram_id}`, JSON.stringify(record));
    }
  } catch (error) {
    console.error('Consent KV write failed', error);
  }

  try {
    if (env.DB?.prepare) {
      await ensureConsentTable(env);
      await env.DB.prepare(`
        INSERT INTO personal_data_consents
          (telegram_id, username, first_name, last_name, status, version, accepted_at, revoked_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          status = excluded.status,
          version = excluded.version,
          accepted_at = CASE WHEN excluded.status = 'accepted' THEN excluded.accepted_at ELSE personal_data_consents.accepted_at END,
          revoked_at = CASE WHEN excluded.status = 'revoked' THEN excluded.revoked_at ELSE NULL END,
          updated_at = excluded.updated_at
      `).bind(
        record.telegram_id,
        record.username,
        record.first_name,
        record.last_name,
        record.status,
        record.version,
        record.accepted_at,
        record.revoked_at,
        record.updated_at,
      ).run();
    }
  } catch (error) {
    console.error('Consent D1 write failed', error);
  }
}

async function ensureConsentTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS personal_data_consents (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      status TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function logConsentToAdmins(env, user, action, origin) {
  const ids = adminIds(env);
  if (!ids.length) return;
  const now = new Date().toISOString();
  const text = [
    `<b>${action} · ПЕРСОНАЛЬНЫЕ ДАННЫЕ</b>`,
    '',
    `Telegram ID: <code>${escapeHtml(user?.id)}</code>`,
    `Пользователь: ${user?.username ? `@${escapeHtml(user.username)}` : escapeHtml([user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'не указан')}`,
    `Версия: <code>${CONSENT_VERSION}</code>`,
    `UTC: <code>${now}</code>`,
    `Оператор: ${OPERATOR}`,
  ].join('\n');

  await Promise.allSettled(ids.map((id) => safeTelegram(env, 'sendMessage', {
    chat_id: id,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Политика', url: `${origin}/privacy` }]] },
  })));
}

function privacyPage(origin) {
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Политика обработки персональных данных — HOUSE CLEANING</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0b0c;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.58}.wrap{max-width:820px;margin:0 auto;padding:32px 20px 56px}.brand{font-weight:800;letter-spacing:.12em;color:#d9b55b;margin-bottom:18px}.card{background:#141416;border:1px solid #29292d;border-radius:22px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.25)}h1{font-size:30px;line-height:1.15;margin:0 0 12px}h2{font-size:19px;margin:28px 0 8px;color:#e8cb7d}p,li{color:#d8d8dc}ul{padding-left:22px}.meta{font-size:14px;color:#a8a8ad}.box{padding:16px;border-radius:14px;background:#1b1b1e;border:1px solid #303034;margin:16px 0}a{color:#e8cb7d}.footer{margin-top:26px;font-size:13px;color:#8e8e94}</style>
</head>
<body><main class="wrap"><div class="brand">HOUSE CLEANING</div><article class="card">
<h1>Политика обработки персональных данных</h1>
<p class="meta">Редакция от 9 сентября 2026 года · версия ${CONSENT_VERSION}</p>
<div class="box"><b>Оператор:</b> ${OPERATOR}<br><b>ИНН:</b> ${OPERATOR_INN}<br><b>ОГРНИП:</b> ${OPERATOR_OGRNIP}<br><b>Регион:</b> Санкт-Петербург</div>
<h2>1. Общие положения</h2>
<p>Настоящая политика определяет порядок обработки и защиты персональных данных пользователей сервиса HOUSE CLEANING, включая Telegram-бот и веб-приложение для оформления заявок на клининговые услуги.</p>
<h2>2. Какие данные обрабатываются</h2>
<ul><li>Telegram ID, имя, фамилия и username, если они доступны;</li><li>имя клиента и номер телефона;</li><li>адрес объекта, площадь, тип помещения, дата и время уборки;</li><li>комментарии к заявке и иные сведения, которые пользователь сообщает добровольно;</li><li>фотографии объекта, загруженные пользователем;</li><li>технические данные, необходимые для безопасной работы сервиса и подтверждения действий пользователя.</li></ul>
<h2>3. Цели обработки</h2>
<ul><li>приём, оформление, подтверждение, изменение и исполнение заявок;</li><li>связь с клиентом по вопросам заказа;</li><li>оказание клининговых услуг и выполнение договорных обязательств;</li><li>обеспечение безопасности, предотвращение ошибок и злоупотреблений;</li><li>выполнение требований законодательства Российской Федерации.</li></ul>
<h2>4. Правовые основания</h2>
<p>Обработка осуществляется на основании согласия субъекта персональных данных, необходимости заключения и исполнения договора по инициативе пользователя, а также иных оснований, предусмотренных законодательством Российской Федерации.</p>
<h2>5. Действия с персональными данными</h2>
<p>Оператор может осуществлять сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, использование, предоставление в случаях, предусмотренных законом или необходимых для исполнения заказа, блокирование, удаление и уничтожение персональных данных.</p>
<h2>6. Срок обработки и хранения</h2>
<p>Данные обрабатываются не дольше, чем этого требуют цели обработки и обязательные сроки хранения, установленные законодательством. При отзыве согласия обработка прекращается, если отсутствуют иные законные основания для её продолжения.</p>
<h2>7. Защита данных</h2>
<p>Оператор принимает необходимые правовые, организационные и технические меры для защиты персональных данных от неправомерного или случайного доступа, изменения, раскрытия, блокирования, уничтожения и иных неправомерных действий.</p>
<h2>8. Сторонние информационные системы</h2>
<p>Для работы сервиса могут использоваться Telegram и техническая инфраструктура поставщиков хостинга и облачных сервисов. Передача и обработка данных с использованием таких систем допускается только при наличии правового основания и с соблюдением применимых требований законодательства о персональных данных.</p>
<h2>9. Права пользователя</h2>
<p>Пользователь вправе запросить сведения об обработке своих данных, потребовать их уточнения, блокирования или удаления при наличии предусмотренных законом оснований, а также отозвать ранее предоставленное согласие.</p>
<p>В Telegram-боте отзыв согласия доступен командой <b>/revoke</b>. После отзыва повторное оформление новой заявки через бота потребует нового согласия.</p>
<h2>10. Обновление политики</h2>
<p>Политика может обновляться при изменении сервиса или законодательства. При существенном изменении условий согласия бот запросит подтверждение новой версии.</p>
<p class="footer">HOUSE CLEANING · ${OPERATOR} · ИНН ${OPERATOR_INN} · ОГРНИП ${OPERATOR_OGRNIP}</p>
</article></main></body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]
    .filter(Boolean)
    .join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
}

async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char));
}
