# 本插件集合的配套技能(可选)
#
# 使用方法:把需要的技能目录复制到 ~/.dsh/skills/ 下,会话即可按需加载。
# 每个技能一个目录,内含 SKILL.md。
#
# 技能与插件的分工:
#   - 插件(plugins/*.js) = 能力(工具、定时任务、数据),经 dsh plugin add 安装
#   - 技能(skills/*/SKILL.md) = 行为(告诉 agent 何时用、怎么用),复制即用
#
# 示例结构:
#   skills/
#   └── balance-check/
#       └── SKILL.md      # 用户提到"余额"时,agent 调用 balance_check 工具
