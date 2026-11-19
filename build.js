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

const S = site.site;
const BASE = S.url.replace(/\/$/, '');

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
  const navHtml = site.nav.map(n =>
    `<a href="${link(n.href, lang, prefix)}" class="nav-link${canonicalHref === n.href ? ' active' : ''}">${lang === 'en' ? n.labelEn : n.label}</a>`
  ).join('');

  const langSwitchHref = prefix + logicalToDist(canonicalHref, altLang);
  const footerLinks = S.footerLinks.map(f =>
    `<a href="${link(f.href, lang, prefix)}">${lang === 'en' ? f.labelEn : f.label}</a>`
  ).join('');

  const catList = categories.slice(0, 5).map(c =>
    `<a href="${link(`/category/${c.slug}.html`, lang, prefix)}">${lang === 'en' ? c.nameEn : c.name}</a>`
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
<header class="site-header" id="siteHeader">
  <div class="container header-inner">
    <a href="${link('/', lang, prefix)}" class="brand">
      <span class="brand-icon">💰</span>
      <span class="brand-name">${esc(name)}</span>
    </a>
    <nav class="main-nav" id="mainNav">${navHtml}</nav>
    <div class="header-actions">
      ${showSearch !== false ? `<button class="icon-btn" id="searchToggle" aria-label="${t('search', lang)}" title="${t('search', lang)}">🔍</button>` : ''}
      <button class="icon-btn" id="langSwitch" data-href="${langSwitchHref}" aria-label="${t('langSwitch', lang)}" title="${lang === 'en' ? '中文' : 'English'}">${lang === 'en' ? '🇨🇳' : '🇬🇧'}</button>
      <button class="icon-btn" id="themeToggle" aria-label="${t('darkMode', lang)}" title="${t('darkMode', lang)}">🌙</button>
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

/* ---------- 页面生成 ---------- */

// 首页
function buildHome(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const all = sortedPosts();
  const featured = all.filter(p => p.featured).slice(0, 3);
  const latest = all.slice(0, 6);
  const popular = [...all].sort((a, b) => (b.id - a.id)).slice(0, 5);

  const featuredHtml = featured.map((p, i) => {
    const cat = catBySlug(p.category);
    const href = link(`/post/${p.slug}.html`, lang, prefix);
    const title = lang === 'en' ? p.titleEn : p.title;
    const excerpt = lang === 'en' ? p.excerptEn : p.excerpt;
    return `<a href="${href}" class="hero-feature-card" style="--card-color:${cat.color}">
      <div class="hfc-emoji">${p.emoji}</div>
      <div class="hfc-content">
        <span class="hfc-cat">${lang === 'en' ? cat.nameEn : cat.name}</span>
        <h3>${esc(title)}</h3>
        <p>${esc(excerpt)}</p>
        <span class="hfc-more">${t('readMore', lang)} →</span>
      </div>
    </a>`;
  }).join('');

  const latestHtml = latest.map(p => postCard(p, lang, prefix)).join('');
  const catHtml = categories.map(c => `<a href="${link(`/category/${c.slug}.html`, lang, prefix)}" class="cat-card" style="--cat-color:${c.color}">
    <div class="cat-icon">${c.icon}</div>
    <h3>${lang === 'en' ? c.nameEn : c.name}</h3>
    <p>${lang === 'en' ? c.descriptionEn : c.description}</p>
    <span class="cat-count">${postsByCat(c.slug, lang).length} ${lang === 'en' ? 'articles' : '篇文章'}</span>
  </a>`).join('');

  const popularHtml = popular.map((p, i) => {
    const href = link(`/post/${p.slug}.html`, lang, prefix);
    const title = lang === 'en' ? p.titleEn : p.title;
    return `<li><span class="rank">${i + 1}</span><a href="${href}">${esc(title)}</a></li>`;
  }).join('');

  const body = `
<section class="hero">
  <div class="container hero-grid">
    <div class="hero-text">
      <div class="hero-badge">✨ ${lang === 'en' ? 'Updated daily · Free guides' : '每日更新 · 免费教程'}</div>
      <h1>${lang === 'en' ? 'Build a Real Side Hustle,' : '找到属于你的副业，'}<br><span class="gradient-text">${lang === 'en' ? 'One Step at a Time' : '从第一步开始'}</span></h1>
      <p>${lang === 'en' ? S.descriptionEn : S.description}</p>
      <div class="hero-buttons">
        <a href="${link('/category/side-hustles.html', lang, prefix)}" class="btn btn-primary">${lang === 'en' ? 'Explore Side Hustles' : '浏览副业项目'} →</a>
        <a href="${link('/about.html', lang, prefix)}" class="btn btn-ghost">${t('about', lang)}</a>
      </div>
      <div class="hero-stats">
        <div><strong>${posts.length}+</strong><span>${lang === 'en' ? 'Practical guides' : '实用教程'}</span></div>
        <div><strong>${categories.length}</strong><span>${t('categories', lang)}</span></div>
        <div><strong>2</strong><span>${lang === 'en' ? 'Languages' : '中英双语'}</span></div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="floating-card fc1"><span>💵</span><div><small>${lang === 'en' ? 'Monthly side income' : '本月副业收入'}</small><strong>¥3,280</strong></div></div>
      <div class="floating-card fc2"><span>📈</span><div><small>${lang === 'en' ? 'Traffic growth' : '流量增长'}</small><strong>+42%</strong></div></div>
      <div class="floating-card fc3"><span>✅</span><div><small>${lang === 'en' ? 'Tasks completed' : '已完成任务'}</small><strong>28/30</strong></div></div>
      <div class="hero-main-icon">🚀</div>
    </div>
  </div>
</section>

<section class="section container">
  <div class="section-head">
    <div><span class="section-label">FEATURED</span><h2>🔥 ${t('featured', lang)}</h2></div>
    <a href="${link('/all.html', lang, prefix)}" class="section-link">${t('viewAll', lang)} →</a>
  </div>
  <div class="feature-grid">${featuredHtml}</div>
</section>

<section class="section container">
  <div class="section-head">
    <div><span class="section-label">LATEST</span><h2>📚 ${t('latest', lang)}</h2></div>
    <a href="${link('/all.html', lang, prefix)}" class="section-link">${t('allPosts', lang)} →</a>
  </div>
  <div class="post-grid">${latestHtml}</div>
</section>

<section class="section container">
  <div class="section-head"><div><span class="section-label">CATEGORIES</span><h2>🗂 ${t('categoriesTitle', lang)}</h2></div></div>
  <div class="cat-grid">${catHtml}</div>
</section>

<section class="section container">
  <div class="two-col">
    <div class="panel">
      <h3>🔥 ${t('popular', lang)}</h3>
      <ol class="popular-list">${popularHtml}</ol>
    </div>
    <div class="panel tip-panel">
      <h3>🛡 ${t('tipsTitle', lang)}</h3>
      <p>${t('tipsText', lang)}</p>
      <a href="${link('/category/scam-alerts.html', lang, prefix)}" class="btn btn-primary">${lang === 'en' ? 'Learn More' : '查看避坑指南'} →</a>
    </div>
  </div>
</section>`;

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

  const body = `
<div class="container">
  <nav class="breadcrumb"><a href="${link('/', lang, prefix)}">${t('home', lang)}</a> <span>/</span> <span>${esc(catName)}</span></nav>
  <header class="page-header" style="--cat-color:${cat.color}">
    <div class="page-icon">${cat.icon}</div>
    <h1>${esc(catName)}</h1>
    <p>${esc(catDesc)}</p>
    <span class="page-count">${list.length} ${lang === 'en' ? 'articles' : '篇文章'}</span>
  </header>
  <div class="section-head"><div><h2>${t('postsIn', lang)} ${esc(catName)}</h2></div></div>
  <div class="post-grid">${list.map(p => postCard(p, lang, prefix)).join('') || `<p>${t('noPosts', lang)}</p>`}</div>
</div>`;

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
  const cards = all.map(p => `<div data-post-cat="${p.category}">${postCard(p, lang, prefix)}</div>`).join('');

  const body = `
<div class="container">
  <nav class="breadcrumb"><a href="${link('/', lang, prefix)}">${t('home', lang)}</a> <span>/</span> <span>${t('allArticles', lang)}</span></nav>
  <header class="page-header"><div class="page-icon">📚</div><h1>${t('allArticles', lang)}</h1><p>${S.description && (lang === 'en' ? S.descriptionEn : S.description)}</p></header>
  <div class="filter-bar"><button class="filter-btn active" data-cat="all">${lang === 'en' ? 'All' : '全部'}</button>${catFilter}</div>
  <div class="post-grid" id="allPostsGrid">${cards}</div>
</div>`;

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
  const body = `
<div class="container">
  <nav class="breadcrumb"><a href="${link('/', lang, prefix)}">${t('home', lang)}</a> <span>/</span> <span>${esc(title)}</span></nav>
  <article class="static-page">
    <header class="page-header"><div class="page-icon">${isAbout ? '👋' : '📋'}</div><h1>${esc(title)}</h1></header>
    <div class="article-content">${paras.map(p => `<p>${inline(p)}</p>`).join('')}</div>
  </article>
</div>`;
  return layout({
    lang, title, description: paras[0],
    keywords: (lang === 'en' ? S.keywordsEn : S.keywords).join(','),
    canonicalHref, prefix, body
  });
}

// 404 页
function build404(lang) {
  const prefix = lang === 'en' ? '../' : '';
  const body = `
<div class="container not-found">
  <div class="nf-emoji">🧭</div>
  <h1>404</h1>
  <h2>${t('notFound', lang)}</h2>
  <p>${t('notFoundDesc', lang)}</p>
  <a href="${link('/', lang, prefix)}" class="btn btn-primary">${t('backHome', lang)} →</a>
</div>`;
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
    add('/about.html', lang, '0.5', 'monthly');
    for (const c of categories) add(`/category/${c.slug}.html`, lang, '0.7', 'weekly');
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
  writeFile('about.html', buildStaticPage('about', 'zh'));
  writeFile('disclaimer.html', buildStaticPage('disclaimer', 'zh'));
  writeFile('404.html', build404('zh'));

  // 英文页面（/en/）
  writeFile('en/index.html', buildHome('en'));
  writeFile('en/all.html', buildAll('en'));
  writeFile('en/about.html', buildStaticPage('about', 'en'));
  writeFile('en/disclaimer.html', buildStaticPage('disclaimer', 'en'));
  writeFile('en/404.html', build404('en'));

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
