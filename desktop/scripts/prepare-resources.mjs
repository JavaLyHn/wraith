import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const REPO = path.resolve(ROOT, '..')            // 仓库根
const JAR_SRC = path.join(REPO, 'target', 'wraith-1.0-SNAPSHOT.jar')
const RES = path.join(ROOT, 'resources')

if (!existsSync(JAR_SRC)) { console.error('缺 jar,请先在仓库根跑 mvn -q clean package -DskipTests:', JAR_SRC); process.exit(1) }
mkdirSync(RES, { recursive: true })
copyFileSync(JAR_SRC, path.join(RES, 'wraith.jar'))
if (!existsSync(path.join(RES, 'runtime', 'bin', 'java'))) {
  execFileSync('node', [path.join(DIR, 'gen-jre.mjs')], { stdio: 'inherit' })
}
console.log('resources 就绪:wraith.jar + runtime')
