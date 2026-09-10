(() => {
  const previousRenderQuotePagesV8 = renderQuotePages;
  let logoBoundsCache = null;

  function getVisibleLogoBounds(image) {
    if (logoBoundsCache) return logoBoundsCache;

    const maxSample = 640;
    const scale = Math.min(1, maxSample / image.width, maxSample / image.height);
    const sw = Math.max(1, Math.round(image.width * scale));
    const sh = Math.max(1, Math.round(image.height * scale));
    const sample = document.createElement('canvas');
    sample.width = sw;
    sample.height = sh;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0, 0, sw, sh);
    sctx.drawImage(image, 0, 0, sw, sh);

    try {
      const pixels = sctx.getImageData(0, 0, sw, sh).data;
      let minX = sw;
      let minY = sh;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const alpha = pixels[(y * sw + x) * 4 + 3];
          if (alpha > 10) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX >= minX && maxY >= minY) {
        const padX = Math.max(4, Math.round((maxX - minX + 1) * 0.025));
        const padY = Math.max(4, Math.round((maxY - minY + 1) * 0.025));
        minX = Math.max(0, minX - padX);
        minY = Math.max(0, minY - padY);
        maxX = Math.min(sw - 1, maxX + padX);
        maxY = Math.min(sh - 1, maxY + padY);

        logoBoundsCache = {
          sx: minX / scale,
          sy: minY / scale,
          sw: (maxX - minX + 1) / scale,
          sh: (maxY - minY + 1) / scale,
        };
        return logoBoundsCache;
      }
    } catch (error) {
      console.warn('Logo crop detection failed', error);
    }

    logoBoundsCache = { sx: 0, sy: 0, sw: image.width, sh: image.height };
    return logoBoundsCache;
  }

  async function redrawTopLogo(page) {
    if (!page || !window.HOUSE_CLEANING_LOGO) return;

    try {
      const image = await loadImage(window.HOUSE_CLEANING_LOGO);
      const ctx = page.getContext('2d');
      const M = 72;

      // Убираем старую отрисовку логотипа, которая могла заходить на заголовок.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(M - 10, 42, 520, 215);

      const crop = getVisibleLogoBounds(image);
      const maxW = 300;
      const maxH = 128;
      const ratio = Math.min(maxW / crop.sw, maxH / crop.sh);
      const drawW = crop.sw * ratio;
      const drawH = crop.sh * ratio;
      const drawX = M;
      const drawY = 66 + (maxH - drawH) / 2;

      ctx.drawImage(
        image,
        crop.sx, crop.sy, crop.sw, crop.sh,
        drawX, drawY, drawW, drawH,
      );
    } catch (error) {
      console.error('Top logo redraw failed', error);
    }
  }

  function removeBottomBranding(page) {
    if (!page) return;
    const ctx = page.getContext('2d');
    const W = page.width;
    const H = page.height;
    const M = 72;

    // Внизу КП не дублируем ни логотип, ни название бренда, ни контакты.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(M - 4, H - 148, W - M * 2 + 8, 125);

    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M, H - 150);
    ctx.lineTo(W - M, H - 150);
    ctx.stroke();
  }

  renderQuotePages = async function renderQuotePagesV8(quote) {
    const pages = await previousRenderQuotePagesV8(quote);
    if (!pages.length) return pages;

    await redrawTopLogo(pages[0]);
    pages.forEach(removeBottomBranding);
    return pages;
  };
})();
