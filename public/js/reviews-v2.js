(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  const params = new URLSearchParams(window.location.search);
  const requestedOrder = String(params.get('review') || '').trim();

  function headers(extra = {}) { return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra }; }
  function toast(text, error = false) { const node = document.querySelector('#toast'); if (!node) return; node.textContent = text; node.className = `toast show${error ? ' error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = 'toast'; }, 3000); }
  async function loadReview(orderNumber) { try { const response = await fetch(`/api/demo-review?order=${encodeURIComponent(orderNumber)}`, { headers: headers() }); if (!response.ok) return null; return (await response.json())?.review || null; } catch { return null; } }
  function detailOrderNumber() { const value = String(root.querySelector('.cc-detail-head h1')?.textContent || '').trim(); return /^HC-[A-Za-z0-9._-]+$/i.test(value) ? value : ''; }
  function isCompletedDetail() { return String(root.querySelector('.cc-detail-head .cc-kicker')?.textContent || '').toLowerCase().includes('заверш'); }
  function stars(value) { const rating = Number(value || 0); return Array.from({ length: 5 }, (_, i) => `<button type="button" class="hc-review-star ${i < rating ? 'active' : ''}" data-review-star="${i + 1}" aria-label="${i + 1} звезда">★</button>`).join(''); }
  function readonlyStars(value) { const rating = Math.max(0, Math.min(5, Number(value || 0))); return `<div class="hc-review-readonly"><div class="hc-review-stars readonly">${'★'.repeat(Math.round(rating))}${'<span>★</span>'.repeat(5 - Math.round(rating))}</div><strong>${rating.toFixed(1)}</strong></div>`; }

  async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  async function renderReviewPhotos(holder, review) {
    const count = Array.isArray(review?.photo_file_ids) ? review.photo_file_ids.length : 0;
    const grid = holder.querySelector('[data-review-saved-photos]');
    if (!grid || !count) return;
    for (let index = 0; index < count; index += 1) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'hc-review-saved-photo loading';
      tile.innerHTML = '<span>Фото</span>';
      grid.appendChild(tile);
      try {
        const response = await fetch(`/api/demo-review-photo?order=${encodeURIComponent(review.order_number)}&index=${index}`, { headers: headers() });
        if (!response.ok) throw new Error();
        const url = URL.createObjectURL(await response.blob());
        tile.classList.remove('loading');
        tile.innerHTML = `<img src="${url}" alt="Фото к отзыву ${index + 1}">`;
        tile.onclick = () => openPhoto(url);
      } catch { tile.classList.remove('loading'); tile.classList.add('error'); tile.textContent = 'Недоступно'; }
    }
  }

  function openPhoto(url) { const overlay = document.createElement('div'); overlay.className = 'hc-review-lightbox'; overlay.innerHTML = `<button type="button" aria-label="Закрыть">×</button><img src="${url}" alt="Фото к отзыву">`; document.body.append(overlay); overlay.querySelector('button').onclick = () => overlay.remove(); overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); }; }

  function bindStars(holder) {
    holder.querySelectorAll('[data-review-star]').forEach((button) => button.onclick = () => {
      const value = Number(button.dataset.reviewStar || 0);
      holder.dataset.rating = String(value);
      holder.querySelectorAll('[data-review-star]').forEach((star) => star.classList.toggle('active', Number(star.dataset.reviewStar) <= value));
      const score = holder.querySelector('[data-review-score]');
      if (score) score.textContent = value.toFixed(1);
      try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); } catch {}
    });
  }

  async function decorateDetail() {
    if (!isCompletedDetail()) return;
    const orderNumber = detailOrderNumber();
    if (!orderNumber || root.querySelector('[data-review-widget]')) return;
    const anchor = root.querySelector('.cc-gallery-title') || root.querySelector('.cc-policy-note') || root.querySelector('.cc-detail-card');
    if (!anchor) return;
    const holder = document.createElement('section');
    holder.dataset.reviewWidget = '1';
    holder.className = 'card hc-review-card';
    holder.innerHTML = '<div class="hc-review-loading">Проверяем отзыв...</div>';
    anchor.insertAdjacentElement('beforebegin', holder);
    const review = await loadReview(orderNumber);
    if (!root.contains(holder)) return;

    if (review) {
      holder.classList.add('submitted');
      holder.innerHTML = `<div class="hc-review-title"><div><span>Ваш отзыв</span><strong>Спасибо за обратную связь</strong></div><b>✓</b></div>${readonlyStars(review.rating)}${review.text ? `<p class="hc-review-text">${escapeHtml(review.text)}</p>` : '<p class="hc-review-muted">Отзыв отправлен без комментария.</p>'}<div class="hc-review-saved-photos" data-review-saved-photos></div>`;
      renderReviewPhotos(holder, review);
      return;
    }

    holder.dataset.rating = '0';
    holder.innerHTML = `<div class="hc-review-title"><div><span>Как прошла уборка?</span><strong>Оцените нашу работу</strong></div></div><p class="hc-review-lead">Ваш отзыв помогает нам следить за качеством сервиса.</p><div class="hc-review-score-row"><div class="hc-review-stars" data-review-stars>${stars(0)}</div><strong data-review-score>0.0</strong></div><textarea class="hc-review-textarea" data-review-text maxlength="2500" placeholder="Комментарий — по желанию"></textarea><label class="hc-review-photo-picker"><input type="file" accept="image/*" multiple data-review-files><span>＋ Добавить фотографии</span><small>Необязательно · до 5 фото</small></label><div class="hc-review-preview" data-review-preview></div><button class="primary-btn hc-review-submit" type="button" data-review-submit>Отправить отзыв</button>`;
    bindStars(holder);
    const input = holder.querySelector('[data-review-files]');
    input.onchange = () => drawPreview(holder, [...input.files].slice(0, 5));
    holder.querySelector('[data-review-submit]').onclick = async () => {
      const rating = Number(holder.dataset.rating || 0);
      if (!rating) return toast('Поставьте оценку от 1 до 5 звёзд', true);
      const button = holder.querySelector('[data-review-submit]');
      button.disabled = true; button.textContent = 'Отправляем...';
      try {
        const files = [...(input.files || [])].slice(0, 5);
        const photos = [];
        for (let index = 0; index < files.length; index += 1) photos.push({ name: files[index].name || `review-${index + 1}.jpg`, type: files[index].type || 'image/jpeg', data: await fileToBase64(files[index]) });
        const response = await fetch('/api/demo-review-v2', { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ order_number: orderNumber, rating, text: holder.querySelector('[data-review-text]').value || '', photos }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Не удалось отправить отзыв');
        toast('Спасибо за отзыв'); holder.remove(); decorateDetail();
      } catch (error) { button.disabled = false; button.textContent = 'Отправить отзыв'; toast(error.message || 'Не удалось отправить отзыв', true); }
    };
    if (requestedOrder === orderNumber || sessionStorage.getItem('hc-review-focus') === orderNumber) { sessionStorage.removeItem('hc-review-focus'); requestAnimationFrame(() => holder.scrollIntoView({ behavior: 'smooth', block: 'center' })); }
  }

  function drawPreview(holder, files) { const preview = holder.querySelector('[data-review-preview]'); if (!preview) return; preview.innerHTML = ''; files.forEach((file, index) => { const url = URL.createObjectURL(file); const node = document.createElement('div'); node.className = 'hc-review-preview-item'; node.innerHTML = `<img src="${url}" alt="Фото ${index + 1}"><span>${index + 1}</span>`; preview.appendChild(node); }); }

  function decorateCompletedCards() {
    root.querySelectorAll('.cc-order-card').forEach((card) => {
      if (card.querySelector('[data-review-shortcut]')) return;
      const status = String(card.querySelector('.cc-status-pill')?.textContent || '').toLowerCase();
      if (!status.includes('заверш')) return;
      const orderId = card.dataset.orderId;
      if (!orderId) return;
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.reviewShortcut = '1'; button.className = 'hc-review-shortcut'; button.textContent = '★ Оставить отзыв';
      button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); const number = String(card.querySelector('.cc-order-number')?.textContent || '').trim(); if (number) sessionStorage.setItem('hc-review-focus', number); card.click(); };
      card.appendChild(button);
    });
  }

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char)); }
  let queued = false;
  const scan = () => { decorateCompletedCards(); decorateDetail(); };
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; scan(); }); }).observe(root, { childList: true, subtree: true });
  scan();
})();
