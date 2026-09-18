# LibTV 底层逻辑拆解

> 调研对象：LibTV 官方 CLI `libtv` **v1.0.2**（`C:\Users\Administrator\.libtv\libtv`）
> 调研时间：2026-09-18；调研账号：用户「原野小马」，活跃团队账户「视觉组」（专业版团队VIP，teamId 3984）
> 证据目录：本文中 `NN-*.json/txt` 均指 `libtv-recon/` 目录下的原始返回文件（与本文同目录）。
> 所有结论以 **CLI 实际输出** 为准；skill 文档与实际不一致处已标注。

---

## 1. 完整命令树与能力清单

实际 `--help` 采集（证据 `01-help-tree.txt`）。**v1.0.2 的根命令只有 10 个**：

```
libtv
├── login                      登录
│   ├── web [--open]           浏览器回调登录，写 ~/.libtv/credentials.json
│   └── phone -p <手机号> [-c <验证码>] [--captcha]   短信两步登录
├── logout                     删除凭据文件、清内存 token
├── account                    多账户
│   ├── info                   当前用户 + 生效账户（顺带校准本机账户作用域）
│   ├── list|ls                可切换账户列表（个人+团队，含 isActive）
│   └── use <account>          切换生效账户（accountId 数字 / accountName 精确）
├── project                    画布（真正的画布文件）
│   ├── create <名> [-d 简介] [--cover-url] [-t teamId] [--folder-id]
│   ├── list|ls [-p 页码] [-s 页大小] [-o 排序] [--name 子串] [-t teamId]
│   ├── update <uuid> [-n 名] [-d 简介] [--cover-url] [--folder-id]
│   ├── use <uuid>             目录绑定画布（写 .libtv/project.json）
│   ├── unuse                  解除绑定（删除该文件）
│   └── (默认) [uuid]          画布结构摘要：nodes(id/name/type/position) + edges(id/source/target)
├── upload <节点名> -f <文件> [-t image|video|audio] [--x --y] [-g 组]
│                              上传本地文件并建成资源节点
├── download [-n 节点] [-o 目录] [--without-ai-watermark] [--vip]
│                              下载节点资源；单节点直存、多文件/分组出 ZIP
├── image
│   └── shortcut list | <scene|label> -n <源图节点> [--x --y]
│                              图片 Slash 快捷（对齐画布九宫格/`/`面板；gridType 4/9/16/25 原地改图，其余右侧新建）
├── script
│   └── storyboard <脚本节点> [-s 覆盖 imageGenConfig]
│                              从脚本节点派生分镜图组并逐张生成
├── node [node]                画布节点（核心命令）
│   ├── list [-g 组]           列出节点（精简：id/type/name）
│   ├── create <名> -t <类型>  仅新建（-t 必填；--x/--y 写在父级 node 后、create 前）
│   ├── delete <node>          删节点 + 其全部连线
│   └── (默认) <node>          查询 / 更新(-s/-u/--prompt/--name) / 改边(--left*/--right*) / --run 触发生成（阻塞到终态）
├── group                      普通分组（画布上的 group 节点）
│   ├── list / create <名> [--node 子节点…] / use <组> / unuse
│   └── (默认) <组>            幂等：有则查询/绑定，无则建组；--run 整组按顺序执行
├── model
│   ├── search [关键词] [-t 节点类型]   supportModels 检索（modelKey 全等优先，否则 modelName 模糊）
│   └── (默认) <名字…>          全等解析 modelKey/modelName，输出完整 tool_spec schema
└── help [command]
```

### 1.1 文档与实测的出入（重要）

| 项 | skill 文档 | v1.0.2 实测 |
|---|---|---|
| `libtv workspace *`（项目/工作区 5 个子命令） | 有完整文档 | **不存在**：`error: unknown command 'workspace'`，exit=1（证据 `02-workspace-list-attempt.json`）。「工作区」概念在 API 层存在（project list 返回里的 `folderId`/`projectSpaceId`），但 CLI 尚未暴露命令面 |
| `project list -w/--workspace` | 文档有 | **实际无此 flag**（help 里只有 `-p/-s/-o/--name/-t`） |
| `node create -t` 枚举 | 文档列 7 种 | help 原文：`text、image、video、audio、group、script、video-clip`——**未列 storyboard**，但 `-t storyboard` 实际可建（实测成功，证据 `14-node-create-storyboard.json`）；`group` 虽在 help 枚举里，文档明确应走 `libtv group` |
| `group` 默认子命令 | 文档含 `--node` 绑定 | help 补充了 `--node-rm` 解绑（文档未提） |

---

## 2. 数据模型：层级关系与关键字段

### 2.1 层级总览

```
用户 user (uuid/id/nickname)
└── 账户 account（个人 accountType=1 / 团队 accountType=2，带 teamId、会员 memberAccount）
    └── 工作区/文件夹 folder（= API 的 folderId/projectSpaceId；CLI 未暴露，见 §1.1）
        └── 画布 project（id + uuid 双标识）
            └── 节点 node（nodeKey = UUID；含 group 分组节点 → childNodeIds 子节点）
                └── 连线 edge（id/source/target，source/target 均为 nodeKey）
                    └── 任务 task（由 node --run 触发，经 generation/create 提交，taskInfo 写回节点）
```

### 2.2 账户（证据 `03-account-info.json` / `04-account-list.json`）

```json
{"user":{"uuid":"d5d9c248…","id":762839,"nickname":"原野小马"},
 "activeAccount":{"accountId":3706266,"accountName":"视觉组","accountType":2,
   "teamRole":3,"isActive":true,
   "memberAccount":{"memberName":"专业版团队VIP","accountLevel":3,"effective":true}},
 "teamId":3984,"accountsCount":2}
```
要点：`accountType` 1=个人 / 2=团队；`account use` 会改变后续所有命令的**计费与数据作用域**（实测：切账户后在对方空间的画布上 `--run` 报 `30001 账号状态已切换`）。

### 2.3 画布 project（证据 `06-project-create.json` / `05-project-list.json`）

```json
{"projectMeta":{"id":12618863,"uuid":"8bc7bc1cee6a46f68b60060669022689",
 "name":"CLI调研-可删除","teamId":3984,"visibility":0,"ownerId":762839,
 "createdAtMs":1789704197636,"updatedAtMs":1789704197636,"projectType":0,"bizScene":0}}
```
要点：**双标识**——`id`（数字，列表/内部用）与 `uuid`（32 位 hex，不是标准带横线 UUID；`project use`、`-p` 都用它）；`folderId`/`projectSpaceId` 指向工作区文件夹；归属团队用 `teamId`。

### 2.4 本地绑定（证据 `53-local-binding.json`）

`.libtv/project.json` 写在**当前工作目录**，是 CLI 的"当前上下文"：`{"projectUuid": "…"}`（文档还支持 `workspaceId`/`teamId`/`groupNodeKey`）。所有省略 `-p` 的命令读它。这是"目录即上下文"的设计——类比 git 的 `.git`。

### 2.5 节点 node（证据 `09~15-node-create-*.json`、`18-node-query-image.json`）

通用骨架（create 返回）：

```json
{"nodeKey":"758cbc30-8743-4840-ad0d-d7fe2416cc86","nodeType":"image",
 "data":{"type":"image","name":"调研-图片","action":"image_generate",
         "generatorType":"default","params":{…}, …类型特有字段…}}
```

| 字段 | 说明 |
|---|---|
| `nodeKey` | 节点 UUID（带横线），跨命令引用节点的**主键**；`node list` 里叫 `id` |
| `nodeType` vs `data.type` | **双层类型**：`data.type` 是数据层类型，React Flow 渲染类型可以不同——`storyboard` 节点 `data.type` 恒为 `"script"`（证据 `14`），`node list` 输出也显示 `script` |
| `data.name` | 展示名（CLI 定位节点的第二键，精确匹配、id 优先） |
| `data.action` | 生成器动作枚举：`text_generate` / `image_generate` / `video_generate` / `audio_generate` / `script_generate` / `video_clip_resource`（video-clip 无 `_generate`，它是合成链路） |
| `data.generatorType` | 实测均 `default` |
| `data.params` | **生成器参数**（"这次怎么生成"），见 §3 |
| `data.taskInfo` / `prevTaskInfo` / `isStale` | 任务链路维护，`-u` 明确拒写 |
| `position` | 只在 `project` 摘要里暴露（`{x,y}` 像素）；`node create` 时用父级 `--x/--y` 设定 |

### 2.6 连线 edge（证据 `16/17-edge-*.json`、`51-project-summary-final.json`）

- 建边返回：`{"mode":"connect","focalNodeKey":…,"createdCount":1,"deletedCount":0,"connections":[{"connectionId":"…","source":"…","target":"…"}],"incomingRecalcNodeKeys":["<下游节点>"]}`。
- 边是纯 `{id, source, target}` 三元组，**无类型、无端口概念**——"语义"完全由两端节点类型 + 下游模型 schema 的 `modeType` 决定。
- **连线即数据流**：建边后 CLI/画布自动把上游内容重算进下游 `params` 的汇入列表（`incomingRecalcNodeKeys`）。证据 `18`：文本节点连到图片节点后，图片节点 `params.textList` 自动变为 `[{"nodeId":"<文本nodeKey>","content":[]}]`。
- 两种改边语义：`--left/--right`（**确保**：有则不变、无则建，不删其它边）与 `--left-add/--left-rm`（增量增删），同侧两组互斥。

### 2.7 任务 task

任务不由独立命令管理：由 `node <node> --run`（或 `node create … --run`、`group --run`、`script storyboard`、`image shortcut`）触发，CLI **内部**完成「提交 generation/create → 轮询 → 结果写回节点 → stdout 输出终态 JSON」，对外是**同步阻塞**语义。状态字段落在节点的 `taskInfo`（含 `taskId`/`status`/`progress`），文档约定 `status=2` 成功、`status=3` 失败。本次调研因算力额度限制未能实测任务流转，详见 §4。

---

## 3. 每种节点类型的数据结构差异

以 `node create` 原始返回为准（证据 `09`–`15`），聚焦 `data` 顶层与 `params` 默认值差异：

| 类型 | 证据 | data 顶层特有字段 | params 默认（新建即预填） |
|---|---|---|---|
| `text` | `09` | `content: []`（string[]，结果写回处） | `prompt / model:"GVLM 3.1" / count:1 / settings:{} / advancedSettings:{}` |
| `image` | `10` | `url: []`、`alt:"图片"` | `model:"Lib Image 2.5 Pro"`、`modeType:"text2image"`、`settings:{quality:"medium",resolution:"2K",background:"auto",ratio:"16:9"}` |
| `video` | `11` | `url: []`、`poster:""` | `model:"Seedance 2.0 VIP"`、`modeType:"text2video"`、`imageList/videoList/audioList:[]`、`settings:{ratio,resolution:"720p",duration:5,enableSound:"on"}`、`advancedSettings:{search_enabled:1,autoCompliance:1}` |
| `audio` | `12` | `url: []` | `model:"Seed Audio 1.0"`、`scene:""`、`settings:{language:"zh",sample_rate:24000,format:"wav"}`、`advancedSettings:{voice_setting_speed/pitch/vol}` |
| `script` | `13` | `rows: []`、`viewMode:"table"` | `model:"GVLM 3.1"`、`scene:"script-generate"`、`textList/imageList/videoList/audioList:[]`（**无 settings 分桶**） |
| `storyboard` | `14` | 与 script **完全相同**（`data.type:"script"`） | 同 script |
| `video-clip` | `15` | `url: []` | **`params:{}` 全空**——无 model、无 schema 校验；核心数据在 `data.cropRange`/`clipTimelineData`（合成时间线） |

结构性结论：

1. **新建即按默认模型 schema 预填 params**——默认值不是 CLI 硬编码，而是从该类型默认模型的 schema 推导（换模型时 settings 会被重 schema 化，见 §3.1）。
2. `script`/`storyboard` 共用一套数据结构，差异只在 React Flow 渲染类型。
3. 媒体汇入列表（`textList/imageList/videoList/audioList`）只有**消费方**才有：video/script 四类全有，image 连线上游后出现 `textList`，text/audio 新建时没有（由模型 schema 的 `modeType.items` 决定是否支持多模态输入）。
4. `video-clip` 是唯一不走「model+schema」的类型：不校验 params、不选模型，证明 CLI 的写入通道对"生成类"和"编排类"节点是两种协议。

### 3.1 `-s` vs `-u` 双写入通道（实测验证，证据 `25-node-set-image-minimal.json`）

执行 `-s "model=Z-image Turbo" -s quality=1K -s count=1 -s ratio=1:1` 后：

```json
"params":{"prompt":"一只橘猫…","model":"Z-image Turbo","count":1,"modeType":"text2image",
          "settings":{"quality":"1K","ratio":"1:1"},"advancedSettings":{}}
```

- `model` 落库的是 **modelName 字符串**（"Z-image Turbo"），不是 modelKey；CLI 内部解析。
- 原 Lib Image 2.5 Pro 的 `settings`（含 `resolution/background`）被**整体替换**为新模型 schema 的键集合——settings 不是逐键合并，是按新模型重建。
- `quality`/`ratio` 这类在 `config.settings` 桶里的字段可**拍平**写在顶层，CLI 按 schema 的 `originalField` 自动归位到 `params.settings`。
- `-u` 写 `data` 顶层（内容，如 text 的 `content`），拒写 `params/label/type/action/taskInfo/…`。

---

## 4. 生成任务状态机

### 4.1 实测结果：提交阶段即被拒（额度耗尽）

对图片节点（Z-image Turbo、1K、count=1、1:1——该模型最小配置）发起 `--run`，四种尝试全部在 **generation/create 提交阶段**失败，任务从未创建，因此**没有可观測的状态流转**（证据 `31-run-timeline.txt`：每次 run 约 3 秒内报错退出，轮询到的节点 JSON 始终没有 `taskInfo`）：

| # | 账户 | 画布 | 命令 | 错误 | 证据 |
|---|---|---|---|---|---|
| 1 | 团队「视觉组」 | CLI调研-可删除 | `node 调研-图片 --run` | `1200000165 团队算力额度超限` | `32-run-stderr-poll-log.txt` |
| 2 | 个人「原野小马」 | 同上（团队画布） | 同上 | `30001 账号状态已切换，请返回主页重新进入` | `35/37-run*-stderr.txt` |
| 3 | 个人 | CLI调研-个人-可删除（新建，--team-id 0） | `node 调研-图片-个人 --run` | `1200000136 算力不足` | `42-run-stderr-poll-log.txt` |
| 4 | 团队 | CLI调研-可删除 | `node 调研-文本 --run` | `10000`，extra_msg: `PowerFreezeV2: 2000001100 本月积分使用已达上限，请联系团长调整积分使用上限` | `46-run-text-stderr.txt` |

根因：团队月度积分达上限 + 个人账户非会员无算力。**结论：状态机实测待额度恢复后补做**；以下为命令面 + skill 文档可确证的约定（标注为文档依据）。

### 4.2 可确证的状态机约定（文档依据，未经本次实测）

- **提交**：`node <node> --run` → `generation/create`；提交前 CLI 会按模型 `schema.rules` 本地校验（如 z-image：`[{"require":["prompt","media"],"mode":"any"}]`，证据 `24`），以及 Seedance 类模型的真人合规校验。
- **轮询**：CLI 内部轮询（stderr 打 `[run] task=<taskId> … status=… progress=…%`），外部**不需要也不应该**再轮询；终态后结果写回节点（`data.url` 等）并输出终态 JSON。
- **状态枚举**：`status=2` 成功、`status=3` 失败（`libtv script storyboard` 输出的 `imageRuns[*].status` 约定）；节点侧由 `taskInfo`/`prevTaskInfo`/`isStale` 承载（`-u` 拒写键，证明其由任务链路维护）。
- **轮询观察法**：CLI 没有独立的 task 查询命令；观察任务进度的官方姿势就是反复 `libtv node "<名>"` 看 `taskInfo` 字段变化（本次尝试了这条路，因任务未创建而无变化，证据 `31/43-task-poll-*.json`）。

---

## 5. CLI 暴露了哪些能力、没暴露哪些

**已暴露**（均有实测或 help 证据）：登录/多账户切换；画布 CRUD + 目录绑定 + 结构摘要；7 类节点 create/list/delete/查询/改参；连线增删（确保/增量双语义）；`--run` 同步生成、整组顺序执行；上传建资源节点；下载（含去水印 `--without-ai-watermark`、`--vip`）；图片 Slash 快捷（九宫格原地改图/右侧新建）；脚本→分镜图组批处理；模型检索 + 完整 schema 拉取；NDJSON 管道串联（上游 stdout 的 `nodeKey` 喂下游 stdin 当 `--left`）。

**未暴露**（从命令面推断，非编造）：

1. **工作区（workspace）管理**：v1.0.2 无此命令（§1.1），工作区只能网页端建/管；CLI 里画布直接挂 folderId。
2. **自由布局**：坐标只能在 `create`/`upload` 时给一次（`--x/--y`），**没有移动已有节点的命令**；缩放、框选、对齐等更无从谈起。
3. **可视化编辑**：图像涂抹/局部重绘的蒙版交互、视频时间线的拖拽剪辑（clipTimelineData 只能整段 JSON 手写）、表格视图的单元格级交互（rows 只能整数组重写）。
4. **任务管理面**：无 task list/cancel/retry 命令；任务只能随节点 `--run` 隐式存在。
5. **undo/redo、版本历史、协作者光标、评论**等画布协作能力：命令面无任何痕迹。
6. **节点类型变更**：`type` 是 `-u` 拒写键，类型创建即定型。
7. **删除画布/工作区**：`project` 只有 create/list/update/use/unuse，**没有 delete**——CLI 不允许删画布（防呆）。
8. 素材库（asset）管理、模型白名单申请（schema 里有 `requiresWhitelistPermission`）等运营能力。

---

## 6. 架构借鉴点（对我们的画布项目：React Flow + 命令层 + 内容卡片）

1. **"目录即上下文"的本地绑定**。`.libtv/project.json` 让一长串命令免带项目参数，且天然支持多目录绑多画布。我们的命令层可以有等价的"当前画布/当前选区"会话态，显著降低命令 payload 复杂度。
2. **节点定位协议：id 优先 + 展示名精确匹配 + 唯一性校验**。简单、可预测、对 agent 友好；同名时给明确错误并引导改用 id。比"模糊搜索"更适合程序化调用。
3. **双写入通道分离"生成参数"与"节点内容"**（`-s` 走 schema 校验写 params / `-u` 浅写 data 顶层 + 拒写黑名单）。这把"影响模型输出"和"改卡片内容"两类语义在协议层分开，配合 `originalField` 别名归位（展示字段名 ↔ 落库字段名），值得我们的内容卡片参数体系照搬。
4. **schema 驱动的模型能力声明**。`properties`（参数定义+控件+默认值+枚举）/ `config.settings|advancedSettings`（面板分桶）/ `rules`（可否生成的校验规则，支持 `forModeTypes` 按模态收紧）/ `modeType.items`（各输入模态的入边数量 [min,max]）——模型换接入方、换版本，前端/CLI 零改动。我们接多 provider 时，这套"tool_spec 下发 + 客户端按 schema 渲染与校验"是最值得学的一层。
5. **连线即数据流，改边自动重算下游 params**。边本身无类型（就 source/target），语义由下游模型 schema 解释；改边返回 `incomingRecalcNodeKeys` 标明谁被重算。React Flow 的边也是哑数据，这个"边哑 + schema 解释"的分工让连线层极薄。
6. **同步封装异步**：`--run` 把"提交→轮询→写回→终态输出"包成一条阻塞命令，调用方（agent/脚本）零轮询逻辑；stdout 只出业务 JSON（NDJSON 可管道）、stderr 只出进度。我们命令层对接 BullMQ 任务时可以提供同样的 sync facade。
7. **NDJSON 管道约定**：上游成功输出单行 JSON（含 `nodeKey`），下游 stdin 逐行消费当作入边——画布操作就此可组合成 shell 流水线，这是"命令层"成为一等公民的关键设计。
8. **确保（ensure）vs 增量（add/rm）的双语义改边**：`--left` 幂等不删旧边，`--left-add/--left-rm` 精确增删。幂等默认让重放脚本安全。
9. **双层 type**：`data.type`（数据）与渲染 type 分离（storyboard 复用 script 数据）。内容卡片范式下，"数据模型"与"卡片呈现"解耦可以避免为每种视图复制一份数据结构。
10. **新建即预填默认模型 + 默认 params**：节点一创建就是"可运行"状态（模型、分辨率、时长全有默认值），降低空节点的心智负担；换模型时按新 schema 重建 settings 而非逐键合并，避免脏参数残留。
11. **防呆边界**：CLI 不给删画布/改类型/手写 taskInfo 的口子——命令面只暴露"安全子集"，危险操作留给网页。我们的命令层也可照此划定 agent 可触达的操作边界。

---

## 7. 本次调研产物清单

- 新建画布（团队空间，保留未删）：**`CLI调研-可删除`，UUID `8bc7bc1cee6a46f68b60060669022689`**
  （网页：`https://www.liblib.tv/canvas?projectId=8bc7bc1cee6a46f68b60060669022689`）
- 画布内节点 7 个（text/image/video/audio/script/storyboard/video-clip）+ 连线 2 条（调研-文本→调研-图片、调研-图片→调研-视频），nodeKey 见 §2.5 与各证据文件
- 个人空间验证画布：`CLI调研-个人-可删除`，UUID `ca892ea1badd48bd83130f595c3af2f2`（含 1 个已配好最小参数的图片节点，额度恢复后 `libtv node "调研-图片-个人" --run` 即可补测状态机）
- 原始证据 40+ 份：`libtv-recon/NN-*.json|txt`
- 调研结束时账户状态已还原为团队「视觉组」生效、目录绑定团队画布（证据 `44/45/52/53`）
