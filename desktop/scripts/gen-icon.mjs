import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const SRC = path.join(ROOT, 'src/renderer/assets/logo-light.png') // 透明底浅色标
const BUILD = path.join(ROOT, 'build')
const ICONSET = path.join(BUILD, 'icon.iconset')

const CANVAS = 1024, TILE = 824, RADIUS = 185, MARK = 560, TILE_COLOR = '#1C1B2A'
const off = Math.round((CANVAS - TILE) / 2)

mkdirSync(BUILD, { recursive: true })
rmSync(ICONSET, { recursive: true, force: true })
mkdirSync(ICONSET, { recursive: true })

// 深色圆角瓷砖(居中于 1024 透明画布)
const tileSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
     <rect x="${off}" y="${off}" width="${TILE}" height="${TILE}" rx="${RADIUS}" ry="${RADIUS}" fill="${TILE_COLOR}"/>
   </svg>`)

const mark = await sharp(SRC)
  .resize(MARK, MARK, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer()

const master = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: tileSvg }, { input: mark, gravity: 'center' }])
  .png().toBuffer()

writeFileSync(path.join(BUILD, 'icon-master.png'), master)
writeFileSync(path.join(BUILD, 'icon-512.png'), await sharp(master).resize(512, 512).png().toBuffer())

// iconset:各尺寸 + @2x
const sizes = [16, 32, 128, 256, 512]
for (const s of sizes) {
  writeFileSync(path.join(ICONSET, `icon_${s}x${s}.png`), await sharp(master).resize(s, s).png().toBuffer())
  writeFileSync(path.join(ICONSET, `icon_${s}x${s}@2x.png`), await sharp(master).resize(s * 2, s * 2).png().toBuffer())
}

execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', path.join(BUILD, 'icon.icns')])
console.log('icon.icns + icon-512.png generated')
if (!existsSync(path.join(BUILD, 'icon.icns'))) { console.error('icon.icns 未生成'); process.exit(1) }
