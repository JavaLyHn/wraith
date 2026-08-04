import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeConfig, loadConfig, ConfigError, DEFAULT_DATA_DIR } from '../../scripts/github-ai-daily/config.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ghai-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const TEMPLATE = { topN: 5, minStars: 100, tiers: { rising: 3000, mid: 30000 }, topics: { agent: ['ai-agent', 'agentic'] } };

describe('mergeConfig', () => {
  it('用户的键一律不被模板覆盖', () => {
    const merged = mergeConfig(TEMPLATE, { topN: 20, tiers: { rising: 500 } });
    expect(merged.topN).toBe(20);
    expect(merged.tiers.rising).toBe(500);
    expect(merged.tiers.mid).toBe(30000); // 缺失的才补
  });

  it('用户显式写的 falsy 值不被当成缺失', () => {
    const merged = mergeConfig(TEMPLATE, { minStars: 0, topN: null });
    expect(merged.minStars).toBe(0);
    expect(merged.topN).toBe(null);
  });

  it('数组整体替换而不是合并 —— 用户删掉的 topic 不许被模板加回来', () => {
    const merged = mergeConfig(TEMPLATE, { topics: { agent: ['ai-agent'] } });
    expect(merged.topics.agent).toEqual(['ai-agent']);
  });

  it('模板独有的新键会被补进来（升级路径）', () => {
    const merged = mergeConfig({ ...TEMPLATE, brandNewKey: 7 }, { topN: 20 });
    expect(merged.brandNewKey).toBe(7);
  });

  it('不改动入参', () => {
    const user = { topN: 20 };
    mergeConfig(TEMPLATE, user);
    expect(user).toEqual({ topN: 20 });
    expect(TEMPLATE.tiers.mid).toBe(30000);
  });
});

describe('loadConfig', () => {
  it('首次运行从模板复制，并标记 createdFromTemplate', () => {
    const dir = tmp(), tplDir = tmp();
    const templatePath = join(tplDir, 'config.default.json');
    writeFileSync(templatePath, JSON.stringify(TEMPLATE));
    const r = loadConfig({ dataDir: join(dir, 'nested'), templatePath });
    expect(r.createdFromTemplate).toBe(true);
    expect(r.config.topN).toBe(5);
    expect(existsSync(r.path)).toBe(true);
    expect(JSON.parse(readFileSync(r.path, 'utf8')).topN).toBe(5);
  });

  it('已有配置时不再标记 createdFromTemplate，且用户值优先', () => {
    const dir = tmp(), tplDir = tmp();
    const templatePath = join(tplDir, 'config.default.json');
    writeFileSync(templatePath, JSON.stringify(TEMPLATE));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ topN: 99 }));
    const r = loadConfig({ dataDir: dir, templatePath });
    expect(r.createdFromTemplate).toBe(false);
    expect(r.config.topN).toBe(99);
    expect(r.config.minStars).toBe(100);
  });

  it('JSON 语法错误抛 ConfigError 且带上文件路径 —— 绝不静默回落默认值', () => {
    const dir = tmp(), tplDir = tmp();
    const templatePath = join(tplDir, 'config.default.json');
    writeFileSync(templatePath, JSON.stringify(TEMPLATE));
    mkdirSync(dir, { recursive: true });
    const bad = join(dir, 'config.json');
    writeFileSync(bad, '{ "topN": 5, }');
    let err;
    try { loadConfig({ dataDir: dir, templatePath }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.path).toBe(bad);
    expect(err.message).toContain('config.json');
  });
});

describe('DEFAULT_DATA_DIR', () => {
  it('落在 ~/.wraith/reports/github-ai-daily', () => {
    expect(DEFAULT_DATA_DIR.endsWith(join('.wraith', 'reports', 'github-ai-daily'))).toBe(true);
  });
});

describe('config.default.json 的默认口径', () => {
  const tpl = JSON.parse(readFileSync(
    new URL('../../scripts/github-ai-daily/config.default.json', import.meta.url), 'utf8'));

  it('所有时间口径都在配置里', () => {
    for (const k of ['streakTtlDays', 'windowNominalHours', 'windowToleranceHours',
                     'searchThrottleMs', 'graphqlMaxRetries', 'baselineMinAgeHours',
                     'snapshotRetainDays', 'activeWithinDays']) {
      expect(typeof tpl[k], k).toBe('number');
    }
  });
  it('通用词不再当强信号', () => {
    const all = Object.values(tpl.topics).flat();
    for (const g of ['observability', 'evaluation', 'inference', 'memory', 'sandbox']) {
      expect(all, g).not.toContain(g);
    }
  });
  it('AI 专用的近义词保留', () => {
    const all = Object.values(tpl.topics).flat();
    for (const k of ['evals', 'llm-serving', 'context-engineering', 'agent-security']) {
      expect(all, k).toContain(k);
    }
  });
  it('AI 判定阈值可配置，且模板默认值与代码里的模块常量一致（不留两套数字）', () => {
    expect(typeof tpl.aiThreshold).toBe('number');
    expect(tpl.aiThreshold).toBe(2);
  });
});
