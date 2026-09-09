(() => {
  const tg = window.Telegram?.WebApp;
  let lastSuccessKey = '';

  function successKey(node) {
    return node?.textContent?.match(/HC-[A-Z0-9-]+/i)?.[0] || String(Date.now());
  }

  function hapticSuccess() {
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
  }

  function addSparkles() {
    const layer = document.createElement('div');
    layer.className = 'hc-success-sparkles';
    for (let i = 0; i < 18; i += 1) {
      const dot = document.createElement('i');
      dot.style.setProperty('--x', `${12 + Math.random() * 76}%`);
      dot.style.setProperty('--y', `${8 + Math.random() * 48}%`);
      dot.style.setProperty('--delay', `${Math.random() * .75}s`);
      dot.style.setProperty('--scale', `${.65 + Math.random() * 1.05}`);
      layer.appendChild(dot);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2800);
  }

  function launchConfetti() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'hc-confetti-canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const palette = ['#f8d98d', '#e5b95d', '#fff2c9', '#c99736', '#ffffff'];
    const pieces = Array.from({ length: 105 }, (_, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      return {
        x: innerWidth / 2 + side * (12 + Math.random() * 70),
        y: Math.min(innerHeight * .37, 300),
        vx: side * (1.1 + Math.random() * 5.8) + (Math.random() - .5) * 2,
        vy: -(4.5 + Math.random() * 8.5),
        gravity: .16 + Math.random() * .12,
        drag: .992,
        w: 4 + Math.random() * 6,
        h: 7 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .28,
        alpha: .82 + Math.random() * .18,
        color: palette[Math.floor(Math.random() * palette.length)],
      };
    });

    const started = performance.now();
    const duration = 2350;

    function frame(now) {
      const elapsed = now - started;
      ctx.clearRect(0, 0, innerWidth, innerHeight);

      pieces.forEach((p) => {
        p.vx *= p.drag;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        const fade = elapsed > 1650 ? Math.max(0, 1 - (elapsed - 1650) / 700) : 1;
        ctx.save();
        ctx.globalAlpha = p.alpha * fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      if (elapsed < duration) requestAnimationFrame(frame);
      else canvas.remove();
    }

    requestAnimationFrame(frame);
    window.addEventListener('resize', resize, { once: true });
  }

  function enhanceSuccess(node) {
    if (!node || node.dataset.hcCelebrated === '1') return;
    const key = successKey(node);
    if (key === lastSuccessKey) return;
    node.dataset.hcCelebrated = '1';
    lastSuccessKey = key;
    node.classList.add('hc-success-premium');
    hapticSuccess();
    addSparkles();
    launchConfetti();
  }

  function scan() {
    const success = document.querySelector('.success');
    if (success) enhanceSuccess(success);
  }

  const root = document.querySelector('#app');
  if (root) new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan, { once: true });
  setTimeout(scan, 300);
})();