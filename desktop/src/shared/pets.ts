export type PetSource = 'built-in' | 'petdex' | 'imported'

export type PetKind = 'static' | 'spritesheet'

export type PetState = 'idle' | 'thinking' | 'tool' | 'approval' | 'success' | 'error'

export type PetMotionStyle = 'calm' | 'float' | 'lively' | 'static'

export interface PetSprite {
  columns: number
  rows: number
  frameWidth: number
  frameHeight: number
}

export interface PetView {
  id: string
  displayName: string
  description: string
  source: PetSource
  kind: PetKind
  available: boolean
  removable: boolean
  previewUrl: string | null
  sprite: PetSprite | null
}

export interface PetImportResult {
  pet: PetView | null
  error: string | null
}
