// Google review carousel for aroodog.com.
// Fills every [data-reviews] block with live 5-star reviews from the
// aroo-google-reviews Supabase function.
(function () {
  var ENDPOINT = 'https://pgcospvlhorcvssafjoo.supabase.co/functions/v1/aroo-google-reviews';
  var WRITE_URL = 'https://g.page/r/CSEv50ucIH2yEBM/review';
  var blocks = document.querySelectorAll('[data-reviews]');
  if (!blocks.length) return;

  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';
  var G = '<svg class="rv-g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  function stars(n) { var s = ''; for (var i = 0; i < n; i++) s += STAR; return '<span class="rv-stars" aria-label="' + n + ' out of 5 stars">' + s + '</span>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^(https:\/\/|\/(?!\/))/.test(u || '') ? u : null; }

  function card(r) {
    var author = esc(r.author);
    var authorUrl = safeUrl(r.authorUrl);
    var photo = safeUrl(r.photo);
    var url = safeUrl(r.url);
    var avatar = photo
      ? '<span class="rv-avatar"><img src="' + esc(photo) + '" alt="" referrerpolicy="no-referrer" loading="lazy" width="44" height="44"></span>'
      : '<span class="rv-avatar" aria-hidden="true">' + esc(r.author.charAt(0).toUpperCase()) + '</span>';
    var name = authorUrl
      ? '<a class="rv-name" href="' + esc(authorUrl) + '" target="_blank" rel="noopener">' + author + '</a>'
      : '<span class="rv-name">' + author + '</span>';
    var long = r.text.length > 240;
    return '<figure class="rv-card">' + stars(5) +
      '<blockquote>&ldquo;' + esc(r.text) + '&rdquo;</blockquote>' +
      (long ? '<button type="button" class="rv-more" aria-expanded="false">Read more</button>' : '') +
      '<figcaption class="rv-author">' + avatar + '<span>' + name +
      (r.when ? '<span class="rv-when">' + esc(r.when) + '</span>' : '') + '</span>' + G + '</figcaption></figure>';
  }

  // Layered carousel: the active review sits in the middle, its neighbors
  // tucked behind on each side. Rotates slowly; pauses on hover, focus, or
  // an opened review. Swipe or use the arrows/dots to move by hand.
  var INTERVAL = 6000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function wire(root) {
    var stage = root.querySelector('.rv-track');
    var cards = Array.prototype.slice.call(stage.children);
    var n = cards.length;
    var controls = root.querySelector('.rv-controls');
    var prev = root.querySelector('.rv-prev');
    var next = root.querySelector('.rv-next');
    var dots = root.querySelector('.rv-dots');
    var active = 0, timer = null, hover = false, focus = false;

    function offset(i) {
      var d = ((i - active) % n + n) % n;
      if (d > n / 2) d -= n;
      if (n === 2 && d !== 0) d = 1;
      return d;
    }
    function layout() {
      var h = 0;
      cards.forEach(function (c) { c.style.minHeight = ''; });
      cards.forEach(function (c, i) {
        var d = offset(i);
        c.setAttribute('data-pos', d === 0 ? 'center' : d === -1 ? 'left' : d === 1 ? 'right' : 'hidden');
        c.setAttribute('aria-hidden', d === 0 ? 'false' : 'true');
        c.inert = d !== 0;
        h = Math.max(h, c.offsetHeight);
      });
      cards.forEach(function (c) { c.style.minHeight = h + 'px'; });
      stage.style.height = h + 'px';
      for (var j = 0; j < dots.children.length; j++) dots.children[j].setAttribute('aria-current', j === active ? 'true' : 'false');
    }
    function go(i) { active = ((i % n) + n) % n; layout(); }
    function paused() { return hover || focus || root.querySelector('.rv-card.is-open'); }
    function start() {
      stop();
      if (n < 2 || reduceMotion) return;
      timer = setInterval(function () { if (!paused() && !document.hidden) go(active + 1); }, INTERVAL);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    controls.hidden = n < 2;
    for (var i = 0; i < n; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Show review ' + (i + 1));
      b.addEventListener('click', (function (k) { return function () { go(k); start(); }; })(i));
      dots.appendChild(b);
    }
    prev.addEventListener('click', function () { go(active - 1); start(); });
    next.addEventListener('click', function () { go(active + 1); start(); });
    // Tapping a side card brings it to the middle.
    cards.forEach(function (c, i) {
      c.addEventListener('click', function () { if (offset(i) !== 0) { go(i); start(); } });
    });
    root.addEventListener('mouseenter', function () { hover = true; });
    root.addEventListener('mouseleave', function () { hover = false; });
    root.addEventListener('focusin', function () { focus = true; });
    root.addEventListener('focusout', function () { focus = false; });

    var x0 = null;
    stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) { go(active + (dx < 0 ? 1 : -1)); start(); }
    }, { passive: true });

    root.rvLayout = layout;
    window.addEventListener('resize', layout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    layout();
    stage.classList.add('is-ready');
    start();
  }

  function render(root, data) {
    var score = root.querySelector('.rv-score');
    var based = root.querySelector('.rv-based');
    var viewport = root.querySelector('.rv-viewport');
    var reviewsUrl = safeUrl(data && data.reviewsUrl) || WRITE_URL;
    var writeUrl = safeUrl(data && data.writeReviewUrl) || WRITE_URL;
    var badge = root.querySelector('.rv-badge');
    if (badge) badge.href = reviewsUrl;

    if (data && data.rating && score) {
      score.querySelector('.rv-num').textContent = data.rating.toFixed(1);
      score.querySelector('.rv-stars-slot').innerHTML = stars(Math.round(data.rating));
      score.hidden = false;
      if (based) {
        based.innerHTML = 'Based on <a href="' + esc(reviewsUrl) + '" target="_blank" rel="noopener">' +
          data.count + ' Google review' + (data.count === 1 ? '' : 's') + '</a>';
        based.hidden = false;
      }
    }

    var list = (data && data.reviews) || [];
    if (!list.length) {
      viewport.outerHTML = '<p class="rv-empty">Had a great experience? <a href="' + esc(writeUrl) + '" target="_blank" rel="noopener">Leave us a Google review</a>.</p>';
      return;
    }
    viewport.querySelector('.rv-track').innerHTML = list.map(card).join('');
    viewport.querySelectorAll('.rv-more').forEach(function (b) {
      b.addEventListener('click', function () {
        var open = b.getAttribute('aria-expanded') !== 'true';
        b.closest('.rv-card').classList.toggle('is-open', open);
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.textContent = open ? 'Show less' : 'Read more';
        if (root.rvLayout) root.rvLayout();
      });
    });
    wire(root);
  }

  fetch(ENDPOINT)
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (data) { blocks.forEach(function (b) { render(b, data); }); });
})();
