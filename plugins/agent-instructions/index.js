/**
 * dizzy-dsh-agent-instructions 插件(Host 端)
 *
 * 职责:把 prompts/agent-instructions.md(源自 DSH AGENTS.md 的
 *       Agent 规则)注入到系统提示词 section。
 *
 * 每次模型步骤组装时重新读取提示词文件,用户编辑后无需重启即可生效。
 * order -50 在 persona(0)之前渲染,与 harness 身份(-100)之后。
 * 提示词文件随本插件包走(自包含):plugins/agent-instructions/prompts/。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PROMPT_FILE = fileURLToPath(new URL('./prompts/agent-instructions.md', import.meta.url))

export default {
  name: 'dizzy-dsh-agent-instructions',
  inject: ['systemPrompt'],
  apply(ctx) {
    const disposePrompt = ctx.systemPrompt.section({
      name: 'dizzy-dsh:agent-instructions',
      order: -50,
      text: () => {
        try {
          return readFileSync(PROMPT_FILE, 'utf8')
        } catch (err) {
          return 'Dizzy-DSH: 无法读取 prompts/agent-instructions.md(' + String(err.code ?? err) + ')'
        }
      },
    })

    return () => {
      disposePrompt()
    }
  },
}
