import type { PetView } from './pets'

export interface Box { x: number; y: number; width: number; height: number }

export function isOpaqueAt(data: Uint8ClampedArray | number[], sheetWidth: number, px: number, py: number, threshold = 16): boolean {
  if (px < 0 || py < 0) return false
  const idx = (py * sheetWidth + px) * 4 + 3
  return idx >= 0 && idx < data.length && (data[idx] as number) > threshold
}

/** 单张静态图片的紧凑固定尺寸上限(与精灵表 192×208 量级一致)。PetSprite 与
 * PetWindowApp(点击穿透命中测试,Task 8)共用同一个值,避免两处各写一份 112 magic
 * number 而悄悄失步——命中测试算的缩放比必须与实际渲染尺寸严格一致,否则命中会偏。 */
export const STATIC_IMAGE_MAX_PX = 112

/**
 * 单图案例下「按 CSS max-width/max-height 等比收缩、绝不放大」的比例(Task 8)。
 * naturalW×naturalH 是图片原始像素尺寸,maxPx 是收缩方框边长;取三者中更小的收缩比
 * (宽/高各自需要的比例中更严格的那个,以及 1 本身防止放大)。非正宽高/maxPx 一律
 * 兜底返回 1(不缩放),避免除零或产生 NaN/Infinity。
 */
export function containScale(naturalW: number, naturalH: number, maxPx: number): number {
  if (naturalW <= 0 || naturalH <= 0 || maxPx <= 0) return 1
  return Math.min(1, maxPx / naturalW, maxPx / naturalH)
}

/**
 * 点击穿透(Task 8)的核心坐标反算:窗口/CSS 指针坐标 → 精灵表(或单图)sheet 像素。
 *
 * 前提(见 PetSprite 的 CSS-尺寸缩放改法,修掉 Task 7 遗留的居中裁切歧义):精灵/图片
 * 以窗口左上角为原点渲染,占用的 CSS 盒子精确是 `frameW*scale × frameH*scale`——
 * 不使用 `transform: scale`(那样 transform-origin 默认居中,窗口坐标与像素坐标的
 * 对应关系随 scale 漂移,无法唯一反算)。scale 就是"1 个 sheet 像素对应几个 CSS 像素"
 * 的比例,因此反算是除法:sheetPx = frameOrigin + clientPx / scale。
 *
 * col/row 定位当前展示的那一帧(单图场景固定 (0,0)、frameW/frameH 用图片原始宽高即可,
 * 此时该函数退化成"整图命中测试",与精灵表复用同一套除法逻辑)。
 *
 * 指针落在精灵盒之外——含窗口右/下侧因 PET_WINDOW_PAD 留出的死区,那部分从来没画过
 * 精灵/图片像素——直接返回 null,调用方应视为"未命中"(透明穿透),绝不能拿越界坐标
 * 去 isOpaqueAt 误采到相邻帧/相邻格的像素。scale<=0 同样返回 null(防除零/负除)。
 */
export function spriteHitPixel(
  clientX: number,
  clientY: number,
  scale: number,
  col: number,
  row: number,
  frameW: number,
  frameH: number
): { px: number; py: number } | null {
  if (scale <= 0) return null
  const boxW = frameW * scale
  const boxH = frameH * scale
  if (clientX < 0 || clientY < 0 || clientX >= boxW || clientY >= boxH) return null
  return {
    px: Math.floor(col * frameW + clientX / scale),
    py: Math.floor(row * frameH + clientY / scale),
  }
}

// 缩放夹取:夹到 [min,max] 并四舍五入到两位小数(消抖)。滚轮步进(stepScale)与
// 触控板捏合手势(PetWindowApp 的 gesturechange:起始缩放 × e.scale)共用同一夹取,
// [0.5,2.0] 只此一处定义。
export function clampScale(value: number, min = 0.5, max = 2.0): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100))
}

export function stepScale(current: number, deltaY: number, min = 0.5, max = 2.0, step = 0.1): number {
  return clampScale(current + (deltaY < 0 ? step : -step), min, max)
}

export function clampToDisplay(box: Box, workArea: Box): Box {
  const x = Math.min(Math.max(box.x, workArea.x), workArea.x + Math.max(0, workArea.width - box.width))
  const y = Math.min(Math.max(box.y, workArea.y), workArea.y + Math.max(0, workArea.height - box.height))
  return { x, y, width: box.width, height: box.height }
}

export function defaultPetPosition(workArea: Box, size: { width: number; height: number }, margin = 24): { x: number; y: number } {
  return { x: workArea.x + workArea.width - size.width - margin, y: workArea.y + workArea.height - size.height - margin }
}

/** 全局宠物窗口是否应该显示:总开关打开 且 存在可用宠物(否则无物可画)。 */
export function shouldShowPet(config: { enabled: boolean }, hasAvailablePet: boolean): boolean {
  return config.enabled && hasAvailablePet
}

export interface PetMenuItem { id: string; label: string; type?: 'separator' | 'checkbox' | 'submenu'; checked?: boolean; submenu?: PetMenuItem[] }

export function buildPetMenuTemplate(pets: PetView[], config: { selectedId: string | null; scale: number }): PetMenuItem[] {
  return [
    { id: 'pet:select', label: '选择宠物', type: 'submenu', submenu: pets.filter(p => p.available).map(p => ({
      id: `pet:select:${p.id}`, label: p.displayName, type: 'checkbox', checked: config.selectedId === p.id,
    })) },
    { id: 'pet:scale', label: '缩放', type: 'submenu', submenu: [0.5, 1, 1.5, 2].map(s => ({
      id: `pet:scale:${s}`, label: `${Math.round(s * 100)}%`, type: 'checkbox', checked: Math.abs(config.scale - s) < 0.001,
    })) },
    { id: 'pet:reset-position', label: '重置位置' },
    { id: 'sep', label: '', type: 'separator' },
    { id: 'pet:close', label: '关闭宠物' },
  ]
}
