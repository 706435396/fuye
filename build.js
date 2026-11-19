#!/usr/bin/env node
/**
 * 副业掘金 · 静态博客构建脚本
 * 数据源: data/site.json / data/categories.json / data/posts.json
 * 输出:   dist/
 * 特性:   中英双语、hreflang、JSON-LD、sitemap、RSS、搜索索引
 * 兼容:   不使用 fs.rmSync（规避 WorkBuddy genie-safe-delete Shim 的 EBUSY）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'assets');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

const site = JSON.parse(fs.readFileSync(path.join(DATA, 'site.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(DATA, 'categories.json'), 'utf8'));
const posts = JSON.parse(fs.readFileSync(path.join(DATA, 'posts.json'), 'utf8'));
const platforms = JSON.parse(fs.readFileSync(path.join(DATA, 'platforms.json'), 'utf8'));
const scams = JSON.parse(fs.readFileSync(path.join(DATA, 'scams.json'), 'utf8'));
const blogColumns = JSON.parse(fs.readFileSync(path.join(DATA, 'blog-columns.json'), 'utf8'));

const S = site.site;
const BASE = S.url.replace(/\/$/, '');
const i18n = (obj, lang) => (obj && obj[lang === 'zh' ? 'zh' : 'en']) || '';

/* ---------- 工具函数 ---------- */

// 规避 Shim: 递归逐文件删除，不调用 fs.rmSync
function safeRemoveDir(target) {
  if (!fs.existsSync(target)) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const p = path.join(target, entry.name);
    if (entry.isDirectory()) {
      safeRemoveDir(p);
    } else {
      try { fs.unlinkSync(p); } catch (_) { /* 忽略锁文件 */ }
    }
  }
  try { fs.rmdirSync(target); } catch (_) { /* 忽略 */ }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFile(rel, content) {
  const full = path.join(OUT, rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, 'utf8');
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 轻量内联格式：**加粗** 与 `代码`
function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// 逻辑 href → 站点根相对 dist 路径
function logicalToDist(logicalHref, lang) {
  let p = String(logicalHref).replace(/^\//, '');
  if (p === '') p = 'index.html';
  return (lang === 'en' ? 'en/' : '') + p;
}

// 生成页面链接（相对当前页）
function link(href, lang, prefix) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  return prefix + logicalToDist(href, lang);
}

// 绝对 URL（sitemap / canonical / hreflang）
function absUrl(logicalHref, lang) {
  return BASE + '/' + logicalToDist(logicalHref, 'zh').replace(/^zh\//, '') ;
}
function absUrlLang(logicalHref, lang) {
  return BASE + '/' + logicalToDist(logicalHref, lang);
}

function fmtDate(dateStr, lang) {
  const [y, m, d] = dateStr.split('-');
  if (lang === 'en') {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
  }
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function catBySlug(slug) {
  return categories.find(c => c.slug === slug) || categories[0];
}

function postsByCat(slug, lang) {
  return posts.filter(p => p.category === slug).sort((a, b) => b.date.localeCompare(a.date));
}

function sortedPosts() {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}

// 文章封面图（方案C列表缩略图）：取正文首张图，无图则用统一占位图
const FALLBACK_COVER = 'assets/images/amap-review-example.jpg';
function coverOf(p) {
  const blocks = (p.content && p.content.zh) || [];
  const img = blocks.find(b => b && b.type === 'img' && b.src);
  return img ? img.src : FALLBACK_COVER;
}

/* ---------- 内容块渲染 ---------- */

function renderBlocks(blocks, prefix = '') {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(b => {
    switch (b.type) {
      case 'p':
        return `<p>${inline(b.text)}</p>`;
      case 'h2':
        return `<h2>${inline(b.text)}</h2>`;
      case 'h3':
        return `<h3>${inline(b.text)}</h3>`;
      case 'ul':
        return `<ul>${(b.items || []).map(i => `<li>${inline(i)}</li>`).join('')}</ul>`;
      case 'ol':
        return `<ol>${(b.items || []).map(i => `<li>${inline(i)}</li>`).join('')}</ol>`;
      case 'quote':
        return `<blockquote><p>${inline(b.text)}</p>${b.by ? `<cite>— ${inline(b.by)}</cite>` : ''}</blockquote>`;
      case 'tip':
        return `<div class="callout"><div class="callout-title">💡 ${inline(b.title || (b.text ? '' : ''))}</div><p>${inline(b.text)}</p></div>`;
      case 'img': {
        const src = (b.src || '').replace(/^\/+/, '');
        const cap = b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : '';
        return `<figure class="article-figure"><img src="${prefix}${esc(src)}" alt="${esc(b.alt || b.caption || '')}" loading="lazy" decoding="async">${cap}</figure>`;
      }
      case 'table': {
        const head = (b.head || []).map(h => `<th>${inline(h)}</th>`).join('');
        const rows = (b.rows || []).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      default:
        return '';
    }
  }).join('\n');
}

/* ---------- 模板片段 ---------- */

function t(key, lang) {
  const dict = {
    zh: {
      home: '首页', categories: '分类', latest: '最新文章', featured: '精选',
      readMore: '阅读全文', minRead: '分钟阅读', allPosts: '全部文章',
      about: '关于我们', backHome: '返回首页', related: '相关文章',
      toc: '本文目录', search: '搜索文章', searchPh: '输入关键词搜索...', noResult: '没有找到相关文章',
      postsIn: '下的文章', prev: '上一篇', next: '下一篇', share: '分享',
      darkMode: '切换深色模式', langSwitch: 'English', readTime: '分钟',
      copyright: '版权所有', disclaimer: '免责声明', subscribe: '订阅更新',
      subscribeDesc: '订阅我们的邮件，第一时间获取最新副业教程', emailPh: '你的邮箱地址', subscribeBtn: '订阅',
      categoriesTitle: '文章分类', tagline: '让每个普通人都能找到靠谱的网上副业',
      allArticles: '全部文章', viewAll: '查看全部', noPosts: '暂无文章',
      tipsTitle: '副业避坑提示', tipsText: '任何要求先交大额费用、承诺躺赚的项目都需谨慎。',
      aboutTitle: '关于副业掘金',
      aboutP1: '副业掘金是一个专注于网上副业的中文与英文双语博客。我们分享真实可行的副业项目、赚钱教程、工具测评与避坑指南，帮助普通人利用碎片时间增加额外收入。',
      aboutP2: '我们相信，副业不是一夜暴富的捷径，而是通过持续行动积累的长期资产。这里没有夸大的承诺，只有可验证的方法和务实的建议。',
      aboutP3: '本站内容由编辑团队整理创作，如发现信息有误，欢迎联系我们更正。',
      discTitle: '免责声明',
      discP1: '本站提供的信息仅供参考，不构成任何投资、法律或财务建议。副业有风险，行动前请自行判断并承担相应责任。',
      discP2: '本站可能包含联盟推广链接，通过链接购买我们可能获得佣金，但这不会影响我们的客观评测，也不会增加你的成本。',
      discP3: '我们努力确保信息准确，但不对信息的完整性、适用性做任何明示或暗示的保证。',
      notFound: '页面未找到', notFoundDesc: '你访问的页面不存在或已被移动。',
      popular: '热门文章', quickNav: '快速导航', footerDesc: '专注分享真实可行的网上副业与赚钱方法。'
    },
    en: {
      home: 'Home', categories: 'Categories', latest: 'Latest Articles', featured: 'Featured',
      readMore: 'Read More', minRead: 'min read', allPosts: 'All Articles',
      about: 'About', backHome: 'Back Home', related: 'Related Articles',
      toc: 'On This Page', search: 'Search articles', searchPh: 'Type keywords to search...', noResult: 'No articles found',
      postsIn: 'Articles in', prev: 'Previous', next: 'Next', share: 'Share',
      darkMode: 'Toggle dark mode', langSwitch: '中文', readTime: 'min',
      copyright: 'All rights reserved', disclaimer: 'Disclaimer', subscribe: 'Subscribe',
      subscribeDesc: 'Subscribe to get the latest side hustle guides in your inbox', emailPh: 'Your email address', subscribeBtn: 'Subscribe',
      categoriesTitle: 'Categories', tagline: 'Practical side hustles for ordinary people',
      allArticles: 'All Articles', viewAll: 'View all', noPosts: 'No articles yet',
      tipsTitle: 'Side Hustle Warning', tipsText: 'Be cautious of any program demanding large upfront fees or promising effortless riches.',
      aboutTitle: 'About Side Hustle Hub',
      aboutP1: 'Side Hustle Hub is a bilingual blog dedicated to online side hustles. We share real, actionable projects, money-making tutorials, tool reviews and scam alerts to help ordinary people earn extra income.',
      aboutP2: 'We believe a side hustle is not a get-rich-quick scheme but a long-term asset built through consistent action. No exaggerated promises — only verifiable methods and practical advice.',
      aboutP3: 'Content is written by our editorial team. If you spot any errors, please contact us.',
      discTitle: 'Disclaimer',
      discP1: 'Information on this site is for reference only and does not constitute investment, legal or financial advice. Side hustles carry risk — judge for yourself and take responsibility.',
      discP2: 'This site may contain affiliate links. We may earn a commission if you purchase through them, at no extra cost to you. This does not affect our objective reviews.',
      discP3: 'We strive for accuracy but make no warranties regarding completeness or fitness for a particular purpose.',
      notFound: 'Page Not Found', notFoundDesc: 'The page you are looking for does not exist or has been moved.',
      popular: 'Popular Articles', quickNav: 'Quick Navigation', footerDesc: 'Practical guides to real online side hustles and making money.'
    }
  };
  return dict[lang][key] || key;
}

// 单个标签
function tagHtml(post, lang) {
  const tags = lang === 'en' ? (post.tagsEn || post.tags) : post.tags;
  return (tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
}

// 文章卡片
function postCard(post, lang, prefix) {
  const cat = catBySlug(post.category);
  const href = link(`/post/${post.slug}.html`, lang, prefix);
  const title = lang === 'en' ? post.titleEn : post.title;
  const excerpt = lang === 'en' ? post.excerptEn : post.excerpt;
  return `<article class="post-card">
  <a href="${href}" class="post-card-emoji" style="--card-color:${cat.color}">${post.emoji}</a>
  <div class="post-card-body">
    <div class="post-card-meta">
      <a href="${link(`/category/${cat.slug}.html`, lang, prefix)}" class="cat-badge" style="--cat-color:${cat.color}">${lang === 'en' ? cat.nameEn : cat.name}</a>
      <span class="dot">·</span>
      <time>${fmtDate(post.date, lang)}</time>
    </div>
    <h3><a href="${href}">${esc(title)}</a></h3>
    <p>${esc(excerpt)}</p>
    <div class="post-card-foot">
      <span class="readtime">⏱ ${post.readTime} ${t('minRead', lang)}</span>
      <a href="${href}" class="readmore">${t('readMore', lang)} →</a>
    </div>
  </div>
</article>`;
}

/* ---------- 公共 HTML 骨架 ---------- */

function layout({ lang, title, description, keywords, canonicalHref, prefix, body, jsonLd, showSearch }) {
  const name = lang === 'en' ? S.nameEn : S.name;
  const tagline = lang === 'en' ? S.taglineEn : S.tagline;
  const pageTitle = title ? `${title} | ${name}` : `${name} - ${tagline}`;
  const canonical = absUrlLang(canonicalHref, lang);
  const altLang = lang === 'zh' ? 'en' : 'zh';
  // 顶栏彩色导航（方案C）：首页/平台导航/副业博客/最新避雷/投稿
  const topNav = [
    { href: '/', zh: '首页', en: 'Home', cls: 'c-blue' },
    ...site.nav.map(n => ({ href: n.href, zh: n.label, en: n.labelEn,
      cls: n.href === '/scams.html' ? 'c-red' : n.href === '/platforms.html' ? 'c-green' : n.href === '/blog.html' ? 'c-purple' : 'c-orange' }))
  ];
  const navHtml = topNav.map(n =>
    `<a href="${link(n.href, lang, prefix)}" class="top-link ${n.cls}${canonicalHref === n.href ? ' active' : ''}">${lang === 'en' ? n.en : n.zh}</a>`
  ).join('');

  const langSwitchHref = prefix + logicalToDist(canonicalHref, altLang);
  const footerLinks = S.footerLinks.map(f =>
    `<a href="${link(f.href, lang, prefix)}">${lang === 'en' ? f.labelEn : f.label}</a>`
  ).join('');

  const catList = platforms.categories.slice(0, 6).map(c =>
    `<a href="${link(`/platform/${c.id}.html`, lang, prefix)}">${esc(lang === 'en' ? c.nameEn : c.name)}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="keywords" content="${esc(keywords)}">
<meta name="author" content="${esc(lang === 'en' ? S.authorEn : S.author)}">
<meta name="theme-color" content="${S.themeColor}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="zh-CN" href="${absUrlLang(canonicalHref, 'zh')}">
<link rel="alternate" hreflang="en" href="${absUrlLang(canonicalHref, 'en')}">
<link rel="alternate" hreflang="x-default" href="${absUrlLang(canonicalHref, 'zh')}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(name)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💰</text></svg>">
<link rel="stylesheet" href="${prefix}assets/css/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<a class="skip-link" href="#main">${lang === 'en' ? 'Skip to content' : '跳转到正文'}</a>
<div class="topbar">
  <div class="container topbar-inner">
    <nav class="top-nav" id="mainNav">${navHtml}</nav>
    <div class="topbar-right">
      <span class="top-login">${lang === 'en' ? 'Sign in / Register' : '注册 / 登录'}</span>
      <button class="theme-switch" id="themeToggle" aria-label="${t('darkMode', lang)}" title="${t('darkMode', lang)}"><span class="ts-knob"></span></button>
    </div>
  </div>
</div>
<header class="site-header" id="siteHeader">
  <div class="container header-inner">
    <a href="${link('/', lang, prefix)}" class="brand">
      <span class="brand-icon">💰</span>
      <span class="brand-name">${esc(name)}</span>
    </a>
    <div class="header-search">
      <input type="text" placeholder="${t('searchPh', lang)}" aria-label="${t('search', lang)}" id="portalSearchInput" autocomplete="off">
      <button id="portalSearchBtn">${t('search', lang)}</button>
    </div>
    <div class="header-actions">
      ${showSearch !== false ? `<button class="icon-btn" id="searchToggle" aria-label="${t('search', lang)}" title="${t('search', lang)}">🔍</button>` : ''}
      <button class="icon-btn" id="langSwitch" data-href="${langSwitchHref}" aria-label="${t('langSwitch', lang)}" title="${lang === 'en' ? '中文' : 'English'}">${lang === 'en' ? '🇨🇳' : '🇬🇧'}</button>
      <button class="icon-btn menu-toggle" id="menuToggle" aria-label="Menu">☰</button>
    </div>
  </div>
</header>

<!-- 搜索弹层 -->
<div class="search-overlay" id="searchOverlay" hidden>
  <div class="search-box">
    <div class="search-input-wrap">
      <span>🔍</span>
      <input type="text" id="searchInput" placeholder="${t('searchPh', lang)}" autocomplete="off">
      <button id="searchClose" aria-label="Close">✕</button>
    </div>
    <div class="search-results" id="searchResults"></div>
  </div>
</div>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <a href="${link('/', lang, prefix)}" class="brand"><span class="brand-icon">💰</span><span class="brand-name">${esc(name)}</span></a>
      <p>${t('footerDesc', lang)}</p>
    </div>
    <div class="footer-col">
      <h4>${t('quickNav', lang)}</h4>
      ${catList}
    </div>
    <div class="footer-col">
      <h4>${t('about', lang)}</h4>
      <a href="${link('/about.html', lang, prefix)}">${t('about', lang)}</a>
      <a href="${link('/disclaimer.html', lang, prefix)}">${t('disclaimer', lang)}</a>
      <a href="${link('/privacy.html', lang, prefix)}">${lang === 'en' ? 'Privacy Policy' : '隐私政策'}</a>
      <a href="${link('/submit.html', lang, prefix)}">${lang === 'en' ? 'Submit a Platform' : '投稿平台'}</a>
      <a href="mailto:${S.email}">${lang === 'en' ? 'Contact' : '联系我们'}</a>
    </div>
    <div class="footer-col subscribe-col">
      <h4>${t('subscribe', lang)}</h4>
      <p>${t('subscribeDesc', lang)}</p>
      <form class="subscribe-form" onsubmit="return false;">
        <input type="email" placeholder="${t('emailPh', lang)}" aria-label="Email">
        <button type="submit">${t('subscribeBtn', lang)}</button>
      </form>
    </div>
  </div>
  <div class="container footer-bottom">
    <span>© ${new Date().getFullYear()} ${esc(name)}. ${t('copyright', lang)}.</span>
    <span class="footer-links">${footerLinks}</span>
  </div>
</footer>

<button class="back-to-top" id="backToTop" aria-label="Back to top">↑</button>
<script src="${prefix}assets/js/main.js" data-lang="${lang}" data-prefix="${prefix}"></script>
</body>
</html>`;
}

/* ---------- 方案C 门户通用组件（除文章页外共用） ---------- */

// 右侧栏：站内搜索 / 最近发表 / 标签云 / 归档
function portalSide(lang, prefix) {
  const L = (zh, en) => lang === 'en' ? en : zh;
  const all = sortedPosts();
  const rankNoCls = ['n1','n2','n3','n4','n5','n6','n7'];
  const recentRows = all.slice(0, 7).map((p, i) =>
    `<li><span class="rank-no ${rankNoCls[i]}">${String(i + 1).padStart(2, '0')}</span><p><a href="${link(`/post/${p.slug}.html`, lang, prefix)}">${esc(L(p.title, p.titleEn))}</a></p></li>`
  ).join('');
  const tagColors = ['a1','a2','a3','a4','a5','a6'];
  const tagCount = {};
  all.forEach(p => (lang === 'en' ? (p.tagsEn || p.tags) : p.tags).forEach(tg => { tagCount[tg] = (tagCount[tg] || 0) + 1; }));
  const tagCloud = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]).slice(0, 16).map((tg, i) =>
    `<a class="${tagColors[i % tagColors.length]}" href="${link('/blog.html', lang, prefix)}">${esc(tg)}</a>`
  ).join('');
  const archiveMap = {};
  all.forEach(p => { const ym = p.date.slice(0, 7); archiveMap[ym] = (archiveMap[ym] || 0) + 1; });
  const archiveRows = Object.keys(archiveMap).sort((a, b) => b.localeCompare(a)).map(ym => {
    const [y, m] = ym.split('-');
    return `<a href="${link('/blog.html', lang, prefix)}">${y}年${Number(m)}月 <span>${archiveMap[ym]}</span></a>`;
  }).join('');
  return `<aside class="portal-side">
    <div class="ps-box">
      <h4><span class="ps-bar"></span>${L('站内搜索', 'Site search')}</h4>
      <div class="ps-inner"><div class="ps-search"><span>${esc(lang === 'en' ? S.nameEn : S.name)}</span><input id="sideSearchInput" placeholder="${L('更多项目搜索', 'Search projects')}"><button id="sideSearchBtn">${lang === 'en' ? 'Go' : '搜索'}</button></div></div>
    </div>
    <div class="ps-box">
      <h4><span class="ps-bar" style="background:#e5484d"></span>${L('最近发表', 'Recent posts')}<span class="ps-dots"><i></i><i></i><i></i></span></h4>
      <div class="ps-inner ps-pad-sm"><ul class="ps-rank">${recentRows}</ul></div>
    </div>
    <div class="ps-box">
      <h4><span class="ps-bar" style="background:#1fb474"></span>${L('标签列表', 'Tag cloud')}<span class="ps-dots"><i></i><i></i><i></i></span></h4>
      <div class="ps-inner"><div class="ps-tags">${tagCloud}</div></div>
    </div>
    <div class="ps-box">
      <h4><span class="ps-bar" style="background:#f08c00"></span>${L('文章归档', 'Archives')}<span class="ps-dots"><i></i><i></i><i></i></span></h4>
      <div class="ps-inner"><div class="ps-arch">${archiveRows}</div></div>
    </div>
  </aside>`;
}

// 深色横幅
function portalBanner(inner) {
  return `<section class="portal-banner"><div class="container"><h1>${inner}</h1></div></section>`;
}

// 站点级红Tab（最新文章/平台导航/副业博客/投稿）
// homePanels=true：生成带 data-tab 的切换按钮，配合首页四面板；否则为普通跳转链接
function siteTabs(lang, prefix, current, firstHref, homePanels) {
  const L = (zh, en) => lang === 'en' ? en : zh;
  const defs = [
    { key: 'home', zh: '最新文章', en: 'Latest', href: '/' },
    { key: 'platforms', zh: '平台导航', en: 'Platforms', href: '/platforms.html' },
    { key: 'blog', zh: '副业博客', en: 'Blog', href: '/blog.html' },
    { key: 'submit', zh: '投稿平台', en: 'Submit', href: '/submit.html' }
  ];
  return `<nav class="portal-tabs"${homePanels ? ' id="homeTabs"' : ''}>${defs.map(d => {
    const href = homePanels
      ? `#panel-${d.key}`
      : ((d.key === 'home' && firstHref) ? firstHref : link(d.href, lang, prefix));
    const attr = homePanels ? ` data-tab="${d.key}"` : '';
    return `<a href="${href}"${attr} class="${d.key === current ? 'on' : ''}">${L(d.zh, d.en)}</a>`;
  }).join('')}</nav>`;
}

// 紧凑文章行列表（缩略图 + 标签 + 标题 + 摘要 + 元信息）
function portalRowsHtml(list, lang, prefix, opts) {
  opts = opts || {};
  const L = (zh, en) => lang === 'en' ? en : zh;
  const catName = slug => { const c = categories.find(x => x.slug === slug); return c ? L(c.name, c.nameEn) : ''; };
  return list.map((p, i) => {
    const isScam = p.category === 'scam-alerts' || /骗局|避雷|套路|别信/.test(p.title);
    const badge = (opts.firstTop && i === 0) ? `<span class="pr-tag r">${L('置顶', 'TOP')}</span>`
      : isScam ? `<span class="pr-tag r" style="background:#111">${L('避雷', 'ALERT')}</span>`
      : (p.featured || opts.allFeatured) ? `<span class="pr-tag o">${L('推荐', 'PICKS')}</span>` : '';
    return `<article class="portal-row" data-post-cat="${p.category}">
      <a href="${link(`/post/${p.slug}.html`, lang, prefix)}" class="pr-thumb"><img loading="lazy" src="${prefix}${coverOf(p)}" alt="${esc(L(p.title, p.titleEn))}"></a>
      <div class="pr-body">
        <div class="pr-title">${badge}<h3><a href="${link(`/post/${p.slug}.html`, lang, prefix)}">${esc(L(p.title, p.titleEn))}</a></h3></div>
        <p class="pr-excerpt">${esc(L(p.excerpt, p.excerptEn))}</p>
        <div class="pr-meta"><span>👤 ${esc(lang === 'en' ? S.authorEn : S.author)}</span><span class="pr-dot"></span><span>📁 ${esc(catName(p.category))}</span><span class="pr-dot"></span><span>🕒 ${p.date}</span><span class="pr-dot"></span><span>👁 ${p.readTime || 3} ${L('分钟阅读', 'min read')}</span></div>
      </div>
    </article>`;
  }).join('');
}

// 平台导航板块：平台紧凑行（分类色块缩略图 + 类型标签 + 名称 + 优点 + 提现/币种/结算）
function portalPlatformRows(lang, prefix) {
  const L = (zh, en) => lang === 'en' ? en : zh;
  const rows = [];
  platforms.categories.forEach(c => {
    c.platforms.forEach(p => {
      const href = link(`/platform/${c.id}.html`, lang, prefix);
      rows.push(`<article class="portal-row">
        <a href="${href}" class="pr-thumb pr-thumb-icon" style="background:linear-gradient(135deg,${c.color},${c.color}aa)">${c.icon}</a>
        <div class="pr-body">
          <div class="pr-title"><span class="pr-tag" style="background:${c.color}">${esc(L(p.type, p.typeEn))}</span><h3><a href="${href}">${esc(p.name)}</a></h3></div>
          <p class="pr-excerpt">${esc(L((p.pros && p.pros[0]) || '', (p.prosEn && p.prosEn[0]) || ''))}</p>
          <div class="pr-meta"><span>💰 ${esc(L(p.minWithdraw, p.minWithdrawEn))}</span><span class="pr-dot"></span><span>💱 ${esc(L(p.currency, p.currencyEn))}</span><span class="pr-dot"></span><span>🏦 ${esc(L(p.settle, p.settleEn))}</span><span class="pr-dot"></span><span>📁 ${esc(L(c.name, c.nameEn))}</span></div>
        </div>
      </article>`);
    });
  });
  return rows.join('');
}

// 副业博客板块：按专栏分组的紧凑文章行
function portalBlogRows(lang, prefix) {
  const L = (zh, en) => lang === 'en' ? en : zh;
  let html = '';
  blogColumns.columns.forEach(col => {
    const colPosts = col.slugs.map(sl => posts.find(p => p.slug === sl)).filter(Boolean).slice(0, 3);
    if (!colPosts.length) return;
    const href = link(`/column/${col.id}.html`, lang, prefix);
    html += `<div class="portal-group-title"><span class="pgt-icon">${col.icon}</span><a href="${href}">${esc(L(col.name, col.nameEn))}</a><a class="pgt-more" href="${href}">${L('更多', 'More')} →</a></div>`;
    html += portalRowsHtml(colPosts, lang, prefix);
  });
  return html;
}

// 投稿平台板块：投稿引导 + 步骤紧凑行
function portalSubmitRows(lang, prefix) {
  const L = (zh, en) => lang === 'en' ? en : zh;
  const mail = S.email;
  const href = link('/submit.html', lang, prefix);
  const steps = lang === 'en'
    ? [
        ['Find a platform', 'Send us the platform name, URL and how it works.'],
        ['Fill in the details', 'Include type, minimum withdrawal, currency, settlement and honest downsides.'],
        ['Manual review', 'We verify every submission before publishing — no paid placements.'],
        ['Live on site', 'Approved platforms appear in the directory with full details.']
      ]
    : [
        ['发现平台', '把平台名称、网址和玩法发给我们。'],
        ['填写信息', '写清类型、最低提现、币种、结算方式与真实坑点。'],
        ['人工核实', '每份投稿我们都会核实，不接受付费上架。'],
        ['上架展示', '通过审核的平台会收录进导航，附上完整信息。']
      ];
  const rows = steps.map((s, i) => `<article class="portal-row portal-row-step">
      <div class="pr-step-no">${i + 1}</div>
      <div class="pr-body">
        <div class="pr-title"><h3>${esc(s[0])}</h3></div>
        <p class="pr-excerpt">${esc(s[1])}</p>
      </div>
    </article>`).join('');
  return `<div class="portal-submit-hero">
      <div class="psh-icon">📝</div>
      <div class="psh-text">
        <h2>${L('发现靠谱平台？投稿给我们', 'Found a legit platform? Submit it')}</h2>
        <p>${L('我们人工核实每一份提交，只上架能查证的平台。', 'We manually verify every submission and only publish what we can confirm.')}</p>
      </div>
      <a href="${href}" class="btn btn-primary">${L('投稿平台', 'Submit a platform')} →</a>
    </div>
    <div class="portal-group-title">${L('投稿流程', 'How it works')}</div>
    ${rows}
    <div class="portal-submit-mail">${L('邮箱', 'Email')}: <a href="mailto:${esc(mail)}">${esc(mail)}</a></div>`;
}

// 门户框架：横幅 + 红Tab + 两栏（左侧内容 + 右侧栏）
function portalShell({ banner, tabs, main, lang, prefix, mainClass, mainId }) {
  const cls = `portal-main${mainClass ? ' ' + mainClass : ''}`;
  const id = mainId ? ` id="${mainId}"` : '';
  return `${portalBanner(banner)}
<div class="container">
  ${tabs}
  <div class="portal-layout">
    <div class="${cls}"${id}>${main}</div>
    ${portalSide(lang, prefix)}
  </div>
</div>`;
}

/* ---------- 页面生成 ---------- */

// 首页（方案C 门户资讯流）
function buildHome(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const L = (zh, en) => lang === 'en' ? en : zh;

  // 四个切换面板（与"最新文章"同款紧凑列表风格）
  const panels = `
  <div class="portal-panel is-active" data-panel="home">
    ${portalRowsHtml(sortedPosts().slice(0, 12), lang, prefix, { firstTop: true })}
    <div class="panel-more"><a href="${link('/all.html', lang, prefix)}">${L('查看全部文章', 'View all articles')} →</a></div>
  </div>
  <div class="portal-panel" data-panel="platforms" hidden>
    ${portalPlatformRows(lang, prefix)}
    <div class="panel-more"><a href="${link('/platforms.html', lang, prefix)}">${L('进入平台导航', 'Open platform directory')} →</a></div>
  </div>
  <div class="portal-panel" data-panel="blog" hidden>
    ${portalBlogRows(lang, prefix)}
    <div class="panel-more"><a href="${link('/blog.html', lang, prefix)}">${L('进入副业博客', 'Open blog')} →</a></div>
  </div>
  <div class="portal-panel" data-panel="submit" hidden>
    ${portalSubmitRows(lang, prefix)}
  </div>`;
  const tabs = siteTabs(lang, prefix, 'home', null, true);
  const banner = `${L('副业掘金', 'Side Hustle Hub')} · <em>${L('每日项目', 'Daily')}</em>${L('资讯简报', ' Project Brief')}`;

  const body = portalShell({ banner, tabs, main: panels, lang, prefix, mainClass: 'portal-main-panels' });

  // 页脚法务入口由 layout 统一处理
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: lang === 'en' ? S.nameEn : S.name,
    description: lang === 'en' ? S.descriptionEn : S.description,
    url: absUrlLang('/', lang),
    inLanguage: lang === 'zh' ? 'zh-CN' : 'en',
    author: { '@type': 'Organization', name: lang === 'en' ? S.authorEn : S.author }
  };

  return layout({
    lang, title: '', description: lang === 'en' ? S.descriptionEn : S.description,
    keywords: (lang === 'en' ? S.keywordsEn : S.keywords).join(','),
    canonicalHref: '/', prefix, body, jsonLd
  });
}

// 文章详情页
function buildPost(post, lang) {
  const prefix = lang === 'en' ? '../../' : '../';
  const cat = catBySlug(post.category);
  const title = lang === 'en' ? post.titleEn : post.title;
  const excerpt = lang === 'en' ? post.excerptEn : post.excerpt;
  const content = lang === 'en' ? post.content.en : post.content.zh;
  const canonicalHref = `/post/${post.slug}.html`;

  // 目录
  const headings = content.filter(b => b.type === 'h2');
  const tocHtml = headings.length > 1 ? `<div class="toc">
    <div class="toc-title">📑 ${t('toc', lang)}</div>
    <ol>${headings.map((h, i) => `<li><a href="#sec-${i}">${inline(h.text)}</a></li>`).join('')}</ol>
  </div>` : '';

  // 给 h2 加锚点 id
  let h2Index = -1;
  const bodyHtml = renderBlocks(content, prefix).replace(/<h2>([\s\S]*?)<\/h2>/g, (match, inner) => {
    h2Index++;
    return `<h2 id="sec-${h2Index}">${inner}</h2>`;
  });

  const all = sortedPosts();
  const idx = all.findIndex(p => p.id === post.id);
  const prevPost = all[idx - 1];
  const nextPost = all[idx + 1];
  const navHtml = `<div class="post-nav">
    ${prevPost ? `<a href="${link(`/post/${prevPost.slug}.html`, lang, prefix)}" class="post-nav-item prev"><span>← ${t('prev', lang)}</span><strong>${esc(lang === 'en' ? prevPost.titleEn : prevPost.title)}</strong></a>` : '<div></div>'}
    ${nextPost ? `<a href="${link(`/post/${nextPost.slug}.html`, lang, prefix)}" class="post-nav-item next"><span>${t('next', lang)} →</span><strong>${esc(lang === 'en' ? nextPost.titleEn : nextPost.title)}</strong></a>` : '<div></div>'}
  </div>`;

  const related = all.filter(p => p.category === post.category && p.id !== post.id).slice(0, 3);
  const relatedHtml = related.length ? `<section class="section">
    <div class="section-head"><div><h2>🔗 ${t('related', lang)}</h2></div></div>
    <div class="post-grid">${related.map(p => postCard(p, lang, prefix)).join('')}</div>
  </section>` : '';

  const body = `
<div class="container article-layout">
  <article class="article-main">
    <nav class="breadcrumb">
      <a href="${link('/', lang, prefix)}">${t('home', lang)}</a> <span>/</span>
      <a href="${link(`/category/${cat.slug}.html`, lang, prefix)}">${lang === 'en' ? cat.nameEn : cat.name}</a> <span>/</span>
      <span>${esc(title)}</span>
    </nav>
    <header class="article-header">
      <div class="article-meta-top">
        <a href="${link(`/category/${cat.slug}.html`, lang, prefix)}" class="cat-badge" style="--cat-color:${cat.color}">${lang === 'en' ? cat.nameEn : cat.name}</a>
        <span>⏱ ${post.readTime} ${t('minRead', lang)}</span>
        <span>📅 ${fmtDate(post.date, lang)}</span>
      </div>
      <h1>${esc(title)}</h1>
      <p class="article-excerpt">${esc(excerpt)}</p>
      <div class="article-tags">${tagHtml(post, lang)}</div>
    </header>
    <div class="article-hero" style="--card-color:${cat.color}">${post.emoji}</div>
    <div class="article-content">${bodyHtml}</div>
    <div class="article-share">
      <span>${t('share', lang)}:</span>
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(absUrlLang(canonicalHref, lang))}" target="_blank" rel="noopener" class="share-btn">𝕏</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(absUrlLang(canonicalHref, lang))}" target="_blank" rel="noopener" class="share-btn">f</a>
      <button class="share-btn" id="copyLink" data-url="${absUrlLang(canonicalHref, lang)}" title="${lang === 'en' ? 'Copy link' : '复制链接'}">🔗</button>
    </div>
    ${navHtml}
  </article>
  <aside class="article-sidebar">
    ${tocHtml}
    <div class="sidebar-card">
      <h4>🛡 ${t('tipsTitle', lang)}</h4>
      <p>${t('tipsText', lang)}</p>
      <a href="${link('/category/scam-alerts.html', lang, prefix)}">${lang === 'en' ? 'Read more' : '了解更多'} →</a>
    </div>
  </aside>
</div>
${relatedHtml}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: excerpt,
    image: BASE + '/assets/og-default.svg',
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: lang === 'en' ? S.authorEn : S.author },
    publisher: { '@type': 'Organization', name: lang === 'en' ? S.nameEn : S.name },
    mainEntityOfPage: absUrlLang(canonicalHref, lang),
    inLanguage: lang === 'zh' ? 'zh-CN' : 'en',
    keywords: (lang === 'en' ? (post.tagsEn || post.tags) : post.tags).join(', ')
  };

  return layout({
    lang, title, description: excerpt,
    keywords: (lang === 'en' ? (post.tagsEn || post.tags) : post.tags).join(','),
    canonicalHref, prefix, body, jsonLd
  });
}

// 分类页
function buildCategory(cat, lang) {
  const prefix = lang === 'en' ? '../../' : '../';
  const list = postsByCat(cat.slug, lang);
  const canonicalHref = `/category/${cat.slug}.html`;
  const catName = lang === 'en' ? cat.nameEn : cat.name;
  const catDesc = lang === 'en' ? cat.descriptionEn : cat.description;

  const main = `<div class="portal-content">
  <header class="page-header" style="--cat-color:${cat.color}">
    <div class="page-icon">${cat.icon}</div>
    <h1>${esc(catName)}</h1>
    <p>${esc(catDesc)}</p>
    <span class="page-count">${list.length} ${lang === 'en' ? 'articles' : '篇文章'}</span>
  </header>
  ${portalRowsHtml(list, lang, prefix)}
</div>`;
  const body = portalShell({
    banner: `${cat.icon} ${esc(catName)}`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });

  return layout({
    lang, title: catName, description: catDesc,
    keywords: `${catName},${(lang === 'en' ? S.keywordsEn : S.keywords).join(',')}`,
    canonicalHref, prefix, body
  });
}

// 全部文章页
function buildAll(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const all = sortedPosts();
  const canonicalHref = '/all.html';
  const catFilter = categories.map(c => `<button class="filter-btn" data-cat="${c.slug}">${lang === 'en' ? c.nameEn : c.name}</button>`).join('');

  const main = `<div class="portal-content">
  <header class="page-header"><div class="page-icon">📚</div><h1>${t('allArticles', lang)}</h1><p>${S.description && (lang === 'en' ? S.descriptionEn : S.description)}</p></header>
  <div class="filter-bar"><button class="filter-btn active" data-cat="all">${lang === 'en' ? 'All' : '全部'}</button>${catFilter}</div>
  <div id="allPostsGrid">${portalRowsHtml(all, lang, prefix)}</div>
</div>`;
  const body = portalShell({
    banner: `📚 ${t('allArticles', lang)}`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });

  return layout({
    lang, title: t('allArticles', lang), description: lang === 'en' ? S.descriptionEn : S.description,
    keywords: (lang === 'en' ? S.keywordsEn : S.keywords).join(','),
    canonicalHref, prefix, body
  });
}

// 关于 / 免责声明 页
function buildStaticPage(kind, lang) {
  const prefix = lang === 'en' ? '../' : '';
  const canonicalHref = kind === 'about' ? '/about.html' : '/disclaimer.html';
  const isAbout = kind === 'about';
  const title = isAbout ? t('aboutTitle', lang) : t('discTitle', lang);
  const paras = isAbout ? [t('aboutP1', lang), t('aboutP2', lang), t('aboutP3', lang)] : [t('discP1', lang), t('discP2', lang), t('discP3', lang)];
  const main = `<div class="portal-content">
  <article class="static-page">
    <header class="page-header"><div class="page-icon">${isAbout ? '👋' : '📋'}</div><h1>${esc(title)}</h1></header>
    <div class="article-content">${paras.map(p => `<p>${inline(p)}</p>`).join('')}</div>
  </article>
</div>`;
  const body = portalShell({
    banner: `${isAbout ? '👋' : '📋'} ${esc(title)}`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });
  return layout({
    lang, title, description: paras[0],
    keywords: (lang === 'en' ? S.keywordsEn : S.keywords).join(','),
    canonicalHref, prefix, body
  });
}

/* ---------- 新增栏目页面 ---------- */

// 通用：breadcrumb
function crumb(lang, prefix, items) {
  return `<nav class="breadcrumb"><a href="${link('/', lang, prefix)}">${t('home', lang)}</a> ${items.map(x => `<span>/</span>${x}`).join(' ')}</nav>`;
}

// 平台导航总览 /platforms.html
function buildPlatformsIndex(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const catHtml = platforms.categories.map(c => {
    const count = c.platforms.length;
    return `<a href="${link(`/platform/${c.id}.html`, lang, prefix)}" class="nav-cat-card" style="--cat-color:${c.color}">
      <div class="nc-icon">${c.icon}</div>
      <h3>${esc(lang === 'en' ? c.nameEn : c.name)}</h3>
      <p>${esc(lang === 'en' ? c.descEn : c.desc)}</p>
      <span class="nc-count">${count} ${lang === 'en' ? 'platforms' : '个平台'} →</span>
    </a>`;
  }).join('');
  const main = `<div class="portal-content">
  <div class="page-hero page-hero-sm">
    <div class="page-icon">🧭</div>
    <h1>${lang === 'en' ? 'Legit Side Hustle Platform Directory' : '正规副业平台导航'}</h1>
    <p>${lang === 'en' ? 'Each platform is listed with its type, minimum withdrawal, currency, settlement method, pros and real downsides. Most are pocket-money channels — set realistic expectations.' : '每个平台都写清类型、最低提现、结算币种与方式、优点与真实坑点。多数属于零花钱渠道，请建立合理预期。'}</p>
  </div>
  <div class="notice-box notice-warn">
    <strong>${lang === 'en' ? 'Read this first' : '先看这里'}</strong>
    <p>${lang === 'en' ? 'We do not promise guaranteed income. Any platform asking for an upfront deposit, membership fee or "unlock" payment before withdrawal is a red flag.' : '本站不承诺收益。凡是要求先交押金、会员费、解冻费才能提现的，一律高度警惕。'}</p>
  </div>
  <div class="nav-cat-grid">${catHtml}</div>
</div>`;
  const body = portalShell({
    banner: `🧭 ${lang === 'en' ? 'Platform Directory' : '平台导航'}`, tabs: siteTabs(lang, prefix, 'platforms'), main, lang, prefix
  });
  return layout({
    lang, title: lang === 'en' ? 'Platform Directory' : '平台导航',
    description: lang === 'en' ? 'A vetted directory of side hustle platforms with withdrawal thresholds, settlement methods, pros and real downsides.' : '正规副业平台导航：分类整理问卷、接单、内容分成、分销等平台，写清提现门槛与真实坑点。',
    keywords: '副业平台,问卷平台,接单平台,平台提现,surveys,affiliate', canonicalHref: '/platforms.html', prefix, body
  });
}

// 平台分类页 /platform/{id}.html
function buildPlatformCategory(c, lang) {
  const prefix = lang === 'en' ? '../../' : '../';
  const listHtml = c.platforms.map(p => {
    const pros = (lang === 'en' ? p.prosEn : p.pros).map(x => `<li class="pro">${esc(x)}</li>`).join('');
    const cons = (lang === 'en' ? p.consEn : p.cons).map(x => `<li class="con">${esc(x)}</li>`).join('');
    return `<article class="platform-card" style="--cat-color:${c.color}">
      <div class="pc-head">
        <div><h3>${esc(p.name)}</h3><span class="pc-type">${esc(lang === 'en' ? p.typeEn : p.type)}</span></div>
        <span class="pc-level">${esc(lang === 'en' ? p.levelEn : p.level)}</span>
      </div>
      <div class="pc-specs">
        <div><span>${lang === 'en' ? 'Min. withdrawal' : '最低提现'}</span><strong>${esc(lang === 'en' ? p.minWithdrawEn : p.minWithdraw)}</strong></div>
        <div><span>${lang === 'en' ? 'Currency' : '结算币种'}</span><strong>${esc(lang === 'en' ? p.currencyEn : p.currency)}</strong></div>
        <div><span>${lang === 'en' ? 'Settlement' : '结算方式'}</span><strong>${esc(lang === 'en' ? p.settleEn : p.settle)}</strong></div>
      </div>
      <div class="pc-pairs">
        <div class="pc-col"><h4>✅ ${lang === 'en' ? 'Pros' : '优点'}</h4><ul>${pros}</ul></div>
        <div class="pc-col pc-cons"><h4>⚠️ ${lang === 'en' ? 'Downsides' : '坑点'}</h4><ul>${cons}</ul></div>
      </div>
    </article>`;
  }).join('');
  const title = lang === 'en' ? c.nameEn : c.name;
  const main = `<div class="portal-content">
  <div class="page-hero page-hero-sm">
    <div class="page-icon">${c.icon}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(lang === 'en' ? c.descEn : c.desc)}</p>
  </div>
  <div class="platform-list">${listHtml}</div>
</div>`;
  const body = portalShell({
    banner: `${c.icon} ${esc(title)}`, tabs: siteTabs(lang, prefix, 'platforms'), main, lang, prefix
  });
  return layout({
    lang, title, description: lang === 'en' ? c.descEn : c.desc,
    keywords: (lang === 'en' ? c.nameEn : c.name) + ',副业平台,提现', canonicalHref: `/platform/${c.id}.html`, prefix, body
  });
}

// 骗局拆解列表 /scams.html
function buildScamsIndex(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const items = scams.scams.map(s => {
    const href = link(`/scam/${s.id}.html`, lang, prefix);
    return `<a href="${href}" class="scam-card" style="--scam-color:${s.color}">
      <div class="sc-icon">${s.icon}</div>
      <div class="sc-body">
        <div class="sc-meta"><time>${esc(s.date)}</time><span class="sc-tag">${lang === 'en' ? 'Scam Alert' : '避雷'}</span></div>
        <h3>${esc(lang === 'en' ? s.titleEn : s.title)}</h3>
        <p>${esc(lang === 'en' ? s.summaryEn : s.summary)}</p>
        <span class="sc-more">${lang === 'en' ? 'See how it works' : '查看套路拆解'} →</span>
      </div>
    </a>`;
  }).join('');
  const main = `<div class="portal-content">
  <div class="page-hero page-hero-sm">
    <div class="page-icon">🚨</div>
    <h1>${lang === 'en' ? 'Latest Scam Alerts' : '最新避雷'}</h1>
    <p>${lang === 'en' ? 'Pinned: recent high-frequency scams — Douyin idle-earnings, AI fake-order schemes, upfront deposits. Learn the pattern, spot the red flags.' : '置顶：近期高发骗局——抖音挂机、AI 代做刷单、垫付任务。拆解套路，记住识别特征。'}</p>
  </div>
  <div class="notice-box notice-danger">
    <strong>🛑 ${lang === 'en' ? 'Golden rule' : '一条铁律'}</strong>
    <p>${lang === 'en' ? 'Anyone asking you to pay first — deposits, fees, "unlock" charges — is a scam. No exceptions.' : '凡是先让你垫付、交押金、交会费、买"入场券"的，一律不要参与，没有例外。'}</p>
  </div>
  <div class="scam-grid">${items}</div>
</div>`;
  const body = portalShell({
    banner: `🚨 ${lang === 'en' ? 'Latest Scam Alerts' : '最新避雷'}`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });
  return layout({
    lang, title: lang === 'en' ? 'Latest Scam Alerts' : '最新避雷',
    description: lang === 'en' ? 'Breakdowns of recent side hustle scams with red flags and warning signs.' : '近期高发副业骗局拆解：套路、识别特征与防范提示，先垫付交押金的一律标红避雷。',
    keywords: '副业骗局,避雷,刷单诈骗,挂机骗局,side hustle scam', canonicalHref: '/scams.html', prefix, body
  });
}

// 骗局详情 /scam/{id}.html
function buildScam(s, lang) {
  const prefix = lang === 'en' ? '../../' : '../';
  const steps = (lang === 'en' ? s.steps : s.steps).map((st, i) => `<li><span class="step-n">${i + 1}</span><span>${esc(typeof st === 'string' ? st : (st[lang] || st.zh))}</span></li>`).join('');
  const flags = (lang === 'en' ? s.redFlagsEn : s.redFlags).map(x => `<li>${esc(x)}</li>`).join('');
  const main = `<div class="portal-content">
  <article class="static-page scam-detail" style="--scam-color:${s.color}">
    <header class="page-header"><div class="page-icon">${s.icon}</div><h1>${esc(lang === 'en' ? s.titleEn : s.title)}</h1><p class="page-sub">${esc(lang === 'en' ? s.summaryEn : s.summary)} · ${esc(s.date)}</p></header>
    <div class="article-content">
      <div class="notice-box notice-danger"><strong>🛑 ${lang === 'en' ? 'If you see this, walk away' : '遇到即远离'}</strong><p>${lang === 'en' ? s.verdictEn : s.verdict}</p></div>
      <h2>${lang === 'en' ? 'How the scam works' : '套路拆解'}</h2>
      <ol class="scam-steps">${steps}</ol>
      <h2>${lang === 'en' ? 'Red flags (memorize these)' : '识别特征（记住这些）'}</h2>
      <ul class="red-flags">${flags}</ul>
      <div class="notice-box notice-warn"><strong>📷 ${lang === 'en' ? 'Screenshot clue' : '截图识别'}</strong><p>${lang === 'en' ? 'Fake earnings screenshots are usually too neat: identical round numbers, no transaction IDs, and the same image reused across accounts. Real platform records are messy and verifiable.' : '假收益截图往往过于整齐：清一色整数、无交易单号、多个账号复用同一张图。真实的平台记录细节杂乱且可核对。'}</p></div>
    </div>
  </article>
</div>`;
  const body = portalShell({
    banner: `🚨 ${esc(lang === 'en' ? s.titleEn : s.title)}`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });
  return layout({
    lang, title: lang === 'en' ? s.titleEn : s.title, description: lang === 'en' ? s.summaryEn : s.summary,
    keywords: '骗局拆解,副业避雷,scam breakdown', canonicalHref: `/scam/${s.id}.html`, prefix, body
  });
}

// 博客专栏页 /column/{id}.html
function buildBlogColumn(col, lang) {
  const prefix = lang === 'en' ? '../../' : '../';
  const colPosts = col.slugs.map(sl => posts.find(p => p.slug === sl)).filter(Boolean);
  const title = lang === 'en' ? col.nameEn : col.name;
  const otherCols = blogColumns.columns.filter(c => c.id !== col.id).map(c => `<a href="${link(`/column/${c.id}.html`, lang, prefix)}">${lang === 'en' ? c.nameEn : c.name} →</a>`).join('');
  const main = `<div class="portal-content">
  <div class="page-hero page-hero-sm" style="--cat-color:${col.color}">
    <div class="page-icon">${col.icon}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(lang === 'en' ? col.descEn : col.desc)}</p>
  </div>
  ${portalRowsHtml(colPosts, lang, prefix)}
  <div class="panel" style="margin-top:28px"><h3>${lang === 'en' ? 'Other columns' : '其他专栏'}</h3><div class="column-links">${otherCols}</div></div>
</div>`;
  const body = portalShell({
    banner: `${col.icon} ${esc(title)}`, tabs: siteTabs(lang, prefix, 'blog'), main, lang, prefix
  });
  return layout({
    lang, title, description: lang === 'en' ? col.descEn : col.desc,
    keywords: (lang === 'en' ? col.nameEn : col.name) + ',副业经验', canonicalHref: `/column/${col.id}.html`, prefix, body
  });
}

// 博客频道页 /blog.html
function buildBlogIndex(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const colHtml = blogColumns.columns.map(c => {
    const n = c.slugs.length;
    return `<a href="${link(`/column/${c.id}.html`, lang, prefix)}" class="nav-cat-card" style="--cat-color:${c.color}">
      <div class="nc-icon">${c.icon}</div><h3>${esc(lang === 'en' ? c.nameEn : c.name)}</h3>
      <p>${esc(lang === 'en' ? c.descEn : c.desc)}</p>
      <span class="nc-count">${n} ${lang === 'en' ? 'articles' : '篇文章'} →</span>
    </a>`;
  }).join('');
  const main = `<div class="portal-content">
  <div class="page-hero page-hero-sm">
    <div class="page-icon">📖</div>
    <h1>${lang === 'en' ? 'Side Hustle Experience Blog' : '副业经验博客'}</h1>
    <p>${lang === 'en' ? 'Beginner guides, payout thresholds and risk control, honest income logs, and scam breakdowns — the SEO backbone of this site.' : '新手入门、提现门槛与风控、真实收入记录、骗局拆解——本站 SEO 主力栏目。'}</p>
  </div>
  <div class="nav-cat-grid">${colHtml}</div>
</div>`;
  const body = portalShell({
    banner: `📖 ${lang === 'en' ? 'Blog' : '副业经验博客'}`, tabs: siteTabs(lang, prefix, 'blog'), main, lang, prefix
  });
  return layout({
    lang, title: lang === 'en' ? 'Blog' : '副业经验博客',
    description: lang === 'en' ? 'Beginner guides, payout and risk control, real income logs and scam breakdowns.' : '副业经验博客：新手入门、提现风控、真实收入记录与骗局拆解。',
    keywords: '副业经验,新手指南,收入记录,骗局拆解', canonicalHref: '/blog.html', prefix, body
  });
}

// 投稿页 /submit.html（静态说明 + 邮箱提交）
function buildSubmit(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const mail = S.email;
  const subject = encodeURIComponent(lang === 'en' ? 'Platform submission: ' : '平台投稿：');
  const bodyTpl = encodeURIComponent(lang === 'en'
    ? 'Platform name:\nType (survey / gig / affiliate / resale):\nMinimum withdrawal:\nCurrency & settlement:\nPros:\nDownsides / risks:\nOfficial URL:\nWhy you recommend it:'
    : '平台名称：\n类型（问卷/接单/分销/二手）：\n最低提现：\n结算币种与方式：\n优点：\n坑点与风险：\n官网地址：\n推荐理由：');
  const mailto = `mailto:${mail}?subject=${subject}&body=${bodyTpl}`;
  const body = portalShell({
    banner: `📝 ${lang === 'en' ? 'Submit a Platform' : '投稿平台'}`, tabs: siteTabs(lang, prefix, 'submit'),
    lang, prefix,
    main: `<div class="portal-content">
  <div class="page-hero page-hero-sm">
    <div class="page-icon">📝</div>
    <h1>${lang === 'en' ? 'Submit a Legit Platform' : '投稿靠谱平台'}</h1>
    <p>${lang === 'en' ? 'Found a platform worth sharing? Send it to us. We manually review every submission and only publish what we can verify.' : '发现值得分享的靠谱平台？欢迎投稿。我们人工审核每一份提交，只上架能核实的平台。'}</p>
  </div>
  <div class="article-content static-page">
    <h2>${lang === 'en' ? 'What to include' : '请提供这些信息'}</h2>
    <ul>
      <li>${lang === 'en' ? 'Platform name and official URL' : '平台名称与官网地址'}</li>
      <li>${lang === 'en' ? 'Type: survey, crowdsourcing, writing, design, affiliate, resale, etc.' : '类型：问卷、众包、文案、设计、分销、二手等'}</li>
      <li>${lang === 'en' ? 'Minimum withdrawal, currency and settlement method' : '最低提现、结算币种与结算方式'}</li>
      <li>${lang === 'en' ? 'Pros AND honest downsides (fees, bans, slow payouts, low rates)' : '优点与真实坑点（抽成、封号、提现卡审核、单价低等）'}</li>
      <li>${lang === 'en' ? 'Your first-hand experience — no copy-paste marketing text' : '你的实测视角——不要直接复制官方宣传文案'}</li>
    </ul>
    <h2>${lang === 'en' ? 'Review process' : '审核流程'}</h2>
    <p>${lang === 'en' ? 'We verify the platform, check its payout terms and cross-check user feedback. Submissions with exaggerated income claims, referral pressure or upfront-fee requirements will be rejected.' : '我们会核实平台主体、提现规则与用户反馈。含夸大收益承诺、拉人头或要求先交钱的投稿一律不予上架。'}</p>
    <div class="notice-box notice-warn"><strong>${lang === 'en' ? 'No guarantees' : '不承诺收录'}</strong><p>${lang === 'en' ? 'Submission does not guarantee publication. We edit content for clarity and compliance before publishing.' : '投稿不等于收录。上架前我们会做合规与可读性编辑。'}</p></div>
    <a href="${mailto}" class="btn btn-primary btn-lg">✉️ ${lang === 'en' ? 'Email your submission' : '邮件提交投稿'} →</a>
    <p class="muted">${lang === 'en' ? 'Or copy this address:' : '或复制邮箱地址：'} <code>${mail}</code></p>
  </div>
</div>` });
  return layout({
    lang, title: lang === 'en' ? 'Submit a Platform' : '投稿平台',
    description: lang === 'en' ? 'Submit a legit side hustle platform for manual review and publication.' : '投稿靠谱副业平台，人工审核后上架。',
    keywords: '副业投稿,提交平台,submit platform', canonicalHref: '/submit.html', prefix, body
  });
}

// 隐私政策 /privacy.html
function buildPrivacy(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const paras = lang === 'en' ? [
    ['Last updated: 2026-11-19', ''],
    ['1. Information we collect', 'This is a static information site. We do not require registration and do not collect personal information such as your name, phone number or ID. If you email us, we only use that message to reply to you.'],
    ['2. Cookies and local storage', 'We use browser local storage only to remember your light/dark theme preference. We do not use advertising or tracking cookies.'],
    ['3. Third-party links', 'Outbound links to platforms are for reference. Those sites have their own privacy policies; we are not responsible for their data practices.'],
    ['4. Contact', 'For privacy questions, email ' + S.email + '.']
  ] : [
    ['最后更新：2026-11-19', ''],
    ['1. 我们收集的信息', '本站为静态信息站点，不要求注册，不收集姓名、电话、身份证等个人信息。你通过邮件联系我们时，我们仅用该信息回复你。'],
    ['2. Cookie 与本地存储', '我们仅用浏览器本地存储记住你的深浅色主题偏好，不使用广告或追踪 Cookie。'],
    ['3. 第三方链接', '站外平台链接仅供参考，这些网站有各自的隐私政策，我们对其数据处理不承担责任。'],
    ['4. 联系方式', '隐私相关问题请发邮件至 ' + S.email + '。']
  ];
  const content = paras.map(([h, p]) => `<h2>${esc(h)}</h2>${p ? `<p>${esc(p)}</p>` : ''}`).join('');
  const main = `<div class="portal-content">
  <article class="static-page"><header class="page-header"><div class="page-icon">🔒</div><h1>${lang === 'en' ? 'Privacy Policy' : '隐私政策'}</h1></header><div class="article-content">${content}</div></article>
</div>`;
  const body = portalShell({
    banner: `🔒 ${lang === 'en' ? 'Privacy Policy' : '隐私政策'}`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });
  return layout({
    lang, title: lang === 'en' ? 'Privacy Policy' : '隐私政策',
    description: lang === 'en' ? 'How this site handles your information.' : '本站如何处理你的信息。',
    keywords: '隐私政策,privacy policy', canonicalHref: '/privacy.html', prefix, body
  });
}

// 404 页
function build404(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const main = `<div class="portal-content">
  <div class="not-found">
    <div class="nf-emoji">🧭</div>
    <h1>404</h1>
    <h2>${t('notFound', lang)}</h2>
    <p>${t('notFoundDesc', lang)}</p>
    <a href="${link('/', lang, prefix)}" class="btn btn-primary">${t('backHome', lang)} →</a>
  </div>
</div>`;
  const body = portalShell({
    banner: `🧭 404`, tabs: siteTabs(lang, prefix), main, lang, prefix
  });
  return layout({
    lang, title: '404', description: t('notFoundDesc', lang),
    keywords: '', canonicalHref: '/404.html', prefix, body, showSearch: false
  });
}

/* ---------- SEO 文件 ---------- */

function buildSitemap() {
  const urls = [];
  const add = (href, lang, priority, changefreq) => {
    urls.push(`  <url>
    <loc>${absUrlLang(href, lang)}</loc>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${absUrlLang(href, 'zh')}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${absUrlLang(href, 'en')}"/>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`);
  };
  for (const lang of ['zh', 'en']) {
    add('/', lang, '1.0', 'daily');
    add('/all.html', lang, '0.8', 'daily');
    add('/platforms.html', lang, '0.9', 'weekly');
    add('/scams.html', lang, '0.9', 'daily');
    add('/blog.html', lang, '0.8', 'weekly');
    add('/submit.html', lang, '0.5', 'monthly');
    add('/about.html', lang, '0.5', 'monthly');
    add('/disclaimer.html', lang, '0.5', 'monthly');
    add('/privacy.html', lang, '0.5', 'monthly');
    for (const c of categories) add(`/category/${c.slug}.html`, lang, '0.7', 'weekly');
    for (const c of platforms.categories) add(`/platform/${c.id}.html`, lang, '0.8', 'weekly');
    for (const s of scams.scams) add(`/scam/${s.id}.html`, lang, '0.8', 'weekly');
    for (const c of blogColumns.columns) add(`/column/${c.id}.html`, lang, '0.7', 'weekly');
    for (const p of posts) add(`/post/${p.slug}.html`, lang, '0.8', 'monthly');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`;
}

function buildRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${BASE}/sitemap.xml
`;
}

function buildRss(lang) {
  const all = sortedPosts().slice(0, 20);
  const name = lang === 'en' ? S.nameEn : S.name;
  const desc = lang === 'en' ? S.descriptionEn : S.description;
  const items = all.map(p => {
    const title = lang === 'en' ? p.titleEn : p.title;
    const excerpt = lang === 'en' ? p.excerptEn : p.excerpt;
    return `    <item>
      <title>${esc(title)}</title>
      <link>${absUrlLang(`/post/${p.slug}.html`, lang)}</link>
      <guid isPermaLink="true">${absUrlLang(`/post/${p.slug}.html`, lang)}</guid>
      <description>${esc(excerpt)}</description>
      <pubDate>${new Date(p.date + 'T00:00:00Z').toUTCString()}</pubDate>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(name)}</title>
    <link>${absUrlLang('/', lang)}</link>
    <description>${esc(desc)}</description>
    <language>${lang === 'zh' ? 'zh-CN' : 'en'}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

function buildSearchIndex() {
  return JSON.stringify(posts.map(p => ({
    slug: p.slug,
    category: p.category,
    emoji: p.emoji,
    title: p.title,
    titleEn: p.titleEn,
    excerpt: p.excerpt,
    excerptEn: p.excerptEn,
    tags: p.tags,
    tagsEn: p.tagsEn || p.tags
  })));
}

function copyStatic() {
  if (fs.existsSync(PUBLIC)) {
    for (const f of fs.readdirSync(PUBLIC)) {
      const src = path.join(PUBLIC, f);
      if (fs.statSync(src).isFile()) {
        writeFile(f, fs.readFileSync(src, 'utf8'));
      }
    }
  }
  // 拷贝 assets
  for (const dir of ['css', 'js']) {
    const srcDir = path.join(ASSETS, dir);
    if (fs.existsSync(srcDir)) {
      for (const f of fs.readdirSync(srcDir)) {
        const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
        writeFile(`assets/${dir}/${f}`, content);
      }
    }
  }
  // 拷贝 images（二进制，直接复制）
  const imgDir = path.join(ASSETS, 'images');
  if (fs.existsSync(imgDir)) {
    const outImgDir = path.join(OUT, 'assets/images');
    ensureDir(outImgDir);
    for (const f of fs.readdirSync(imgDir)) {
      const src = path.join(imgDir, f);
      if (fs.statSync(src).isFile() && /\.(png|jpe?g|webp|gif|svg)$/i.test(f)) {
        fs.copyFileSync(src, path.join(outImgDir, f));
      }
    }
  }
  // OG 默认图（SVG）
  writeFile('assets/og-default.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><text x="600" y="300" font-size="120" text-anchor="middle">💰</text><text x="600" y="420" font-size="56" fill="#fff" font-family="sans-serif" font-weight="bold" text-anchor="middle">${esc(S.name)} · ${esc(S.nameEn)}</text><text x="600" y="480" font-size="28" fill="#e0e7ff" font-family="sans-serif" text-anchor="middle">${esc(S.tagline)}</text></svg>`);
}

/* ---------- 执行 ---------- */

function main() {
  console.log('🚀 开始构建副业掘金博客...');
  safeRemoveDir(OUT);
  ensureDir(OUT);

  copyStatic();

  // 中文页面（根目录）
  writeFile('index.html', buildHome('zh'));
  writeFile('all.html', buildAll('zh'));
  writeFile('platforms.html', buildPlatformsIndex('zh'));
  writeFile('scams.html', buildScamsIndex('zh'));
  writeFile('blog.html', buildBlogIndex('zh'));
  writeFile('submit.html', buildSubmit('zh'));
  writeFile('about.html', buildStaticPage('about', 'zh'));
  writeFile('disclaimer.html', buildStaticPage('disclaimer', 'zh'));
  writeFile('privacy.html', buildPrivacy('zh'));
  writeFile('404.html', build404('zh'));

  // 平台 / 骗局 / 专栏页（中文）
  for (const c of platforms.categories) writeFile(`platform/${c.id}.html`, buildPlatformCategory(c, 'zh'));
  for (const s of scams.scams) writeFile(`scam/${s.id}.html`, buildScam(s, 'zh'));
  for (const c of blogColumns.columns) writeFile(`column/${c.id}.html`, buildBlogColumn(c, 'zh'));

  // 英文页面（/en/）
  writeFile('en/index.html', buildHome('en'));
  writeFile('en/all.html', buildAll('en'));
  writeFile('en/platforms.html', buildPlatformsIndex('en'));
  writeFile('en/scams.html', buildScamsIndex('en'));
  writeFile('en/blog.html', buildBlogIndex('en'));
  writeFile('en/submit.html', buildSubmit('en'));
  writeFile('en/about.html', buildStaticPage('about', 'en'));
  writeFile('en/disclaimer.html', buildStaticPage('disclaimer', 'en'));
  writeFile('en/privacy.html', buildPrivacy('en'));
  writeFile('en/404.html', build404('en'));

  // 平台 / 骗局 / 专栏页（英文）
  for (const c of platforms.categories) writeFile(`en/platform/${c.id}.html`, buildPlatformCategory(c, 'en'));
  for (const s of scams.scams) writeFile(`en/scam/${s.id}.html`, buildScam(s, 'en'));
  for (const c of blogColumns.columns) writeFile(`en/column/${c.id}.html`, buildBlogColumn(c, 'en'));

  // 文章页
  for (const p of posts) {
    writeFile(`post/${p.slug}.html`, buildPost(p, 'zh'));
    writeFile(`en/post/${p.slug}.html`, buildPost(p, 'en'));
  }

  // 分类页
  for (const c of categories) {
    writeFile(`category/${c.slug}.html`, buildCategory(c, 'zh'));
    writeFile(`en/category/${c.slug}.html`, buildCategory(c, 'en'));
  }

  // SEO / 搜索
  writeFile('sitemap.xml', buildSitemap());
  writeFile('robots.txt', buildRobots());
  writeFile('rss.xml', buildRss('zh'));
  writeFile('en/rss.xml', buildRss('en'));
  writeFile('feed.xml', buildRss('zh'));
  writeFile('search-index.json', buildSearchIndex());

  // 统计
  const count = (ext, dir = OUT) => {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) n += count(ext, p);
      else if (e.name.endsWith(ext)) n++;
    }
    return n;
  };
  console.log('✅ 构建完成！');
  console.log(`   文章页: ${posts.length * 2} 个`);
  console.log(`   分类页: ${categories.length * 2} 个`);
  console.log(`   HTML 总页数: ${count('.html')} 个`);
  console.log(`   输出目录: ${OUT}`);
}

main();
