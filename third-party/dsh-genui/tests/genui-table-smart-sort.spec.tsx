// @vitest-environment jsdom
// Table smart-sort / numeric alignment / chart polish / live-region a11y.
// The sortable-table upgrade (0.9): human-written cells like `1,234`, `1.2k`,
// `3.5万`, `0.3%`, `¥99` compare as real numbers instead of strings, numeric
// columns right-align, and the button/copy confirmations announce via hidden
// live regions (button content is atomic to screen readers).
import { cleanup, fireEvent, render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock, GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { parseSortableNumber } from '../src/client/blocks/charts.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

function renderBlock(items: unknown[]) {
  const spec = repairGenuiSpec({ items })!
  const out = render(<GenuiBlock spec={spec} />)
  return out.container
}

const bodyRows = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '')

describe('parseSortableNumber', () => {
  it('reads plain numbers and numeric strings', () => {
    expect(parseSortableNumber(42)).toBe(42)
    expect(parseSortableNumber('10')).toBe(10)
    expect(parseSortableNumber('-3')).toBe(-3)
  })
  it('strips thousands separators (ASCII and full-width)', () => {
    expect(parseSortableNumber('1,234')).toBe(1234)
    expect(parseSortableNumber('1，234')).toBe(1234)
    expect(parseSortableNumber('1,299.5')).toBe(1299.5)
  })
  it('expands k/m/b suffixes and 万/亿', () => {
    expect(parseSortableNumber('1.2k')).toBe(1200)
    expect(parseSortableNumber('3M')).toBe(3_000_000)
    expect(parseSortableNumber('2b')).toBe(2_000_000_000)
    expect(parseSortableNumber('3.5万')).toBe(35_000)
    expect(parseSortableNumber('2亿')).toBe(200_000_000)
  })
  it('handles percent and currency decorations', () => {
    expect(parseSortableNumber('0.3%')).toBe(0.3)
    expect(parseSortableNumber('¥99')).toBe(99)
    expect(parseSortableNumber('$1,200')).toBe(1200)
  })
  it('returns NaN for non-numeric cells', () => {
    expect(parseSortableNumber('abc')).toBeNaN()
    expect(parseSortableNumber('')).toBeNaN()
    expect(parseSortableNumber(null)).toBeNaN()
    expect(parseSortableNumber(Number.NaN)).toBeNaN()
  })
})

describe('table smart sorting', () => {
  it('orders decorated values numerically, not lexically', () => {
    const container = renderBlock([{ type: 'table', columns: ['名称', '数量'], rows: [
      ['A', '1.2k'], ['B', '950'], ['C', '1,100'], ['D', '3万'],
    ] }])
    const header = container.querySelectorAll('thead th button')[1]!
    fireEvent.click(header)
    // 950 < 1,100 < 1.2k < 3万
    expect(bodyRows(container)).toEqual(['B950', 'C1,100', 'A1.2k', 'D3万'])
    expect(header.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
  })

  it('keeps mixed columns deterministic: numbers first, then text', () => {
    const container = renderBlock([{ type: 'table', columns: ['名称', '列'], rows: [
      ['A', '10'], ['B', 'x'], ['C', '5'],
    ] }])
    const header = container.querySelectorAll('thead th button')[1]!
    fireEvent.click(header)
    expect(bodyRows(container)).toEqual(['C5', 'A10', 'Bx'])
  })

  it('sorts percentages as numbers across a boundary (9.9% < 10%)', () => {
    const container = renderBlock([{ type: 'table', columns: ['月', '率'], rows: [
      ['一月', '9.9%'], ['二月', '10%'],
    ] }])
    const header = container.querySelectorAll('thead th button')[1]!
    fireEvent.click(header)
    expect(bodyRows(container)).toEqual(['一月9.9%', '二月10%'])
  })
})

describe('table numeric column alignment', () => {
  it('right-aligns fully numeric columns and leaves text columns alone', () => {
    const container = renderBlock([{ type: 'table', columns: ['名称', '数量'], rows: [
      ['A', '1.2k'], ['B', '950'],
    ] }])
    const rows = container.querySelectorAll('tbody tr')
    const first = rows[0]!.querySelectorAll('td')
    expect(first[0]!.className).not.toContain('tdNum')
    expect(first[1]!.className).toContain('tdNum')
    const ths = container.querySelectorAll('thead th')
    expect(ths[0]!.className).not.toContain('thNum')
    expect(ths[1]!.className).toContain('thNum')
  })

  it('treats a column with any non-numeric cell as text', () => {
    const container = renderBlock([{ type: 'table', columns: ['名称', '列'], rows: [
      ['A', '10'], ['B', 'x'],
    ] }])
    const cell = container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[1]!
    expect(cell.className).not.toContain('tdNum')
  })
})

describe('chart polish', () => {
  it('rounds a fractional donut total to one decimal', () => {
    const container = renderBlock([{ type: 'chart', kind: 'donut', data: [
      { label: 'A', value: 3.3 }, { label: 'B', value: 6.6 },
    ] }])
    const totals = [...container.querySelectorAll('text')].map(t => t.textContent)
    // 3.3 + 6.6 floats to 9.899999999999999 — the label must read 9.9.
    expect(totals).toContain('9.9')
    expect(totals).not.toContain('9.899999999999999')
  })

  it('keeps the integer total integer', () => {
    const container = renderBlock([{ type: 'chart', kind: 'donut', data: [
      { label: 'A', value: 30 }, { label: 'B', value: 70 },
    ] }])
    const totals = [...container.querySelectorAll('text')].map(t => t.textContent)
    expect(totals).toContain('100')
  })
})

describe('live-region confirmations (a11y)', () => {
  it('announces 已复制 to clipboard through a hidden status region', () => {
    const container = renderBlock([{ type: 'copy', label: '复制', text: 'xyz' }])
    fireEvent.click(container.querySelector('button')!)
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status!.textContent).toBe('已复制到剪贴板')
    // visually hidden, not merely display-less
    expect((status! as HTMLElement).className).toContain('visuallyHidden')
  })

  it('announces 已触发 next to an actionable button', () => {
    vi.useFakeTimers()
    try {
      const actions: Array<[string, Record<string, unknown>]> = []
      const spec = repairGenuiSpec({ items: [{ type: 'button', label: '刷新', action: 'refresh' }] })!
      const { container } = render(
        <GenuiActionContext.Provider value={(action, payload) => { actions.push([action, payload]) }}>
          <GenuiBlock spec={spec} />
        </GenuiActionContext.Provider>,
      )
      fireEvent.click(container.querySelector('button')!)
      // the block-level action debounce (300ms) delivers the action
      act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
      expect(actions).toHaveLength(1)
      expect(container.querySelector('[role="status"]')!.textContent).toBe('已触发')
      expect(container.querySelector('button')!.textContent).toContain('已触发')
    } finally {
      vi.useRealTimers()
    }
  })
})
