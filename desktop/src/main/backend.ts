import path from 'path'

/**
 * defaultJarPath — pure helper, returns ~/.wraith/wraith.jar for any homedir.
 * Takes homedir as a parameter so it's fully testable without os.homedir().
 */
export function defaultJarPath(homedir: string): string {
  return path.join(homedir, '.wraith', 'wraith.jar')
}

/** 打包态:用捆绑 JRE 的 java + 捆绑 jar 跑 app-server。 */
export function packagedBackendCommand(resourcesPath: string): { cmd: string; args: string[] } {
  return {
    cmd: path.join(resourcesPath, 'runtime', 'bin', 'java'),
    args: ['-jar', path.join(resourcesPath, 'wraith.jar'), 'app-server'],
  }
}

/**
 * resolveBackendCommand — pure helper, no side effects.
 *
 * 优先级:WRAITH_APPSERVER_CMD 覆写 > packaged(捆绑 java+jar)> dev(系统 java + defaultJar)。
 *
 * If WRAITH_APPSERVER_CMD is a non-empty string → split on whitespace;
 * first token is cmd, rest are args.
 * Otherwise if packaged → use bundled JRE + bundled jar.
 * Otherwise → java -jar <defaultJar> app-server.
 */
export function resolveBackendCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
): { cmd: string; args: string[] } {
  const override = env['WRAITH_APPSERVER_CMD']
  if (override && override.trim().length > 0) {
    const tokens = override.trim().split(/\s+/)
    const [cmd, ...args] = tokens
    return { cmd: cmd!, args }
  }
  if (packaged) return packagedBackendCommand(packaged.resourcesPath)
  return { cmd: 'java', args: ['-jar', defaultJar, 'app-server'] }
}
