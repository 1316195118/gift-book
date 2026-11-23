import { beforeEach, describe, expect, it } from 'vitest'
import { currentOperator, normalizeOperator, recentOperators, rememberOperator } from '../operator.js'

describe('operator identity', () => {
  beforeEach(() => localStorage.clear())

  it('normalizes whitespace and limits length', () => {
    expect(normalizeOperator('  记账   小周  ')).toBe('记账 小周')
    expect(Array.from(normalizeOperator('人'.repeat(30))).length).toBe(20)
    expect(normalizeOperator('   ')).toBe('本机')
  })

  it('remembers the active operator and recent names', () => {
    rememberOperator('新郎', 'family-a')
    rememberOperator('账房', 'family-a')
    expect(currentOperator('family-a')).toBe('账房')
    expect(recentOperators('family-a')).toEqual(['账房', '新郎'])
    expect(currentOperator('family-b')).toBe('本机')
  })

  it('deduplicates recent names and keeps newest first', () => {
    rememberOperator('甲', 'f')
    rememberOperator('乙', 'f')
    rememberOperator('甲', 'f')
    expect(recentOperators('f')).toEqual(['甲', '乙'])
  })
})
