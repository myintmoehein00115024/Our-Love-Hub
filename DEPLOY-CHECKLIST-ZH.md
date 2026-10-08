# 新 GitHub 账号发布检查单

1. 前往 https://github.com/signup ，自行使用 myintmoehein00115024@gmail.com 注册并验证邮箱；设置新的 GitHub 用户名。
2. 建立仓库 `our-love-hub`，上传这个 ZIP 解压后**内部的全部内容**，不要多套一层文件夹。
3. GitHub 仓库 Settings → Pages → Deploy from a branch → main → /(root) → Save。
4. 打开 `https://新用户名.github.io/our-love-hub/` 检查首页和四个模块。
5. 聊天：将 `Always-Yours-Chat/worker.js` 中 `YOUR-NEW-GITHUB-USERNAME` 替换为新用户名并重新部署 Cloudflare Worker；否则新来源可能被 CORS 拦截。数据库 D1 和照片 KV 的数据不会因为 GitHub 上传而转移。
6. 旅程相册：原有 Cloudflare Worker 和 Google Drive 仍保留旧配置；检查 Google OAuth 授权 JavaScript 来源以及后台 CORS 新来源设置。未完成前云端功能可能无法工作。
7. 公开前检查照片、私人内容和第三方音频版权。GitHub Pages 站点不能当作加密私人存储；仅将仓库设为 Private 并不意味着网站只有你可访问。
8. 在电脑与手机检查：全部链接、子页面、PWA、登录、消息、图片、相册云端同步。此包仅做离线静态结构检查，没有替你新建账号或上线。

## 年份命名

- 2025 年给女朋友做的：`2025-For-My-Girlfriend/`（原 ThinThin）
- 2026 年给女朋友做的：`2026-For-My-Girlfriend/`（原 PuTuTuLay）
- 上传合并包时仍使用同一个 GitHub Pages 仓库，首页 `index.html` 已更改跳转链接。


## 恋爱纪念日核对（2024 年 3 月 23 日）

- [ ] Our Journey 的首页、章节文字均为 **23 Mar 2024**，相恋天数基于 **2024-03-23**。
- [ ] 2025 年生日网站的时间线、Love 页面与情书日期均为 **23 March 2024**。
- [ ] 2025 年的故事日期验证输入 **2024-03-23** 能通过；旧日期不能通过。
- [ ] 浏览器/PWA 重新加载后显示新日期；2025/2026 年的 8 月 23 日生日不变。
- [ ] Cloudflare、Google Drive 等线上服务需部署后单独验证。
