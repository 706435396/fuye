# 💰 副业掘金 · GitHub + Cloudflare Pages 双语博客

一个零成本、SEO 友好、中英双语的副业赚钱博客。纯静态 HTML，构建脚本从 JSON 数据源自动生成，托管在 GitHub，部署在 Cloudflare Pages（全球 CDN + 免费 SSL）。

> 站点名称、域名、邮箱等占位信息可在 `data/site.json` 一处修改。

---

## 一、特性一览

| 特性 | 说明 |
|------|------|
| 🌍 中英双语 | 中文在根路径 `/`，英文在 `/en/`，互指 hreflang |
| ⚡ 纯静态 | 无后端、无数据库，访问快、安全感强、托管免费 |
| 🔍 SEO 完备 | sitemap.xml / robots.txt / RSS / JSON-LD 结构化数据 / canonical |
| 🎨 现代 UI | 渐变科技风、响应式、深浅色切换、搜索、分类筛选、文章目录 |
| 📝 数据驱动 | 文章/分类/站点信息全部在 `data/*.json`，改数据即改站 |
| 🔄 自动部署 | push 到 GitHub 自动构建上线（Cloudflare Pages） |

---

## 二、目录结构

```
副业网/
├── build.js                  # 构建脚本（读 JSON → 生成 dist/）
├── package.json              # npm 脚本
├── data/
│   ├── site.json             # 站点名/域名/导航/SEO 关键词
│   ├── categories.json       # 分类
│   └── posts.json            # 文章（含中英双语正文）
├── assets/
│   ├── css/style.css         # 样式
│   └── js/main.js            # 交互
├── public/
│   ├── _headers              # CF 安全头 + 缓存
│   └── _redirects            # 重定向规则
├── .github/workflows/
│   └── deploy.yml.disabled   # Actions 部署备用方案
├── dist/                     # 构建产物（部署目录，勿手改）
└── README.md
```

---

## 三、本地运行

```bash
# 1. 安装依赖（本项目零运行时依赖，此步可跳过构建）
#    构建脚本仅用 Node 内置模块，Node >= 18 即可

# 2. 构建
npm run build
# 输出：dist/ 目录，46+ 个 HTML 页面

# 3. 本地预览
npm run dev
# 打开 http://localhost:3000
```

---

## 四、添加 / 修改文章

编辑 `data/posts.json`，复制一个对象并修改字段：

```json
{
  "id": 11,
  "slug": "my-new-post",
  "category": "side-hustles",
  "tags": ["副业", "新手"],
  "tagsEn": ["Side Hustle", "Beginner"],
  "date": "2026-11-20",
  "readTime": 8,
  "featured": false,
  "emoji": "💡",
  "title": "中文标题",
  "titleEn": "English Title",
  "excerpt": "中文摘要",
  "excerptEn": "English excerpt",
  "content": {
    "zh": [
      { "type": "p",   "text": "段落文字" },
      { "type": "h2",  "text": "二级标题" },
      { "type": "ul",  "items": ["要点一", "要点二"] },
      { "type": "ol",  "items": ["步骤一", "步骤二"] },
      { "type": "tip", "title": "提示", "text": "提示内容" },
      { "type": "table", "head": ["列1","列2"], "rows": [["A","B"]] },
      { "type": "quote", "text": "引用", "by": "作者" }
    ],
    "en": [ ... 同上，英文内容 ... ]
  }
}
```

然后 `npm run build` 重新生成即可。`category` 需对应 `categories.json` 里的 slug。

---

## 五、部署到 GitHub + Cloudflare Pages（推荐路径）

### 方案 A：Cloudflare Pages 直连 GitHub（推荐，无需 Actions）

1. **建 GitHub 仓库**
   - 登录 GitHub → New repository，例如 `fuyemoney-blog`
   - 本地初始化并推送：
     ```bash
     cd 项目目录
     git init
     git add .
     git commit -m "init: side hustle blog"
     git branch -M main
     git remote add origin https://github.com/你的用户名/fuyemoney-blog.git
     git push -u origin main
     ```

2. **连接 Cloudflare Pages**
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
   - 选择刚才的 GitHub 仓库
   - 构建配置填写：
     - **Build command**: `npm run build`
     - **Build output directory**: `dist`
     - **Root directory**: `/`（默认）
   - 点击 **Save and Deploy**，等待首次部署完成，得到 `https://xxx.pages.dev`

3. **后续更新**：只要 `git push`，Cloudflare 会自动重新构建部署。

### 方案 B：GitHub Actions 部署（备用）

1. 在 Cloudflare 获取 **Account ID**（Dashboard 右侧栏）和 **API Token**（My Profile → API Tokens → Edit Cloudflare Workers 模板，含 Pages 权限）
2. 仓库 → Settings → Secrets and variables → Actions，新增两个 secret：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. 把 `.github/workflows/deploy.yml.disabled` 重命名为 `deploy.yml`
4. 修改其中的 `--project-name=fuyemoney-blog` 为你的项目名，push 即触发部署

---

## 六、绑定自定义域名

1. Cloudflare Pages → 你的项目 → **Custom domains** → **Set up a custom domain**
2. 输入域名（如 `blog.example.com`），按提示添加 DNS 记录（CNAME 指向 `xxx.pages.dev`）
3. Cloudflare 自动签发 SSL 证书，几分钟内生效
4. **重要**：修改 `data/site.json` 里的 `url` 为你的正式域名，重新构建部署，确保 sitemap / canonical 指向正确域名

---

## 七、提交搜索引擎收录

1. 打开 [Google Search Console](https://search.google.com/search-console) → 添加资源（域名或前缀）
2. 站点地图提交：`https://你的域名/sitemap.xml`
3. 打开 [Bing Webmaster Tools](https://www.bing.com/webmasters) 同样提交 sitemap
4. 已在 GSC 的可使用「网址检查 → 请求编入索引」加速收录

---

## 八、SEO 文件说明

| 文件 | 作用 |
|------|------|
| `sitemap.xml` | 42 条 URL，含中英双语 hreflang 互指 |
| `robots.txt` | 允许抓取，声明 sitemap 位置 |
| `rss.xml` / `en/rss.xml` | 中英 RSS 订阅源 |
| `feed.xml` | 中文源兼容路径 |
| JSON-LD | 首页 Blog、文章页 BlogPosting 结构化数据 |
| canonical + hreflang | 每页规范链接，避免中英重复内容 |

---

## 九、凭证安全实践（重要）

- **绝不**把 API Token、密钥提交进仓库或写入 `.git/config`
- 需要临时凭证推送时，用一次性内联方式：
  ```bash
  git -c http.extraheader="AUTHORIZATION: basic <一次性token>" push origin main
  ```
  用完即弃，不留痕
- GitHub OAuth 可在 WorkBuddy IDE 左侧栏连接器管理
- 本项目静态博客不需要任何运行时密钥

---

## 十、常见问题

**Q：英文页面在哪里？**
A：`/en/`，例如 `https://域名/en/post/best-side-hustles-2026.html`。首页右上角 🇬🇧/🇨🇳 按钮可切换。

**Q：为什么访问 `xxx.pages.dev/en` 报错？**
A：`_redirects` 已配置 `/en → /en/index.html` 的 301，正常访问 `/en/` 即可。

**Q：改了数据没生效？**
A：重新 `npm run build` 并 push；或确认 Cloudflare 部署成功。

**Q：可以挂广告吗？**
A：静态页可直接插入广告联盟的 `<script>`：在 `build.js` 的 `layout()` 模板中 `</body>` 前添加即可，或后续改造为数据配置。

---

© 2026 副业掘金 · 用行动积累长期资产，而非一夜暴富的捷径。
