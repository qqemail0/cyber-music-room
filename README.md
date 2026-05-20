# Neon Pulse 在线听歌房

一个可部署到 GitHub Pages 的赛博朋克在线听歌网站。

## 功能

- 内置 3 首原创合成曲，无版权问题。
- 用户可上传音频，保存到当前浏览器 IndexedDB。
- 可选 Firebase 模式：跨设备在线用户、实时聊天、云端保存上传歌曲。
- 在线用户列表：昵称、IP、在线心跳。
- 聊天频道：120 分钟 TTL 自动清理。
- 赛博朋克视觉：霓虹面板、扫描线、音频可视化。

## 本地运行

```powershell
python -m http.server 8090 -d public
```

打开：

```text
http://127.0.0.1:8090/
```

## 验证

```powershell
node .\tests\verify-site.mjs
```

## GitHub Pages 部署

推送到 GitHub 后，仓库会通过 `.github/workflows/deploy-pages.yml` 自动部署 `public/`。

## Firebase 实时模式

见：[docs/firebase-setup.md](docs/firebase-setup.md)

不配置 Firebase 时，网站仍可在 GitHub Pages 上运行，但在线用户和聊天主要是当前浏览器/多标签演示；跨设备实时同步需要 Firebase。
