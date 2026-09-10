import baseWorker, { ConsentStore, AppStore } from './demo-worker-v17.js';

export { ConsentStore, AppStore };

const KP_VERSION = '19';
const COMPANY = Object.freeze({
  name: 'ИП Царегородцева Евгения Андреевна',
  inn: '781157991880',
  ogrnip: '325784700025441',
  legal_address: '195030, Россия, г. Санкт-Петербург, ул. Дыбенко д. 6, корп. 2',
  phone: '+7 999 210 79 77',
  email: 'cleaning@tsaregorodtseva-1.ru',
  brand: 'HOUSE CLEANING',
  region: 'Санкт-Петербург и Ленинградская область',
  vat_label: 'Без НДС',
});
const PRESETS = Object.freeze([
  { group:'Основные тарифы', name:'Коммерческая уборка', unit:'м²', price:95 },
  { group:'Основные тарифы', name:'Генеральная уборка', unit:'м²', price:230 },
  { group:'Основные тарифы', name:'Поддерживающая уборка', unit:'м²', price:95 },
  { group:'Основные тарифы', name:'Уборка после ремонта', unit:'м²', price:230 },
  { group:'Отдельные услуги', name:'Обеспыливание потолков, вентиляционных решёток и коммуникаций', unit:'м²', price:0 },
  { group:'Отдельные услуги', name:'Обеспыливание стен и поверхностей', unit:'м²', price:0 },
  { group:'Отдельные услуги', name:'Мытьё окон', unit:'шт.', price:0 },
  { group:'Отдельные услуги', name:'Мытьё витрин', unit:'м²', price:0 },
  { group:'Отдельные услуги', name:'Мытьё дверей', unit:'шт.', price:0 },
  { group:'Отдельные услуги', name:'Мытьё стеклянных перегородок', unit:'м²', price:0 },
  { group:'Отдельные услуги', name:'Мытьё полов', unit:'м²', price:0 },
  { group:'Отдельные услуги', name:'Мытьё плинтусов', unit:'пог. м', price:0 },
  { group:'Отдельные услуги', name:'Уборка санузлов', unit:'усл.', price:0 },
  { group:'Отдельные услуги', name:'Удаление строительной пыли и загрязнений', unit:'м²', price:0 },
  { group:'Отдельные услуги', name:'Локальная очистка труднодоступных участков', unit:'усл.', price:0 },
]);
const DEFAULT_EQUIPMENT = ['Моющий пылесос Karcher WD 3','Пылесос для сухой уборки Karcher WD 6','Пароочиститель Karcher SC 4'].join('\n');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // Bootstrap больше не ждёт Durable Object. Проверяем Telegram подпись прямо здесь,
    // поэтому экран доступа не может зависнуть на чтении счётчика/истории.
    if (request.method === 'GET' && url.pathname === '/api/kp/bootstrap') {
      const user = await validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
      if (!user) return json({ ok:false, error:'Не удалось подтвердить Telegram. Закройте окно и откройте КП заново через бота.' }, 401);
      if (!canUseKp(env, user.id)) return json({ ok:false, error:'Ваш Telegram ID не добавлен в администраторы КП.' }, 403);
      return json({
        ok:true,
        admin:{ id:Number(user.id), first_name:user.first_name || '' },
        company:COMPANY,
        presets:PRESETS,
        defaults:{
          quote_number:'Исх. № 15', issue_date:spbToday(), valid_days:14,
          prepayment_percent:0, payment_terms:'', vat_label:'Без НДС',
          duration:'1–2 дня', equipment:DEFAULT_EQUIPMENT,
          object_type:'Коммерческое помещение',
          title:'Коммерческое предложение на оказание клининговых услуг'
        }
      });
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

function canUseKp(env,id){
  const ids=[env.ADMIN_TELEGRAM_IDS,env.ADMIN_TELEGRAM_ID,env.ADMIN_ID,env.KP_ADMIN_TELEGRAM_IDS,env.KP_ADMIN_TELEGRAM_ID]
    .filter(Boolean).join(',').split(/[;,\s]+/).map(v=>v.trim()).filter(Boolean);
  return ids.includes(String(id));
}

async function validateInitData(initData, botToken){
  if(!initData || !botToken) return null;
  try{
    const params=new URLSearchParams(initData);
    const received=(params.get('hash')||'').toLowerCase();
    const authDate=Number(params.get('auth_date')||0);
    const userRaw=params.get('user');
    if(!received || !authDate || !userRaw || Math.abs(Date.now()/1000-authDate)>86400) return null;
    params.delete('hash');
    const entries=[...params.entries()];
    const candidates=[entries,entries.filter(([k])=>k!=='signature')];
    const enc=new TextEncoder();
    const secret=await hmac(enc.encode('WebAppData'),enc.encode(botToken));
    for(const candidate of candidates){
      const check=[...candidate].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
      const digest=await hmac(secret,enc.encode(check));
      const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(constantEqual(hex,received)){
        const user=JSON.parse(userRaw); return user?.id ? user : null;
      }
    }
  }catch{}
  return null;
}
async function hmac(keyBytes,dataBytes){
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return crypto.subtle.sign('HMAC',key,dataBytes);
}
function constantEqual(a,b){
  if(a.length!==b.length)return false; let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i); return diff===0;
}
function spbToday(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store, no-cache, must-revalidate'}});
}
