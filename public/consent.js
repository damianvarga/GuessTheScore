(function () {
  var cookieName = 'gs_consent';

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? m[1] : null;
  }

  function setCookie(name, value) {
    document.cookie = name + '=' + value + ';max-age=31536000;path=/';
  }

  function loadAds() {
    if (window.__adsenseLoaded) return;
    var units = document.querySelectorAll('.adsbygoogle');
    if (!units.length) return;
    var client = units[0].getAttribute('data-ad-client');
    if (!client) return;
    window.__adsenseLoaded = true;
    var s = document.createElement('script');
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = function () {
      var ads = window.adsbygoogle = window.adsbygoogle || [];
      document.querySelectorAll('.adsbygoogle').forEach(function () {
        ads.push({});
      });
    };
    document.head.appendChild(s);
  }

  var consent = getCookie(cookieName);
  var banner = document.getElementById('consent-banner');

  if (consent === '1') {
    if (banner) banner.style.display = 'none';
    loadAds();
    return;
  }
  if (consent === '0') {
    if (banner) banner.style.display = 'none';
    return;
  }
  if (banner) {
    banner.style.display = 'block';
    var acceptBtn = document.getElementById('consent-accept');
    var declineBtn = document.getElementById('consent-decline');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function () {
        setCookie(cookieName, '1');
        banner.style.display = 'none';
        loadAds();
      });
    }
    if (declineBtn) {
      declineBtn.addEventListener('click', function () {
        setCookie(cookieName, '0');
        banner.style.display = 'none';
      });
    }
  }
})();
