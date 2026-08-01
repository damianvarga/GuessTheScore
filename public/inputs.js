document.addEventListener('input', function (e) {
  const el = e.target;
  if (!el || el.dataset.digits === undefined) return;
  const max = parseInt(el.dataset.maxlen, 10) || 5;
  el.value = el.value.replace(/[^0-9]/g, '').slice(0, max);
});
