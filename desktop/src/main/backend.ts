import path from 'path'

/**
 * defaultJarPath — pure helper, returns ~/.wraith/wraith.jar for any homedir.
 * Takes homedir as a parameter so it's fully testable without os.homedir().
 */
export function defaultJarPath(homedir: string): string {
  return path.join(homedir, '.wraith', 'wraith.jar')
}

/**
 * resolveBackendCommand — pure helper, no side effects.
 *
 * If WRAITH_APPSERVER_CMD is a non-empty string → split on whitespace;
 * first token is cmd, rest are args.
 * Otherwise → java -jar <defaultJar> app-server.
 */
export function resolveBackendCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string
): { cmd: string; args: string[] } {
  const override = env['WRAITH_APPSERVER_CMD']
  if (override && override.trim().length > 0) {
    const tokens = override.trim().split(/\s+/)
    const [cmd, ...args] = tokens
    return { cmd: cmd!, args }
  }
  return { cmd: 'java', args: ['-jar', defaultJar, 'app-server'] }
}
