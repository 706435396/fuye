/* ============================================================
   副业掘金 · 前端交互
   主题切换 / 语言切换 / 搜索 / 筛选 / 移动端菜单 / 回到顶部 / 复制
   ============================================================ */
(function () {
  'use strict';

  const script = document.getElementById('main-js') || document.querySelector('script[data-prefix]');
  const LANG = script ? script.dataset.lang : 'zh';
  const PREFIX = script ? script.dataset.prefix : '';

  const I18N = {
    zh: { noResult: '没有找到相关文章', searchPh: '输入关键词搜索...', copied: '已复制链接！', copy: '复制链接', all: '全部' },
    en: { noResult: 'No articles found', searchPh: 'Type keywords to search...', copied: 'Link copied!', copy: 'Copy link', all: 'All' }
  };
  const T = I18N[LANG] || I18N.zh;

  /* ---------- 主题切换 ---------- */
  const THEME_KEY = 'fuye-2zl-theme';
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  if (!savedTheme) {
    savedTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  applyTheme(savedTheme);

  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });
  }

  /* ---------- 语言切换 ---------- */
  const langBtn = document.getElementById('langSwitch');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      const href = langBtn.getAttribute('data-href');
      if (href) window.location.href = href;
    });
  }

  /* ---------- 移动端菜单 ---------- */
  const menuBtn = document.getElementById('menuToggle');
  const nav = document.getElementById('mainNav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () { nav.classList.toggle('open'); });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('open'); });
    });
  }

  /* ---------- 回到顶部 ---------- */
  const toTop = document.getElementById('backToTop');
  if (toTop) {
    window.addEventListener('scroll', function () {
      toTop.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- 复制链接 ---------- */
  const copyBtn = document.getElementById('copyLink');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      const url = copyBtn.getAttribute('data-url');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { flash(copyBtn, '✓'); });
      } else {
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); flash(copyBtn, '✓'); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  }
  function flash(el, text) {
    const old = el.textContent;
    el.textContent = text;
    setTimeout(function () { el.textContent = old; }, 1500);
  }

  /* ---------- 文章筛选（全部文章页）---------- */
  const allGrid = document.getElementById('allPostsGrid');
  const filterBtns = document.querySelectorAll('.filter-btn');
  if (allGrid && filterBtns.length) {
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const cat = btn.getAttribute('data-cat');
        const items = allGrid.querySelectorAll('[data-post-cat]');
        items.forEach(function (item) {
          item.style.display = (cat === 'all' || item.getAttribute('data-post-cat') === cat) ? '' : 'none';
        });
      });
    });
  }

  /* ---------- 搜索 ---------- */
  const searchToggle = document.getElementById('searchToggle');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchClose = document.getElementById('searchClose');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  let searchData = null;

  function loadSearchData(cb) {
    if (searchData) { cb(searchData); return; }
    fetch(PREFIX + 'search-index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { searchData = data; cb(data); })
      .catch(function () { cb([]); });
  }

  function doSearch(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) { searchResults.innerHTML = ''; return; }
    loadSearchData(function (data) {
      const matched = data.filter(function (p) {
        const fields = [p.title, p.titleEn, p.excerpt, p.excerptEn].concat(p.tags || [], p.tagsEn || []);
        return fields.some(function (f) { return String(f || '').toLowerCase().indexOf(q) > -1; });
      }).slice(0, 8);
      if (!matched.length) {
        searchResults.innerHTML = '<div class="search-empty">🔍 ' + T.noResult + '</div>';
        return;
      }
      searchResults.innerHTML = matched.map(function (p) {
        const title = LANG === 'en' ? p.titleEn : p.title;
        const excerpt = LANG === 'en' ? p.excerptEn : p.excerpt;
        return '<a class="search-result-item" href="' + PREFIX + 'post/' + p.slug + '.html">' +
          '<span class="sri-emoji">' + p.emoji + '</span>' +
          '<span><span class="sri-title">' + escapeHtml(title) + '</span>' +
          '<span class="sri-excerpt">' + escapeHtml(excerpt) + '</span></span></a>';
      }).join('');
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function openSearch() {
    if (!searchOverlay) return;
    searchOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    if (searchResults) searchResults.innerHTML = '';
  }
  function closeSearch() {
    if (!searchOverlay) return;
    searchOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  if (searchToggle) searchToggle.addEventListener('click', openSearch);
  if (searchClose) searchClose.addEventListener('click', closeSearch);
  if (searchOverlay) {
    searchOverlay.addEventListener('click', function (e) { if (e.target === searchOverlay) closeSearch(); });
  }
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(timer);
      const v = searchInput.value;
      timer = setTimeout(function () { doSearch(v); }, 180);
    });
  }

  /* ---------- 全局键盘 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSearch(); if (nav) nav.classList.remove('open'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  /* ---------- 文章页目录高亮 ---------- */
  const tocLinks = document.querySelectorAll('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const heads = document.querySelectorAll('.article-content h2[id]');
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) {
            a.style.color = ''; a.style.borderColor = '';
            if (a.getAttribute('href') === '#' + en.target.id) {
              a.style.color = 'var(--primary)';
              a.style.borderColor = 'var(--primary)';
            }
          });
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    heads.forEach(function (h) { obs.observe(h); });
  }
})();
