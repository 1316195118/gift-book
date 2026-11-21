import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeModal, modal, openModal, runModalAction } from '../modal.js'

afterEach(() => {
  closeModal(true)
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('弹窗动作关闭顺序', () => {
  it('先同步读取弹窗内输入，再关闭并等待一帧后执行动作', async () => {
    const input = document.createElement('textarea')
    input.id = 'modal-remarks-input'
    input.value = '同学代送'
    document.body.appendChild(input)
    openModal('确认', { type: 'html', html: '' }, [])
    const order = []

    await runModalAction({
      text: '确定',
      beforeClose: () => order.push(`read:${input.value}:${modal.open}`),
      handler: async () => order.push(`run:${modal.open}`),
    })

    expect(order).toEqual(['read:同学代送:true', 'run:false'])
  })

  it('关闭前取值失败也先关闭，不把菜单卡在屏幕上', async () => {
    openModal('确认', { type: 'html', html: '' }, [])
    const handler = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await runModalAction({
      text: '确定',
      beforeClose: () => { throw new Error('DOM 已卸载') },
      handler,
    })

    expect(modal.open).toBe(false)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('明确保留弹窗的动作仍可在打开状态下显示进度', async () => {
    openModal('同步', { type: 'html', html: '' }, [])
    let openWhenRunning = false

    await runModalAction({
      text: '同步',
      keepOpen: true,
      handler: () => { openWhenRunning = modal.open },
    })

    expect(openWhenRunning).toBe(true)
    expect(modal.open).toBe(true)
  })
})
