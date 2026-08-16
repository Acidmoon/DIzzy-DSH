/**
 * grok-parse.js 行为测试(不打网、不碰 credentials)。
 * 跑:`node --test plugins/balance/grok-parse.test.js`
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCreditsResponse,
  parseStoredToken,
  toRefreshedToken,
  remainingFromUsed,
  readCentVal,
  labelProduct,
  formatQuotaText,
} from './grok-parse.js'

describe('remainingFromUsed', () => {
  it('floors used then complements to 100', () => {
    assert.equal(remainingFromUsed(76), 24)
    assert.equal(remainingFromUsed(0), 100)
    assert.equal(remainingFromUsed(100), 0)
    assert.equal(remainingFromUsed(-4), 100)
    assert.equal(remainingFromUsed(142), 0)
    assert.equal(remainingFromUsed(33.34), 67)
    assert.equal(remainingFromUsed(99.994), 1)
  })
})

describe('readCentVal', () => {
  it('treats omitted proto3 zero as 0', () => {
    assert.equal(readCentVal({}), 0)
    assert.equal(readCentVal({ val: 1250 }), 1250)
    assert.equal(readCentVal(undefined), null)
  })
})

describe('labelProduct', () => {
  it('maps official enum names and leaves unknown raw', () => {
    assert.equal(labelProduct('PRODUCT_GROK_BUILD'), 'Build')
    assert.equal(labelProduct('4'), '4')
    assert.equal(labelProduct('5'), '5')
  })
})

describe('parseCreditsResponse', () => {
  it('prefers creditUsagePercent and currentPeriod', () => {
    const snap = parseCreditsResponse({
      config: {
        creditUsagePercent: 76,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-08-13T11:49:10.218992Z',
          end: '2026-08-20T11:49:10.218992Z',
        },
        productUsage: [
          { product: 'PRODUCT_GROK_BUILD', usagePercent: 69 },
          { product: 4, usagePercent: 7 },
        ],
        prepaidBalance: { val: 100 },
        isUnifiedBillingUser: true,
        monthlyLimit: { val: 9999 },
        used: { val: 1 },
      },
      subscriptionTier: 'SuperGrok',
    })
    assert.equal(snap.status, 'ok')
    assert.equal(snap.creditUsagePercent, 76)
    assert.equal(snap.remainingPercent, 24)
    assert.equal(snap.periodType, 'USAGE_PERIOD_TYPE_WEEKLY')
    assert.equal(snap.periodEnd, '2026-08-20T11:49:10.218992Z')
    assert.equal(snap.subscriptionTier, 'SuperGrok')
    assert.equal(snap.prepaidBalanceCents, 100)
    assert.equal(snap.isUnified, true)
    assert.deepEqual(snap.products, [
      { id: 'PRODUCT_GROK_BUILD', name: 'Build', usagePercent: 69 },
      { id: '4', name: '4', usagePercent: 7 },
    ])
  })

  it('treats omitted percent plus valid period as genuine 0%', () => {
    const snap = parseCreditsResponse({
      config: {
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-08-13T00:00:00Z',
          end: '2026-08-20T00:00:00Z',
        },
        monthlyLimit: { val: 2000 },
        used: { val: 1800 },
      },
    })
    assert.equal(snap.status, 'ok')
    assert.equal(snap.creditUsagePercent, 0)
    assert.equal(snap.remainingPercent, 100)
  })

  it('treats type-only currentPeriod as the new ledger', () => {
    const snap = parseCreditsResponse({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
        monthlyLimit: { val: 2000 },
        used: { val: 1800 },
      },
    })
    assert.equal(snap.status, 'ok')
    assert.equal(snap.creditUsagePercent, 0)
    assert.equal(snap.periodType, 'USAGE_PERIOD_TYPE_WEEKLY')
  })

  it('does not derive weekly percent from deprecated monthly cents', () => {
    const snap = parseCreditsResponse({
      config: {
        monthlyLimit: { val: 2000 },
        used: { val: 500 },
        billingPeriodStart: '2026-08-01T00:00:00Z',
        billingPeriodEnd: '2026-09-01T00:00:00Z',
      },
    })
    assert.equal(snap.creditUsagePercent, null)
    assert.equal(snap.remainingPercent, null)
    assert.equal(snap.periodStart, null)
    assert.equal(snap.periodEnd, null)
    assert.equal(snap.status, 'legacy')
  })

  it('marks missing config as empty', () => {
    const snap = parseCreditsResponse({ config: null })
    assert.equal(snap.status, 'empty')
    assert.equal(snap.creditUsagePercent, null)
  })

  it('accepts subscription tier from extra over body', () => {
    const snap = parseCreditsResponse(
      { config: { creditUsagePercent: 1, currentPeriod: { end: '2026-08-20T00:00:00Z' } } },
      { subscriptionTier: 'SuperGrok Heavy' },
    )
    assert.equal(snap.subscriptionTier, 'SuperGrok Heavy')
  })
})

describe('parseStoredToken', () => {
  it('accepts subscription-auth JSON and rejects junk', () => {
    const ok = parseStoredToken(JSON.stringify({
      refresh: 'r',
      access: 'a',
      expires: 1,
      accountId: 'sub',
    }))
    assert.equal(ok?.access, 'a')
    assert.equal(ok?.accountId, 'sub')
    assert.equal(parseStoredToken('not-json'), undefined)
    assert.equal(parseStoredToken('{"access":"a"}'), undefined)
  })
})

describe('formatQuotaText', () => {
  it('does not mention account or tokens', () => {
    const text = formatQuotaText({
      status: 'ok',
      creditUsagePercent: 76,
      remainingPercent: 24,
      periodEnd: '2026-08-20T11:49:10.218992Z',
      subscriptionTier: 'SuperGrok',
      products: [{ id: '4', name: 'Chat', usagePercent: 7 }],
      error: null,
    })
    assert.match(text, /SuperGrok/)
    assert.match(text, /周额度/)
    assert.match(text, /已用 76%/)
    assert.match(text, /剩 24%/)
    assert.doesNotMatch(text, /Chat/)
    assert.doesNotMatch(text, /refresh|access|@|account/i)
  })

  it('labels monthly periods without calling them weekly', () => {
    const text = formatQuotaText({
      status: 'ok',
      creditUsagePercent: 10,
      remainingPercent: 90,
      periodEnd: '2026-09-01T00:00:00Z',
      periodType: 'USAGE_PERIOD_TYPE_MONTHLY',
      subscriptionTier: 'Grok',
      products: [],
      error: null,
    })
    assert.match(text, /月额度/)
    assert.doesNotMatch(text, /周额度/)
  })

  it('points unauthenticated users at subscription settings', () => {
    const text = formatQuotaText({
      status: 'unauthenticated',
      creditUsagePercent: null,
      remainingPercent: null,
      periodEnd: null,
      subscriptionTier: null,
      products: [],
      error: '未登录 Grok 订阅',
    })
    assert.match(text, /设置 → 订阅服务/)
  })

  it('keeps reauth wording when the session expired', () => {
    const text = formatQuotaText({
      status: 'unauthenticated',
      creditUsagePercent: null,
      remainingPercent: null,
      periodEnd: null,
      subscriptionTier: null,
      products: [],
      error: '登录已失效,请在设置 → 订阅服务重新登录 Grok',
    })
    assert.match(text, /登录已失效/)
  })
})

describe('toRefreshedToken', () => {
  it('keeps fallback refresh when response omits it', () => {
    const before = Date.now()
    const next = toRefreshedToken({ access_token: 'new', expires_in: 10 }, 'old-refresh')
    assert.equal(next.access, 'new')
    assert.equal(next.refresh, 'old-refresh')
    assert.ok(next.expires >= before + 10_000)
  })
})
