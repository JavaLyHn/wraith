// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import PetsSettings from '../src/renderer/components/PetsSettings'
import type { PetConfig } from '../src/main/settings'
import type { PetView } from '../src/shared/pets'

const FIXED_CONFIG: PetConfig = {
  enabled: true,
  selectedId: 'noir-webling',
  motion: 'calm',
  scale: 1,
  position: null,
  locked: false,
}

const PETS: PetView[] = [
  { id: 'noir-webling', displayName: '暗影蛛', description: '', source: 'petdex', kind: 'static', available: true, removable: false, previewUrl: null, sprite: null },
  { id: 'my-imported', displayName: '自定义', description: '', source: 'imported', kind: 'static', available: true, removable: true, previewUrl: null, sprite: null },
]

function installWraithMock(config: PetConfig = FIXED_CONFIG): {
  petSetConfig: ReturnType<typeof vi.fn>
  onConfigCb: ((c: PetConfig) => void) | null
} {
  const petSetConfig = vi.fn((patch: Partial<PetConfig>) => Promise.resolve({ ...config, ...patch }))
  const state: { onConfigCb: ((c: PetConfig) => void) | null } = { onConfigCb: null }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = {
    petGetConfig: vi.fn(() => Promise.resolve(config)),
    petSetConfig,
    onPetConfig: vi.fn((cb: (c: PetConfig) => void) => {
      state.onConfigCb = cb
      return () => { state.onConfigCb = null }
    }),
    petsList: vi.fn(() => Promise.resolve({ pets: PETS })),
    petsPreview: vi.fn(() => Promise.resolve(null)),
    petsImportImage: vi.fn(() => Promise.resolve({})),
    petsImportPackage: vi.fn(() => Promise.resolve({})),
    petsRemove: vi.fn(() => Promise.resolve()),
  }
  return { petSetConfig, onConfigCb: state.onConfigCb }
}

describe('PetsSettings', () => {
  beforeEach(() => {
    installWraithMock()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('挂载后拉取配置,开关调用 petSetConfig({ enabled })', async () => {
    render(<PetsSettings />)
    const toggle = await screen.findByTestId('pet-enabled')
    fireEvent.click(toggle)
    await waitFor(() => {
      const wraith = (window as unknown as { wraith: { petSetConfig: ReturnType<typeof vi.fn> } }).wraith
      expect(wraith.petSetConfig).toHaveBeenCalledWith({ enabled: false })
    })
  })

  it('缩放滑块 min=0.5 max=2', async () => {
    render(<PetsSettings />)
    const slider = await screen.findByTestId('pet-scale') as HTMLInputElement
    expect(slider.getAttribute('min')).toBe('0.5')
    expect(slider.getAttribute('max')).toBe('2')
  })

  it('点某宠物卡片调用 petSetConfig({ selectedId })', async () => {
    render(<PetsSettings />)
    const card = await screen.findByTestId('pet-card-my-imported')
    fireEvent.click(card)
    await waitFor(() => {
      const wraith = (window as unknown as { wraith: { petSetConfig: ReturnType<typeof vi.fn> } }).wraith
      expect(wraith.petSetConfig).toHaveBeenCalledWith({ selectedId: 'my-imported' })
    })
  })

  it('config 为 null(尚未拉取)时不崩溃', () => {
    ;(window as unknown as { wraith: Record<string, unknown> }).wraith = {
      petGetConfig: vi.fn(() => new Promise(() => {})), // 永不 resolve,模拟 initial async
      onPetConfig: vi.fn(() => () => {}),
      petsList: vi.fn(() => Promise.resolve({ pets: PETS })),
      petsPreview: vi.fn(() => Promise.resolve(null)),
      petsImportImage: vi.fn(() => Promise.resolve({})),
      petsImportPackage: vi.fn(() => Promise.resolve({})),
      petsRemove: vi.fn(() => Promise.resolve()),
    }
    expect(() => render(<PetsSettings />)).not.toThrow()
  })
})
