# Installation contract for AI agents / 安装 Agent 操作契约

This document is for the AI agent operating the user's computer. The end user
should not need to copy files, edit YAML, register a workspace, or import a
session manually.

本文供操作用户电脑的 AI agent 阅读。最终用户不应手工复制文件、修改 YAML、注册工作区
或导入会话。

## Required outcome / 交付标准

After installation, the user starts DeepSeek Harness, opens any requested
workspace, selects the `Prefab Anchored Standard` mode, and creates a new
session. The selected session is automatically prefilled before its first real
prompt. The default installation always uses the generic template.

安装完成后，用户只需启动 DeepSeek Harness、打开目标工作区，选择
`Prefab Anchored Standard` 模式并新建会话。该会话会自动完成预填充，可以直接发送
评测提示词。

## Procedure / 操作步骤

1. Confirm Node.js is at least 22.19 (`node --version`).
2. Ensure every DeepSeek Harness process is fully closed. Do not kill it
   silently; ask the user to close it if necessary.
3. From the repository root, run exactly one installer command:

PowerShell:

```powershell
node .\prefab\install.mjs --confirm-dsh-closed
```

Linux/macOS:

```sh
node ./prefab/install.mjs --confirm-dsh-closed
```

4. Require exit code 0 and the final marker `INSTALL READY`.
5. Tell the user only: start DSH, open the target workspace, select
   `Prefab Anchored Standard`, create a new session, and send the prompt.

Do not select the Project2 template unless the user explicitly asks for the
benchmark-specific reproduction mode. In that case use:

```powershell
node .\prefab\install.mjs --confirm-dsh-closed --template project2
```

and tell the user to select `Prefab Anchored Project2`.

The installer performs all of these operations itself:

- copies the self-contained mode to
  `$DSH_HOME/.agent-presets/prefab-anchored-standard` (or `~/.dsh/...`);
- refuses to overwrite an existing preset;
- bundles the reviewed template and the in-session hydration plugin;
- automatically replaces the roll-time cwd and AGENTS.md when a selected blank
  session is hydrated;
- removes failed warm-up instruction-file calls from the hydrated history;
- unlocks the native file/search tools, user question, todo, and web tools for
  the real task turn without replaying token-stream chunks;
- synchronizes the live Agent turn cursor so the first real prompt is turn 3.

## Optional arguments / 可选参数

```text
--preset <id>             Install under another lowercase-hyphen id.
--template generic|project2
                          Generic is the default; Project2 is explicit opt-in.
--cwd <existing-dir>      Also create a legacy offline Ready session.
--title <text>            Change that legacy Ready session title.
--allowed-tools a,b       Filter that legacy session's durable unlocks.
--rename <json>           Apply legacy session tool-name migrations.
--agents-md <file>        Use a specific legacy instruction file.
```

Do not add MCP credentials to this public mode directory. MCP tools must be
configured separately for the installed preset/profile and can then be found
through `dev_tool_search`.

If the target preset id already exists, stop. Do not overwrite it automatically:
it may contain user MCP configuration or community modifications. An expert
must inspect it or select a different `--preset` id.
