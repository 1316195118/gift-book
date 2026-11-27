import { beforeEach, describe, expect, it } from 'vitest'
import {
  CATEGORY_KEYS,
  getEnabledCategories,
  getHomeCategory,
  saveEnabledCategories,
  setHomeCategory,
} from '../prefs.js'

const ENABLED_KEY = 'giftbook_enabled_categories.v1'

beforeEach(() => {
  localStorage.clear()
})

describe('首页分类显示偏好', () => {
  it('默认显示三种分类，并按固定顺序去重', () => {
    expect(getEnabledCategories()).toEqual(CATEGORY_KEYS)
    expect(saveEnabledCategories(['custom', 'red', 'custom', 'unknown'])).toEqual(['red', 'custom'])
  })

  it('保存后重新读取仍保持所选分类', () => {
    saveEnabledCategories(['white', 'custom'])
    expect(localStorage.getItem(ENABLED_KEY)).toBe(JSON.stringify(['white', 'custom']))
    expect(getEnabledCategories()).toEqual(['white', 'custom'])
  })

  it('全部取消或存储损坏时安全回退为全部显示', () => {
    expect(saveEnabledCategories([])).toEqual(CATEGORY_KEYS)
    localStorage.setItem(ENABLED_KEY, '{broken')
    expect(getEnabledCategories()).toEqual(CATEGORY_KEYS)
  })
})

describe('首页当前分类', () => {
  it('只接受三个有效分类，其他值回退红事', () => {
    setHomeCategory('white')
    expect(getHomeCategory()).toBe('white')
    setHomeCategory('other')
    expect(getHomeCategory()).toBe('red')
  })
})
