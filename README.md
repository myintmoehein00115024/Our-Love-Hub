# Our Love Hub — consolidated GitHub Pages repository

This repository brings **four existing websites** into a single GitHub Pages deployment, while preserving each site's own assets, paths, service worker and PWA manifest.

| Area | URL beneath Pages repository |
|---|---|
| Shared home | `/` |
| Memories and journey | `/Our-Journey/` |
| Private chat frontend | `/Always-Yours-Chat/` |
| 2025 birthday gift (ThinThin) | `/2025-For-My-Girlfriend/` |
| 2026 birthday gift (PuTuTuLay) | `/2026-For-My-Girlfriend/` |

## New GitHub account and upload

1. Go to https://github.com/signup and **register yourself** using `myintmoehein00115024@gmail.com`. Confirm the GitHub verification email. GitHub username is a separate choice and need not match the email address.
2. On that account, create an empty **private** repository named `our-love-hub` (or choose another name). Do not create a second README at repository creation.
3. Unzip the supplied package. Upload **its contents** (including `index.html` and all four site directories) to the repository root with GitHub's **Add file → Upload files**; commit the changes. Alternatively push the folder with Git.
4. Under **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/(root)`, then save. Depending on account and Pages eligibility, a **public repo** may be required; decide whether publishing your personal photos and messages is appropriate *before* making it public.
5. Visit `https://YOUR-NEW-GITHUB-USERNAME.github.io/our-love-hub/`. If your repo has another name, change the final URL segment.

## Important: cloud services are NOT migrated automatically

* `Always-Yours-Chat` requires its original Cloudflare Worker, D1 database and KV namespace. Merely copying static files does **not** migrate cloud data, create accounts or deploy Cloudflare services. After choosing the new username, replace `YOUR-NEW-GITHUB-USERNAME` inside `Always-Yours-Chat/worker.js` in the allowed-origin list, then redeploy this Worker via your own Cloudflare account. Check whether the Cloudflare Worker itself uses authentication and preserve existing stored data. The original origin is retained as a backward-compatible entry.
* `Our-Journey/drive-config.js` still points at its **existing** Cloudflare Worker and Google Drive folder and uses the existing public Google OAuth client ID. The OAuth JavaScript authorized origins and backend CORS/allowed origins may need updates for `https://YOUR-NEW-GITHUB-USERNAME.github.io` before Drive features work on the new site. **Do not put OAuth client secrets, refresh tokens or API secrets in GitHub.**
* Inspect content before making any of these files public. This package includes personal-looking photographs and media, as well as the existing Worker configuration IDs, which may not belong in a public repo.
* Each web app has its own service worker scoped to its subdirectory, preventing root-scope collisions. Service worker caches may retain an older offline copy until refresh.
* The previous GitHub cross-links found in `Our-Journey/index.html` and `PuTuTuLay/index.html` have been changed to relative links. Other external URLs (e.g. Cloudflare Worker endpoints and third-party APIs) are intentionally retained.

## Checks before production

Verify home navigation, journey gallery & cloud sync, chat login/send/read/photo/upload, birthday page and ThinThin subpages on desktop and phone. Confirm fresh-user PWA installs, refreshes and direct deep links. Live Cloudflare/Drive testing requires the corresponding service credentials, deployment and new origin allowlisting.

## 文件名称与年份对照

- `2025-For-My-Girlfriend/` = **2025 年给女朋友做的**（原 `ThinThin/`，2025 年 8 月 23 日生日礼物）
- `2026-For-My-Girlfriend/` = **2026 年给女朋友做的**（原 `PuTuTuLay/`，2026 年 8 月 23 日生日礼物）
- `Our-Journey/` 和 `Always-Yours-Chat/` 继续保留原名称和独立模块。

为避免 GitHub Pages 路径中文编码带来不便，文件夹名称采用英文，ZIP 包名与首页显示使用中文。
年号仅用于整理，不影响原项目的纪念日期、云端账号、登录数据和缓存标识。

## Anniversary correction / 恋爱纪念日修正

**Our relationship began on 23 March 2024 / 我们在 2024 年 3 月 23 日在一起。**

The previous incorrect date has been corrected in the Our Journey timeline,
its dynamic days-together counter, and all dated text in the 2025 birthday website.
The 2025 website's private story date question now expects **2024-03-23**; its page-access
session marker uses the same value. Cache versions were bumped for an offline update.
The 2025 and 2026 birthday dates (23 August) have **not** been changed.

检查：重新打开 2025 网站并用 **2024-03-23** 解锁；查看 2025 网站的相恋时间、
Our Journey 的相恋天数、首页时间线及恋爱纪念日文字。如浏览器显示旧内容，清除相应站点
的缓存或重新载入 PWA，然后再次检查。云端服务与已存储照片/聊天记录未修改。
