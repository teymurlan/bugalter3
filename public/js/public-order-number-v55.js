(() => {
  const labels = new Map();
  const technicalPattern = /HC-[A-Z0-9]+(?:-[A-Z0-9]+)+/g;
  const nativeFetch = window.fetch.bind(window);
  let rewriteQueued = false;

  function positiveNumber(value) {
    const number = Number(value || 0);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  }

  function formatNumber(value) {
    const number = positiveNumber(value);
    return number ? `#${String(number).padStart(3, '0')}` : '';
  }

  function ingest(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => ingest(item, seen));
      return;
    }
    const technical = String(value.order_number || '');
    const number = positiveNumber(value.public_order_number || value.display_number);
    if (technical && number) labels.set(technical, formatNumber(number));
    Object.values(value).forEach((item) => ingest(item, seen));
  }

  function replaceVisibleText(root = document.body) {
    if (!root || !labels.size) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue || '';
      if (!text.includes('HC-')) continue;
      const next = text.replace(technicalPattern, (technical) => labels.get(technical) || technical);
      if (next !== text) node.nodeValue = next;
    }
  }

  function queueRewrite() {
    if (rewriteQueued) return;
    rewriteQueued = true;
    queueMicrotask(() => {
      rewriteQueued = false;
      replaceVisibleText();
    });
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const clone = response.clone();
      const type = String(clone.headers.get('content-type') || '');
      if (type.includes('application/json')) {
        clone.json().then((data) => {
          ingest(data);
          queueRewrite();
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  new MutationObserver(queueRewrite).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.HouseCleaningOrderNumber = {
    format: formatNumber,
    labelFor(order) {
      const direct = formatNumber(order?.public_order_number || order?.display_number);
      return direct || labels.get(String(order?.order_number || '')) || '';
    },
  };
})();
