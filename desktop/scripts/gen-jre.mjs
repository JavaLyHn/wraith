import { execFileSync } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const OUT = path.join(ROOT, 'resources', 'runtime')

// jar 依赖 + 运行时 TLS(jdeps 检不到 crypto provider,显式补 jdk.crypto.ec)
const MODULES = [
  'java.base', 'java.desktop', 'java.management', 'java.naming',
  'java.net.http', 'java.security.jgss', 'java.sql', 'jdk.httpserver',
  'jdk.crypto.ec',
].join(',')

rmSync(OUT, { recursive: true, force: true }) // jlink 要求 output 不存在
execFileSync('jlink', [
  '--add-modules', MODULES,
  '--output', OUT,
  '--strip-debug', '--no-header-files', '--no-man-pages',
], { stdio: 'inherit' })

const java = path.join(OUT, 'bin', 'java')
if (!existsSync(java)) { console.error('jlink 未产出 java:', java); process.exit(1) }
execFileSync(java, ['-version'], { stdio: 'inherit' }) // 冒烟:能起
console.log('bundled JRE →', OUT)
