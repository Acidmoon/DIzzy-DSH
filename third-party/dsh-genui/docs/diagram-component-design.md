# dsh-genui `diagram` 组件设计文档(移植 diagram-design)

> 目标:把 [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
> 的 27 种编辑级视觉类型 + 设计系统(语义 token、正交连接器、反模式清单)
> 移植为 dsh-genui 的一等公民组件 `diagram`,让模型能在 ```dsh-ui 围栏里
> 直接输出品牌化、可访问、编辑级的 SVG 图。
>
> 状态:设计定稿(实现前基线)。上游版本:diagram-design v2.4 / dsh-genui 0.8.3。

---

## 1. 设计目标与原则

| 原则 | 含义 |
|---|---|
| **一等公民** | `diagram` 进 spec.ts 白名单 + render-node switch,与 `mermaid`/`plot` 同级,自动获得 guard、流式、持久化、自愈 |
| **声明式 spec** | 模型输出**数据**(节点/边/布局意图),渲染器负责布局与样式——模型不需要手写 SVG path |
| **编辑级默认** | 正交连接器、4px 网格、语义 token、反模式清单全部编码进渲染器,模型无法产出"AI slop" |
| **可访问** | 每个图 `role="img"` + `aria-label`/`aria-describedby`;交互不引入 |
| **上限硬编码** | 节点数、边数、accent 数等沿用 diagram-design 的复杂度预算,守卫层钳制 |
| **轻依赖** | 纯 React + SVG,无 mermaid/three 运行时依赖;不新增资产路由 |

### 与 mermaid 的关系(不重复)

`mermaid` 已覆盖 flowchart/sequence/class/gantt/pie/er/state/journey 的**自动布局**通用图。
`diagram` 定位不同:**编辑级布局**——模型提供坐标意图(或按类型规则自动布局),
渲染器按 diagram-design 规范精确排版。两者并存:用户要"快速自动布局"用 mermaid,
要"编辑级品牌图"用 diagram。

---

## 2. Spec 形状

### 顶层

```json
{
  "type": "diagram",
  "kind": "architecture | flowchart | sequence | state | er | timeline | swimlane | quadrant | radar | loop | nested | tree | org-chart | layers | venn | pyramid | bar | line | gantt | scatter | high-level | process | medallion | data-flow | dp-integration | dp-security-matrix | it-state",
  "title": "可选标题(Instrument Serif)",
  "variant": "light | dark | editorial",
  "nodes": [ ... ],
  "edges": [ ... ],
  "meta": { "focal": 2, "density": 4 }
}
```

- `kind` 决定布局语法与复杂度预算(见 §4)。
- `variant` 缺省跟随宿主主题(`light` 或 `dark`);`editorial` 强制编辑级皮肤。
- 品牌 token 缺省用内置 style-guide 默认;可选 `theme` 字段覆盖(见 §5)。

### 节点 Node

```json
{
  "id": "n1",
  "label": "用户可见名称(Geist sans)",
  "sub": "可选技术子标签(Geist mono)",
  "type": "focal | backend | store | external | input | optional | security",
  "x": 40, "y": 40, "w": 120, "h": 48,
  "tag": "可选类型角标,如 API"
}
```

### 边 Edge

```json
{
  "from": "n1", "to": "n2",
  "label": "可选边标签(≤14 字符,全大写)",
  "kind": "solid | dashed | accent | link",
  "route": "auto | orthogonal | straight"
}
```

### 布局模型

**两种模式,由 `kind` 决定:**

1. **坐标模式**(architecture / it-state / high-level / process / data-flow / dp-* 等自由布局类):
   模型给 `x/y/w/h`,渲染器负责正交连线、端口选择、桥接、边标签遮罩。
2. **规则布局模式**(flowchart / sequence / state / er / timeline / swimlane / quadrant /
   radar / loop / nested / tree / org-chart / layers / venn / pyramid / bar / line /
   gantt / scatter):模型只给数据,渲染器按类型规则自动排版(与 diagram-design
   各 type-*.md 的布局约定一致)。

两种模式都执行**规范强制层**(§6):4px 网格、复杂度预算、反模式检查。

---

## 3. 组件清单(27 种 kind → 渲染策略)

| kind | 布局模式 | 数据形状 | 复杂度预算 |
|---|---|---|---|
| `architecture` | 坐标 | nodes+edges+可zone | ≤9 节点,≤12 边,≤3 zones |
| `it-state` | 坐标 | phase 分组 nodes | ≤9 节点,≤3 阶段 |
| `flowchart` | 规则 | 节点+分支边 | ≤9 节点 |
| `sequence` | 规则 | lifelines+messages | ≤5 lifelines,≤1 fragment |
| `state` | 规则 | states+transitions+guards | ≤9 states |
| `er` | 规则 | entities+fields+relations | ≤8 entities |
| `timeline` | 规则 | events on axis | ≤12 events |
| `swimlane` | 规则 | lanes+steps+handoffs | ≤5 lanes |
| `quadrant` | 规则 | 2 轴 + items | ≤12 items |
| `radar` | 规则 | axes+series | ≤5 axes,≤5 series |
| `loop` | 规则 | hub+stations | ≤8 stations |
| `nested` | 规则 | containment 树 | ≤6 层 |
| `tree` | 规则 | 父子树 | ≤4 深 |
| `org-chart` | 规则 | 归属/汇报树 | ≤12 节点,≤4 深 |
| `layers` | 规则 | 层列表 | ≤6 层 |
| `venn` | 规则 | 集合 | ≤3 圆 |
| `pyramid` | 规则 | 层级值 | ≤6 层 |
| `bar` | 规则 | 类目值 | ≤8 bars |
| `line` | 规则 | 序列点 | ≤5 series |
| `gantt` | 规则 | tasks+phases | ≤12 tasks |
| `scatter` | 规则 | 点 | ≤30 点 |
| `high-level` | 坐标 | 栈+集群 | ≤9 节点 |
| `process` | 坐标 | 多角色步骤+数据交接 | ≤9 节点 |
| `medallion` | 坐标 | 分层数据存储 | ≤9 节点 |
| `data-flow` | 坐标 | 角色+步骤 | ≤9 节点 |
| `dp-integration` | 坐标 | 源→核心→消费者 | ≤9 节点 |
| `dp-security-matrix` | 规则 | 角色×权限矩阵 | ≤9×9 |
| `it-state` | 坐标 | 阶段分组 | ≤9 节点 |

> 具体每个 kind 的 spec 字段与布局规则见 `docs/diagram-kinds.md`(随实现同步生成)。

---

## 4. 设计系统(内置 style-guide,语义 token)

渲染器内置 diagram-design 的默认皮肤,以 CSS 变量或 SVG 常量形式存在:

| 角色 | Light | Dark |
|---|---|---|
| `paper` | `#f5f5f5` | `#2d3142` |
| `paper-2` | `#ececec` | `#393e53` |
| `ink` | `#2d3142` | `#f5f5f5` |
| `muted` | `#4f5d75` | `#bfc0c0` |
| `soft` | `#7a8399` | `#8e98ac` |
| `rule` | `rgba(45,49,66,0.12)` | `rgba(245,245,245,0.12)` |
| `accent` | `#eb6c36` | `#f08a59` |
| `accent-tint` | `rgba(235,108,54,0.08)` | `rgba(240,138,89,0.10)` |
| `link` | `#2e5aa8` | `#6a95d8` |

- **焦点规则**:`accent` 只上 1–2 个元素;spec 的 `meta.focal` 计数,超出降级为 `ink`。
- **节点类型 → 填充/描边**:focal→accent-tint/accent;backend→white/ink;
  store→ink@5%/muted;external→ink@3%/ink@30%;input→muted@10%/soft;
  optional→ink@2%/ink@20% dashed;security→accent@5%/accent@50% dashed。
- **字体栈**:标题 Instrument Serif;节点名 Geist sans 600;子标签/边标签 Geist Mono。
  (渲染器内用 CSS 栈,不强制外链 Google Fonts——宿主已提供字体环境时直接继承。)

### 主题覆盖(可选)

```json
"theme": { "paper": "#fffdf7", "ink": "#2a2416", "accent": "#c94f1e" }
```

渲染器合并进语义 token;未提供字段回退内置默认。PR 阶段先支持整组 token 覆盖,
品牌抓取(onboarding)属于后续迭代(见 §9)。

---

## 5. 渲染器结构

新增 `src/client/blocks/diagram.tsx`(+ 必要时 `diagram/` 子模块):

```
src/client/blocks/diagram/
  index.tsx          # DiagramNode 入口:variant/主题解析、复杂度守卫、a11y 外壳
  layout.ts          # kind → 布局器(坐标透传或规则布局)
  geometry.ts        # 正交连接器(elbow path r=8)、端口选择、桥接、边标签遮罩
  theme.ts           # 语义 token 表 + 主题合并
  kinds/             # 每个规则布局 kind 一个布局器(共 ~27,可分组)
```

**接入点:**
- `src/client/spec.ts` — 新增 `GenuiDiagram` / `GenuiDiagramNode` / `GenuiDiagramEdge` 接口,并入 `GenuiNode` 联合。
- `src/client/blocks/render-node.tsx` — `case 'diagram': return <DiagramNode .../>`。
- `src/client/guard.ts` — 新增 `maxDiagramNodes`(9)/`maxDiagramEdges`(12)/`maxDiagramZones`(3)等上限,
  并在 `repairGenuiSpec` 里按 kind 钳制(未知 kind 降级为 `architecture` 或丢弃)。
- `src/client/GenuiBlock.module.css` — diagram 容器样式(尺寸、边框、可访问焦点)。
- `src/plugin/index.ts` 的 `GENUI_SECTION_TEXT` + `SKILL.md` — 教模型 `diagram` 语法。

**可访问性:** 根 `<svg role="img" aria-label={title ?? kind} aria-describedby=...>`;title/desc 首子元素。

---

## 6. 规范强制层(渲染时硬编码)

与 diagram-design SKILL.md §5–7 对齐,全部在渲染器实现,模型无法绕过:

1. **4px 网格**:所有坐标/尺寸/字号对齐到 4(布局器输出时取整;坐标模式把模型输入 round 到 4)。
2. **正交连接器强制**:非共享轴连线一律 elbow path(`r=8`);斜线连接自动重路由。
3. **端口选择**:垂直为主用顶/底端口,水平为主用左/右端口;同边多端口 fan(≥12px)。
4. **边标签遮罩 + 6–10px 间隙**:标签永远不压线;遮罩不压节点(节点后画)。
5. **桥接/跳线**:交叉时次要边加 hop arc;两条边永不同路径。
6. **z-order**:bg → zones → arrows → labels → nodes。
7. **焦点预算**:accent > `meta.focal` 时降级。
8. **复杂度预算**:按 kind 钳制节点/边/深度,超出截断(守卫层)。
9. **反模式内置**:无阴影、无发光、无 `rounded-2xl`(rx ≤ 8)、无 3 等宽卡、图例在底部条。

---

## 7. 教学(SKILL.md + GENUI_SECTION_TEXT)

- `GENUI_SECTION_TEXT` 增加一行:
  `- diagram: {"type":"diagram","kind":"architecture","nodes":[...],"edges":[...]} — 编辑级品牌图(27 种类型,正交连接器,语义 token;替代 mermaid 的自动布局)`。
- `SKILL.md` 增加 `diagram` 一节:kind 选择表、节点/边字段、布局模式、焦点规则、
  复杂度预算、"何时用 diagram 而非 mermaid"、示例 spec。
- 新增 skill 教学文件 `SKILL.diagram.md`(可选,作为 genui skill 的附属参考)。

---

## 8. 测试

- `tests/genui-diagram.spec.tsx` — 渲染冒烟:每个 kind 至少一个最小 spec 渲染出 `<svg role="img">`。
- `tests/genui-diagram-guard.spec.ts` — 未知 kind 降级;超预算截断;4px 取整;accent 降级。
- `tests/genui-diagram-connector.spec.ts` — 正交路径、端口选择、边标签遮罩、桥接。
- `tests/genui-diagram-a11y.spec.tsx` — aria-label/describedby、无重复 id。
- 回归:现有 `genui.spec.tsx` 全绿(白名单扩展不破坏旧组件)。

---

## 9. 范围与迭代顺序

**v1(本次 PR):**
- 核心渲染器 + 全部 27 kind 的**最小可用布局器**(坐标类完整;规则类用统一
  自动布局器按 kind 参数化,保证每个 kind 能渲染)。
- 内置默认皮肤(light/dark 跟随宿主)、语义 token、焦点规则、复杂度预算、正交连接器。
- spec.ts / guard / render-node / SKILL.md / GENUI_SECTION_TEXT / 测试。

**v2(后续):**
- 每种 kind 的精细布局(swimlane 分栏、sequence lifeline 激活条、radar 网格等)。
- 品牌抓取(onboarding)、编辑级 `editorial` 变体精修、`sketchy`/`terminal` 皮肤。
- drawio/mermaid 导入重绘(对应 diagram-design 的 scripts/*.py)。

**PR 可合入标准:** v1 全部完成;每个 kind 有最小 spec 渲染 + 测试;文档齐全;
现有 0.8.3 功能零回归。

---

## 10. 参考

- diagram-design:[README](https://github.com/cathrynlavery/diagram-design)、
  `skills/diagram-design/SKILL.md`(v2.4)、`references/style-guide.md`、各 `type-*.md`。
- dsh-genui:当前 0.8.3,`src/client/spec.ts`、`blocks/render-node.tsx`、`guard.ts`。
- 移植基线:本仓库 fork,分支 `feat/diagram-component`。
