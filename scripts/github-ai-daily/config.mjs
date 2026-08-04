import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATA_DIR = join(homedir(), '.wraith', 'reports', 'github-ai-daily');
export const DEFAULT_TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'config.default.json');

export class ConfigError extends Error {
  constructor(message, path, cause) {
    super(message);
    this.name = 'ConfigError';
    this.path = path;
    this.cause = cause;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mergeConfig(template, user) {
  const out = isPlainObject(user) ? { ...user } : {};
  for (const [k, tv] of Object.entries(template ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = isPlainObject(tv) ? mergeConfig(tv, {}) : Array.isArray(tv) ? [...tv] : tv;
    } else if (isPlainObject(tv) && isPlainObject(out[k])) {
      out[k] = mergeConfig(tv, out[k]);
    }
    // 数组或标量：用户已有 → 原样保留（数组整体替换语义）
  }
  return out;
}

export function loadConfig({ dataDir = DEFAULT_DATA_DIR, templatePath = DEFAULT_TEMPLATE_PATH } = {}) {
  let template;
  try {
    template = JSON.parse(readFileSync(templatePath, 'utf8'));
  } catch (e) {
    throw new ConfigError(`配置模板读不了：${templatePath} —— ${e.message}`, templatePath, e);
  }

  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'config.json');

  if (!existsSync(path)) {
    const config = mergeConfig(template, {});
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return { config, path, createdFromTemplate: true };
  }

  let user;
  try {
    user = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ConfigError(
      `config.json 语法错误，已停止运行（不会退回默认值，否则你会以为改生效了）：${path}\n${e.message}`,
      path, e);
  }
  return { config: mergeConfig(template, user), path, createdFromTemplate: false };
}
