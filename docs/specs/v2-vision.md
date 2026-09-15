# V2 愿景与路线图 — Amazon AI Image Studio（所有者自用 → 公司推广）

> 文档类型：产品愿景 + 架构原则 + 分期路线 + 集成知识
> 日期：2026-09-14 · 来源：所有者口述愿景（同日会话记录）
> 地位：V2 期间的指导文档；v1.1 规格（`amazon-ai-image-studio-v1.1.md`）仍是 W1–W9 的事实源
> 面向：Kimi Code 接手会话（新上下文读完本文 + `docs/progress.md` 即可续作）

---

## 1. 所有者愿景（原话提炼）

- 亚马逊生图工具，**先个人使用，成熟后推广到公司**。
- **Agent 规划**：帮用户想一套图的卖点和场景图方案。
- **固定流程**：按向导填写意图 → AI 明白意图后自动生成一套图。
- **自由画布**：生成后可在节点画布自由修改；用户可自己拉节点生成任意图。
- **聊天 Agent**：画布旁边有聊天窗口，Agent 能操作画布节点生图。
- **流程化 + 自由操作并存，都在自由画布上实现。**

## 2. 架构原则（定案）

> **画布即产品。向导和聊天 Agent 都只是"画布的输入方式"，不是独立模式。**

1. 固定流程（向导）= Agent 帮你把图画出来：意图 → AI 规划 → 物化成画布工作流 → 逐节点执行。物化出的图和用户手拉的图**没有区别**。
2. 自由操作 = 同一画布的手工模式。
3. 聊天 Agent = 第三个操作者，与"向导""用户手"平级；它调用的工具就是画布自己的命令 API（加节点/连线/改配置/跑节点/撤销），**不是私有通道**。审计、计费、撤销天然统一（W4 Run/Attempt/credit 账本、W5 fingerprint/STALE 直接适用）。
4. **门禁做成开关，不删逻辑**：个人模式 = 门禁自动通过但全程留痕（`workspaces.auto_approve_gates`，V2-A 已落地）；公司模式 = 强制人工。Truth Pack / QA 的人工批准逻辑一行不删——那是向公司推广时的卖点。
5. **Agent 操作必须可逆、可见**：每轮 Agent 操作是一个可回滚批次（复用 W3-B1 revision snapshot；PR-2 命令层落地）。
6. **成本控制**：接 kie 是真金白银。Agent 会话需要"会话预算上限"（PR-4，复用 W4 预算闸门）。

## 3. 分期路线（每步独立 PR）

| PR | 内容 | 状态 |
|---|---|---|
| PR-3（先行） | **V2-A Planner Agent**：可插拔规划器（fake/kie）+ 意图向导 + autoApproveGates | ✅ DONE 2026-09-14，分支 `feat/v2-planner-agent`，PR #24 |
| PR-2 | **画布命令层 + 自由画布**：UI 画布操作收敛为命令式 API（addNode/connect/configure/run/undo）；节点配置下拉选素材（告别手抄 UUID）；支持空白画布自由搭建 | ⬜ 下一个 |
| PR-1 | **UI 重构**：样式体系（当前零 CSS 全内联）、素材缩略图、审核页真实看图、步骤导航、登录态导航 | ⬜ |
| PR-4 | **聊天 Agent 面板**：画布旁聊天窗，工具 = PR-2 命令层 + 会话预算上限 + 操作批次回滚 | ⬜ |

> 所有者指定 PR-3 先行；PR-2 是聊天 Agent 的工具底座，优先于 PR-1。

## 4. 关键技术决策

- **单 KIE_API_KEY 双用途**：生图（`IMAGE_PROVIDER=kie`，P2-A）+ 规划/聊天 LLM（`PLANNER_PROVIDER=kie`，V2-A）。
- **规划器安全设计**：7 镜骨架（槽位/顺序/比例/像素/QA 策略）永远由领域模板决定，LLM 只填创意字段（purpose/copy/must/mustNot）；槽位不匹配的 LLM 输出丢弃；Zod 校验。产品真实性原则在代码层锁死。
- **LLM 与图像 Provider 是两套适配器**，不混用（不同失败矩阵）。

## 5. kie.ai 集成知识（踩坑记录，别再踩）

- **图像**：异步任务流 `createTask` → poll/webhook（P2-A 已实现，见 `kie-adapter.ts`）。
- **LLM chat**：端点是 **路径含模型 slug**：`POST {base}/{model}/v1/chat/completions`（如 `https://api.kie.ai/gemini-3-flash/v1/chat/completions`）。**不是**统一 `/api/v1/chat/completions`（对 LLM 返回 "feature not supported"）。
- **错误信封**：kie 失败时常返回 **HTTP 200 + `{"code":4xx/5xx,"msg":...}`**，必须检查 body 的 `code`。
- 模型状态（2026-09-14 实测）：`gemini-3-flash` ✅ 可用；`gemini-2.5-flash` ❌ 服务端 500。模型 ID 以 https://kie.ai/market 为准。
- 消息 content 用 parts 数组 `[{type:'text',text:...}]`；`response_format: {type:'json_object'}` 可用。
- 余额查询：`GET /api/v1/chat/credit`（P2-A 已封装）。
- 真实冒烟脚本：`packages/providers/smoke-kie.mts`（需 `.env` 里有 KIE_API_KEY）。

## 6. 当前状态快照（2026-09-14）

- main：W1–W9 全部 VERIFIED（P2-A kie 生图 DONE）；最近合并 PR #21–23。
- 未合并：**PR #24**（V2-A planner agent），等新审稿流程（见 AGENTS.md V2 规则）。
- 本地 `.env`：已重写为中文分区版；`IMAGE_PROVIDER=kie`、`PLANNER_PROVIDER=kie`、`KIE_LLM_MODEL=gemini-3-flash` 均已生效；KIE_API_KEY 已填。
- 本地 DB：11 个迁移全部应用（含 `20260914010000_v2_auto_approve_gates`）。
- 本地 e2e（W2…W7 全链路）2026-09-14 PASS；kie 真实规划冒烟 PASS（7 简报，18.8s）。

## 7. 会话预算/费用提醒

kie 按 credits 计费。规划一次 ≈0.01 credits（gemini-3-flash 实测）。生图约 7 credits/张（文档估值）。聊天 Agent（PR-4）落地前必须配会话预算上限。
