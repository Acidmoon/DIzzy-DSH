window.__ModuleLoader__.load({
  id: 'dsh-plugin-memory-tencentdb',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React

    const h = React.createElement

    // ── 样式：吃宿主 token，明暗主题跟随 ─────────────────────
    const CSS = `
.tdai-mem-view{box-sizing:border-box;width:100%;max-width:960px;margin:0 auto;padding:24px 20px 64px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,ui-sans-serif,system-ui,sans-serif)}
.tdai-mem-title{margin:0;font-size:20px;font-weight:600;line-height:28px}
.tdai-mem-sub{margin-top:2px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.tdai-mem-tabs{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.tdai-mem-tab{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:9px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
.tdai-mem-tab.on{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);font-weight:600}
.tdai-mem-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px}
.tdai-mem-card h4{margin:0 0 6px;font-size:13px;font-weight:600}
.tdai-mem-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.tdai-mem-content{white-space:pre-wrap;font-size:13px;line-height:20px;margin:6px 0}
.tdai-mem-textarea{width:100%;box-sizing:border-box;min-height:160px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:10px;font:inherit;font-size:13px;line-height:20px;resize:vertical}
.tdai-mem-input{width:100%;box-sizing:border-box;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:8px 10px;font:inherit;font-size:13px}
.tdai-mem-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.tdai-mem-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}
.tdai-mem-btn.primary{background:var(--dsw-alias-state-business-tertiary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:600}
.tdai-mem-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.tdai-mem-list{display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto;padding-right:4px}
.tdai-mem-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.tdai-mem-row{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.tdai-mem-err{font-size:12px;color:var(--dsw-alias-state-error-primary)}
`

    const api = async (path, body) => {
      const opts = body === undefined
        ? { headers: { accept: 'application/json' } }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const res = await fetch(path, opts)
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data
    }

    function useLoader(load) {
      const loadRef = useRef(load)
      loadRef.current = load
      const [state, setState] = useState({ loading: true, data: null, error: null })
      const reload = useCallback(() => {
        setState((s) => ({ ...s, loading: true, error: null }))
        loadRef.current().then((data) => setState({ loading: false, data, error: null }))
          .catch((err) => setState({ loading: false, data: null, error: String(err?.message ?? err) }))
      }, [])
      useEffect(() => { reload() }, [reload])
      return { ...state, reload }
    }

    const LoadBox = ({ state, children }) => {
      if (state.error) return h('div', { className: 'tdai-mem-err' }, '加载失败：' + state.error)
      if (state.loading) return h('div', { className: 'tdai-mem-note' }, '加载中…')
      return children
    }

    // ── L0 原始对话：查看 + 删除 ─────────────────────────────
    const L0View = () => {
      const list = useLoader(() => api('/tdai-memory/l0/list'))
      const [busy, setBusy] = useState(false)
      const del = async (id) => {
        if (!id) return
        setBusy(true)
        try { await api('/tdai-memory/l0/delete', { message_ids: [id] }); await list.reload() }
        catch (e) { list.error = String(e?.message ?? e) }
        finally { setBusy(false) }
      }
      return h('div', null,
        h('div', { className: 'tdai-mem-note' }, `L0 原始对话：共 ${list.data?.total ?? '…'} 条（仅可删除，不可编辑）`),
        h(LoadBox, { state: list },
          h('div', { className: 'tdai-mem-list' },
            (list.data?.messages ?? []).map((m) => h('div', { className: 'tdai-mem-card', key: m.id ?? m.timestamp },
              h('div', { className: 'tdai-mem-meta' }, `${m.role} · ${m.timestamp ?? ''} · ${m.session_id ?? ''}`),
              h('div', { className: 'tdai-mem-content' }, m.content),
              h('button', { className: 'tdai-mem-btn danger', disabled: busy, onClick: () => del(m.id) }, '删除'))))))
    }

    // ── L1 原子记忆：查看 + 编辑 + 删除 ──────────────────────
    const L1View = () => {
      const list = useLoader(() => api('/tdai-memory/l1/list'))
      const [editing, setEditing] = useState(null)
      const [content, setContent] = useState('')
      const [background, setBackground] = useState('')
      const [busy, setBusy] = useState(false)
      const startEdit = (item) => { setEditing(item); setContent(item.content ?? ''); setBackground(item.background ?? '') }
      const save = async () => {
        setBusy(true)
        try {
          await api('/tdai-memory/l1/update', { id: editing.id, content, background })
          setEditing(null); await list.reload()
        } catch (e) { list.error = String(e?.message ?? e) }
        finally { setBusy(false) }
      }
      const del = async (id) => {
        setBusy(true)
        try { await api('/tdai-memory/l1/delete', { ids: [id] }); await list.reload() }
        catch (e) { list.error = String(e?.message ?? e) }
        finally { setBusy(false) }
      }
      return h('div', null,
        editing && h('div', { className: 'tdai-mem-card' },
          h('h4', null, `编辑 L1 记忆 ${editing.id}`),
          h('textarea', { className: 'tdai-mem-textarea', value: content, onChange: (e) => setContent(e.target.value) }),
          h('div', { className: 'tdai-mem-note' }, '背景（可选）'),
          h('input', { className: 'tdai-mem-input', value: background, onChange: (e) => setBackground(e.target.value) }),
          h('div', { className: 'tdai-mem-actions' },
            h('button', { className: 'tdai-mem-btn primary', disabled: busy, onClick: save }, '保存'),
            h('button', { className: 'tdai-mem-btn', disabled: busy, onClick: () => setEditing(null) }, '取消'))),
        h(LoadBox, { state: list },
          h('div', { className: 'tdai-mem-list' },
            (list.data?.items ?? []).map((item) => h('div', { className: 'tdai-mem-card', key: item.id },
              h('div', { className: 'tdai-mem-meta' }, `${item.type ?? 'memory'} · ${item.id} · ${item.updated_at ?? ''}`),
              h('div', { className: 'tdai-mem-content' }, item.content),
              item.background ? h('div', { className: 'tdai-mem-note' }, '背景：' + item.background) : null,
              h('div', { className: 'tdai-mem-actions' },
                h('button', { className: 'tdai-mem-btn', disabled: busy, onClick: () => startEdit(item) }, '编辑'),
                h('button', { className: 'tdai-mem-btn danger', disabled: busy, onClick: () => del(item.id) }, '删除')))))))
    }

    // ── L2 场景：索引 + 读取/编辑/删除 ───────────────────────
    const L2View = () => {
      const list = useLoader(() => api('/tdai-memory/l2/list'))
      const [selected, setSelected] = useState(null)
      const [content, setContent] = useState('')
      const [summary, setSummary] = useState('')
      const [busy, setBusy] = useState(false)
      const open = async (path) => {
        setBusy(true)
        try {
          const data = await api('/tdai-memory/l2/read', { path })
          setSelected(data.file); setContent(data.file?.content ?? ''); setSummary('')
        } catch (e) { list.error = String(e?.message ?? e) }
        finally { setBusy(false) }
      }
      const save = async () => {
        setBusy(true)
        try { await api('/tdai-memory/l2/write', { path: selected.path, content, summary }); await list.reload(); setSelected({ ...selected, content }) }
        catch (e) { list.error = String(e?.message ?? e) }
        finally { setBusy(false) }
      }
      const del = async (path) => {
        setBusy(true)
        try { await api('/tdai-memory/l2/delete', { path }); setSelected(null); await list.reload() }
        catch (e) { list.error = String(e?.message ?? e) }
        finally { setBusy(false) }
      }
      return h('div', null,
        selected && h('div', { className: 'tdai-mem-card' },
          h('h4', null, `场景 ${selected.path}`),
          h('textarea', { className: 'tdai-mem-textarea', style: { minHeight: 260 }, value: content, onChange: (e) => setContent(e.target.value) }),
          h('div', { className: 'tdai-mem-note' }, '摘要（可选）'),
          h('input', { className: 'tdai-mem-input', value: summary, onChange: (e) => setSummary(e.target.value) }),
          h('div', { className: 'tdai-mem-actions' },
            h('button', { className: 'tdai-mem-btn primary', disabled: busy, onClick: save }, '保存场景'),
            h('button', { className: 'tdai-mem-btn danger', disabled: busy, onClick: () => del(selected.path) }, '删除场景'))),
        h(LoadBox, { state: list },
          h('div', { className: 'tdai-mem-list' },
            (list.data?.entries ?? []).map((e) => h('div', { className: 'tdai-mem-card', key: e.path },
              h('h4', null, e.path),
              h('div', { className: 'tdai-mem-note' }, `${e.summary ?? ''} · 更新 ${e.updated_at ?? ''}`),
              h('div', { className: 'tdai-mem-actions' },
                h('button', { className: 'tdai-mem-btn', disabled: busy, onClick: () => open(e.path) }, '读取/编辑')))))))
    }

    // ── L3 画像：查看 + 编辑 ─────────────────────────────────
    const L3View = () => {
      const file = useLoader(() => api('/tdai-memory/l3/read'))
      const [content, setContent] = useState('')
      const [saved, setSaved] = useState(false)
      useEffect(() => { if (file.data?.file?.content != null) setContent(file.data.file.content) }, [file.data])
      const save = async () => {
        setSaved(false)
        try { await api('/tdai-memory/l3/write', { content }); await file.reload(); setSaved(true) }
        catch (e) { file.error = String(e?.message ?? e) }
      }
      return h(LoadBox, { state: file },
        h('div', { className: 'tdai-mem-card' },
          h('div', { className: 'tdai-mem-note' }, `L3 用户画像 · 更新 ${file.data?.file?.updated_at ?? '从未生成'}`),
          h('textarea', { className: 'tdai-mem-textarea', style: { minHeight: 380 }, value: content, onChange: (e) => setContent(e.target.value) }),
          h('div', { className: 'tdai-mem-actions' },
            h('button', { className: 'tdai-mem-btn primary', onClick: save }, '保存画像'),
            saved && h('span', { className: 'tdai-mem-note' }, '已保存')))
      )
    }

    // ── 知识库：Wiki / CodeGraph 管理 ────────────────────────
    const KnowledgeView = () => {
      const overview = useLoader(() => api('/tdai-memory/overview'))
      const k = overview.data?.knowledge
      const [wikiName, setWikiName] = useState('')
      const [docName, setDocName] = useState('')
      const [docContent, setDocContent] = useState('')
      const [repoUrl, setRepoUrl] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const act = async (path, body) => {
        setBusy(true); setNotice('')
        try { await api(path, body); setNotice('已提交'); await overview.reload() }
        catch (e) { setNotice('失败：' + String(e?.message ?? e)) }
        finally { setBusy(false) }
      }
      return h('div', null,
        h(LoadBox, { state: overview },
          h('div', { className: 'tdai-mem-card' },
            h('h4', null, k?.enabled === false ? '知识服务未启用' : (k?.health?.error ? '知识服务离线' : '知识服务在线')),
            !k?.health?.error && k?.enabled !== false && h('div', { className: 'tdai-mem-note' }, `Wiki ${k?.wikis?.items?.length ?? 0} 个 · CodeGraph ${k?.graphs?.items?.length ?? 0} 个`),
            k?.enabled !== false && h('div', { className: 'tdai-mem-row' },
              h('div', { className: 'tdai-mem-note' }, '新建 LLM-Wiki（写入一篇文档并触发提取）'),
              h('input', { className: 'tdai-mem-input', placeholder: 'Wiki 名称', value: wikiName, onChange: (e) => setWikiName(e.target.value) }),
              h('input', { className: 'tdai-mem-input', placeholder: '文档文件名', value: docName, onChange: (e) => setDocName(e.target.value) }),
              h('textarea', { className: 'tdai-mem-textarea', style: { minHeight: 100 }, placeholder: '文档内容', value: docContent, onChange: (e) => setDocContent(e.target.value) }),
              h('button', { className: 'tdai-mem-btn primary', disabled: busy, onClick: () => act('/tdai-memory/wiki/create', { name: wikiName, document: { filename: docName || 'notes.md', content: docContent } }) }, busy ? '提交中…' : '创建 Wiki')),
            k?.enabled !== false && h('div', { className: 'tdai-mem-row' },
              h('div', { className: 'tdai-mem-note' }, '新建 CodeGraph'),
              h('input', { className: 'tdai-mem-input', placeholder: 'https://github.com/owner/repo.git', value: repoUrl, onChange: (e) => setRepoUrl(e.target.value) }),
              h('button', { className: 'tdai-mem-btn primary', disabled: busy, onClick: () => act('/tdai-memory/codegraph/create', { repo_url: repoUrl }) }, busy ? '提交中…' : '添加仓库')),
            notice && h('div', { className: 'tdai-mem-note' }, notice))))
    }

    const TABS = [
      ['l0', 'L0 对话'],
      ['l1', 'L1 记忆'],
      ['l2', 'L2 场景'],
      ['l3', 'L3 画像'],
      ['knowledge', '知识库'],
    ]

    const MemoryView = () => {
      const [tab, setTab] = useState('l0')
      return h('div', { className: 'tdai-mem-view' },
        h('h2', { className: 'tdai-mem-title' }, '记忆与知识'),
        h('div', { className: 'tdai-mem-sub' }, 'TencentDB Agent Memory · 个人记忆库 · 可查看与编辑'),
        h('div', { className: 'tdai-mem-tabs' },
          TABS.map(([id, label]) => h('button', {
            key: id,
            className: 'tdai-mem-tab' + (tab === id ? ' on' : ''),
            onClick: () => setTab(id),
          }, label))),
        tab === 'l0' ? h(L0View)
          : tab === 'l1' ? h(L1View)
          : tab === 'l2' ? h(L2View)
          : tab === 'l3' ? h(L3View)
          : h(KnowledgeView))
    }

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)

      // 与「对话 / 轨迹 / 用量」并列的独立页签，不再进设置。
      slots.inject('conversation.view', () => slots.register(
        {
          name: 'conversation.view',
          id: 'tdai-memory',
          order: 30,
          label: '记忆',
          registrant: 'dsh-plugin-memory-tencentdb',
        },
        () => h(MemoryView),
      ))

      return () => { style.remove() }
    }

    exports.apply = apply
    return module.exports
  },
})
