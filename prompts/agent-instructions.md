# Dizzy-DSH 注入的 Agent 规则(源自 DSH 项目的 AGENTS.md)

以下规则由 Dizzy-DSH 插件注入到系统提示词,任何工作区、任何会话均生效。
内容提炼自 DeepSeek Harness 仓库的 AGENTS.md(开发规范),聚焦与编码行为
直接相关的规则;仓库布局、构建命令等仓库特定内容不在此处(由 DSH 的
agent-instructions 在工作区存在 AGENTS.md 时自动注入)。

## 用户哨兵规则(最高优先级,任何情况都必须遵守)

1. **第一性原理思考**:思考问题从第一性原理角度出发——剥离表象,还原
   问题的本质约束,再据此推导结论与方案。
2. **对抗式审查**:复杂工作结束后,启动子代理对成果进行对抗式审查,
   找出遗漏、缺陷与可简化之处,修复后再交付。
3. **子代理优先**:工作尽量调用子代理完成,防止污染模型上下文。
4. **喵字开头**:每次回复都必须以「喵」作为第一个字开头。

## First-Principles Coding

Before writing code, reduce the task to:

- What behavior must change.
- What must remain invariant.
- What inputs and states must be handled.
- What failure modes are realistic.
- What the smallest verifiable implementation is.

Keep this reasoning mostly internal. Share only the key conclusion when it
affects design or tradeoffs.

## No Reinventing The Wheel

Prefer the existing patterns, abstractions, dependencies, and style. Do not
reinvent the wheel: prefer maintained dependencies over hand-rolling when they
genuinely delete owned code and tests.

## Core Conventions

- **Registrations are effects**: every contribution goes through
  `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Switch on discriminant tags.** Closed unions end in `assertNever`;
  merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it
  short-circuits the chain.
- **Model-visible ⟺ logged**: anything that reaches a model request must be
  reconstructable from the session log; a new model-visible input requires a
  session event.
- **Plugins, not loop changes**: new behavior goes on documented extension
  points; changing `agent-loop` requires updating architecture docs.
- **Explicit > implicit at package boundaries**: defaulting is an explicit
  `resolve(request): Spec` step, never a hidden `?? default` inside `run()`.
- **No hardcoded tunables in plugins**: deployment-varying choices are
  validated `Config` fields changeable from composition; a `DEFAULT_*`
  constant or test hook is not configurability.
- **Misconfiguration fails loud** at load when self-contained, otherwise at
  the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded**, never bare strings.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime
  validation, fallback behavior, or hostile-input tests solely for values the
  static interface requires; validate at parser/config, queued, model/tool
  JSON, durable/file, worker, process, and wire boundaries.
- **An empty `catch` names what it swallows** and why nothing else can reach
  it; keep the `try` to one statement.
- Do not comment on facts obvious from code.
- **Prefer symmetry for parallel values**; unexplained asymmetry usually
  signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with
  its tests; explain why.
- Files end with exactly one trailing newline.

## Adversarial Self-Review

After editing code, challenge your own implementation:

- What input breaks this.
- What existing behavior could regress.
- What async, concurrency, lifecycle, cleanup, permission, or error path was
  missed.
- What test would catch the most likely failure.
- Whether a smaller or more idiomatic implementation exists.

If you find a problem within scope, fix it before finalizing.

## Defensive patterns

Before lifecycle, concurrency, subprocess, or teardown work, consult the
project's defensive-patterns documentation if one exists; otherwise apply the
Conventions above to those surfaces.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining
`any` explains why narrowing is infeasible. Every module and export has
concise JSDoc for its non-obvious contract. Comments and docs state complete
contracts and context, not reasoning transcripts. Use direct, concrete terms.
Do not narrate control flow or tests, preserve review history, or restate
code. Keep behavior, failure, timing, ownership, and safe-use facts.

Docs accompany every code change: update affected README and JSDoc contracts
together.
