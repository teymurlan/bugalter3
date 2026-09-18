const root = document.querySelector('#app');
const tg = window.Telegram?.WebApp;
let celebrated = '';

installStyles();
installDatePicker();
installCelebration();

function installStyles() {
  const style = document.createElement('style');
  style.id = 'hc-ui-polish-v47';
  style.textContent = `
    .hc-calendar-v2 .hc-manual-date{display:grid!important;grid-template-columns:1fr!important;gap:12px!important;width:100%!important;max-width:100%!important;padding:18px!important;border:1px solid #2a3b45!important;border-radius:22px!important;background:#0c1419!important;box-sizing:border-box!important;overflow:hidden!important}
    .hc-calendar-v2 .hc-manual-date>span{display:block!important;width:100%!important;min-width:0!important}
    .hc-date-shell-v47{position:relative!important;width:100%!important;max-width:100%!important;height:60px!important;border:1px solid #344852!important;border-radius:18px!important;background:#10191f!important;overflow:hidden!important;box-sizing:border-box!important}
    .hc-date-label-v47{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:space-between!important;padding:0 18px!important;box-sizing:border-box!important;color:#f5f7f8!important;font-size:18px!important;font-weight:750!important;pointer-events:none!important}
    .hc-date-label-v47 b{font-size:20px!important;font-weight:600!important;opacity:.85!important}
    .hc-date-shell-v47 input{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;z-index:2!important;cursor:pointer!important}
    .hc-date-shell-v47:focus-within{border-color:#efbd4b!important;box-shadow:0 0 0 3px rgba(239,189,75,.12)!important}
    .hc-known-address-note{margin-top:14px!important;padding:14px 16px!important;border:1px solid rgba(75,210,130,.26)!important;border-radius:16px!important;background:rgba(75,210,130,.09)!important;color:#91eab5!important;font-size:14px!important;line-height:1.45!important}
    .photo-step.hc-repeat-address .photo-drop{display:none!important}
    .hc-confetti-canvas,.hc-confetti-v45{display:none!important}
    .hc-confetti-v47{display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:99999!important;pointer-events:none!important}
  `;
  document.head.appendChild(style);
}

function formatDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Выберите дату';
  const months = ['янв.','февр.','мар.','апр.','мая','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]} г.`;
}

function polishDate() {
  const input = root?.querySelector('.hc-calendar-v2 [data-date]');
  if (!input || input.closest('.hc-date-control') || input.closest('.hc-date-shell-v47')) return;
  const shell = document.createElement('div');
  shell.className = 'hc-date-shell-v47';
  const label = document.createElement('div');
  label.className = 'hc-date-label-v47';
  label.innerHTML = `<span>${formatDate(input.value)}</span><b>▣</b>`;
  input.parentNode.insertBefore(shell, input);
  shell.append(label, input);
  const sync = () => { const span = label.querySelector('span'); if (span) span.textContent = formatDate(input.value); };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
}

function installDatePicker() {
  if (!root) return;
  new MutationObserver(() => requestAnimationFrame(polishDate)).observe(root, { childList:true, subtree:true });
  polishDate();
}

function installCelebration() {
  if (!root) return;
  const scan = () => {
    const success = root.querySelector('.success');
    if (!success) return;
    const key = success.textContent?.match(/HC-[A-Z0-9-]+/i)?.[0] || 'success';
    if (key === celebrated || success.dataset.v47Celebrated) return;
    success.dataset.v47Celebrated = '1';
    celebrated = key;
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
    confetti();
  };
  new MutationObserver(scan).observe(root, { childList:true, subtree:true });
  scan();
}

function confetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hc-confetti-v47';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  const colors = ['#ff4057','#ff7a32','#ffd447','#52d273','#25c9e8','#4b7cff','#9257f5','#f14fc4','#fff'];
  const pieces = Array.from({ length: 150 }, (_, i) => ({
    x: Math.random() * w, y: -20 - Math.random()*180, vx:(Math.random()-.5)*2.8, vy:2.4+Math.random()*4.2,
    g:.035+Math.random()*.055, r:Math.random()*Math.PI, s:(Math.random()-.5)*.25,
    ww:4+Math.random()*6, hh:7+Math.random()*10, c:colors[i%colors.length], delay:Math.random()*420
  }));
  const start = performance.now();
  function draw(now) {
    const t = now-start; ctx.clearRect(0,0,w,h);
    for (const p of pieces) {
      if (t < p.delay) continue;
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.s;
      const alpha = t > 2200 ? Math.max(0,1-(t-2200)/700) : 1;
      ctx.save(); ctx.globalAlpha=alpha; ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.fillStyle=p.c; ctx.fillRect(-p.ww/2,-p.hh/2,p.ww,p.hh); ctx.restore();
    }
    if (t < 2900) requestAnimationFrame(draw); else canvas.remove();
  }
  requestAnimationFrame(draw);
}
