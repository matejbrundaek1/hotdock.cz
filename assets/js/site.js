/* base.js — small stand-ins for behaviour that every classic Wix site gets from Wix's own
   script. Each site adds its own extras after this (custom/<site>/site.js). */
(function () {
  'use strict';

  // Menu hover colours: Wix styles the hovered menu button through data-state="… over".
  document.querySelectorAll('.wixui-dropdown-menu__item').forEach(function (li) {
    function set(on) {
      var st = (li.getAttribute('data-state') || '').split(/\s+/).filter(function (x) { return x && x !== 'over'; });
      if (on) st.push('over');
      li.setAttribute('data-state', st.join(' '));
    }
    li.addEventListener('mouseenter', function () { set(true); });
    li.addEventListener('mouseleave', function () { set(false); });
  });

  // Videos that play by themselves on Wix (background videos, autoplay video boxes).
  document.querySelectorAll('video[autoplay]').forEach(function (v) {
    v.muted = true;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  });

  // "Back to top" arrow on phones: appears after scrolling, takes you to the top.
  var btt = document.getElementById('BACK_TO_TOP_BUTTON');
  if (btt) {
    var show = function () {
      var on = window.scrollY > window.innerHeight * 0.5;
      btt.style.opacity = on ? '1' : '0';
      btt.style.visibility = on ? 'visible' : 'hidden';
      btt.style.transition = 'opacity .3s';
    };
    window.addEventListener('scroll', show, { passive: true });
    show();
    btt.style.cursor = 'pointer';
    btt.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  // Links to a spot on the same page glide there, as on Wix.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a) return;
    var url = new URL(a.href, location.href);
    if (url.pathname.replace(/\/(m\.html)?$/, '') !== location.pathname.replace(/\/(m\.html)?$/, '')) return;
    var target = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', url.hash);
  });
})();

/* custom/hotdock.cz/site.js — behaviour that Wix's own script gave the hotdock.cz pages.
   Appended after tools/base.js. Plain browser JavaScript, no libraries.
   Everything here was measured against the live Wix site (timings, thresholds, class names). */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var isMobile = root.getAttribute('data-device') === 'mobile';

  function $$(sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); }
  function normPath(p) { return (p || '/').replace(/\/m\.html$/, '/').replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/'; }
  function bodyTop() { return doc.body.getBoundingClientRect().top; }

  /* ------------------------------------------------------------------------------------------
     1. Entrance animations ("float in" / "fade in" of blocks)
     Wix starts the paused CSS animation of a block when 15 % of the block is inside the screen (the live
     pages' "viewport-enter" trigger: threshold 0.15, margin 0 for every block of this site), then marks it
     data-motion-enter="done" (the page CSS only animates blocks that are not "done").
  ------------------------------------------------------------------------------------------- */
  function initMotion() {
    var items = $$('[data-motion-enter="pending"]');
    if (!items.length) return;
    function finish(el) { el.setAttribute('data-motion-enter', 'done'); el.style.animationPlayState = ''; }
    function hasAnimation(el) { var n = getComputedStyle(el).animationName; return !!n && n !== 'none'; }
    function play(el) {
      var ended = false;
      function end() { if (ended) return; ended = true; el.removeEventListener('animationend', onEnd); finish(el); }
      function onEnd(ev) { if (ev.target === el) end(); }
      el.addEventListener('animationend', onEnd);
      el.style.animationPlayState = 'running';
      setTimeout(end, 4000); // safety net, the animations last 1.2 s
    }
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        // 15 % of the block visible - or the block fills the whole screen (a block taller than the screen can never show 15 %)
        var fills = en.rootBounds && en.intersectionRect.height >= en.rootBounds.height - 1;
        if (en.intersectionRatio < 0.15 - 0.002 && !fills) return;
        io.unobserve(en.target);
        play(en.target);
      });
    }, { threshold: [0, 0.15] }) : null;
    items.forEach(function (el) {
      if (!hasAnimation(el)) { finish(el); return; } // e.g. visitor asks the system for reduced motion
      if (io) io.observe(el); else play(el);
    });
  }

  /* ------------------------------------------------------------------------------------------
     2. Header bar that slides up when you scroll down (desktop)
     Same rule as Wix's "HeaderHideToTop": hides after scrolling down 400 px from the last turning
     point, comes back after scrolling up 400 px (or at the very top). Scroll is measured 100 ms
     after the first scroll event, like Wix does.
  ------------------------------------------------------------------------------------------- */
  function initHeader() {
    var header = doc.getElementById('SITE_HEADER');
    if (!header || isMobile) return;
    var DISTANCE = 400;
    var hidden = false, dir = 'down', turn = 0, timer = null;
    function pos() { return { y: bodyTop(), bottom: window.innerHeight + window.scrollY === doc.body.scrollHeight }; }
    var prev = pos();
    function settle(ev) { if (ev.target === header) { header.removeEventListener('transitionend', settle); header.classList.add('YFsPrR'); } }
    function setHidden(on) {
      hidden = on; dir = 'down'; turn = 0;           // Wix starts counting again after every change
      header.removeEventListener('transitionend', settle);
      header.classList.remove('ptcyHf', 'd3PC2t', 'YFsPrR');
      header.classList.add(on ? 'ptcyHf' : 'd3PC2t');
      header.addEventListener('transitionend', settle);
    }
    function measure() {
      timer = null;
      var cur = pos(), old = prev; prev = cur;
      var now = cur.y && -cur.y, before = old.y && -old.y;
      if (dir !== 'down' || !(now < before) || (cur.bottom && old.bottom)) {
        if (dir === 'up' && now > before && now >= 0 && before >= 0) { turn = before; dir = 'down'; }
      } else { turn = before; dir = 'up'; }
      if (hidden) { if ((dir === 'up' && now + DISTANCE < turn) || cur.y === 0) setHidden(false); }
      else if (dir === 'down' && now - turn >= DISTANCE) setHidden(true);
    }
    window.addEventListener('scroll', function () { if (timer === null) timer = setTimeout(measure, 100); }, { passive: true });
  }

  /* ------------------------------------------------------------------------------------------
     3. Video boxes (the pictures that play a film: autoplay, play on hover, click to play/pause,
        sound button). Settings come from data-wx-vb (taken from the Wix page data).
  ------------------------------------------------------------------------------------------- */
  function VideoBox(box, cfg) {
    var video = box.querySelector('video');
    if (!video) return;
    var poster = box.querySelector('img.bgVideoposter');
    var pressBtn = box.querySelector('.UeoHYs');
    var audioBtn = box.querySelector('[data-audio-mute]');
    var touchMode = 'ontouchend' in window && isMobile;
    var hasAudio = !!cfg.hasAudio, hasClick = !!cfg.hasClick, hasRollIn = !!cfg.hasRollIn;
    var audioRollIn = !!cfg.hasAudioRollIn, clickPauses = !!cfg.canClickPause, rollPauses = !!cfg.canRollPause;
    var autoplay = !!cfg.autoplay, replay = cfg.canReplay !== false;
    var volume = +(box.getAttribute('data-volume') || cfg.volume || 1);
    var stopped = false;              // film ended and may not be replayed
    var wantAudio = hasAudio;         // visitor has not switched the sound off
    var armed = autoplay || !hasClick; // the sound button may show up
    var audioTimer, fadeTimer, touchTimer, audioCtx = null, clicked = false;

    // Like Wix: the sound only comes up on hover after the visitor clicked in this box (a suspended AudioContext
    // stands for "no click yet"). Browsers allow only a handful of AudioContexts per page; without one we just
    // remember the click.
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); } catch (e) { audioCtx = null; }

    function showAudio() {
      box.setAttribute('data-show-audio', '');
      clearTimeout(audioTimer);
      audioTimer = setTimeout(function () { box.removeAttribute('data-show-audio'); }, 2000);
    }
    function fadeIn() {
      video.volume = 0; video.muted = false;
      var level = 0; clearInterval(fadeTimer);
      fadeTimer = setInterval(function () {
        level += 0.2;
        if (level >= volume) { video.volume = volume; clearInterval(fadeTimer); } else video.volume = level;
      }, 200);
    }
    function fadeOut() {
      var level = 1; clearInterval(fadeTimer); video.volume = volume;
      fadeTimer = setInterval(function () {
        level -= 0.2;
        if (level <= 0) { video.volume = 0; video.muted = true; clearInterval(fadeTimer); } else video.volume = level;
      }, 200);
    }
    function tryPlay() { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    var api = {
      play: function (mark) {
        if (mark) box.setAttribute('data-playing', '');
        if (pressBtn) pressBtn.setAttribute('aria-pressed', 'true');
        tryPlay(); armed = true;
      },
      pause: function () {
        box.removeAttribute('data-playing');
        if (pressBtn) pressBtn.setAttribute('aria-pressed', 'false');
        video.pause();
      },
      toggle: function () { if (video.paused) api.play(true); else api.pause(); },
      mute: function () {
        video.muted = true; box.setAttribute('data-audio', 'off');
        if (audioBtn) audioBtn.setAttribute('aria-pressed', 'true');
      },
      unmute: function (fade) {
        if (fade) fadeIn(); else video.muted = false;
        box.setAttribute('data-audio', 'on');
        if (audioBtn) audioBtn.setAttribute('aria-pressed', 'false');
      },
      toggleSound: function () {
        var muteNow = !video.muted; wantAudio = !muteNow;
        if (muteNow) api.mute(); else api.unmute();
      }
    };

    // --- what the pointer / finger does
    function onClick(e) {
      clicked = true;
      if (audioCtx && audioCtx.resume) audioCtx.resume();
      if (!video || stopped) return;
      if (touchMode) {
        var first = !autoplay && !box.getAttribute('data-touched');
        var second = box.getAttribute('data-touched') === 'on';
        if (hasAudio) showAudio();
        if (hasAudio && audioBtn && audioBtn.contains(e.target)) { api.toggleSound(); return; }
        if (first || second) { if (video.paused) api.play(true); else if (clickPauses || rollPauses) api.pause(); }
        if (hasClick || hasRollIn) {
          clearTimeout(touchTimer);
          box.setAttribute('data-touched', 'on');
          touchTimer = setTimeout(function () { box.setAttribute('data-touched', 'off'); }, 1400);
        }
      } else {
        if (hasAudio && audioBtn) { showAudio(); if (audioBtn.contains(e.target)) { api.toggleSound(); return; } }
        if (video.paused) api.play(true); else if (clickPauses) api.pause();
      }
    }
    function onEnter() {
      if (!video || stopped) return;
      if (hasRollIn) api.play(); else if (hasClick) box.setAttribute('data-roll-in', '');
      if (hasAudio && armed) {
        showAudio();
        var audioOk = audioCtx ? (audioCtx.state === 'running' || audioCtx.state === 'interrupted') : clicked;
        if (wantAudio && audioOk && (audioRollIn || hasRollIn) && video.muted) api.unmute(true);
      }
    }
    function onLeave() {
      if (!video) return;
      if (rollPauses) video.pause(); else if (hasClick) box.removeAttribute('data-roll-in');
      if (hasAudio) {
        clearTimeout(audioTimer); box.removeAttribute('data-show-audio');
        if (audioRollIn && !video.muted) fadeOut();
      }
    }
    function onMove() { if (hasAudio && armed) showAudio(); }
    function onKey(e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      if (!video || stopped) return;
      if (audioBtn && audioBtn.contains(e.target)) api.toggleSound(); else api.toggle();
    }
    if (touchMode) { if (hasAudio || hasClick || hasRollIn) box.addEventListener('click', onClick); }
    else {
      if (hasAudio || hasClick) box.addEventListener('click', onClick);
      if (hasAudio || hasRollIn || hasClick) box.addEventListener('mouseenter', onEnter);
      if (hasAudio || rollPauses || hasClick) box.addEventListener('mouseleave', onLeave);
      if (hasAudio) box.addEventListener('mousemove', onMove);
      box.addEventListener('keydown', onKey);
    }

    // --- what the film itself reports
    function swapPoster() {
      video.style.opacity = '1';
      if (poster) poster.style.opacity = '0';
    }
    video.addEventListener('playing', swapPoster);
    video.addEventListener('loadeddata', function () { box.setAttribute('data-can-play', ''); });
    if (video.readyState >= 2) box.setAttribute('data-can-play', '');
    video.addEventListener('ended', function () {
      if (!replay) { stopped = true; box.setAttribute('data-stop', ''); }
      box.removeAttribute('data-playing');
    });
    if (!autoplay) box.removeAttribute('data-playing');

    // --- play only while the box is on screen and the tab is visible (like Wix)
    var visible = !doc.hidden, inView = false;
    doc.addEventListener('visibilitychange', function () {
      if (!box.hasAttribute('data-playing')) return;
      visible = !doc.hidden;
      if (visible && inView) tryPlay(); else video.pause();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          inView = en.isIntersecting;
          if (visible && inView) { if (box.hasAttribute('data-playing') && video.src) tryPlay(); }
          else video.pause();
        });
      }).observe(box);
    } else if (autoplay) { tryPlay(); }
    if (video.readyState >= 3 && !video.paused) swapPoster();
  }

  function initVideoBoxes() {
    $$('.wixui-video-box[data-wx-vb]').forEach(function (box) {
      var cfg; try { cfg = JSON.parse(box.getAttribute('data-wx-vb')); } catch (e) { return; }
      VideoBox(box, cfg);
    });
  }

  /* ------------------------------------------------------------------------------------------
     4. Phone menu (the "hamburger"): builds the full-screen list on click like Wix does
  ------------------------------------------------------------------------------------------- */
  var closeMenu = function () {};
  function initTinyMenu() {
    var nav = doc.getElementById('TINY_MENU');
    if (!nav) return;
    var btn = nav.querySelector('[data-testid="tinymenu-menubutton"]');
    var holder = nav.querySelector('.wnBX6j');
    var list = nav.querySelector('ul[aria-hidden]');
    if (!btn || !holder || !list) return;
    var icon = btn.querySelector('svg');
    var here = normPath(location.pathname);
    var isOpen = false, t1, t2;

    function buildItems() {
      var wrap = doc.createElement('div'); wrap.className = 'pu1NwP';
      var ul = doc.createElement('ul'); ul.id = 'menuItemsTINY_MENU'; ul.className = 'S6He1V vlrgcZ c1Ehg0';
      $$('a', list).forEach(function (src, i) {
        var li = doc.createElement('li'); li.className = 'EFQsWg';
        var a = doc.createElement('a'); a.setAttribute('data-testid', 'linkElement');
        if (src.hasAttribute('data-anchor')) a.setAttribute('data-anchor', src.getAttribute('data-anchor'));
        a.setAttribute('href', src.getAttribute('href')); a.setAttribute('target', src.getAttribute('target') || '_self');
        var selected = !src.hasAttribute('data-anchor') && normPath(new URL(src.getAttribute('href'), location.href).pathname) === here;
        a.className = 'S60BpP' + (selected ? ' xWu3lt' : '');
        li.setAttribute('data-testid', 'tinymenu-item-' + i + (selected ? '-selected' : ''));
        a.textContent = src.textContent;
        li.appendChild(a); ul.appendChild(li);
      });
      wrap.appendChild(ul);
      return wrap;
    }
    function open() {
      if (isOpen) return; isOpen = true;
      clearTimeout(t1); clearTimeout(t2);
      holder.appendChild(buildItems());
      btn.setAttribute('aria-expanded', 'true');
      if (icon) icon.removeAttribute('preserveAspectRatio');     // (Wix leaves it empty = browser default; an empty value would log a console error)
      nav.classList.remove('S1paC5'); nav.classList.add('kgNViD');
      t1 = setTimeout(function () { doc.body.classList.add('siteScrollingBlocked'); }, 27);
    }
    function close() {
      if (!isOpen) return; isOpen = false;
      clearTimeout(t1); clearTimeout(t2);
      while (holder.firstChild) holder.removeChild(holder.firstChild);
      btn.setAttribute('aria-expanded', 'false');
      if (icon) icon.setAttribute('preserveAspectRatio', 'none');
      nav.classList.remove('kgNViD'); nav.classList.add('S1paC5');
      t1 = setTimeout(function () { nav.classList.remove('S1paC5'); }, 14);
      t2 = setTimeout(function () { doc.body.classList.remove('siteScrollingBlocked'); }, 30);
    }
    closeMenu = close;
    window.addEventListener('pageshow', function (e) { if (e.persisted) close(); });   // back button restored the page with the menu open
    btn.removeAttribute('aria-expanded');
    btn.addEventListener('click', function () { if (isOpen) close(); else open(); });
  }

  /* ------------------------------------------------------------------------------------------
     5. "Back to top" arrow on the phone: appears after scrolling past 512 px, goes away again after
        3 seconds, a tap scrolls up smoothly. (Replaces the simpler stand-in from base.js.)
  ------------------------------------------------------------------------------------------- */
  function initBackToTop() {
    var old = doc.getElementById('BACK_TO_TOP_BUTTON');
    if (!old) return;
    var btt = old.cloneNode(true);          // a clean copy without base.js's listeners / inline styles
    btt.removeAttribute('style');
    old.parentNode.replaceChild(btt, old);
    var visible = false, scrollTimer = null, hideTimer = null;
    function measure() {
      scrollTimer = null;
      if (!visible && Math.abs(bodyTop()) > 512) {
        visible = true; btt.classList.add('z7UpAt');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { visible = false; btt.classList.remove('z7UpAt'); }, 3000);
      }
    }
    window.addEventListener('scroll', function () { if (scrollTimer === null) scrollTimer = setTimeout(measure, 100); }, { passive: true });
    btt.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ------------------------------------------------------------------------------------------
     6. Links that lead to the page you are already on
        - plain link (menu item, logo button): glides to the top (ease-in-out sine, 0.4 s + 21.6 ms·√pixels)
        - link whose Wix "anchor" no longer exists (MUSIC VIDEOS, CONTACT …): Wix just jumps to the top
        Both without reloading the page.
  ------------------------------------------------------------------------------------------- */
  var glideId = 0;
  function glideToTop() {
    var from = window.pageYOffset;
    if (!from) return;
    var id = ++glideId;
    var duration = 395 + 21.6 * Math.sqrt(from);
    var t0 = null;
    function stop() { glideId++; window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); window.removeEventListener('keydown', stop); }
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    function step(t) {
      if (id !== glideId) return;
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / duration);
      window.scrollTo(0, from * (1 - (1 - Math.cos(Math.PI * k)) / 2));
      if (k < 1) requestAnimationFrame(step); else stop();
    }
    requestAnimationFrame(step);
  }
  function initSamePageLinks() {
    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var target = a.getAttribute('target');
      if (target && target !== '_self') return;
      var u;
      try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (u.origin !== location.origin || u.hash) return;
      if (normPath(u.pathname) !== normPath(location.pathname) || u.search !== location.search) return;
      e.preventDefault();
      closeMenu();
      if (a.hasAttribute('data-anchor')) { glideId++; window.scrollTo(0, 0); } else glideToTop();
    });
  }

  /* ------------------------------------------------------------------------------------------
     7. Video player with its own control bar ("Playable" player on the Feature Film page)
     Wix builds the player's inside only when it scrolls into view and plays it from there; the
     control bar appears while the pointer moves over it, hides 2 s after the last movement while
     the film plays, stays visible while paused. All states are the same classes/attributes Wix sets,
     so the page CSS does the drawing. On phones Wix uses the browser's own video controls.
  ------------------------------------------------------------------------------------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' : '') + pad2(m) + ':' + pad2(s);
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function Player(root) {
    function hook(name) { return root.querySelector('[data-playable-hook="' + name + '"]'); }
    function hooks(name) { return $$('[data-playable-hook="' + name + '"]', root); }
    var container = hook('player-container'), screen = hook('screen-block'), topBlock = hook('top-block'), bottom = hook('bottom-block');
    var video = screen && screen.querySelector('video');
    if (!container || !video) return;
    var indicator = root.querySelector('.upGNDJ');
    var loader = hook('loader');
    var playWrap = hooks('playback-control')[0], playBtn = hooks('playback-control')[1];
    var volCtl = hook('volume-control'), muteBtn = hook('mute-button'), volBlock = hook('volume-input-block');
    var volBar = hook('volume-input'), volHit = hook('volume-hitbox');
    var progress = hook('progress-control'), progHit = hook('progress-hitbox');
    var played = hook('progress-played'), buffered = hook('progress-buffered'), seekTo = hook('progress-seek-to'), seekBtn = hook('progress-seek-button');
    var timeCtl = hook('time-control'), nowText = hook('current-time-indicator'), lenText = hook('duration-time-indicator');
    var pipBtn = hooks('picture-in-picture-control')[1], pipWrap = hooks('picture-in-picture-control')[0];
    var fsBtn = hook('full-screen-button');
    var tip = root.querySelector('[role="tooltip"]'), tipText = tip && tip.querySelector('[data-playable-hook="tooltip-inner"]');
    var tipHolder = tip && tip.parentNode;

    var hovering = false, userPaused = false, dragging = null, idleTimer = null, raf = 0;

    // ---- control bar visibility
    function showControls() {
      screen.classList.remove('aXrXkB'); topBlock.classList.add('FyWkdw'); bottom.classList.add('dGEJNK');
    }
    function hideControls() {
      if (video.paused) return;
      screen.classList.add('aXrXkB'); topBlock.classList.remove('FyWkdw'); bottom.classList.remove('dGEJNK');
    }
    function idle() { clearTimeout(idleTimer); if (!video.paused) idleTimer = setTimeout(hideControls, 2000); }
    container.addEventListener('mouseenter', function () { hovering = true; showControls(); idle(); });
    container.addEventListener('mousemove', function () { hovering = true; showControls(); idle(); });
    container.addEventListener('mouseleave', function () { hovering = false; clearTimeout(idleTimer); hideControls(); });

    // ---- tooltip (one shared bubble)
    var tipPlain = false, tipOwner = null;
    function tipShow(text, centerX, plain) {
      if (!tip || !tipText || !tipHolder) return;
      tipPlain = !!plain;
      if (plain) {                       // the time bubble over the progress bar is Playable's preview-thumbnail box (without a picture)
        var tb = tipText.querySelector('[data-playable-hook="thumb-text-block"]');
        if (tb) tb.textContent = text;
        else tipText.innerHTML = '<div class="F1Ig1D j6b75H" data-playable-component=""> <div class="_Od17P" data-playable-hook="thumb-high-quality"> </div> <div class="vaSh1_" data-playable-hook="thumb-low-quality"> </div> <div class="CXb_TI" data-playable-hook="thumb-text-block">' + text + '</div></div>';
      } else tipText.textContent = text;
      tip.className = 'chEfQZ ' + (plain ? 'undefined' : 'TJLRFP') + ' D_qOXi';
      var h = tipHolder.getBoundingClientRect(), w = tip.offsetWidth;
      tip.style.left = clamp(centerX - h.left - w / 2, 0, Math.max(0, h.width - w)) + 'px';
      tip.style.top = 'initial'; tip.style.bottom = '0px';
    }
    function tipHide() { if (tip) tip.className = 'chEfQZ ' + (tipPlain ? 'undefined' : 'TJLRFP'); tipOwner = null; }
    function tipTextFor(btn) {
      if (btn === fsBtn) return btn.classList.contains('JZZ0I9') ? 'Exit Full Screen' : 'Enter Full Screen';
      return btn.getAttribute('aria-label') || '';
    }
    function tipFor(btn) {
      if (!btn) return;
      btn.addEventListener('mouseenter', function () { var r = btn.getBoundingClientRect(); tipOwner = btn; tipShow(tipTextFor(btn), r.left + r.width / 2); });
      btn.addEventListener('mouseleave', tipHide);
      // a click that changes the label (Mute <-> Unmute, full screen, picture-in-picture) only swaps the words, the bubble stays where it is
      btn.addEventListener('click', function () { setTimeout(function () { if (tipOwner === btn && tipText) tipText.textContent = tipTextFor(btn); }, 0); });
    }
    [muteBtn, pipBtn, fsBtn].forEach(tipFor);                 // (the play/pause button has no bubble on Wix)

    // ---- centre bubble that flashes when the picture itself is clicked
    var ICONS = {
      pause: '<svg class="Bf5r6b Nkf_4l" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 14"> <path fill="#FFF" fill-rule="evenodd" d="M7 0h3v14H7V0zM0 0h3v14H0V0z"></path> </svg>',
      play: '<svg class="NVmRhj Nkf_4l" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 14"> <path fill="#FFF" fill-rule="evenodd" d="M.079 0L0 14l10.5-7.181z"></path> </svg>',
      up: '<svg class="Nkf_4l" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 14"> <g fill="none" fill-rule="evenodd"> <path fill="#FFF" d="M0 3.919h2.993v5.97H0V3.92zm2.995-.015L7 .924v12L2.995 9.882v-5.98z"></path> <path stroke="#FFF" d="M12.793 13.716a9.607 9.607 0 0 0 0-13.586M9.853 10.837a5.45 5.45 0 0 0 0-7.707"></path> </g> </svg>',
      down: '<svg class="Nkf_4l" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 14"> <g fill="none" fill-rule="evenodd"> <path fill="#FFF" d="M0 3.919h2.993v5.97H0V3.92zm2.995-.015L7 .924v12L2.995 9.882v-5.98z"></path> <path stroke="#FFF" d="M9.853 10.837a5.45 5.45 0 0 0 0-7.707"></path> </g> </svg>',
      forward: '<div class="tlknGG"> <span>5</span> </div> <svg class="Nkf_4l" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"> <path fill="#FFF" fill-rule="evenodd" d="M17 0c4.59 0 8.84 1.87 11.9 4.93V1.7h3.4v10.2H22.1V8.5h5.44C24.99 5.27 21.25 3.4 17 3.4 9.52 3.4 3.4 9.52 3.4 17c0 7.48 6.12 13.6 13.6 13.6 7.48 0 13.6-6.12 13.6-13.6H34c0 9.35-7.65 17-17 17S0 26.35 0 17 7.65 0 17 0z"></path> </svg>',
      back: '<div class="tlknGG"> <span>5</span> </div> <svg class="Nkf_4l" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"> <path fill="#FFF" fill-rule="evenodd" d="M17 0C12.41 0 8.16 1.87 5.1 4.93V1.7H1.7v10.2h10.2V8.5H6.46C9.01 5.27 12.75 3.4 17 3.4c7.48 0 13.6 6.12 13.6 13.6 0 7.48-6.12 13.6-13.6 13.6-7.48 0-13.6-6.12-13.6-13.6H0c0 9.35 7.65 17 17 17s17-7.65 17-17S26.35 0 17 0z"></path> </svg>'
    };
    function flash(icon) {
      if (!indicator) return;
      indicator.innerHTML = '<div class="xGKNX2"> ' + ICONS[icon] + '</div>';
    }

    // ---- play / pause
    function tryPlay() { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    function togglePlay(withFlash) {
      if (video.paused) { userPaused = false; if (withFlash) flash('play'); tryPlay(); }
      else { userPaused = true; if (withFlash) flash('pause'); video.pause(); }
    }
    function syncPlayState() {
      var playing = !video.paused;
      if (playWrap) playWrap.setAttribute('data-playable-is-playing', playing ? 'true' : 'false');
      if (playBtn) { playBtn.classList.toggle('U10_e9', !playing); playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
      if (!playing && autoPausing) { autoPausing = false; cancelAnimationFrame(raf); return; }   // only rests because it scrolled away
      if (!playing) { showControls(); clearTimeout(idleTimer); } else idle();
      if (playing) tick(); else cancelAnimationFrame(raf);
    }
    video.addEventListener('play', syncPlayState);
    video.addEventListener('pause', syncPlayState);
    video.addEventListener('waiting', function () { if (loader) { loader.classList.remove('a8S_bR'); loader.classList.add('veFGHB'); } });
    ['playing', 'canplay', 'seeked'].forEach(function (ev) { video.addEventListener(ev, function () { if (loader) { loader.classList.remove('veFGHB'); loader.classList.add('a8S_bR'); } }); });
    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-playable-hook="bottom-block"], [data-playable-hook="top-block"]')) return;
      togglePlay(true);
    });
    if (playBtn) playBtn.addEventListener('click', function () { togglePlay(false); });

    // ---- volume
    function setVolumeView() {
      var muted = video.muted || video.volume === 0;
      var pct = muted ? 0 : Math.round(video.volume * 100);
      if (volCtl) { volCtl.setAttribute('data-playable-volume-percent', pct); volCtl.setAttribute('data-playable-is-muted', muted ? 'true' : 'false'); }
      if (volBar) volBar.setAttribute('style', 'width:' + pct + '%;');
      if (volBlock) { volBlock.setAttribute('value', pct); volBlock.setAttribute('aria-valuenow', pct); }
      if (muteBtn) {
        ['rbNMd9', 'LSYah9', 'C4iBa_', 'sBQrEF'].forEach(function (c) { muteBtn.classList.remove(c); });
        if (muted) muteBtn.classList.add('rbNMd9', 'LSYah9'); else muteBtn.classList.add(video.volume >= 0.5 ? 'sBQrEF' : 'C4iBa_');
        muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        if (tipOwner === muteBtn && tipText) tipText.textContent = muted ? 'Unmute' : 'Mute';
      }
    }
    function setVolume(v) {
      v = clamp(Math.round(v * 100) / 100, 0, 1);
      video.volume = v; video.muted = false; setVolumeView();
    }
    video.addEventListener('volumechange', setVolumeView);
    if (muteBtn) muteBtn.addEventListener('click', function () {
      if (video.muted || video.volume === 0) { video.muted = false; if (video.volume === 0) video.volume = 1; } else video.muted = true;
      setVolumeView();
    });
    function volumeFrom(e) { var r = volHit.getBoundingClientRect(); return clamp((Math.floor(e.clientX) - r.left) / r.width, 0, 1); }
    if (volHit) volHit.addEventListener('mousedown', function (e) {
      e.preventDefault(); dragging = 'volume'; volCtl.classList.add('LK7q_I'); setVolume(volumeFrom(e));
    });

    // ---- progress
    function tick() { updateProgress(); cancelAnimationFrame(raf); if (!video.paused) raf = requestAnimationFrame(tick); }
    function updateProgress() {
      var d = video.duration || 0, t = video.currentTime || 0, p = d ? clamp(t / d, 0, 1) : 0;
      if (played) played.style.transform = 'scaleX(' + (Math.round(p * 1000) / 1000) + ')';
      if (progress && seekBtn) seekBtn.style.transform = 'translateX(' + (Math.round(p * progress.offsetWidth * 1000) / 1000) + 'px)';
      var pct = (p * 100).toFixed(2);
      if (progress) { progress.setAttribute('aria-valuenow', pct); progress.setAttribute('aria-valuetext', 'Already played ' + (+pct) + '%'); progress.setAttribute('data-playable-played-percent', pct); }
      if (nowText) nowText.textContent = clock(t);
      if (lenText && d) lenText.textContent = clock(d);
      if (timeCtl) { timeCtl.setAttribute('data-playable-current-time', t); if (d) timeCtl.setAttribute('data-playable-duration', d); }
      if (buffered && d && video.buffered.length) {
        var end = 0; for (var i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 0.5) end = Math.max(end, video.buffered.end(i));
        buffered.style.width = clamp(end / d * 100, 0, 100) + '%';
      }
    }
    ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked', 'progress'].forEach(function (ev) { video.addEventListener(ev, updateProgress); });
    function progressFrom(e) { var r = progHit.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); }
    function seekToFraction(f) { if (video.duration) { video.currentTime = f * video.duration; updateProgress(); } }
    if (progHit) {
      progHit.addEventListener('mousedown', function (e) {
        e.preventDefault(); dragging = 'progress'; progress.classList.add('SU1bwf'); seekToFraction(progressFrom(e));
      });
      progHit.addEventListener('mousemove', function (e) {
        if (dragging) return;
        var f = progressFrom(e);
        if (seekTo) seekTo.setAttribute('style', 'width:' + (f * 100) + '%;');
        tipShow(clock(f * (video.duration || 0)), e.clientX, true);
      });
      progHit.addEventListener('mouseleave', function () { if (!dragging) { if (seekTo) seekTo.setAttribute('style', 'width:0%;'); tipHide(); } });
    }
    document.addEventListener('mousemove', function (e) {
      if (dragging === 'volume') setVolume(volumeFrom(e));
      else if (dragging === 'progress') { var f = progressFrom(e); seekToFraction(f); if (seekTo) seekTo.setAttribute('style', 'width:' + (f * 100) + '%;'); tipShow(clock(f * (video.duration || 0)), e.clientX, true); }
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      if (dragging === 'volume') volCtl.classList.remove('LK7q_I'); else { progress.classList.remove('SU1bwf'); if (seekTo) seekTo.setAttribute('style', 'width:0%;'); tipHide(); }
      dragging = null;
    });

    // ---- keyboard (when the player has the focus)
    container.addEventListener('keydown', function (e) {
      var k = e.key, handled = true;
      if (e.target.tagName === 'BUTTON' && (k === ' ' || k === 'Enter')) return;       // let a focused button do its own thing
      if (k === ' ' || k === 'Spacebar') togglePlay(true);
      else if (k === 'ArrowRight') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); flash('forward'); }
      else if (k === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); flash('back'); }
      else if (k === 'ArrowUp') { var up = video.muted ? video.volume : video.volume + 0.1; setVolume(Math.round(up * 10) / 10 || 0.1); flash('up'); }
      else if (k === 'ArrowDown') { setVolume(Math.round((video.volume - 0.1) * 10) / 10); flash('down'); }
      else handled = false;
      if (handled) { e.preventDefault(); showControls(); idle(); }
    });

    // ---- picture-in-picture and full screen
    if (pipBtn && document.pictureInPictureEnabled && video.requestPictureInPicture) {
      pipBtn.addEventListener('click', function () {
        if (document.pictureInPictureElement) document.exitPictureInPicture(); else video.requestPictureInPicture().catch(function () {});
      });
      video.addEventListener('enterpictureinpicture', function () { pipBtn.classList.add('J43JlI'); pipBtn.setAttribute('aria-label', 'Leave Picture-in-Picture'); if (pipWrap) pipWrap.setAttribute('data-is-picture-in-picture', 'true'); });
      video.addEventListener('leavepictureinpicture', function () { pipBtn.classList.remove('J43JlI'); pipBtn.setAttribute('aria-label', 'Play Picture-in-Picture'); if (pipWrap) pipWrap.setAttribute('data-is-picture-in-picture', 'false'); });
    } else if (bottom) bottom.classList.add('eNEoBr');
    var canFull = container.requestFullscreen || container.webkitRequestFullscreen;
    function inFull() { return document.fullscreenElement === container || document.webkitFullscreenElement === container; }
    function toggleFull() {
      if (inFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
      else if (canFull) { var p = (container.requestFullscreen || container.webkitRequestFullscreen).call(container); if (p && p.catch) p.catch(function () {}); }
    }
    function fullChanged() {
      var on = inFull();
      if (on) container.setAttribute('data-playable-in-full-screen', 'true'); else container.removeAttribute('data-playable-in-full-screen');
      container.classList.toggle('Ls__Qf', on);
      if (indicator) indicator.innerHTML = '';
      root.classList.toggle('VideoPlayer2054936319__forceVisibleInFullscreen', on);
      if (fsBtn) { fsBtn.classList.toggle('JZZ0I9', on); fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Enter full screen'); }
    }
    if (canFull) {
      document.addEventListener('fullscreenchange', fullChanged); document.addEventListener('webkitfullscreenchange', fullChanged);
      if (fsBtn) fsBtn.addEventListener('click', toggleFull);
      container.addEventListener('dblclick', function (e) { if (!e.target.closest('[data-playable-hook="bottom-block"], [data-playable-hook="top-block"]')) toggleFull(); });
    } else if (bottom) bottom.classList.add('rXX5LL');

    // The film starts by itself while it is on screen (muted, looping) and rests while it is not — as in Chrome on Wix.
    // (Watching the control-bar container instead of the page block keeps it running in full screen.)
    var autoPausing = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { if (!userPaused && video.paused) tryPlay(); }
          else if (!video.paused) { autoPausing = true; video.pause(); }
        });
      }).observe(container);
    } else tryPlay();
    setVolumeView(); updateProgress();
  }

  // phones: the browser's own controls; the film still starts while it is on screen
  function MobilePlayer(root) {
    var video = root.querySelector('video');
    if (!video) return;
    var userPaused = false, resting = false;
    video.addEventListener('pause', function () { if (resting) resting = false; else userPaused = true; });
    video.addEventListener('play', function () { userPaused = false; });
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { if (!userPaused && video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } }
        else if (!video.paused) { resting = true; video.pause(); }
      });
    }).observe(root);
  }

  function initPlayers() {
    $$('.wixui-video-player').forEach(isMobile ? MobilePlayer : Player);
  }

  /* ------------------------------------------------------------------------------------------
     7b. Section background that scrolls slower than the page (Commercials, desktop only)
     Wix shifts the background box by 0.2 x the distance of the section's top from the top of the screen.
  ------------------------------------------------------------------------------------------- */
  function initParallax() {
    var items = $$('[data-wx-parallax]').map(function (el) {
      return { el: el, speed: parseFloat(el.getAttribute('data-wx-parallax')) || 0, section: doc.getElementById(el.id.replace(/^bgMedia_/, '')) };
    }).filter(function (it) { return it.section; });
    if (!items.length) return;
    var queued = false;
    function update() {
      queued = false;
      items.forEach(function (it) { it.el.style.transform = 'translate3d(0px, ' + (it.speed * it.section.getBoundingClientRect().top) + 'px, 0px)'; });
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }

  /* ------------------------------------------------------------------------------------------
     8. YouTube / Vimeo embeds are loaded when they come into view (as Wix builds them)
  ------------------------------------------------------------------------------------------- */
  function initEmbeds() {
    var frames = $$('iframe[data-wx-src]');
    if (!frames.length) return;
    function load(f) { f.setAttribute('src', f.getAttribute('data-wx-src')); f.removeAttribute('data-wx-src'); }
    if (!('IntersectionObserver' in window)) { frames.forEach(load); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); load(en.target); } });
    }, { rootMargin: '100px' });
    frames.forEach(function (f) { io.observe(f); });
  }

  /* ---------------------------------------------------------------------------------------- */
  function start() {
    initEmbeds();
    initParallax();
    initPlayers();
    initMotion();
    initHeader();
    initVideoBoxes();
    initTinyMenu();
    if (isMobile) initBackToTop();
    initSamePageLinks();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();


/* Website editing: pressing F and R together (or opening the page with #admin at the end of the address)
   opens the login. The editor itself (/hotdock.cz/_admin/editor.js) is only loaded then, so visitors download nothing extra. */
(function () {
  var DEMO = true;   // preview copies (GitHub Pages) switch this on: editing can be tried there, nothing is saved
  var EDITOR = '/hotdock.cz/_admin/editor.js?v=3c282edb97', API = '/hotdock.cz/_admin/api.php';
  var down = {}, started = false;
  function start(open) {
    window.KWA_DEMO = DEMO; window.KWA_API = API;
    if (open) window.KWA_OPEN = true;
    if (window.KWA) { if (open) window.KWA.open(); return; }
    if (started) return;
    started = true;
    var s = document.createElement('script');
    s.src = EDITOR; s.async = true;
    document.head.appendChild(s);
  }
  function typing(e) {
    var t = e.composedPath ? e.composedPath()[0] : e.target;   // the real field, also inside the editor's own windows
    return t && t.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  function which(e) {
    var k = (e.key || '').toLowerCase();
    return e.code === 'KeyF' || k === 'f' ? 'f' : e.code === 'KeyR' || k === 'r' ? 'r' : '';
  }
  addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    var k = which(e);
    if (!k) return;
    down[k] = Date.now();
    var other = down[k === 'f' ? 'r' : 'f'];
    if (other && down[k] - other < 1500) { down = {}; e.preventDefault(); start(true); }
  }, true);
  addEventListener('keyup', function (e) { var k = which(e); if (k) delete down[k]; }, true);
  addEventListener('blur', function () { down = {}; });
  function fromAddress() {
    if (location.hash !== '#admin') return;
    history.replaceState(null, '', location.pathname + location.search);
    start(true);
  }
  addEventListener('hashchange', fromAddress);
  fromAddress();
  var on = /(?:^|;\s*)kwa=1/.test(document.cookie);
  try { if (DEMO && sessionStorage.getItem('kwa-demo')) on = true; } catch (e) {}
  if (on) start(false);
})();
