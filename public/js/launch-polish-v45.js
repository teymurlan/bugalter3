import { state } from './state.js';
import { showToast } from './utils.js';

const root = document.querySelector('#app');
const tg = window.Telegram?.WebApp;
const GENERATION = 'v45-clean-launch';
const RESET_KEY = 'hc-clean-start-generation';
let checkingPhotoStep = false;
let lastCelebrated = '';

await finishLocalCleanStart();
installPolishStyles();
installBookingFixes();
installCelebration();

async function finishLocalCleanStart() {
  let marker = '';
  try { marker = localStorage.getItem(RESET_KEY) || ''; } catch {}
  if (marker !== 'pending' && !window.__HC_CLEAN_START_PENDING) return;
  try {
    await state.resetDraft();
    localStorage.removeItem('hc-demo-orders-v3');
    localStorage.removeItem('hc-client-profile-v1');
    localStorage.setItem(RESET_KEY, GENERATION);
  } catch (error) {
    console.warn('Local clean start fallback', error);
    try { localStorage.setItem(RESET_KEY, GENERATION); } catch {}
  }
  if (!sessionStorage.getItem('hc-v45-reloaded')) {
    sessionStorage.setItem('hc-v45-reloaded', '1');
    location.reload();
    await new Promise(() => {});
  }
}

function installPolishStyles() {
  if (document.querySelector('#hc-launch-polish-v45')) return;
  const style = document.createElement('style');
  style.id = 'hc-launch-polish-v45';
  style.textContent = `
    .hc-calendar-v2 .hc-manual-date{
      display:flex!important;flex-direction:column!important;align-items:stretch!important;
      gap:14px!important;width:100%!important;max-width:100%!important;
      padding:18px!important;border:1px solid #263640!important;border-radius:22px!important;
      background:linear-gradient(145deg,#0d151a,#0a1115)!important;box-sizing:border-box!important
    }
    .hc-calendar-v2 .hc-manual-date>span{width:100%!important;display:block!important;min-width:0!important}
    .hc-calendar-v2 .hc-manual-date input{
      width:100%!important;max-width:100%!important;min-width:0!important;height:60px!important;
      padding:0 18px!important;border:1px solid #344852!important;border-radius:18px!important;
      background:#10191f!important;color:#f5f7f8!important;font-size:18px!important;font-weight:650!important;
      letter-spacing:.01em!important;box-sizing:border-box!important;color-scheme:dark!important
    }
    .hc-calendar-v2 .hc-manual-date input:focus{border-color:#efbd4b!important;box-shadow:0 0 0 3px rgba(239,189,75,.13)!important;outline:none!important}
    .hc-known-address-note{margin:12px 0 0;padding:12px 14px;border-radius:16px;background:rgba(69,201,122,.10);border:1px solid rgba(69,201,122,.25);color:#88e7ad;font-size:14px;line-height:1.4}
    .hc-confetti-canvas{display:none!important}
    .hc-confetti-v45{display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:99999!important}
    @media(max-width:390px){.hc-calendar-v2 .hc-manual-date{padding:15px!important;border-radius:20px!important}.hc-calendar-v2 .hc-manual-date input{height:58px!important;font-size:17px!important}}
  `;
  document.head.appendChild(style);
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim().replace(/\s+/g, ' ');
}
function cityCore(value) {
  const city = normalize(value);
  if (!city) return '';
  if (city === 'спб' || city.includes('санкт петербург')) return 'spb';
  if (city.includes('ленинград') && city.includes('област')) return 'lo';
  return city;
}
function unitFrom(address, apartment) {
  const direct = normalize(apartment);
  if (direct) return direct.replace(/^0+/, '') || '0';
  const match = String(address || '').match(/(?:квартира|кв\.?|офис)\s*([0-9а-яa-z-]+)/i);
  return normalize(match?.[1] || '').replace(/^0+/, '');
}
function addressCore(value) {
  return normalize(String(value || '').replace(/(?:квартира|кв\.?|офис)\s*[0-9а-яa-z-]+/ig, ' '))
    .replace(/\b(россия|рф|санкт петербург|спб|ленинградская область)\b/g, ' ')
    .replace(/\b(улица|ул|проспект|просп|пр кт|переулок|пер|набережная|наб|шоссе|дом|д)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function sameAddress(order, draft) {
  const a = addressCore(order?.address);
  const b = addressCore(draft?.address);
  if (!a || !b || a !== b) return false;
  const unitA = unitFrom(order?.address, order?.apartment);
  const unitB = unitFrom(draft?.address, draft?.apartment);
  if (unitA !== unitB) return false;
  const cityA = cityCore(order?.city);
  const cityB = cityCore(draft?.city);
  return !cityA || !cityB || cityA === cityB;
}
function hasKnownObject(order) {
  const status = String(order?.status || '').toUpperCase();
  const photos = Number(order?.photo_count || 0) > 0 || (Array.isArray(order?.photo_file_ids) && order.photo_file_ids.length > 0);
  return status === 'COMPLETED' || photos;
}
async function checkKnownAddress() {
  const draft = state.draft || {};
  if (!String(draft.address || '').trim()) return false;
  try {
    const response = await fetch('/api/demo-client-orders', {
      headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const data = await response.json();
    return (Array.isArray(data?.orders) ? data.orders : []).some((order) => hasKnownObject(order) && sameAddress(order, draft));
  } catch { return false; }
}
async function markKnownAddressIfNeeded() {
  if (state.photos?.length) return false;
  const known = await checkKnownAddress();
  state.draft.knownAddress = known;
  state.draft.photoRequired = !known;
  state.saveDraft();
  return known;
}

function installBookingFixes() {
  if (!root) return;
  const decorate = () => {
    const step = Number(state.draft?.step || 0);

    if (step === 4 && root.querySelector('.photo-step')) {
      const next = root.querySelector('[data-next]');
      if (next) next.disabled = false;
      const count = root.querySelector('.photo-count');
      if (!checkingPhotoStep && !state.photos?.length && String(state.draft?.address || '').trim()) {
        checkingPhotoStep = true;
        markKnownAddressIfNeeded().then((known) => {
          if (known && count) {
            const spans = count.querySelectorAll('span');
            if (spans[1]) spans[1].textContent = 'Этот адрес уже обслуживали — фотографии не нужны';
            if (!root.querySelector('.hc-known-address-note')) {
              count.insertAdjacentHTML('afterend', '<div class="hc-known-address-note">Адрес и квартира совпали с прошлой уборкой. Можно продолжить без фотографий.</div>');
            }
          }
        }).finally(() => { checkingPhotoStep = false; });
      }
    }

    if (step === 8) {
      const next = root.querySelector('[data-next]');
      if (next && !next.dataset.hcV45KnownGuard) {
        next.dataset.hcV45KnownGuard = '1';
        const original = next.onclick;
        next.onclick = async (event) => {
          if (!state.photos?.length && state.draft?.photoRequired !== false) {
            const known = await markKnownAddressIfNeeded();
            if (known) showToast('Адрес уже обслуживали — фотографии не требуются');
          }
          return original?.call(next, event);
        };
      }
    }
  };
  new MutationObserver(() => requestAnimationFrame(decorate)).observe(root, { childList: true, subtree: true });
  decorate();
}

function installCelebration() {
  if (!root) return;
  const scan = () => {
    const success = root.querySelector('.success');
    if (!success) return;
    const key = success.textContent?.match(/HC-[A-Z0-9-]+/i)?.[0] || success.textContent?.slice(0, 80) || 'success';
    if (success.dataset.hcV45Celebrated === '1' || key === lastCelebrated) return;
    success.dataset.hcV45Celebrated = '1';
    lastCelebrated = key;
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
    fireColorCelebration();
  };
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  scan();
}

function fireColorCelebration() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hc-confetti-v45';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { canvas.remove(); return; }

  const dpr = Math.min(1.7, window.devicePixelRatio || 1);
  const width = window.innerWidth || 390;
  const height = window.innerHeight || 700;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#ff4057','#ff7a32','#ffd447','#52d273','#25c9e8','#4b7cff','#9257f5','#f14fc4','#ffffff'];
  const centers = [0.12, 0.31, 0.5, 0.69, 0.88].map((x) => x * width);
  const pieces = [];
  centers.forEach((center, burst) => {
    for (let i = 0; i < 34; i += 1) {
      const angle = Math.PI * (0.12 + Math.random() * 0.76);
      const speed = 2.5 + Math.random() * 6.8;
      const direction = Math.random() < .5 ? -1 : 1;
      pieces.push({
        x: center + (Math.random() - .5) * 16,
        y: -8 + burst * 8 + Math.random() * 26,
        vx: Math.cos(angle) * speed * direction,
        vy: -1.8 + Math.sin(angle) * speed * .45 + Math.random() * 1.8,
        gravity: .10 + Math.random() * .075,
        drag: .992,
        w: 4 + Math.random() * 6,
        h: 7 + Math.random() * 10,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - .5) * .36,
        delay: burst * 70 + Math.random() * 180,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < .18 ? 'circle' : 'rect',
      });
    }
  });

  const started = performance.now();
  const duration = 2600;
  function frame(now) {
    const elapsed = now - started;
    ctx.clearRect(0, 0, width, height);
    for (const p of pieces) {
      if (elapsed < p.delay) continue;
      p.vx *= p.drag;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      const life = elapsed - p.delay;
      const fade = life > 1850 ? Math.max(0, 1 - (life - 1850) / 650) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * .62, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
