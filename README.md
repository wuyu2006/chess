# GAMBIT · Neural Chess

一个可在本地运行、断网也能玩的 3D 国际象棋。玩家可选择执白或执黑，对阵 DeepSeek、OpenAI、Claude、Gemini、Kimi、Qwen、GLM、Grok、OpenRouter，或使用内置离线引擎。

棋盘、32 枚棋子、贴图、Three.js、chess.js 全部存放在本地，运行时不依赖 CDN，也不需要 `npm install`。

## 功能

- 真实大理石 3D 棋具：Poly Haven “Chess Set”，32 枚独立棋子。
- 可旋转、缩放、翻转视角；默认自动摆到玩家一侧。
- 棋子移动、骑士弧线、王车易位、升变、吃子碎裂与镜头震动。
- 支持白方或黑方开局。
- 9 家云端模型厂商 + 内置离线引擎。
- 每回合只请求一次模型，使用紧凑 FEN、合法着法列表和 JSON 输出，控制 token 消耗。
- 模型不可用时自动由本地引擎接管。
- 悔棋、认输、将杀/逼和/和棋判定、棋谱、子力统计、局面评估。
- 深色响应式界面，桌面与手机布局都可用。

## 在线体验

打开 <https://wuyu2006.github.io/chess/> 即可直接游玩，无需安装。

GitHub Pages 是纯静态托管，不包含本地 Node 代理，因此网站版只支持「内置离线引擎」；想和 DeepSeek 等云端模型对弈，请在本地运行 `start.bat`。

## 快速开始

环境要求：**Node.js 18.17 或更高版本**。

1. 在项目根目录创建 `.env`（可从 `.env.example` 复制），填入 DeepSeek Key：

   ```ini
   DEEPSEEK_API_KEY=sk-你的密钥
   PORT=3000
   ```

2. 双击 `start.bat`，或在终端执行：

   ```powershell
   npm start
   ```

3. 浏览器打开 **http://localhost:3000**。

服务器只监听 `127.0.0.1`，DeepSeek Key 不会出现在前端代码或浏览器网络请求中。项目内的 `.env` 优先于系统环境变量，避免机器上同名变量指向其他账号。

如果只想离线下棋，不需要填写任何 Key：在开局界面选择“内置离线引擎”即可。

## 模型配置

### DeepSeek（推荐）

- 厂商：`DeepSeek`
- 模型：`deepseek-flash`（DeepSeek V4.1 Flash）
- Key 位置：服务端 `.env` 的 `DEEPSEEK_API_KEY`
- 设置面板中留空 Key 即可直接使用服务端配置。

### 其他厂商

在“API 与模型设置”中选择厂商、模型 ID，并填入对应 Key。除 DeepSeek 外，Key 保存在**本机浏览器 localStorage**，请求只发送给本地 Node 代理，再由代理转发给厂商。

支持：

`OpenAI` · `Anthropic` · `Google Gemini` · `Moonshot / Kimi` · `Alibaba / Qwen` · `Zhipu / GLM` · `xAI / Grok` · `OpenRouter`

也可以填写自定义 Base URL 和任意模型 ID。

### 深度思考

DeepSeek 深度思考默认关闭，以控制每步成本。开启后模型会先推理再落子，棋力更强但 token 消耗明显增加；如果推理耗尽输出预算，服务端会自动用一次非思考请求重试。

## 对弈操作

- 点击己方棋子，再点击目标格。
- 拖拽棋盘旋转，滚轮缩放；按钮可翻转视角。
- 兵到底线会弹出升变选择。
- “悔棋”会同时撤销 AI 和你自己的上一回合。
- 黑方开局时 AI 会先走第一步。
- 窄屏下点击底部“棋谱”按钮，可打开棋谱与 AI 评论抽屉；再次点击或按 Esc 关闭。

## Token 设计

每回合只发送：

- 当前 FEN
- 行棋方与回合数
- 上一步 SAN
- 当前所有合法着法 SAN
- 固定 JSON 输出要求

不发送历史聊天记录，不做多轮对话。DeepSeek 普通请求 `max_tokens` 为 180；OpenAI 使用 `max_completion_tokens` 以兼容推理模型；返回后由服务端校验着法合法性，非法或空响应会触发一次重试，仍失败则交给本地引擎。

## 离线模式

选择“内置离线引擎”后：

- 不发送任何 API 请求。
- 使用本地 alpha-beta 搜索与局面评估。
- 默认约 1.25 秒、深度 3；在低端设备上也能快速落子。
- 云端请求失败时也会自动切换到这套引擎。

## 目录

```text
chess/
├─ server.mjs                 零依赖本地服务器 + 模型代理
├─ start.bat                  Windows 启动脚本
├─ .env.example               环境变量模板
├─ docs/
│  ├─ index.html
│  ├─ styles.css
│  ├─ js/                     场景、对弈逻辑、AI 网关、引擎
│  ├─ assets/models/chess_set 本地 3D 棋具与贴图
│  └─ vendor/                 Three.js r187、chess.js 1.4.0
└─ README.md
```

## 排错

**页面打不开 / 端口被占用**

修改 `.env` 中的 `PORT`，然后重启 `npm start`。

**提示未配置 Key**

在设置面板填写 Key，或改用内置离线引擎。DeepSeek 还可以直接把 Key 放进 `.env` 并重启服务器。

**模型返回错误后仍能继续下棋**

这是预期行为：本地引擎会接管当前回合，界面会显示“本地接管”。

**改了 `.env` 不生效**

`.env` 在服务器启动时读取，修改后需要重启 `npm start`。

**第一次加载稍慢**

首次需要读取约 20 MB 的本地模型和 2K 贴图；之后由浏览器缓存加速。

## 第三方资源与许可

- **Poly Haven — Chess Set**：作者 Riley Queen，CC0。  
  https://polyhaven.com/a/chess_set  
  运行时使用的模型与贴图位于 `docs/assets/models/chess_set/`。
- **Three.js r187**：MIT License。  
  许可文本：`docs/vendor/THREE_LICENSE`。
- **chess.js 1.4.0**：BSD-2-Clause License。  
  许可文本：`docs/vendor/CHESSJS_LICENSE`。

音效由 Web Audio API 实时合成，没有额外音频素材。
