/* Website editing in the browser — loaded only after pressing F and R together (see loader.js in site.js).
 *
 *  - Texts: every piece of text that is really written in the page's file gets a dashed frame; click into it
 *    and type. Formatting (colours, bold words, links) stays as it is, only the words change.
 *  - Photos: click a photo and pick a new one from the computer. It is made smaller in the browser first.
 *  - "Uložit" sends the changes to /hotdock.cz/_admin/api.php, which writes them into the page, its phone version and
 *    every other page that shows the same text or photo (header, footer). Every save can be undone.
 *
 * The editor's own buttons and windows live in a shadow root, so the site's styles never touch them and
 * their styles never touch the site. On the preview copies (GitHub Pages) it runs as a demo: nothing is saved.
 */
(function () {
  'use strict';
  if (window.KWA) return;

  const DEMO = !!window.KWA_DEMO;
  const API = window.KWA_API || '/hotdock.cz/_admin/api.php';
  const doc = document, root = doc.documentElement;
  const RAW = /^(SCRIPT|STYLE|TEXTAREA|TITLE|NOSCRIPT|TEMPLATE|XMP|IFRAME|NOEMBED|NOFRAMES)$/;
  const BLANK = /^[ \t\n\r\f]*$/;
  const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,td,th,label,button';
  const NOT_INLINE = ':not(span,a,b,strong,i,em,u,br,sup,sub,small,font,s,mark,code,wbr,abbr,cite,q,time,del,ins)';
  const BREAKS = /^(P|H[1-6]|LI|BLOCKQUOTE|FIGCAPTION|DD|DT|TD|TH)$/;
  const MEDIA = /assets\/img\/([^\/?#"'\s]+?)(?:-[0-9a-f]{10})?\.(?:avif|webp|jpe?g|png|gif|svg)(?:[?#]|$)/i;
  const LIMIT = 1.9 * 1024 * 1024;   // ordinary hosts accept uploads up to 2 MB
  const NL = '\uE000';              // a line break the owner typed; api.php writes it as <br> (line ends already in the file stay)
  const EMPTY = '\u200B';           // what an emptied text keeps (invisible), so the spot can be filled again later

  const st = { logged: false, token: '', undo: 0, editing: false, prepared: false, busy: false };
  let hosts = [];                    // editable pieces of text: { el, nodes:[{node,id,idx,old}], orig, els, breaks, dirty }
  const hostOf = new Map();          // element -> host
  let photos = [];                   // new photos waiting for "Uložit": { id, media, blob, ext, url }
  let leaving = false;
  let ui = null;                     // the editor's own interface

  // ---------- texts as the browser and the server both count them ----------
  function texts(el) {
    const out = [];
    if (!el) return out;
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (BLANK.test(n.data)) continue;
      let raw = false;
      for (let p = n.parentNode; p && p !== el.parentNode; p = p.parentNode) {
        if (p.nodeType === 1 && RAW.test(p.nodeName.toUpperCase())) { raw = true; break; }
      }
      if (!raw) out.push(n);
    }
    return out;
  }
  const isUI = el => !!ui && (el === ui.host || ui.host.contains(el));
  const fromUI = e => !!ui && e.target === ui.host;

  // ---------- find what can be edited on this page ----------
  async function prepare() {
    if (st.prepared) return true;
    let html;
    try {
      const r = await fetch(location.href.split('#')[0], { cache: 'no-store', credentials: 'same-origin' });
      html = await r.text();
    } catch (e) {
      toast('Stránku se nepodařilo připravit k úpravám. Obnovte ji a zkuste to znovu.', 'bad');
      return false;
    }
    const src = new DOMParser().parseFromString(html, 'text/html');
    const count = new Map();
    for (const el of src.querySelectorAll('[id]')) count.set(el.id, (count.get(el.id) || 0) + 1);
    const srcEl = id => (count.get(id) === 1 ? src.getElementById(id) : null);

    // texts: the live page is matched against the file, so only text that is really in the file is offered
    const maps = new Map();
    const mapOf = scope => {
      if (maps.has(scope)) return maps.get(scope);
      const S = texts(srcEl(scope.id)).map(n => n.data);
      const m = new Map();
      let j = 0;
      for (const n of texts(scope)) {
        let k = j;
        while (k < S.length && S[k] !== n.data) k++;
        if (k < S.length) { m.set(n, k); j = k + 1; }
      }
      const res = { m, S };
      maps.set(scope, res);
      return res;
    };
    const scopeOf = node => {
      for (let el = node.parentElement; el && el !== doc.body; el = el.parentElement) {
        if (el.id && count.get(el.id) === 1) return el;
      }
      return null;
    };
    const ok = new Map();
    for (const n of texts(doc.body)) {
      const p = n.parentElement;
      if (!p || isUI(p) || p.closest('svg,select,option,video,audio')) continue;
      const scope = scopeOf(n);
      if (!scope) continue;
      const { m, S } = mapOf(scope);
      const idx = m.get(n);
      if (idx !== undefined) ok.set(n, { node: n, id: scope.id, idx, old: S[idx], scope });
    }
    const okHost = el => {
      if (!el || el === doc.body || el === root || el.querySelector(NOT_INLINE)) return false;
      return texts(el).every(n => ok.has(n));
    };
    const chosen = new Set();
    for (const info of ok.values()) {
      const p = info.node.parentElement;
      let el = p.closest(BLOCK);
      if (!el || !info.scope.contains(el) || !okHost(el)) el = okHost(p) ? p : null;
      if (el) chosen.add(el);
    }
    // texts only screen readers get ("top of page", "use tab to navigate…") are 1 px boxes: leave them alone
    const srOnly = el => { const r = el.getBoundingClientRect(); return el.getClientRects().length > 0 && (r.width <= 2 || r.height <= 2); };
    const all = [...chosen].filter(el => !srOnly(el));
    // existing line breaks: the k-th <br> of an element, when the page has exactly as many as the file
    const brLists = new Map();
    const brInfo = br => {
      const scope = scopeOf(br);
      if (!scope) return { id: null };
      if (!brLists.has(scope)) {
        const live = [...scope.getElementsByTagName('br')];
        brLists.set(scope, live.length === srcEl(scope.id).getElementsByTagName('br').length ? live : null);
      }
      const list = brLists.get(scope);
      return list ? { id: scope.id, k: list.indexOf(br), count: list.length } : { id: null };
    };
    hosts = all.filter(el => !all.some(o => o !== el && o.contains(el))).map(el => {
      const orig = new Map();
      const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) orig.set(n, n.data);
      const brs = new Map([...el.getElementsByTagName('br')].map(br => [br, brInfo(br)]));
      const h = { el, nodes: texts(el).map(n => ok.get(n)), orig, brs, els: new Set(el.querySelectorAll('*')), breaks: BREAKS.test(el.nodeName), dirty: false };
      el.setAttribute('data-kwa-host', '');
      hostOf.set(el, h);
      return h;
    });

    // photos: the nearest element that is in the file once and holds this picture
    let nPhotos = 0;
    for (const img of doc.querySelectorAll('img')) {
      const m = MEDIA.exec(img.getAttribute('src') || '');
      if (!m || isUI(img)) continue;
      // the still picture shown before a video starts is not a photo of its own
      if (/poster/i.test(img.className) || img.closest('wix-video, [id^="videoContainer_"]') || (img.parentElement && img.parentElement.querySelector(':scope > video'))) continue;
      // the component around the picture (not the <img> alone), so <picture> sources and links to the big photo change too
      for (let el = img.parentElement; el && el !== doc.body; el = el.parentElement) {
        if (!el.id || count.get(el.id) !== 1) continue;
        if (!srcEl(el.id).outerHTML.includes('assets/img/' + m[1])) continue;
        img.setAttribute('data-kwa-img', '');
        img.dataset.kwaId = el.id;
        img.dataset.kwaMedia = m[1];
        nPhotos++;
        break;
      }
    }
    st.prepared = true;
    st.counts = { texts: hosts.length, photos: nPhotos };
    return true;
  }

  // What a piece of text says now, put back onto the pieces it was made of in the file.
  //  - words typed into an existing piece stay in that piece;
  //  - words the browser put into a new piece join the piece before them on the same line, or else the one
  //    after them; on a line of its own (next to an existing line break) they go right before / after that break;
  //  - a removed existing line break is removed in the file too; Enter adds one (NL);
  //  - a text emptied completely keeps one invisible character, so it can be filled again later.
  // -> { texts: [...], breaks: [...], unsure } — unsure: something could not be placed exactly (shown after saving)
  function project(h) {
    const seq = [];
    const w = doc.createTreeWalker(h.el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const mine = new Set(h.nodes.map(x => x.node));
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) {
        if (mine.has(n)) seq.push({ t: 'text', n });
        else if (h.orig.has(n)) { if (n.data !== h.orig.get(n) && !BLANK.test(n.data)) seq.push({ t: 'new', s: n.data }); }
        else seq.push({ t: 'new', s: n.data });
      } else if (h.brs.has(n)) seq.push({ t: 'br', n });
      else if (!h.els.has(n) && (n.nodeName === 'BR' || (/^(DIV|P|LI|H[1-6])$/.test(n.nodeName) && seq.length))) seq.push({ t: 'new', s: NL, nl: true });
    }
    while (seq.length && seq[seq.length - 1].nl) seq.pop();   // the browser's own line break at the very end shows nothing
    const vals = new Map(h.nodes.map(x => [x.node, '']));
    const before = new Map();
    const breaks = [];
    let unsure = false;
    for (let i = 0; i < seq.length; i++) {
      const it = seq[i];
      if (it.t === 'text') { vals.set(it.n, vals.get(it.n) + (before.get(it.n) || '') + it.n.data); continue; }
      if (it.t !== 'new') continue;
      let words = '', j = i;
      while (j < seq.length && seq[j].t === 'new') words += seq[j++].s;
      const prev = seq[i - 1], next = seq[j];
      if (prev && prev.t === 'text') vals.set(prev.n, vals.get(prev.n) + words);
      else if (next && next.t === 'text') before.set(next.n, (before.get(next.n) || '') + words);
      else {
        const at = next && next.t === 'br' ? { info: h.brs.get(next.n), op: 'before' } : prev && prev.t === 'br' ? { info: h.brs.get(prev.n), op: 'after' } : null;
        if (at && at.info.id) breaks.push({ id: at.info.id, k: at.info.k, count: at.info.count, op: at.op, text: words });
        else { unsure = true; const first = h.nodes[0].node; vals.set(first, vals.get(first) + words); }
      }
      i = j - 1;
    }
    const kept = new Set(seq.filter(x => x.t === 'br').map(x => x.n));
    for (const [br, info] of h.brs) {
      if (kept.has(br)) continue;
      if (info.id) breaks.push({ id: info.id, k: info.k, count: info.count, op: 'del' });
      else unsure = true;
    }
    const shown = [...vals.values(), ...breaks.map(x => x.text || '')].join('').split(NL).join('');
    if (!shown.trim()) {
      for (const x of h.nodes) vals.set(x.node, '');
      vals.set(h.nodes[0].node, EMPTY);
      for (let i = breaks.length - 1; i >= 0; i--) if (breaks[i].op !== 'del') breaks.splice(i, 1);
    }
    const nav = !!h.el.closest('nav');   // menu items: the phone menu is found by its words (see api.php)
    return {
      texts: h.nodes.map(x => ({ id: x.id, idx: x.idx, old: x.old, new: vals.get(x.node), nav })).filter(c => c.new !== c.old),
      breaks,
      unsure,
    };
  }

  const changes = () => hosts.filter(h => h.dirty).length + photos.length;
  function check(h) {
    const p = project(h);
    h.dirty = p.texts.length + p.breaks.length > 0;
    h.el.classList.toggle('kwa-changed', h.dirty);
    refresh();
  }

  // ---------- editing on / off ----------
  function setMode(edit) {
    st.editing = edit;
    root.classList.toggle('kwa-edit', edit);
    for (const h of hosts) {
      if (edit) { h.el.setAttribute('contenteditable', 'true'); h.el.setAttribute('spellcheck', 'false'); }
      else { h.el.removeAttribute('contenteditable'); h.el.removeAttribute('spellcheck'); }
    }
    if (!edit) hideChip();
    try { sessionStorage.setItem('kwa-mode', edit ? 'edit' : 'view'); } catch (e) {}
    refresh();
  }

  async function begin(edit, message) {
    showDock();
    if (!(await prepare())) return;
    setMode(edit);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('kwa-msg') || 'null'); sessionStorage.removeItem('kwa-msg'); } catch (e) {}
    if (saved) toast(saved[1], saved[0], 7000);
    else if (message) toast(message, 'ok', 6000);
    if (!st.counts.texts && !st.counts.photos) toast('Na této stránce není nic, co by šlo upravit.', 'info', 6000);
  }

  // ---------- talking to the server ----------
  async function call(action, body) {
    const opt = { method: 'POST', credentials: 'same-origin', headers: { 'X-KWA': '1' } };
    if (st.token) opt.headers['X-KWA-Token'] = st.token;
    if (body instanceof FormData) opt.body = body;
    else if (body) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(API + '?a=' + action, opt); } catch (e) { return { ok: false, error: 'net' }; }
    let j;
    try { j = await r.json(); } catch (e) { j = { ok: false, error: r.status === 404 ? 'noapi' : 'server' }; }
    j.status = r.status;
    return j;
  }

  function problem(r) {
    switch (r && r.error) {
      case 'net': return 'Server neodpovídá. Zkontrolujte připojení k internetu a zkuste to znovu.';
      case 'login': case 'token': return 'Přihlášení vypršelo. Přihlaste se znovu, neuložené změny zůstaly na stránce.';
      case 'storage': return 'Server nedovolil zapsat soubory. Na hostingu je potřeba povolit zápis do složky webu.';
      case 'write': return 'Server nedovolil zapsat soubory, web zůstal beze změny. Na hostingu je potřeba povolit zápis do složky webu.';
      case 'write-stuck': return 'Server nedovolil zapsat soubory a některé stránky se už změnily. Až bude zápis povolený, dejte v nabídce „Vrátit poslední uložení“.';
      case 'undo-partial': return 'Vrácení se povedlo jen zčásti, server nedovolil zapsat některé stránky. Záloha zůstala, zkuste to znovu.';
      case 'big': return 'Fotka je moc velká. Vyberte menší (do 2 MB).';
      case 'type': return 'Tenhle soubor není fotka ve formátu JPG, PNG, GIF nebo WebP.';
      case 'noapi': return 'Úpravy tady nefungují: na serveru chybí PHP nebo složka _admin.';
      case 'nothing': return 'Zatím není co vrátit.';
      default: return 'Něco se nepovedlo' + (r && r.status ? ' (kód ' + r.status + ')' : '') + '. Zkuste to znovu.';
    }
  }
  const expired = r => r && (r.error === 'login' || r.error === 'token');

  const plural = (n, one, few, many) => n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  // ---------- actions ----------
  async function save() {
    if (st.busy) return;
    const all = hosts.filter(h => h.dirty).map(project);
    const list = all.flatMap(p => p.texts), breaks = all.flatMap(p => p.breaks), unsure = all.some(p => p.unsure);
    if (!list.length && !breaks.length && !photos.length) { toast('Není co uložit.', 'info'); return; }
    if (DEMO) {
      toast('Tohle je jen ukázka. Na skutečném webu by se teď ' + plural(changes(), 'změna uložila', 'změny uložily', 'změn uložilo') + '.', 'info', 7000);
      return;
    }
    busy(true);
    try {
      for (const p of photos) {
        if (p.url) continue;
        const fd = new FormData();
        fd.append('photo', p.blob, 'foto.' + p.ext);
        const r = await call('upload', fd);
        if (!r.ok) throw r;
        p.url = r.url;
      }
      const page = location.pathname.replace(/(^|\/)(index|m)\.html$/, '').replace(/^\/+|\/+$/g, '');
      const r = await call('save', { page, texts: list, breaks, images: photos.map(p => ({ id: p.id, media: p.media, url: p.url })) });
      if (!r.ok) throw r;
      const missed = [...r.texts, ...r.breaks, ...r.images].filter(n => !n).length;
      remember(missed
        ? ['warn', 'Uloženo, ale ' + plural(missed, 'změnu', 'změny', 'změn') + ' se nepodařilo zapsat (text se mezitím na webu změnil). Zkontrolujte stránku a upravte ho znovu.']
        : r.partial
          ? ['warn', 'Uloženo, ale ' + plural(r.partial, 'změna se nepropsala', 'změny se nepropsaly', 'změn se nepropsalo') + ' do druhé verze této stránky (pro telefon nebo pro počítač), protože je tam text trochu jinak. Tam ho upravte zvlášť: na telefonu otevřete stránku s #admin na konci adresy.']
          : unsure
            ? ['warn', 'Uloženo. Některé nové řádky se nedaly umístit přesně, zkontrolujte prosím, jak text vypadá.']
            : ['ok', 'Uloženo. Změny jsou na webu.']);
      leaving = true;
      location.reload();
    } catch (r) {
      busy(false);
      toast(problem(r), 'bad', 9000);
      if (expired(r)) { st.logged = false; openLogin(); }
    }
  }

  async function discard() {
    if (!changes()) return;
    if (!(await ask('Zahodit neuložené změny?', 'Stránka se vrátí do stavu, ve kterém je teď na webu.', 'Zahodit'))) return;
    leaving = true;
    location.reload();
  }

  async function undo() {
    if (DEMO) { toast('V ukázce se nic neukládá, takže není co vracet.', 'info'); return; }
    if (!st.undo) { toast('Zatím není co vrátit.', 'info'); return; }
    if (!(await ask('Vrátit poslední uložení?', 'Všechny stránky, které poslední uložení změnilo, se vrátí do předchozího stavu. Neuložené změny na této stránce se zahodí.', 'Vrátit'))) return;
    busy(true);
    const r = await call('undo');
    if (!r.ok) { busy(false); toast(problem(r), 'bad', 8000); if (expired(r)) { st.logged = false; openLogin(); } return; }
    remember(['ok', 'Vráceno. Web je ve stavu před posledním uložením.']);
    leaving = true;
    location.reload();
  }

  async function logout() {
    if (changes() && !(await ask('Odhlásit bez uložení?', 'Neuložené změny na této stránce se zahodí.', 'Odhlásit'))) return;
    if (DEMO) { try { sessionStorage.removeItem('kwa-demo'); } catch (e) {} }
    else await call('logout');
    leaving = true;
    location.reload();
  }

  function remember(m) { try { sessionStorage.setItem('kwa-msg', JSON.stringify(m)); } catch (e) {} }

  // ---------- photos ----------
  function pickPhoto(img) {
    const input = ui.file;
    input.onchange = async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      let ready = null;
      try { ready = await shrink(f); } catch (e) { ready = null; }
      if (!ready) { toast('Tenhle soubor neumím použít. Vyberte fotku JPG, PNG, GIF nebo WebP.', 'bad', 7000); return; }
      if (ready.big) { toast('Fotka je moc velká. Vyberte menší (do 2 MB).', 'bad', 7000); return; }
      const id = img.dataset.kwaId, media = img.dataset.kwaMedia;
      const url = URL.createObjectURL(ready.blob);
      for (const el of doc.querySelectorAll('img[data-kwa-img]')) {
        if (el.dataset.kwaId !== id || el.dataset.kwaMedia !== media) continue;
        el.removeAttribute('srcset');
        el.src = url;
        if (el.parentElement && el.parentElement.nodeName === 'PICTURE') {
          for (const s of el.parentElement.querySelectorAll('source')) s.removeAttribute('srcset');
        }
        el.classList.add('kwa-changed');
      }
      photos = photos.filter(p => !(p.id === id && p.media === media));
      photos.push({ id, media, blob: ready.blob, ext: ready.ext });
      refresh();
      toast('Fotka vyměněna. Až budete hotový, klikněte na „Uložit“.', 'ok');
    };
    input.click();
  }

  // Makes a photo small enough for the web (longest side at most 2560 px, under 2 MB) without changing how it looks.
  async function shrink(file) {
    const type = file.type || '';
    if (type === 'image/gif') return file.size <= LIMIT ? { blob: file, ext: 'gif' } : { big: true };
    const pic = await decode(file);
    const w0 = pic.width, h0 = pic.height;
    if (!w0 || !h0) return null;
    let k = Math.min(1, 2560 / Math.max(w0, h0));
    if (k === 1 && (type === 'image/jpeg' || type === 'image/webp') && file.size <= LIMIT) {
      return { blob: file, ext: type === 'image/webp' ? 'webp' : 'jpg' };
    }
    const clear = /png|webp|avif/.test(type) && seeThrough(pic);
    for (let i = 0; i < 7; i++, k *= 0.8) {
      const c = doc.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k));
      c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d').drawImage(pic, 0, 0, c.width, c.height);
      const blob = await new Promise(res => c.toBlob(res, clear ? 'image/png' : 'image/jpeg', 0.86));
      if (blob && blob.size <= LIMIT) return { blob, ext: clear ? 'png' : 'jpg' };
    }
    return { big: true };
  }
  async function decode(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch (e) { /* try the slower way */ } }
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, close() {}, img };
  }
  function seeThrough(pic) {
    const c = doc.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(pic.img || pic, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  // ---------- events on the page ----------
  function hook() {
    // In editing mode the page's own links, menus, players and galleries stay still.
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'dblclick']) {
      addEventListener(type, e => { if (st.editing && !fromUI(e)) e.stopPropagation(); }, { capture: true, passive: true });
    }
    addEventListener('pointerdown', e => { if (!fromUI(e)) menu(false); }, true);
    addEventListener('click', e => {
      if (!st.editing || fromUI(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const img = e.target.closest && e.target.closest('img[data-kwa-img]');
      if (img) pickPhoto(img);
    }, true);
    addEventListener('keydown', e => {
      if (!st.logged) return;
      if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 's') {
        if (changes()) { e.preventDefault(); save(); }
        return;
      }
      if (!st.editing || fromUI(e)) return;
      const h = hostOf.get(e.target);
      if (!h) return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); if (h.breaks) doc.execCommand('insertLineBreak'); return; }
      if (e.key === ' ' && h.el.closest('button')) { e.preventDefault(); doc.execCommand('insertText', false, ' '); return; }
      if (e.key === 'Escape') { e.target.blur(); return; }
      if ((e.metaKey || e.ctrlKey) && /^[biu]$/i.test(e.key)) e.preventDefault();
    }, true);
    addEventListener('beforeinput', e => {
      if (!st.editing || !hostOf.has(e.target)) return;
      if (/^format/.test(e.inputType) || e.inputType === 'insertParagraph') e.preventDefault();
    }, true);
    addEventListener('input', e => { const h = hostOf.get(e.target); if (h) check(h); }, true);
    addEventListener('paste', e => {
      const h = st.editing && hostOf.get(e.target);
      if (!h) return;
      e.preventDefault();
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((line, i) => {
        if (i) doc.execCommand(h.breaks ? 'insertLineBreak' : 'insertText', false, h.breaks ? undefined : ' ');
        if (line) doc.execCommand('insertText', false, line);
      });
    }, true);
    for (const type of ['drop', 'dragstart']) {
      addEventListener(type, e => { if (st.editing && !fromUI(e)) e.preventDefault(); }, true);
    }
    addEventListener('mouseover', e => {
      if (!st.editing) return;
      const img = e.target.closest && e.target.closest('img[data-kwa-img]');
      if (img) showChip(img);
    }, true);
    addEventListener('mouseout', e => { if (e.target.matches && e.target.matches('img[data-kwa-img]')) hideChip(); }, true);
    addEventListener('scroll', hideChip, { capture: true, passive: true });
    addEventListener('beforeunload', e => { if (!leaving && changes()) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---------- the editor's own interface ----------
  const ICON = {
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  const icon = (name, size) => `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const PAGE_CSS = `
html.kwa-edit body * { pointer-events: none !important; }
html.kwa-edit [data-kwa-host], html.kwa-edit [data-kwa-host] *, html.kwa-edit img[data-kwa-img] { pointer-events: auto !important; }
html.kwa-edit [data-kwa-host] { cursor: text; -webkit-user-select: text !important; user-select: text !important; outline: 1px dashed rgba(255, 92, 53, .55); outline-offset: 3px; caret-color: #ff5c35; }
html.kwa-edit [data-kwa-host]:hover { outline: 1px solid rgba(255, 92, 53, .95); }
html.kwa-edit [data-kwa-host].kwa-changed { outline: 1px solid #3ddc97; }
html.kwa-edit [data-kwa-host]:focus { outline: 2px solid #ff5c35; outline-offset: 4px; }
html.kwa-edit img[data-kwa-img] { cursor: pointer; }
html.kwa-edit img[data-kwa-img]:hover { outline: 3px solid #ff5c35 !important; outline-offset: -3px; }
html.kwa-edit img[data-kwa-img].kwa-changed { outline: 3px solid #3ddc97 !important; outline-offset: -3px; }
`;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.k {
  --bg: rgba(20, 20, 23, .86); --solid: #141417; --s1: #1e1e23; --s2: #2c2c33; --line: rgba(255,255,255,.10); --line2: rgba(255,255,255,.18);
  --text: #f4f4f5; --muted: #a1a1aa; --accent: #ff5c35; --ink: #1a0b05; --ok: #3ddc97; --bad: #ff7070;
  --ring: 0 0 0 3px rgba(255, 92, 53, .45);
  --shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 18px 50px -12px rgba(0,0,0,.65), 0 4px 14px rgba(0,0,0,.35);
  font: 500 14px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text); -webkit-font-smoothing: antialiased; letter-spacing: 0;
}
@media (prefers-color-scheme: light) {
  .k { --bg: rgba(255,255,255,.9); --solid: #ffffff; --s1: #f4f4f5; --s2: #e4e4e7; --line: rgba(0,0,0,.09); --line2: rgba(0,0,0,.18);
       --text: #18181b; --muted: #52525b; --accent: #d9431c; --ink: #ffffff; --ok: #0f8a57; --bad: #c62828; --ring: 0 0 0 3px rgba(217, 67, 28, .35);
       --shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 18px 50px -12px rgba(0,0,0,.28), 0 4px 14px rgba(0,0,0,.08); }
}
button { font: inherit; color: inherit; }
.btn { appearance: none; border: 0; background: transparent; cursor: pointer; height: 36px; padding: 0 14px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; white-space: nowrap; transition: background .15s, transform .12s, opacity .15s, box-shadow .15s; }
.btn:hover { background: var(--s1); }
.btn:active { transform: scale(.97); }
.btn:focus-visible, .seg button:focus-visible, .menu button:focus-visible, .in:focus-visible { outline: none; box-shadow: var(--ring); }
.btn[disabled] { opacity: .42; cursor: default; transform: none; background: transparent; }
.primary { background: var(--accent); color: var(--ink); font-weight: 650; }
.primary:hover { background: var(--accent); filter: brightness(1.08); }
.primary[disabled] { background: var(--accent); }
.ghost { color: var(--muted); }
.ghost:hover { color: var(--text); }
.icon { width: 36px; padding: 0; }

.dock { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2147483000; display: flex; align-items: center; gap: 4px;
  padding: 6px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); animation: up .28s cubic-bezier(.2,.8,.2,1); }
.brand { display: flex; align-items: center; gap: 8px; padding: 0 10px 0 10px; font-weight: 650; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); flex: none; }
.dot.live { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); animation: pulse 1.6s ease-in-out infinite; }
.tag { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 6px; background: var(--s2); color: var(--muted); }
.seg { display: flex; padding: 3px; border-radius: 999px; background: var(--s1); border: 1px solid var(--line); }
.seg button { appearance: none; border: 0; background: transparent; cursor: pointer; height: 28px; padding: 0 12px; border-radius: 999px; color: var(--muted);
  display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; transition: background .15s, color .15s; }
.seg button:hover { color: var(--text); }
.seg button[aria-pressed="true"] { background: var(--solid); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 0 0 1px var(--line); }
.sep { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }
.count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; background: rgba(0,0,0,.2); font-size: 12px; font-weight: 700; display: inline-grid; place-items: center; }
.count.pop { animation: pop .3s ease-out; }
.more { position: relative; }
.menu { position: absolute; right: 0; bottom: calc(100% + 12px); min-width: 260px; padding: 6px; border-radius: 16px; background: var(--solid);
  border: 1px solid var(--line); box-shadow: var(--shadow); animation: fadeup .18s ease-out; }
.menu[hidden] { display: none; }
.menu button { appearance: none; border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 10px 12px; border-radius: 10px; text-align: left; font-size: 14px; }
.menu button:hover { background: var(--s1); }
.menu button[disabled] { opacity: .42; cursor: default; background: transparent; }
.menu svg { color: var(--muted); flex: none; }
.menu hr { border: 0; border-top: 1px solid var(--line); margin: 6px 4px; }
.hint { position: fixed; left: 50%; bottom: 74px; transform: translateX(-50%); z-index: 2147483000; padding: 6px 12px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--line); color: var(--muted); font-size: 12.5px; white-space: nowrap; box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
.hint b { color: var(--text); font-weight: 600; }
.hint[hidden] { display: none; }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; }

.chip { position: fixed; z-index: 2147483000; pointer-events: none; display: flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px;
  background: var(--accent); color: var(--ink); font-size: 13px; font-weight: 650; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
.chip[hidden] { display: none; }

.toasts { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483002; display: grid; gap: 8px; width: min(460px, calc(100vw - 32px)); pointer-events: none; }
.toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; background: var(--solid); border: 1px solid var(--line);
  box-shadow: var(--shadow); font-size: 14px; line-height: 1.45; animation: down .22s cubic-bezier(.2,.8,.2,1); pointer-events: auto; }
.toast svg { flex: none; margin-top: 2px; }
.toast.ok svg { color: var(--ok); } .toast.bad svg, .toast.warn svg { color: var(--bad); } .toast.info svg { color: var(--muted); }
.toast.bye { opacity: 0; transform: translateY(-6px); transition: opacity .2s, transform .2s; }

.scrim { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 16px; background: rgba(8, 8, 10, .58);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); animation: fade .18s ease-out; }
.card { position: relative; width: min(400px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 32px 28px 24px; border-radius: 22px;
  background: var(--solid); border: 1px solid var(--line); box-shadow: var(--shadow); animation: rise .24s cubic-bezier(.2,.8,.2,1); }
.close { position: absolute; top: 12px; right: 12px; }
.badge { width: 52px; height: 52px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center; color: var(--accent);
  border: 1px solid var(--line2); background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 8%, transparent), 0 0 36px -8px color-mix(in srgb, var(--accent) 70%, transparent); }
h2 { margin: 0; text-align: center; font-size: 21px; line-height: 1.25; font-weight: 700; letter-spacing: -.015em; }
.sub { margin: 8px 0 24px; text-align: center; color: var(--muted); font-size: 14px; }
.field { margin-bottom: 16px; position: relative; }
.field label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; }
.in { width: 100%; height: 46px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line2); background: var(--s1); color: var(--text);
  font: inherit; font-size: 16px; transition: border-color .15s, box-shadow .15s; }
.in:hover { border-color: color-mix(in srgb, var(--text) 30%, transparent); }
.in:focus { outline: none; border-color: var(--accent); box-shadow: var(--ring); }
.pw .in { padding-right: 52px; }
.eye { position: absolute; right: 5px; bottom: 5px; width: 36px; height: 36px; color: var(--muted); }
.err { min-height: 20px; margin: -4px 0 12px; color: var(--bad); font-size: 13.5px; }
.wide { width: 100%; height: 46px; border-radius: 12px; font-size: 15px; }
.row { display: flex; gap: 8px; margin-top: 8px; }
.row .btn { flex: 1; height: 44px; border-radius: 12px; }
.secondary { background: var(--s1); border: 1px solid var(--line); }
.foot { margin-top: 18px; text-align: center; color: var(--muted); font-size: 12.5px; }
kbd { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--line2); background: var(--s1); color: var(--text); }
.note { margin: 0 0 16px; padding: 10px 12px; border-radius: 12px; border: 1px dashed var(--line2); color: var(--muted); font-size: 13.5px; }
.tips { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
.tips li { display: grid; grid-template-columns: 28px 1fr; gap: 10px; font-size: 14.5px; line-height: 1.5; }
.tips svg { color: var(--accent); margin-top: 2px; }
.tips b { font-weight: 650; }

@keyframes up { from { opacity: 0; transform: translate(-50%, 10px); } }
@keyframes fadeup { from { opacity: 0; transform: translateY(6px); } }
@keyframes down { from { opacity: 0; transform: translateY(-8px); } }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px) scale(.98); } }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); } }
@keyframes pop { 40% { transform: scale(1.25); } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 680px) {
  .dock { left: 8px; right: 8px; bottom: max(8px, env(safe-area-inset-bottom)); transform: none; border-radius: 20px; justify-content: space-between; animation: none; }
  .brand .t, .brand .tag, .sep, .discard, .hint { display: none; }
  .brand { padding: 0 4px 0 8px; }
}
@media (max-width: 420px) {
  .seg .lbl { display: none; }
  .seg button { padding: 0 11px; }
  .primary { padding: 0 12px; }
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

  function mountUI() {
    if (ui) return;
    const style = doc.createElement('style');
    style.id = 'kwa-page-css';
    style.textContent = PAGE_CSS;
    doc.head.appendChild(style);
    const host = doc.createElement('div');
    host.id = 'kwa-root';
    host.setAttribute('translate', 'no');
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${CSS}</style><div class="k">
      <div class="toasts" role="status" aria-live="polite"></div>
      <div class="chip" hidden>${icon('image', 15)}<span>Vyměnit fotku</span></div>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" hidden>
      <div class="layer"></div>
    </div>`;
    root.appendChild(host);
    // keys and clicks inside the editor's windows are not the page's business
    for (const type of ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'input', 'wheel']) {
      sh.addEventListener(type, e => e.stopPropagation(), { passive: type === 'wheel' || type.startsWith('touch') });
    }
    const q = s => sh.querySelector(s);
    ui = { host, sh, k: q('.k'), toasts: q('.toasts'), chip: q('.chip'), file: q('input[type=file]'), layer: q('.layer') };
  }

  function showDock() {
    if (ui.dock) return;
    const wrap = doc.createElement('div');
    wrap.innerHTML = `
      <div class="hint" hidden></div>
      <div class="dock" role="toolbar" aria-label="Úpravy webu">
        <div class="brand"><span class="dot" aria-hidden="true"></span><span class="t">Úpravy webu</span>${DEMO ? '<span class="tag">ukázka</span>' : ''}</div>
        <div class="seg" role="group" aria-label="Režim">
          <button type="button" data-mode="edit" aria-pressed="true" title="Upravovat: kliknutím do textu nebo na fotku">${icon('pen', 14)}<span class="lbl">Upravovat</span></button>
          <button type="button" data-mode="view" aria-pressed="false" title="Prohlížet: odkazy fungují">${icon('eye', 14)}<span class="lbl">Prohlížet</span></button>
        </div>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="btn ghost discard" data-act="discard" disabled>Zahodit</button>
        <button type="button" class="btn primary" data-act="save" disabled>${icon('check')}<span class="label">Uložit</span><span class="count">0</span></button>
        <div class="more">
          <button type="button" class="btn icon" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Další možnosti" title="Další možnosti">${icon('more', 18)}</button>
          <div class="menu" role="menu" hidden>
            <button type="button" role="menuitem" data-act="undo">${icon('undo')}Vrátit poslední uložení</button>
            <button type="button" role="menuitem" data-act="discard">${icon('trash')}Zahodit neuložené změny</button>
            <button type="button" role="menuitem" data-act="help">${icon('help')}Jak upravovat</button>
            <hr>
            <button type="button" role="menuitem" data-act="password">${icon('key')}Změnit heslo</button>
            <button type="button" role="menuitem" data-act="logout">${icon('out')}Odhlásit</button>
          </div>
        </div>
      </div>`;
    while (wrap.firstElementChild) ui.k.appendChild(wrap.firstElementChild);
    const q = s => ui.k.querySelector(s);
    Object.assign(ui, { dock: q('.dock'), hint: q('.hint'), dot: q('.dot'), save: q('[data-act=save]'), count: q('.count'),
      discard: q('.dock > [data-act=discard]'), menu: q('.menu'), menuBtn: q('[data-act=menu]'), seg: [...ui.k.querySelectorAll('.seg button')] });
    ui.dock.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.mode) { setMode(b.dataset.mode === 'edit'); return; }
      const act = b.dataset.act;
      if (act === 'menu') { menu(ui.menu.hidden); return; }
      menu(false);
      if (act === 'save') save();
      else if (act === 'discard') discard();
      else if (act === 'undo') undo();
      else if (act === 'help') help();
      else if (act === 'password') password();
      else if (act === 'logout') logout();
    });
    ui.sh.addEventListener('keydown', e => { if (e.key === 'Escape' && !ui.menu.hidden) { menu(false); ui.menuBtn.focus(); } });
    refresh();
  }

  function menu(open) {
    if (!ui.menu) return;
    ui.menu.hidden = !open;
    ui.menuBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      ui.menu.querySelector('[data-act=undo]').disabled = !DEMO && !st.undo;
      ui.menu.querySelector('[data-act=discard]').disabled = !changes();
      const first = ui.menu.querySelector('button:not([disabled])');
      if (first) first.focus();
    }
  }

  function refresh() {
    if (!ui || !ui.dock) return;
    const n = changes();
    if (ui.count.textContent !== String(n)) {
      ui.count.textContent = n;
      ui.count.classList.remove('pop');
      void ui.count.offsetWidth;
      if (n) ui.count.classList.add('pop');
    }
    ui.save.disabled = !n || st.busy;
    ui.discard.disabled = !n || st.busy;
    ui.save.title = n ? 'Uložit (' + plural(n, 'změna', 'změny', 'změn') + ') — také Ctrl+S / ⌘S' : 'Zatím nic nového k uložení';
    ui.dot.classList.toggle('live', !!n);
    for (const b of ui.seg) b.setAttribute('aria-pressed', String((b.dataset.mode === 'edit') === st.editing));
    ui.hint.hidden = false;
    ui.hint.innerHTML = st.editing
      ? '<b>Klikněte do textu</b> a pište · <b>Klikněte na fotku</b> a vyberte novou'
      : 'Prohlížení: odkazy fungují, můžete přejít na jinou stránku';
  }

  function busy(on) {
    st.busy = on;
    if (!ui.save) return;
    ui.save.querySelector('.label').textContent = on ? 'Ukládám…' : 'Uložit';
    ui.save.querySelector('svg, .spin').outerHTML = on ? '<span class="spin" aria-hidden="true"></span>' : icon('check');
    refresh();
  }

  function toast(text, kind, ms) {
    kind = kind || 'info';
    const t = doc.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert', 18) + '<div>' + esc(text) + '</div>';
    ui.toasts.appendChild(t);
    while (ui.toasts.children.length > 3) ui.toasts.firstElementChild.remove();
    setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 250); }, ms || 4500);
  }

  function showChip(img) {
    const r = img.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return;
    const pending = img.classList.contains('kwa-changed');
    ui.chip.querySelector('span').textContent = pending ? 'Vyměněno · klikněte pro jinou' : 'Vyměnit fotku';
    ui.chip.style.left = Math.max(8, Math.min(r.left + 10, innerWidth - 220)) + 'px';
    ui.chip.style.top = Math.max(8, Math.min(r.top + 10, innerHeight - 44)) + 'px';
    ui.chip.hidden = false;
  }
  function hideChip() { if (ui && ui.chip) ui.chip.hidden = true; }

  // A window in the middle of the screen; resolves with what the buttons decide.
  function windowOf(html, setup) {
    return new Promise(resolve => {
      const before = doc.activeElement;
      const scrim = doc.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML = `<div class="card" role="dialog" aria-modal="true">${html}</div>`;
      ui.layer.appendChild(scrim);
      const card = scrim.firstElementChild;
      const done = value => {
        scrim.remove();
        if (before && before.focus) try { before.focus({ preventScroll: true }); } catch (e) {}
        resolve(value);
      };
      scrim.addEventListener('mousedown', e => { if (e.target === scrim) done(null); });
      card.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
        if (e.key === 'Tab') {   // keep the keyboard inside the window
          const items = [...card.querySelectorAll('button:not([disabled]),input')];
          const i = items.indexOf(ui.sh.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
          else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
        }
      });
      card.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => done(null)));
      setup(card, done);
      const first = card.querySelector('input, .primary, button');
      if (first) setTimeout(() => first.focus(), 30);
    });
  }

  const closeBtn = `<button type="button" class="btn icon close" data-close aria-label="Zavřít">${icon('x', 18)}</button>`;
  const eyeBtn = '<button type="button" class="btn icon eye" aria-label="Zobrazit heslo" title="Zobrazit heslo">' + icon('eye', 18) + '</button>';
  function wireEyes(card) {
    card.querySelectorAll('.eye').forEach(b => b.addEventListener('click', () => {
      const input = b.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Skrýt heslo' : 'Zobrazit heslo');
      input.focus();
    }));
  }

  function openLogin() {
    if (st.logged) { toast('Už jste přihlášený. Upravujte přímo na stránce.', 'info'); return; }
    if (ui.layer.querySelector('.login')) return;
    windowOf(`
      ${closeBtn}
      <form class="login" novalidate>
        <div class="badge">${icon('pen', 22)}</div>
        <h2>Úpravy webu</h2>
        <p class="sub">Přihlaste se a měňte texty a fotky přímo na stránce.</p>
        ${DEMO ? '<p class="note">Tohle je náhled na GitHubu. Úpravy si tu můžete vyzkoušet, ale nic se neuloží. Jméno a heslo tu není potřeba.</p>' : ''}
        <div class="field"><label for="kwa-u">Jméno</label><input class="in" id="kwa-u" name="user" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
        <div class="field pw"><label for="kwa-p">Heslo</label><input class="in" id="kwa-p" name="pass" type="password" autocomplete="current-password" required>${eyeBtn}</div>
        <div class="err" role="alert"></div>
        <button type="submit" class="btn primary wide">${DEMO ? 'Vyzkoušet úpravy' : 'Přihlásit'}</button>
        <p class="foot">Otevírá se stiskem <kbd>F</kbd> + <kbd>R</kbd> zároveň · zavřít <kbd>Esc</kbd></p>
      </form>`, (card, done) => {
      wireEyes(card);
      const form = card.querySelector('form'), err = card.querySelector('.err'), btn = card.querySelector('[type=submit]');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        err.textContent = '';
        if (DEMO) {
          try { sessionStorage.setItem('kwa-demo', '1'); } catch (x) {}
          st.logged = true;
          done(true);
          begin(true, 'Ukázka spuštěna. Klikněte do textu a pište, nebo klikněte na fotku. Nic se neuloží.');
          return;
        }
        const user = form.user.value.trim(), pass = form.pass.value;
        if (!user || !pass) { err.textContent = 'Vyplňte jméno i heslo.'; return; }
        btn.disabled = true;
        btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Přihlašuji…';
        const r = await call('login', { user, pass });
        btn.disabled = false;
        btn.textContent = 'Přihlásit';
        if (r.ok) {
          st.logged = true; st.token = r.token; st.undo = r.undo || 0;
          done(true);
          if (st.prepared) { showDock(); setMode(true); toast('Přihlášeno.', 'ok'); }
          else begin(true, 'Přihlášeno. Klikněte do textu a pište, nebo klikněte na fotku.');
          if (r.weak) setTimeout(() => toast('Doporučení: nastavte si vlastní delší heslo (nabídka ⋯ → Změnit heslo). Teď platí to první.', 'info', 12000), 800);
          return;
        }
        if (r.error === 'wrong') {
          err.textContent = 'Špatné jméno nebo heslo.' + (r.left ? ' ' + (r.left === 1 ? 'Zbývá 1 pokus.' : 'Zbývají ' + (r.left <= 4 ? r.left + ' pokusy.' : r.left + ' pokusů.')) : '');
          form.pass.select();
        } else if (r.error === 'locked') {
          const min = Math.max(1, Math.ceil((r.wait || 900) / 60));
          err.textContent = 'Příliš mnoho špatných pokusů. Zkuste to znovu za ' + plural(min, 'minutu', 'minuty', 'minut') + '.';
        } else {
          err.textContent = problem(r);
        }
      });
    });
  }

  function ask(title, text, yes) {
    return windowOf(`
      <div class="badge">${icon('alert', 22)}</div>
      <h2>${esc(title)}</h2>
      <p class="sub">${esc(text)}</p>
      <div class="row"><button type="button" class="btn secondary" data-close>Zpět</button><button type="button" class="btn primary" data-yes>${esc(yes)}</button></div>`,
      (card, done) => card.querySelector('[data-yes]').addEventListener('click', () => done(true)));
  }

  function help() {
    windowOf(`
      ${closeBtn}
      <div class="badge">${icon('help', 22)}</div>
      <h2>Jak upravovat</h2>
      <p class="sub">Měníte přímo stránku, kterou vidíte.</p>
      <ul class="tips">
        <li>${icon('pen', 18)}<span><b>Text:</b> klikněte do textu s čárkovaným rámečkem a pište. Barvy, tučné písmo a odkazy zůstanou.</span></li>
        <li>${icon('image', 18)}<span><b>Fotka:</b> klikněte na fotku a vyberte novou z počítače. Do rámečku se ořízne sama.</span></li>
        <li>${icon('check', 18)}<span><b>Uložit:</b> změny se zapíšou na web, i do verze pro mobil a na všechny stránky se stejným textem (např. patička).</span></li>
        <li>${icon('eye', 18)}<span><b>Prohlížet:</b> odkazy zase fungují, takže můžete přejít na jinou stránku a upravovat tam.</span></li>
        <li>${icon('undo', 18)}<span><b>Vrátit poslední uložení:</b> když se něco nepovede. Web si pamatuje posledních 30 uložení.</span></li>
      </ul>
      <button type="button" class="btn primary wide" data-close style="margin-top:24px">Rozumím</button>`, () => {});
  }

  function password() {
    if (DEMO) { toast('V ukázce se heslo nemění. Na skutečném webu se tu nastaví nové heslo.', 'info', 6000); return; }
    windowOf(`
      ${closeBtn}
      <form novalidate>
        <div class="badge">${icon('key', 22)}</div>
        <h2>Změnit heslo</h2>
        <p class="sub">Nové heslo musí mít aspoň 8 znaků. Platí pro úpravy tohoto webu.</p>
        <div class="field pw"><label for="kwa-c">Současné heslo</label><input class="in" id="kwa-c" name="current" type="password" autocomplete="current-password">${eyeBtn}</div>
        <div class="field pw"><label for="kwa-n">Nové heslo</label><input class="in" id="kwa-n" name="next" type="password" autocomplete="new-password">${eyeBtn}</div>
        <div class="field pw"><label for="kwa-a">Nové heslo znovu</label><input class="in" id="kwa-a" name="again" type="password" autocomplete="new-password">${eyeBtn}</div>
        <div class="err" role="alert"></div>
        <button type="submit" class="btn primary wide">Uložit nové heslo</button>
      </form>`, (card, done) => {
      wireEyes(card);
      const form = card.querySelector('form'), err = card.querySelector('.err');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const next = form.next.value;
        if (next.length < 8) { err.textContent = 'Nové heslo musí mít aspoň 8 znaků.'; return; }
        if (next !== form.again.value) { err.textContent = 'Nová hesla se neshodují.'; return; }
        const r = await call('password', { current: form.current.value, next });
        if (r.ok) { done(true); toast('Heslo změněno. Příště se přihlaste novým heslem.', 'ok', 6000); return; }
        err.textContent = r.error === 'wrong' ? 'Současné heslo nesedí.' : r.error === 'locked' ? 'Příliš mnoho špatných pokusů. Zkuste to později.' : problem(r);
        if (expired(r)) { done(null); st.logged = false; openLogin(); }
      });
    });
  }

  // ---------- start ----------
  async function start() {
    mountUI();
    hook();
    let mode = 'edit';
    try { mode = sessionStorage.getItem('kwa-mode') || 'edit'; } catch (e) {}
    if (DEMO) {
      let on = false;
      try { on = !!sessionStorage.getItem('kwa-demo'); } catch (e) {}
      if (on) { st.logged = true; begin(mode !== 'view'); }
      else if (window.KWA_OPEN) openLogin();
      return;
    }
    const r = await call('status');
    if (r.ok && r.loggedIn) {
      st.logged = true; st.token = r.token; st.undo = r.undo || 0;
      begin(mode !== 'view');
      if (window.KWA_OPEN) toast('Už jste přihlášený. Upravujte přímo na stránce.', 'info');
    } else {
      doc.cookie = 'kwa=; path=/; max-age=0; samesite=strict';
      if (window.KWA_OPEN) openLogin();
    }
  }

  window.KWA = { open: () => (ui ? openLogin() : null), state: () => ({ ...st, hosts: hosts.length, changes: changes() }) };
  start();
})();
