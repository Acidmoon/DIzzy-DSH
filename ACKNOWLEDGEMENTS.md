# 致谢 / Acknowledgements

这个项目从个人实验发展成今天的样子，离不开社区对代码、实验、复现、文档和维护工作的共同投入。下面的名单依据公开的 commit、Pull Request、Issue 和配套研究仓库整理；排列按贡献类型，不代表贡献大小排名。

## 协作与维护

- [@Greenhand-monster](https://github.com/Greenhand-monster)——重构自包含模式与双语文档，设计并实现 Eternal Minimal、Wire Think-Execute Standard 和 Combo Anchored，并完成相应实验。
- [@wushi2333](https://github.com/wushi2333)——参与仓库维护、PR 审查与合并，推动 Whoami、配置校验和 agent-scoped 工具发现等改动落地。
- [@tianmingwan](https://github.com/tianmingwan)——贡献 Whoami Standard 及其 subagent 锚定流程，并参与仓库维护。
- [@0liveiraaa](https://github.com/0liveiraaa)——创建并维护 [DeepseekCotexplorations](https://github.com/0liveiraaa/DeepseekCotexplorations) 研究资料库，协助分流、整理社区研究与文档。
- [@noone89A](https://github.com/noone89A)——参与项目协作，并提交 V4-Pro 思维链“人格分裂”的机制归因研究。

## 代码与文档

- [@pythonshiyi](https://github.com/pythonshiyi)——完善首轮回复后的晋升逻辑、缓存与降级健壮性（[#2](https://github.com/xiaobright/dsh-anchored-standard/pull/2)）。
- [@AprilWizard](https://github.com/AprilWizard)——贡献 Zero-Anchored Standard 实验模式（[#4](https://github.com/xiaobright/dsh-anchored-standard/pull/4)）。
- [@slicenferqin](https://github.com/slicenferqin)——定位并修复首轮预算、技能目录、listener 顺序和 verify runner 行为（[#7](https://github.com/xiaobright/dsh-anchored-standard/pull/7)、[#13](https://github.com/xiaobright/dsh-anchored-standard/pull/13)、[#70](https://github.com/xiaobright/dsh-anchored-standard/pull/70)）。
- [@3067997259-design](https://github.com/3067997259-design) 与 [@chr431](https://github.com/chr431)——推进 bootstrap 上下文抑制及官方 Minimal 真实工具 schema 的接入（[#10](https://github.com/xiaobright/dsh-anchored-standard/pull/10)、[#14](https://github.com/xiaobright/dsh-anchored-standard/pull/14)）。
- [@AHCzyz](https://github.com/AHCzyz)——贡献晋升后低注入、压缩感知状态、按需工具发现以及 Windows bash 支持，并提供 Git Bash 路径修复方案（[#20](https://github.com/xiaobright/dsh-anchored-standard/pull/20)、[#21](https://github.com/xiaobright/dsh-anchored-standard/pull/21)、[#33](https://github.com/xiaobright/dsh-anchored-standard/pull/33)）。
- [@MolecularFullerene](https://github.com/MolecularFullerene) 与提交记录关联的 [@Almanassik-Alarabi](https://github.com/Almanassik-Alarabi)——完善配置校验和 agent-scoped 工具发现（[#27](https://github.com/xiaobright/dsh-anchored-standard/pull/27)、[#29](https://github.com/xiaobright/dsh-anchored-standard/pull/29)）。
- [@baizhu945](https://github.com/baizhu945)——修复没有 `/bin/bash` 的主机上 persistent shell 无法启动的问题（[#44](https://github.com/xiaobright/dsh-anchored-standard/pull/44)）。
- [@lunar-me](https://github.com/lunar-me)——审校并修正文档中的英文表达（[#67](https://github.com/xiaobright/dsh-anchored-standard/pull/67)、[#68](https://github.com/xiaobright/dsh-anchored-standard/pull/68)、[#69](https://github.com/xiaobright/dsh-anchored-standard/pull/69)）。

## 研究与独立复现

- [@Rtyyy233](https://github.com/Rtyyy233)——通过 45 个受控会话定位工具 schema 对首轮轨迹的决定性影响，为后续真实 Minimal 工具面对接提供了关键因果证据（[#11](https://github.com/xiaobright/dsh-anchored-standard/issues/11)）。
- [@MolecularFullerene](https://github.com/MolecularFullerene)——完成首请求工具 schema 的 2×2 消融与 Request #2 协议实验，并将结果提交至研究仓库。
- [@TipsyDrifter](https://github.com/TipsyDrifter)——完成 3×3 随机区组独立复现，确认轨迹锚定稳定，同时指出能力增益在小样本下仍未确定（[#65](https://github.com/xiaobright/dsh-anchored-standard/issues/65)）。
- [@JimMilk](https://github.com/JimMilk)——完成 macOS、Windows 和 Linux 三环境共 11 轮评测，提供未复现 98/99 的完整记录与工具链问题分析（[#51](https://github.com/xiaobright/dsh-anchored-standard/issues/51)）。
- [@1127353621zxm-netizen](https://github.com/1127353621zxm-netizen)——整理 DSH 会话导入导出、zstd 多帧兼容和插件 JSON Schema 修复工具。

同样感谢所有提交过 Issue、尚未合并但提供了设计或修复思路的 PR 作者，以及参与测试、答疑和传播的社区成员。很多关键问题最初都来自一条看似普通的使用反馈，无法在这里逐一列出。

完整记录可在 [Contributors](https://github.com/xiaobright/dsh-anchored-standard/graphs/contributors)、[Pull Requests](https://github.com/xiaobright/dsh-anchored-standard/pulls?q=is%3Apr) 和 [Issues](https://github.com/xiaobright/dsh-anchored-standard/issues?q=is%3Aissue) 中查阅；实验材料与研究贡献见 [DeepseekCotexplorations](https://github.com/0liveiraaa/DeepseekCotexplorations)。

> 统计截至 2026-08-17：主仓库共有 18 个已合并 PR，其中包括 10 位外部 PR 作者；此外还有通过协作分支、审查合并和研究仓库参与项目的贡献者。GitHub 账号与本地 Git 作者邮箱的映射可能造成贡献计数差异，因此这里以可核验的实际贡献内容为主，而不是按 commit 数量排序。
