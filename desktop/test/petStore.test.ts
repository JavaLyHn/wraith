import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  importPackage,
  importStaticImage,
  listPets,
  previewDataUrl,
  removeImportedPet,
  validateImageBuffer,
} from '../src/main/petStore'

let root: string
let userDataDir: string
let petdexRoot: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-pets-'))
  userDataDir = path.join(root, 'user-data')
  petdexRoot = path.join(root, 'petdex')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

function png(width = 1, height = 1): Buffer {
  const bytes = Buffer.alloc(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function manifest(id: string, sheet = 'spritesheet.png'): string {
  return JSON.stringify({ id, displayName: id, description: 'test pet', spritesheetPath: sheet })
}

function writePet(base: string, id: string, json = manifest(id), image = png()): void {
  const dir = path.join(base, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'pet.json'), json)
  fs.writeFileSync(path.join(dir, 'spritesheet.png'), image)
}

/** A minimal stored ZIP is enough to exercise path validation before extraction. */
function zipWithEntry(name: string, content: Buffer): Buffer {
  const file = Buffer.alloc(30 + Buffer.byteLength(name) + content.length)
  file.writeUInt32LE(0x04034b50, 0)
  file.writeUInt16LE(20, 4)
  file.writeUInt32LE(content.length, 18)
  file.writeUInt32LE(content.length, 22)
  file.writeUInt16LE(Buffer.byteLength(name), 26)
  file.write(name, 30)
  content.copy(file, 30 + Buffer.byteLength(name))
  const central = Buffer.alloc(46 + Buffer.byteLength(name))
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(content.length, 20)
  central.writeUInt32LE(content.length, 24)
  central.writeUInt16LE(Buffer.byteLength(name), 28)
  central.writeUInt32LE(0, 42)
  central.write(name, 46)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(file.length, 16)
  return Buffer.concat([file, central, end])
}

describe('petStore', () => {
  it('lists a valid Petdex Noir Webling without changing its source directory', async () => {
    writePet(petdexRoot, 'noir-webling')
    const pets = await listPets({ userDataDir, petdexRoot })
    expect(pets.find(pet => pet.id === 'noir-webling')).toMatchObject({ source: 'petdex', available: true, removable: false })
    expect(fs.existsSync(path.join(petdexRoot, 'noir-webling', 'spritesheet.png'))).toBe(true)
  })

  it('lists the optional Noir catalog entry as unavailable when Petdex is absent', async () => {
    const noir = (await listPets({ userDataDir, petdexRoot })).find(pet => pet.id === 'noir-webling')
    expect(noir).toMatchObject({ id: 'noir-webling', displayName: 'Noir Webling', source: 'petdex', available: false, removable: false })
  })

  it('does not follow Petdex manifest or asset symlinks outside a package', async () => {
    const outsideManifest = path.join(root, 'outside.json')
    fs.writeFileSync(outsideManifest, manifest('linked-manifest'))
    const manifestDir = path.join(petdexRoot, 'linked-manifest')
    fs.mkdirSync(manifestDir, { recursive: true })
    fs.symlinkSync(outsideManifest, path.join(manifestDir, 'pet.json'))
    fs.writeFileSync(path.join(manifestDir, 'spritesheet.png'), png())

    const outsideSprite = path.join(root, 'outside.png')
    fs.writeFileSync(outsideSprite, png())
    writePet(petdexRoot, 'linked-asset')
    fs.rmSync(path.join(petdexRoot, 'linked-asset', 'spritesheet.png'))
    fs.symlinkSync(outsideSprite, path.join(petdexRoot, 'linked-asset', 'spritesheet.png'))

    const pets = await listPets({ userDataDir, petdexRoot })
    expect(pets.some(pet => pet.id === 'linked-manifest' || pet.id === 'linked-asset')).toBe(false)
    await expect(previewDataUrl({ userDataDir, petdexRoot, id: 'linked-asset' })).resolves.toBeNull()
  })

  it('rejects an SVG disguised as PNG without creating an import', async () => {
    const source = path.join(root, 'fake.png')
    fs.writeFileSync(source, '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await expect(importStaticImage({ userDataDir, sourcePath: source })).rejects.toThrow('不支持的图片格式')
    expect(fs.existsSync(path.join(userDataDir, 'pets', 'imported'))).toBe(false)
  })

  it('does not replace an existing import when a package is incomplete', async () => {
    const source = path.join(root, 'image.png'); fs.writeFileSync(source, png())
    const old = await importStaticImage({ userDataDir, sourcePath: source })
    const bad = path.join(root, 'bad-pack'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'pet.json'), manifest(old.id))
    await expect(importPackage({ userDataDir, sourcePath: bad })).rejects.toThrow('精灵图')
    expect((await listPets({ userDataDir, petdexRoot })).find(pet => pet.id === old.id)?.kind).toBe('static')
  })

  it('rejects a package with an oversized sprite before committing it', async () => {
    const pack = path.join(root, 'large'); writePet(pack, 'large')
    fs.writeFileSync(path.join(pack, 'large', 'spritesheet.png'), Buffer.alloc(16 * 1024 * 1024 + 1))
    await expect(importPackage({ userDataDir, sourcePath: path.join(pack, 'large') })).rejects.toThrow('精灵图过大')
    expect((await listPets({ userDataDir, petdexRoot })).some(pet => pet.id === 'large')).toBe(false)
  })

  it('rejects a dimension beyond the maximum without Electron', () => {
    expect(() => validateImageBuffer(png(4097, 1), 8 * 1024 * 1024)).toThrow('图片尺寸超限')
  })

  it('rejects Zip Slip entries', async () => {
    const source = path.join(root, 'evil.zip')
    fs.writeFileSync(source, zipWithEntry('../escape.png', png()))
    await expect(importPackage({ userDataDir, sourcePath: source })).rejects.toThrow('非法压缩包路径')
    expect(fs.existsSync(path.join(root, 'escape.png'))).toBe(false)
  })

  it('prefers imported pets over Petdex collisions', async () => {
    writePet(petdexRoot, 'same')
    const pack = path.join(root, 'imported'); writePet(pack, 'same')
    await importPackage({ userDataDir, sourcePath: path.join(pack, 'same') })
    expect((await listPets({ userDataDir, petdexRoot })).find(pet => pet.id === 'same')?.source).toBe('imported')
  })

  it('accepts and propagates a valid Wraith sprite layout', async () => {
    const pack = path.join(root, 'layout')
    writePet(pack, 'layout', JSON.stringify({
      id: 'layout', displayName: 'layout', description: 'test pet', spritesheetPath: 'spritesheet.png',
      sprite: { columns: 4, rows: 3, frameWidth: 64, frameHeight: 80 },
    }))
    const imported = await importPackage({ userDataDir, sourcePath: path.join(pack, 'layout') })
    expect(imported.sprite).toEqual({ columns: 4, rows: 3, frameWidth: 64, frameHeight: 80 })
    expect((await listPets({ userDataDir, petdexRoot })).find(pet => pet.id === 'layout')?.sprite).toEqual(imported.sprite)
  })

  it('rejects conflicting static asset metadata in a spritesheet package', async () => {
    const pack = path.join(root, 'conflict')
    writePet(pack, 'conflict', JSON.stringify({ id: 'conflict', displayName: 'conflict', description: 'test', spritesheetPath: 'spritesheet.png', assetPath: 'image.png' }))
    await expect(importPackage({ userDataDir, sourcePath: path.join(pack, 'conflict') })).rejects.toThrow('冲突')
  })

  it('removes only imported data and keeps a Petdex pet discoverable', async () => {
    writePet(petdexRoot, 'same')
    const pack = path.join(root, 'imported'); writePet(pack, 'same')
    await importPackage({ userDataDir, sourcePath: path.join(pack, 'same') })
    await removeImportedPet({ userDataDir, id: 'same' })
    expect((await listPets({ userDataDir, petdexRoot })).find(pet => pet.id === 'same')?.source).toBe('petdex')
    expect(fs.existsSync(path.join(petdexRoot, 'same', 'spritesheet.png'))).toBe(true)
  })

  it('returns no preview for an unknown id', async () => {
    await expect(previewDataUrl({ userDataDir, petdexRoot, id: 'missing' })).resolves.toBeNull()
  })
})
