# DIY 模式预设（Dizzy-DSH 自有）

DSH 持久造物模式：官方 `standard` 编码 agent + 本合集的造物大脑
（`dizzy-diy` 主技能：四条造物路径的决策表与全流程）。

与官方「创造模式」(`cordis`)解耦：本预设**不挂** `tool-cordis`。
动态插件（`cordis_define` / `cordis_run`）留给创造模式独占；本预设只做
合集子包 / agent preset / 技能。两边可以同进程、同时开着，互不踩
`cordisInspect` 进程单例。

## 内容

```text
presets/diy/
├── preset.yml            # 预设元数据(预设下拉显示「DIY 模式」)
├── agent.cordis.yml      # 组合文件:standard + 双路径 persona + 技能目录
└── skills/
    └── dizzy-diy/        # 主技能:路径决策 + 持久子包/preset/技能全流程
        └── SKILL.md
```

安装脚本还会从**本机 DSH 部署**同步两份官方创作手册快照到预设的
`skills/` 下（`cordis-plugin-development`、`editing-cordis-compositions`），
保证手册与部署版本一致;快照不随仓库分发。

## 安装

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-diy-preset.ps1 [-Force]
```

幂等：目标齐全则跳过（官方快照仍会刷新）；`-Force` 覆盖为仓库版。
装完**重启 dsh web**，新会话的预设下拉选择「DIY 模式」。

## 注意

- 本预设**没有**动态插件工具集。需要 `cordis_define` / `cordis_run`
  探测活运行时时，另开官方「创造模式」会话。
- 不要在已有内容的会话中途切换 preset；新开会话选择。
