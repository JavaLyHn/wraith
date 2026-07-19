import type { PetView } from './pets'

export interface Box { x: number; y: number; width: number; height: number }

export function isOpaqueAt(data: Uint8ClampedArray | number[], sheetWidth: number, px: number, py: number, threshold = 16): boolean {
  if (px < 0 || py < 0) return false
  const idx = (py * sheetWidth + px) * 4 + 3
  return idx >= 0 && idx < data.length && (data[idx] as number) > threshold
}

export function stepScale(current: number, deltaY: number, min = 0.5, max = 2.0, step = 0.1): number {
  const next = current + (deltaY < 0 ? step : -step)
  return Math.min(max, Math.max(min, Math.round(next * 100) / 100))
}

export function clampToDisplay(box: Box, workArea: Box): Box {
  const x = Math.min(Math.max(box.x, workArea.x), workArea.x + Math.max(0, workArea.width - box.width))
  const y = Math.min(Math.max(box.y, workArea.y), workArea.y + Math.max(0, workArea.height - box.height))
  return { x, y, width: box.width, height: box.height }
}

export function defaultPetPosition(workArea: Box, size: { width: number; height: number }, margin = 24): { x: number; y: number } {
  return { x: workArea.x + workArea.width - size.width - margin, y: workArea.y + workArea.height - size.height - margin }
}

export interface PetMenuItem { id: string; label: string; type?: 'separator' | 'checkbox' | 'submenu'; checked?: boolean; submenu?: PetMenuItem[] }

export function buildPetMenuTemplate(pets: PetView[], config: { selectedId: string | null; scale: number }): PetMenuItem[] {
  return [
    { id: 'pet:select', label: '选择宠物', type: 'submenu', submenu: pets.map(p => ({
      id: `pet:select:${p.id}`, label: p.displayName, type: 'checkbox', checked: p.available && config.selectedId === p.id,
    })) },
    { id: 'pet:scale', label: '缩放', type: 'submenu', submenu: [0.5, 1, 1.5, 2].map(s => ({
      id: `pet:scale:${s}`, label: `${Math.round(s * 100)}%`, type: 'checkbox', checked: Math.abs(config.scale - s) < 0.001,
    })) },
    { id: 'pet:reset-position', label: '重置位置' },
    { id: 'sep', label: '', type: 'separator' },
    { id: 'pet:close', label: '关闭宠物' },
  ]
}
