(() => {
  const tg = window.Telegram?.WebApp;
  let lastSuccessKey = '';
  let pollTimer = null;

  function successKey(node) {
    return node?.textContent?.match(/HC-[A-Z0-9-]+/i)?.[0] || node?.dataset?.successKey || String(Date.now());
  }

  function hapticSuccess() {
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
  }

  function addSparkles() {
    const layer = document.createElement('div');
    layer.className = 'hc-success-sparkles';
    for (let i = 0; i < 26; i += 1) {
      const dot = document.createElement('i');
      dot.style.setProperty('--x', `${8 + Math.random() * 84}%`);
      dot.style.setProperty('--y', `${6 + Math.random() * 56}%`);
      dot.style.setProperty('--delay', `${Math.random() * .7}s`);
      dot.style.setProperty('--scale', `${.7 + Math.random() * 1.25}`);
      layer.appendChild(dot);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3000);
  }

  function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.className = 'hc-confetti-canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const w = window.innerWidth || document.documentElement.clientWidth || 390;
      const h = window.innerHeight || document.documentElement.clientHeight || 700;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const width = window.innerWidth || 390;
    const height = window.innerHeight || 700;
    const palette = ['#ffd86a', '#f4bc3f', '#fff2bf', '#d89a23', '#ffffff', '#e8c46f'];
    const pieces = Array.from({ length: 150 }, (_, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      return {
        x: width / 2 + side * (5 + Math.random() * 56),
        y: Math.min(height * .34, 250),
        vx: side * (1.8 + Math.random() * 7.4) + (Math.random() - .5) * 2.2,
        vy: -(5.8 + Math.random() * 10.8),
        gravity: .17 + Math.random() * .11,
        drag: .991,
        w: 4 + Math.random() * 7,
        h: 7 + Math.random() * 12,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .34,
        alpha: .88 + Math.random() * .12,
        color: palette[Math.floor(Math.random() * palette.length)],
      };
    });

    const started = performance.now();
    const duration = 2650;
    function frame(now) {
      const elapsed = now - started;
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        p.vx *= p.drag;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        const fade = elapsed > 1850 ? Math.max(0, 1 - (elapsed - 1850) / 800) : 1;
        ctx.save();
        ctx.globalAlpha = p.alpha * fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < duration) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  function enhanceSuccess(node, force = false) {
    if (!node) return;
    const key = successKey(node);
    if (!force && (node.dataset.hcCelebrated === '1' || key === lastSuccessKey)) return;
    node.dataset.hcCelebrated = '1';
    node.dataset.successKey = key;
    lastSuccessKey = key;
    node.classList.add('hc-success-premium');
    hapticSuccess();
    addSparkles();
    launchConfetti();
  }

  function scan() {
    const node = document.querySelector('#app .success');
    if (node) enhanceSuccess(node);
  }

  window.HCSuccessEffects = {
    play(node) { enhanceSuccess(node || document.querySelector('#app .success'), true); },
  };

  const root = document.querySelector('#app');
  if (root) new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan, { once: true });
  setTimeout(scan, 100);
  setTimeout(scan, 350);
  setTimeout(scan, 900);
  pollTimer = setInterval(scan, 180);
  setTimeout(() => { if (pollTimer) clearInterval(pollTimer); }, 10 * 60 * 1000);
})();