import { textOutput } from './format.js'
import { resolvePersonalIdentity } from './client.js'

/**
 * Wiki / CodeGraph 只读工具集，数据来自独立的 MemoryKnowledge 服务（默认 8421）。
 * 知识资产的创建/录入由 DSH 设置页（插件 client 半区）完成。
 */
export function buildKnowledgeTools({ current, getKnowledgeClient }) {
  const text = textOutput

  const teamIdOf = () => resolvePersonalIdentity(current()?.server ?? {}).teamId

  const wikiList = {
    name: 'tdai_knowledge_wiki_list',
    description: '列出当前个人知识库中的所有 LLM-Wiki（含状态、页数、更新时间）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: text('JSON：wiki 列表。'),
    async execute() {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用（config: knowledge.enabled=false）'
      const data = await client.post('/wiki/list', { team_id: teamIdOf(), limit: 50 })
      return JSON.stringify({ total: data?.total ?? 0, items: data?.items ?? [] })
    },
  }

  const wikiSearch = {
    name: 'tdai_knowledge_wiki_search',
    description: '全文搜索指定 LLM-Wiki 的结构化页面。wiki_id 用 tdai_knowledge_wiki_list 获取。',
    parameters: {
      type: 'object',
      properties: {
        wiki_id: { type: 'string', description: 'wiki_id（wiki- 前缀）' },
        query: { type: 'string', description: '搜索关键词或问题' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '默认 20' },
      },
      required: ['wiki_id', 'query'],
      additionalProperties: false,
    },
    output: text('JSON：匹配到的 wiki 页面/片段。'),
    async execute(args) {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用'
      const body = { wiki_id: args.wiki_id, query: args.query }
      if (Number.isInteger(args.limit)) body.limit = args.limit
      const data = await client.post('/wiki/search', body)
      return JSON.stringify(data)
    },
  }

  const wikiPages = {
    name: 'tdai_knowledge_wiki_pages',
    description: '列出指定 Wiki 的页面清单（refs）。',
    parameters: {
      type: 'object',
      properties: { wiki_id: { type: 'string', description: 'wiki_id（wiki- 前缀）' } },
      required: ['wiki_id'],
      additionalProperties: false,
    },
    output: text('JSON：页面 refs 列表。'),
    async execute(args) {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用'
      return JSON.stringify(await client.post('/wiki/page/ls', { wiki_id: args.wiki_id }))
    },
  }

  const codeList = {
    name: 'tdai_knowledge_codegraph_list',
    description: '列出当前个人知识库中的所有 CodeGraph 仓库（含状态、同步时间）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: text('JSON：code_graph 列表。'),
    async execute() {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用'
      const data = await client.post('/code-graph/list', { team_id: teamIdOf(), limit: 50 })
      return JSON.stringify({ total: data?.total ?? 0, items: data?.items ?? [] })
    },
  }

  const codeSearch = {
    name: 'tdai_knowledge_codegraph_search',
    description: '在指定 CodeGraph 中按符号/文件搜索。code_graph_id 用 tdai_knowledge_codegraph_list 获取。',
    parameters: {
      type: 'object',
      properties: {
        code_graph_id: { type: 'string', description: 'code_graph_id（cg- 前缀）' },
        query: { type: 'string', description: '符号名、文件路径或关键词' },
        kind: { type: 'string', enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'], description: '可选节点类型；省略则不过滤' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '默认 10' },
      },
      required: ['code_graph_id', 'query'],
      additionalProperties: false,
    },
    output: text('JSON：匹配到的符号/文件。'),
    async execute(args) {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用'
      const body = { code_graph_id: args.code_graph_id, query: args.query }
      if (args.kind) body.kind = args.kind
      if (Number.isInteger(args.limit)) body.limit = args.limit
      return JSON.stringify(await client.post('/code-graph/search', body))
    },
  }

  const codeExplore = {
    name: 'tdai_knowledge_codegraph_explore',
    description: '在 CodeGraph 中探索与问题最相关的文件集合（面向任务的代码检索）。',
    parameters: {
      type: 'object',
      properties: {
        code_graph_id: { type: 'string', description: 'code_graph_id（cg- 前缀）' },
        query: { type: 'string', description: '要完成的任务或问题描述' },
        maxFiles: { type: 'integer', minimum: 1, maximum: 200, description: '默认 12' },
      },
      required: ['code_graph_id', 'query'],
      additionalProperties: false,
    },
    output: text('JSON：相关文件及其内容片段。'),
    async execute(args) {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用'
      const body = { code_graph_id: args.code_graph_id, query: args.query }
      if (Number.isInteger(args.maxFiles)) body.maxFiles = args.maxFiles
      return JSON.stringify(await client.post('/code-graph/explore', body))
    },
  }

  const codeFiles = {
    name: 'tdai_knowledge_codegraph_files',
    description: '列出 CodeGraph 仓库的文件树。',
    parameters: {
      type: 'object',
      properties: {
        code_graph_id: { type: 'string', description: 'code_graph_id（cg- 前缀）' },
        path: { type: 'string', description: '可选：只看某个目录' },
        maxDepth: { type: 'integer', minimum: 1, description: '可选：树深度' },
      },
      required: ['code_graph_id'],
      additionalProperties: false,
    },
    output: text('JSON：文件树。'),
    async execute(args) {
      const client = await getKnowledgeClient()
      if (!client) return 'Knowledge 服务未启用'
      const body = { code_graph_id: args.code_graph_id, format: 'tree', includeMetadata: true }
      if (args.path) body.path = args.path
      if (Number.isInteger(args.maxDepth)) body.maxDepth = args.maxDepth
      return JSON.stringify(await client.post('/code-graph/files', body))
    },
  }

  return [wikiList, wikiSearch, wikiPages, codeList, codeSearch, codeExplore, codeFiles]
}
