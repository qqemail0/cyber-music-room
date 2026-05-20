# Firebase 实时模式配置

GitHub Pages 只能托管静态文件。要跨设备显示在线用户、实时聊天、云端保存上传歌曲，需要接 Firebase。

## 1. 创建 Firebase 项目

1. 打开 Firebase Console。
2. 创建 Web App。
3. 开启 Realtime Database。
4. 开启 Storage。
5. 复制 Web App config。

## 2. 修改配置

编辑 `public/firebase-config.js`，把 `window.NEON_FIREBASE_CONFIG = null;` 替换为你的配置：

```js
window.NEON_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Firebase Web config 不是服务器密钥，但数据库和存储规则必须限制好。

## 3. Realtime Database 规则示例

```json
{
  "rules": {
    "presence": {
      ".read": true,
      ".write": true
    },
    "chat": {
      ".read": true,
      ".write": true
    },
    "songs": {
      ".read": true,
      ".write": true
    }
  }
}
```

公开站点初期可以这样测试。正式运营建议加匿名登录、频率限制、内容审核和文件大小限制。

## 4. Storage 规则示例

```txt
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /songs/{fileName} {
      allow read: if true;
      allow write: if request.resource.size < 30 * 1024 * 1024
        && request.resource.contentType.matches('audio/.*');
    }
  }
}
```

## 5. 聊天记录清理

前端每分钟会清理超过 120 分钟的本地聊天，并尝试删除 Firebase 中过期消息。正式生产环境更建议用 Cloud Functions 定时清理。
