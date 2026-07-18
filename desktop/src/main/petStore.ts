import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'
import type { PetKind, PetSprite, PetView } from '../shared/pets'

export const MAX_STATIC_BYTES = 8 * 1024 * 1024
export const MAX_SPRITE_BYTES = 16 * 1024 * 1024
export const MAX_DIMENSION = 4096
export const MAX_ARCHIVE_FILES = 64
export const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const DEFAULT_SPRITE: PetSprite = { columns: 8, rows: 9, frameWidth: 192, frameHeight: 208 }

interface Manifest {
  id: string
  displayName: string
  description: string
  spritesheetPath?: string
  assetPath?: string
  kind?: PetKind
  sprite?: PetSprite
}

interface ResolvedPet extends PetView { assetPath: string }

export function petRoot(userDataDir: string): string { return path.join(userDataDir, 'pets') }
export function importedRoot(userDataDir: string): string { return path.join(petRoot(userDataDir), 'imported') }

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function assertId(id: string): void {
  if (!ID.test(id)) throw new Error('非法宠物 ID')
}

function assertBasename(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || path.basename(value) !== value || value.includes('\\')) {
    throw new Error(`非法${label}路径`)
  }
  return value
}

function imageKind(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp'
  return null
}

function pngSize(buffer: Buffer): [number, number] | null {
  return buffer.length >= 24 && buffer.subarray(12, 16).toString() === 'IHDR'
    ? [buffer.readUInt32BE(16), buffer.readUInt32BE(20)] : null
}

function jpegSize(buffer: Buffer): [number, number] | null {
  for (let pos = 2; pos + 9 < buffer.length;) {
    if (buffer[pos] !== 0xff) return null
    const marker = buffer[pos + 1]!
    const length = buffer.readUInt16BE(pos + 2)
    if (length < 2 || pos + 2 + length > buffer.length) return null
    if (marker >= 0xc0 && marker <= 0xc3) return [buffer.readUInt16BE(pos + 7), buffer.readUInt16BE(pos + 5)]
    pos += length + 2
  }
  return null
}

function webpSize(buffer: Buffer): [number, number] | null {
  const tag = buffer.subarray(12, 16).toString()
  if (tag === 'VP8X' && buffer.length >= 30) return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)]
  if (tag === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff]
  if (tag === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21)
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]
  }
  return null
}

/** Exported for Node-only tests; no Electron or renderer APIs are involved. */
export function validateImageBuffer(buffer: Buffer, maxBytes: number): { kind: 'png' | 'jpeg' | 'webp'; width: number; height: number } {
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error(maxBytes === MAX_SPRITE_BYTES ? '精灵图过大' : '图片过大')
  const kind = imageKind(buffer)
  if (!kind) throw new Error('不支持的图片格式')
  const size = kind === 'png' ? pngSize(buffer) : kind === 'jpeg' ? jpegSize(buffer) : webpSize(buffer)
  if (!size || size[0] <= 0 || size[1] <= 0) throw new Error('无法读取图片尺寸')
  if (size[0] > MAX_DIMENSION || size[1] > MAX_DIMENSION) throw new Error('图片尺寸超限')
  return { kind, width: size[0], height: size[1] }
}

async function validateImage(file: string, maxBytes: number) {
  return validateImageBuffer(await fs.promises.readFile(file), maxBytes)
}

function parseManifest(directory: string): Manifest {
  let input: unknown
  try { input = JSON.parse(fs.readFileSync(path.join(directory, 'pet.json'), 'utf8')) } catch { throw new Error('缺少或无效 pet.json') }
  if (!input || typeof input !== 'object') throw new Error('无效 pet.json')
  const value = input as Record<string, unknown>
  if (typeof value.id !== 'string') throw new Error('无效宠物 ID')
  assertId(value.id)
  if (typeof value.displayName !== 'string' || !value.displayName.trim() || typeof value.description !== 'string') throw new Error('无效宠物描述')
  const spritesheetPath = value.spritesheetPath === undefined ? undefined : assertBasename(value.spritesheetPath, '精灵图')
  const assetPath = value.assetPath === undefined ? undefined : assertBasename(value.assetPath, '图片')
  if (!spritesheetPath && !assetPath) throw new Error('缺少精灵图')
  return { id: value.id, displayName: value.displayName, description: value.description, spritesheetPath, assetPath, kind: value.kind === 'static' ? 'static' : undefined }
}

function makeView(manifest: Manifest, directory: string, source: PetView['source'], removable: boolean): ResolvedPet {
  const asset = manifest.spritesheetPath ?? manifest.assetPath!
  const assetPath = path.join(directory, asset)
  const kind: PetKind = manifest.spritesheetPath ? 'spritesheet' : 'static'
  return { id: manifest.id, displayName: manifest.displayName, description: manifest.description, source, kind, available: true, removable, previewUrl: null, sprite: kind === 'spritesheet' ? DEFAULT_SPRITE : null, assetPath }
}

function readPackage(directory: string, source: PetView['source'], removable: boolean): ResolvedPet | null {
  try {
    const manifest = parseManifest(directory)
    const pet = makeView(manifest, directory, source, removable)
    validateImageBuffer(fs.readFileSync(pet.assetPath), pet.kind === 'spritesheet' ? MAX_SPRITE_BYTES : MAX_STATIC_BYTES)
    return pet
  } catch { return null }
}

function listDirectory(root: string, source: PetView['source'], removable: boolean): ResolvedPet[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .map(entry => readPackage(path.join(root, entry.name), source, removable)).filter((pet): pet is ResolvedPet => pet !== null)
  } catch { return [] }
}

function builtIns(): ResolvedPet[] {
  return [{ id: 'wraith-companion', displayName: 'Wraith Companion', description: 'Wraith official pet', source: 'built-in', kind: 'static', available: false, removable: false, previewUrl: null, sprite: null, assetPath: '' }]
}

export async function listPets(args: { userDataDir: string; petdexRoot: string }): Promise<PetView[]> {
  const merged = new Map<string, ResolvedPet>()
  for (const pet of [...builtIns(), ...listDirectory(args.petdexRoot, 'petdex', false), ...listDirectory(importedRoot(args.userDataDir), 'imported', true)]) merged.set(pet.id, pet)
  return [...merged.values()].map(({ assetPath: _assetPath, ...pet }) => pet)
}

async function replaceFromStaging(root: string, id: string, staging: string): Promise<void> {
  await fs.promises.mkdir(root, { recursive: true })
  const target = path.join(root, id)
  if (!isWithin(root, target)) throw new Error('非法宠物路径')
  const backup = `${target}.backup-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const hadTarget = fs.existsSync(target)
  try {
    if (hadTarget) await fs.promises.rename(target, backup)
    await fs.promises.rename(staging, target)
    if (hadTarget) await fs.promises.rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (hadTarget && !fs.existsSync(target) && fs.existsSync(backup)) await fs.promises.rename(backup, target)
    throw error
  }
}

function staticId(sourcePath: string): string {
  const cleaned = path.basename(sourcePath, path.extname(sourcePath)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pet'
  return cleaned.slice(0, 64).replace(/-+$/g, '') || 'pet'
}

export async function importStaticImage(args: { userDataDir: string; sourcePath: string }): Promise<PetView> {
  const asset = await validateImage(args.sourcePath, MAX_STATIC_BYTES)
  const id = staticId(args.sourcePath); assertId(id)
  const root = importedRoot(args.userDataDir); await fs.promises.mkdir(root, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(root, '.staging-'))
  try {
    const ext = asset.kind === 'jpeg' ? 'jpg' : asset.kind
    const assetPath = `image.${ext}`
    await fs.promises.copyFile(args.sourcePath, path.join(staging, assetPath))
    const manifest: Manifest = { id, displayName: path.basename(args.sourcePath, path.extname(args.sourcePath)), description: 'Imported image pet', assetPath, kind: 'static' }
    await fs.promises.writeFile(path.join(staging, 'pet.json'), JSON.stringify(manifest), 'utf8')
    await replaceFromStaging(root, id, staging)
    return makeView(manifest, path.join(root, id), 'imported', true)
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true })
    throw error
  }
}

function safeArchivePath(name: string): string {
  if (!name || path.isAbsolute(name) || name.split(/[\\/]/).some(part => part === '..' || part === '')) throw new Error('非法压缩包路径')
  return name
}

async function extractZip(source: string, staging: string): Promise<void> {
  await new Promise<void>((resolve, reject) => yauzl.open(source, { lazyEntries: true }, (openError, zip) => {
    if (openError || !zip) {
      reject(openError?.message.includes('relative path') ? new Error('非法压缩包路径') : (openError ?? new Error('无法打开压缩包')))
      return
    }
    let entries = 0; let total = 0; let failed = false
    const fail = (error: Error) => {
      if (!failed) {
        failed = true; zip.close()
        reject(error.message.includes('relative path') ? new Error('非法压缩包路径') : error)
      }
    }
    zip.on('error', error => fail(error))
    zip.on('entry', entry => {
      if (failed) return
      try {
        entries += 1
        if (entries > MAX_ARCHIVE_FILES) throw new Error('压缩包文件过多')
        const name = safeArchivePath(entry.fileName)
        if (/\/$/.test(name)) { zip.readEntry(); return }
        total += entry.uncompressedSize
        if (total > MAX_ARCHIVE_BYTES) throw new Error('压缩包解压后过大')
        if (!['pet.json', 'spritesheet.png', 'spritesheet.webp'].includes(name)) throw new Error('压缩包包含不支持的文件')
        const target = path.join(staging, name)
        if (!isWithin(staging, target)) throw new Error('非法压缩包路径')
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(streamError ?? new Error('无法读取压缩包')); return }
          const output = fs.createWriteStream(target, { flags: 'wx' })
          stream.on('error', fail); output.on('error', fail)
          output.on('close', () => { if (!failed) zip.readEntry() })
          stream.pipe(output)
        })
      } catch (error) { fail(error as Error) }
    })
    zip.on('end', () => { if (!failed) resolve() })
    zip.readEntry()
  }))
}

async function copyFolder(source: string, staging: string): Promise<void> {
  const entries = await fs.promises.readdir(source, { withFileTypes: true })
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error('宠物包文件过多')
  for (const entry of entries) {
    if (!entry.isFile() || !['pet.json', 'spritesheet.png', 'spritesheet.webp'].includes(entry.name)) throw new Error('宠物包包含不支持的文件')
    await fs.promises.copyFile(path.join(source, entry.name), path.join(staging, entry.name))
  }
}

export async function importPackage(args: { userDataDir: string; sourcePath: string }): Promise<PetView> {
  const root = importedRoot(args.userDataDir); await fs.promises.mkdir(root, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(root, '.staging-'))
  try {
    const stat = await fs.promises.stat(args.sourcePath)
    if (stat.isDirectory()) await copyFolder(args.sourcePath, staging)
    else if (path.extname(args.sourcePath).toLowerCase() === '.zip') await extractZip(args.sourcePath, staging)
    else throw new Error('仅支持宠物文件夹或 ZIP 包')
    const manifest = parseManifest(staging)
    if (!manifest.spritesheetPath) throw new Error('缺少精灵图')
    const spritePath = path.join(staging, manifest.spritesheetPath)
    if (!fs.existsSync(spritePath)) throw new Error('缺少精灵图')
    await validateImage(spritePath, MAX_SPRITE_BYTES)
    await replaceFromStaging(root, manifest.id, staging)
    return makeView(manifest, path.join(root, manifest.id), 'imported', true)
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function removeImportedPet(args: { userDataDir: string; id: string }): Promise<void> {
  assertId(args.id)
  const root = importedRoot(args.userDataDir); const target = path.join(root, args.id)
  if (!isWithin(root, target)) throw new Error('非法宠物路径')
  await fs.promises.rm(target, { recursive: true, force: true })
}

function findResolved(args: { userDataDir: string; petdexRoot: string }, id: string): ResolvedPet | null {
  try { assertId(id) } catch { return null }
  const found = [...builtIns(), ...listDirectory(args.petdexRoot, 'petdex', false), ...listDirectory(importedRoot(args.userDataDir), 'imported', true)]
  return found.filter(pet => pet.id === id).at(-1) ?? null
}

export async function previewDataUrl(args: { userDataDir: string; petdexRoot: string; id: string }): Promise<string | null> {
  const pet = findResolved(args, args.id)
  if (!pet?.available || !pet.assetPath) return null
  try {
    const data = await fs.promises.readFile(pet.assetPath)
    const kind = imageKind(data)
    return kind ? `data:image/${kind === 'jpeg' ? 'jpeg' : kind};base64,${data.toString('base64')}` : null
  } catch { return null }
}
