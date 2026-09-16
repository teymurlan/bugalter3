(() => {
  const tg = window.Telegram?.WebApp;
  let lastSuccessKey = '';

  function reduceMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  }

  function successKey(node) {
    return node?.textContent?.match(/HC-[A-Z0-9-]+/i)?.[0] || node?.dataset?.successKey || String(Date.now());
  }

  function hapticSuccess() {
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
  }

  function addSparkles() {
    if (reduceMotion()) return;
    const layer = document.createElement('div');
    layer.className = 'hc-success-sparkles';
    for (let i = 0; i < 18; i += 1) {
      const dot = document.createElement('i');
      dot.style.setProperty('--x', `${9 + Math.random() * 82}%`);
      dot.style.setProperty('--y', `${7 + Math.random() * 49}%`);
      dot.style.setProperty('--delay', `${Math.random() * .34}s`);
      dot.style.setProperty('--scale', `${.75 + Math.random() * 1.05}`);
      layer.appendChild(dot);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1850);
  }

  function launchConfetti() {
    if (reduceMotion()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'hc-confetti-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) { canvas.remove(); return; }

    const dpr = Math.min(1.6, window.devicePixelRatio || 1);
    const width = window.innerWidth || 390;
    const height = window.innerHeight || 700;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = ['#ffd86a', '#f4bc3f', '#fff2bf', '#d89a23', '#ffffff', '#e8c46f'];
    const pieces = Array.from({ length: 96 }, (_, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      return {
        x: width / 2 + side * (4 + Math.random() * 38),
        y: Math.min(height * .31, 220),
        vx: side * (2.6 + Math.random() * 7.8) + (Math.random() - .5) * 1.5,
        vy: -(7.4 + Math.random() * 11.5),
        gravity: .24 + Math.random() * .12,
        drag: .988,
        w: 4 + Math.random() * 6,
        h: 6 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .42,
        alpha: .9 + Math.random() * .1,
        color: palette[Math.floor(Math.random() * palette.length)],
      };
    });

    const started = performance.now();
    const duration = 1750;
    function frame(now) {
      const elapsed = now - started;
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        p.vx *= p.drag;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        const fade = elapsed > 1050 ? Math.max(0, 1 - (elapsed - 1050) / 700) : 1;
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
  setTimeout(scan, 80);
  setTimeout(scan, 280);
})();
