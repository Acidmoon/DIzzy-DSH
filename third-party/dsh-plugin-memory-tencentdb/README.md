# dsh-plugin-memory-tencentdb

DSH（DeepSeek Harness）适配层插件：把独立的 **TencentDB Agent Memory** 服务接入
dsh，提供长期记忆工具、L3/L2 画像注入与 L0 会话自动捕获。

> 路径一架构：本插件是纯客户端适配层，**不修改 TencentDB 源码**；
> 记忆存储与 L1 提取全部在独立运行的 MemoryCore Gateway 中完成。

## 架构

```text
dsh (Cordis host)
  └─ dsh-plugin-memory-tencentdb
       ├─ tdai_memory_search / tdai_conversation_search / ... 工具
       ├─ systemPrompt 注入 L3 画像 + L2 场景导航（定时缓存刷新）
       └─ session/event → L0 对话写回（批量、静默窗口 2s）
             │ @tencentdb-agent-memory/memory-sdk-ts-v2
             ▼ HTTP /v3/*
MemoryCore Gateway :8420（独立进程/容器）
  L0 对话 → 后台提取 → L1 记忆 → L2 场景 → L3 画像
```

## 前置条件

1. Node.js >= 22.16（dsh 自带）。
2. 一个运行中的 MemoryCore Gateway，默认 `http://127.0.0.1:8420`。启动方式见
   [TencentDB-Agent-Memory/MemoryCore](https://github.com/TencentCloud/TencentDB-Agent-Memory/tree/main/MemoryCore)：
   - SQLite + BM25 本地模式，无需 Redis / Docker；
   - 需要一把 OpenAI-compatible LLM key 供后台 L1 提取使用。
3. Gateway 中已存在要绑定的 team / agent / user（本地零配置时可用 `default`）。

## 安装

从本地目录安装（推荐开发阶段）：

```bash
cd /path/to/dsh-plugin-memory-tencentdb
npm install

# 安装到 web profile（或换成你自己的 profile 名）
dsh plugin --profile web add file:$PWD
```

安装后 `dsh plugin` 会把本包加入 profile 的 `dsh.profile.bundles`，
`cordis.patch.yml` 中的插件条目自动挂载。

## 配置

默认连接 `http://127.0.0.1:8420`，instance / team / agent / user 均为 `default`。

覆盖配置：编辑 `~/.dsh/settings.yaml`（命名空间 `tdai-memory`）：

```yaml
tdai-memory:
  server:
    url: http://127.0.0.1:8420
    apiKey: local          # 或留空 + credentialName 引用 dsh 凭证
    credentialName: TDAI_MEMORY_API_KEY   # 非空时优先
    instanceId: default
    teamId: team-xxx
    agentId: agt-xxx
    userId: usr-xxx
  recall:
    enabled: true
    refreshIntervalMs: 60000
  capture:
    enabled: true
    onlyUserSource: true
    flushIntervalMs: 2000
    skipFailedTurns: true
```

若用 dsh 凭证引用，把 key 写进 `~/.dsh/.credentials.yaml`：

```yaml
TDAI_MEMORY_API_KEY: <Gateway Bearer token>
```

## 模型可见能力

| 工具 | 说明 |
|---|---|
| `tdai_memory_search` | 搜索 L1 结构化记忆 |
| `tdai_conversation_search` | 搜索 L0 原始对话（默认当前会话，可跨会话） |
| `tdai_memory_profile` | 读取 L3 画像 + L2 场景索引 |
| `tdai_read_scenario` | 按路径读取 L2 场景全文 |
| `tdai_memory_status` | 查看各层存储计数 |

插件还会：
- 每个 agent 步骤前**自动召回 L1 相关记忆**，以 `<relevant-memories>` 注入模型历史，无需模型手工调用工具；
- 把 L3 画像与 L2 场景导航注入系统提示词（60s 缓存刷新）；
- 把真实用户消息与模型回复自动写回 L0，Gateway 在后台提取 L1+；
- Gateway 离线时指数退避，只在状态切换时打印一条日志，不刷屏。

## 个人模式（零配置）

`server.autoIdentity` 默认开启：插件读取 `~/.dsh/.anonymous-user-id`，
自动派生稳定的 `team=personal` / `agent=personal-agent-*` / `user=user-*`。
**无需 init-admin、无需手工填写 team/agent/user id、无需使用 MemoryPanel。**

```yaml
tdai-memory:
  server:
    url: http://127.0.0.1:8420
    autoIdentity: true
```

## 已知边界（个人模式 MVP）

- 不做团队协作 / 会话初始化选择器；一个 DSH 安装对应一个个人记忆库。
- L0 捕获只收真实用户文本与模型可见文本，不记录工具调用与工具结果。
- 技能（Skill）/ 知识库（Wiki/CodeGraph）/ 团队面板不在此插件内，
  这些能力由 TencentDB 的 MemoryProxy 体系提供。

## Gateway 生命周期

推荐用 systemd user service 托管（崩溃自动拉起、开机自启）：

```bash
systemctl --user enable --now tdai-memory-gateway.service
/home/Acidmoon/Coding/tdai-memory-gateway.sh status
```
