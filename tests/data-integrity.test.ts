import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CITIES_REGISTRY } from '@/lib/constants/cities';

describe('Repository Data Integrity Guard', () => {
  const root = process.cwd();
  const dataSummaryPath = path.join(root, 'data', 'processed', 'history_summary.json');
  const publicSummaryPath = path.join(root, 'public', 'data', 'history_summary.json');
  const historyDir = path.join(root, 'public', 'data', 'history');

  it('has unique IDs across CITIES_REGISTRY', () => {
    const ids = CITIES_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps data/processed/history_summary.json and public/data/history_summary.json in exact sync', () => {
    expect(fs.existsSync(dataSummaryPath)).toBe(true);
    expect(fs.existsSync(publicSummaryPath)).toBe(true);
    expect(fs.readFileSync(dataSummaryPath, 'utf-8')).toBe(fs.readFileSync(publicSummaryPath, 'utf-8'));
  });

  it('has zero orphan files in public/data/history/ and 1:1 coverage with history_summary.json', () => {
    const summary = JSON.parse(fs.readFileSync(publicSummaryPath, 'utf-8')) as Record<string, any[]>;
    const summaryFiles = new Set(
      Object.keys(summary).map((cid) => `${cid.replace(/[^a-zA-Z0-9_\-]/g, '_')}.json`)
    );
    const actualFiles = new Set(fs.readdirSync(historyDir));

    const orphans = Array.from(actualFiles).filter((fn) => !summaryFiles.has(fn));
    const missing = Array.from(summaryFiles).filter((fn) => !actualFiles.has(fn));

    expect(orphans).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('includes pre-aggregated PM2.5-only annual stats to prevent scorecard flicker', () => {
    const summary = JSON.parse(fs.readFileSync(publicSummaryPath, 'utf-8')) as Record<string, any[]>;
    const beijing2025 = summary['cn-beijing']?.find((y) => y.year === 2025);
    expect(beijing2025).toBeDefined();
    expect(beijing2025.daysCount).toBe(365);
    expect(typeof beijing2025.goodDaysRatioPm25CN).toBe('number');
    expect(typeof beijing2025.goodDaysRatioPm25US).toBe('number');
    expect(typeof beijing2025.pollutedDaysPm25CN).toBe('number');
    expect(typeof beijing2025.pollutedDaysPm25US).toBe('number');
  });
});
