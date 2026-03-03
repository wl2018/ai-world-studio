# AI World Studio

AI World Studio 是一個 AI 驅動的角色扮演世界模擬器。你可以建立自己的世界、描述今天想做什麼，AI 助理會在世界中找到合適的情境並邀請你參與——然後你就直接和世界裡的角色聊天互動，就像真的活在那個世界一樣。

## 功能特色

- 🌐 **多世界管理**：建立並管理多個獨立的 AI 世界，每個世界有自己的設定與歷史
- 🎭 **有記憶的角色**：角色跨越每次回合持續存在，以每回合互動摘要作為長期記憶，效果自然且穩定
- 💬 **兩階段互動設計**：第一階段告訴 AI 助理你今天想做什麼，助理找到情境後邀請你進入；第二階段沉浸式與角色直接聊天，如同真實對話
- 📜 **永久回合紀錄**：所有歷史回合完整保存，每回合自動生成標題與摘要，可隨時回顧
- 🔌 **OpenAI 相容 API**：可使用本地模型或任何支援 Assistant Prefill 能力的節點
- 🌏 **多語言提示詞**：內建繁體中文、簡體中文、英文 prompt，自動依設定語言運作

## 快速啟動

### 後端

```bash
cd backend
npm install
cp .env.example .env
# 編輯 .env，填入你的 AI API 設定
npm run dev
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端預設在 `http://localhost:5173`，API 請求自動代理至後端 `3001` port。`npm` 也可替換成 `pnpm`。

## 模型節點設定

**第一階段**：須支援 Function Calling，包含大部分的線上服務商，和大部分本地模型伺服器：

- KoboldCpp
- Ollama
- LM Studio
- vLLM
- ...

**第二階段**：

第二階段角色互動的效果，取決於節點支援的 API 能力。請依照你的節點能力選擇 `PHASE2_PROMPTING_METHOD`：

| 方法 | 說明 | 適用情境 |
|------|------|----------|
| `0` | 標準 `/v1/chat/completions`，無 prefill | 通用 fallback，效果較基本 |
| `1` | `/v1/chat/completions` + assistant prefill | **建議優先嘗試**，需節點支援 assistant prefill |
| `3` / `4` / `5` | `/v1/completions` 原始文字補全模式 | 進階用法，需節點支援 |

## 環境設定

產生 JWT_SECRET：

```bash
dd if=/dev/urandom bs=1 count=33 2>/dev/null | base64
```

複製 `backend/.env.example` 為 `backend/.env`，至少填入以下欄位：

```env
PORT=3001
JWT_SECRET=your-super-secret-jwt-key

BASE_URL=https://127.0.0.1:5000/v1
API_KEY=your-api-key-here
MODEL=
```

進階設定（可選）：

- **分離第二階段模型**：設定 `PHASE2_BASE_URL` / `PHASE2_MODEL` 可讓第一、二階段使用不同模型
- **針對推理模型**：使用 `PHASE2_PROMPTING_METHOD=1` 時，建議同時設定 `PHASE2_ASSISTANT_PERFILL_PREFIX="<think>\n\n</think>\n\n"`，避免 `<think>` 標籤干擾第二階段對話。第一階段也可設定 `ASSISTANT_PREFILL_PREFIX` 跳過思考過程以加快速度（推理對摘要和角色扮演幫助有限）
- **自動開場白**：`PHASE1_GREETING=n` 讓AI助理在前 n 個回合建立時主動打招呼，設 `1` 即只有第一回合，設 `-1` 則每次都打招呼
- **自定義情境種類**：預設只有線上聊天和面對面聊天兩種選項，可以自行編輯`user-prompts.yaml`增加更多與角色互動的模式

## 使用流程

1. 註冊帳號並登入
2. 建立新世界（設定名稱、描述、你在世界中的名字）
3. 開始新回合，進入**第一階段**
4. 告訴助理你想做什麼——例如「我想去咖啡廳」或「找個老朋友敘舊」
5. 助理在世界中找到情境後，會自然地邀請你加入（不會說「我幫你產生一個情境」）
6. 點擊「進入世界」，開始**第二階段**沉浸式對話
7. 對話結束後按「結束回合」，系統自動生成摘要存入角色記憶
8. 下次回來，角色仍然記得你們之前發生的一切

## 技術架構

- **前端**：Vue 3 + Vite + Pinia + Vue Router + vue-i18n
- **後端**：Express.js（ESM）+ better-sqlite3
- **認證**：JWT
- **Prompt 管理**：YAML 多語言結構 + 自定義模板規則

## 聲明

本專案是透過AI產生的純文字虛擬聊天互動環境，並非現實世界的真實情況。請勿使用本專案進行任何違法行為。本專案僅原樣提供（請參看LICENSE檔案）。透過本專案程式產生的任何內容皆由使用者自行負責，與專案作者無關。
