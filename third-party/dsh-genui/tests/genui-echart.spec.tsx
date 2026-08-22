// @vitest-environment jsdom
// EChartNode rendering: preset five forms, error fallback, option priority,
// title/height, role=img/aria-label, scatter with CJK labels.
// The echarts engine is mocked via vi.doMock + dynamic import (setup.ts
// loads the real module before the test file, so vi.mock alone can't
// replace it — vi.resetModules + vi.doMock + dynamic import bypasses the
// cache).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { GenuiEChart } from '../src/client/spec'

afterEach(() => {
  cleanup()
})

function fakeInstance() {
  return { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
}

type EChartNodeModule = typeof import('../src/client/EChartNode')

/** Dynamically import EChartNode with echarts-lazy mocked. */
async function importWithMock(
  createChartImpl: (el: HTMLElement, option: unknown, opts?: { height?: number }) => Promise<unknown> | unknown,
): Promise<{ EChartNode: React.ComponentType<{ node: GenuiEChart }> }> {
  vi.resetModules()
  vi.doMock('../src/client/echarts-lazy.ts', () => ({
    createChart: vi.fn(createChartImpl),
  }))
  return (await import('../src/client/EChartNode.tsx')) as EChartNodeModule
}

describe('EChartNode: preset rendering', () => {
  it('renders data-genui-echart container for each preset', async () => {
    for (const preset of ['bar', 'line', 'area', 'pie', 'scatter'] as const) {
      const { EChartNode } = await importWithMock(() => Promise.resolve(fakeInstance()))
      const node: GenuiEChart = { type: 'echart', preset, data: [{ label: 'a', value: 1 }] }
      const { container, unmount } = render(<EChartNode node={node} />)
      await vi.waitFor(() => {
        expect(container.querySelector('[data-genui-echart]')).not.toBeNull()
      })
      unmount()
    }
  })
})

describe('EChartNode: error fallback', () => {
  it('shows error fallback when engine load fails', async () => {
    const { EChartNode } = await importWithMock(() => Promise.reject(new Error('asset 404')))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('ECharts 渲染失败')
    }, { timeout: 3000 })
  })
})

describe('EChartNode: option vs preset', () => {
  it('option takes priority over preset', async () => {
    let capturedOption: unknown
    const { EChartNode } = await importWithMock((_el, option) => {
      capturedOption = option
      return Promise.resolve(fakeInstance())
    })
    const node: GenuiEChart = {
      type: 'echart',
      preset: 'bar',
      option: { title: { text: 'custom' } },
      data: [{ label: 'a', value: 1 }],
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(capturedOption).toBeDefined()
    }, { timeout: 3000 })
    const opt = capturedOption as Record<string, unknown>
    expect(opt.title).toEqual({ text: 'custom' })
    expect(opt.xAxis).toBeUndefined()
  })
})

describe('EChartNode: title and height', () => {
  it('renders title when provided', async () => {
    const { EChartNode } = await importWithMock(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', title: '销售趋势', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-genui-echart]')).not.toBeNull()
    })
    expect(container.textContent).toContain('销售趋势')
  })

  it('applies custom height to canvas', async () => {
    const { EChartNode } = await importWithMock(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', height: 500, data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]') as HTMLElement
    expect(canvas.style.height).toBe('500px')
  })

  it('defaults height to 300px', async () => {
    const { EChartNode } = await importWithMock(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]') as HTMLElement
    expect(canvas.style.height).toBe('300px')
  })
})

describe('EChartNode: accessibility', () => {
  it('renders role=img and aria-label with title', async () => {
    const { EChartNode } = await importWithMock(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', title: '图表', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]')
    expect(canvas?.getAttribute('aria-label')).toBe('图表')
  })

  it('renders aria-label fallback when no title', async () => {
    const { EChartNode } = await importWithMock(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('ECharts chart')
  })
})

describe('EChartNode: scatter with CJK labels', () => {
  it('passes category xAxis with CJK labels (not value axis)', async () => {
    let capturedOption: unknown
    const { EChartNode } = await importWithMock((_el, option) => {
      capturedOption = option
      return Promise.resolve(fakeInstance())
    })
    const node: GenuiEChart = {
      type: 'echart',
      preset: 'scatter',
      data: [{ label: '一月', value: 10 }, { label: '二月', value: 20 }],
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(capturedOption).toBeDefined()
    }, { timeout: 3000 })
    const opt = capturedOption as { xAxis?: { type?: string; data?: string[] } }
    expect(opt.xAxis?.type).toBe('category')
    expect(opt.xAxis?.data).toEqual(['一月', '二月'])
  })
})
