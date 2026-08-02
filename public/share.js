(function () {
  var ORIGINAL = 'Share';

  function copyText(text, btn) {
    var dummy = document.createElement('textarea');
    dummy.value = text;
    dummy.setAttribute('readonly', '');
    dummy.style.position = 'fixed';
    dummy.style.left = '-9999px';
    document.body.appendChild(dummy);
    dummy.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(dummy);
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(function () {
      btn.textContent = ORIGINAL;
    }, 2000);
  }

  function share(btn) {
    var url = btn.getAttribute('data-share-url') || window.location.href;
    var text = btn.getAttribute('data-share-text') || '';
    var title = btn.getAttribute('data-share-title') || 'Guess the Score';
    var fallbackText = (text ? text + ' ' : '') + url;

    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).catch(function () {});
    } else {
      copyText(fallbackText, btn);
    }
  }

  document.querySelectorAll('[data-share]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      share(btn);
    });
  });
})();
