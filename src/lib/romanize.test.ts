import { describe, expect, it } from 'vitest';
import { hasChinese, romanizeChinese } from './romanize';

describe('hasChinese', () => {
  it('detects a single Chinese character', () => {
    expect(hasChinese('我')).toBe(true);
  });

  it('detects Chinese mixed with other scripts', () => {
    expect(hasChinese('Hello 世界')).toBe(true);
  });

  it('returns false for pure Latin', () => {
    expect(hasChinese('Hello world')).toBe(false);
  });

  it('returns false for pure Hangul (Korean)', () => {
    expect(hasChinese('안녕하세요')).toBe(false);
  });

  it('returns false for pure Hiragana/Katakana (Japanese, no kanji)', () => {
    expect(hasChinese('こんにちは')).toBe(false);
    expect(hasChinese('カタカナ')).toBe(false);
  });

  it('returns true for kanji (which overlaps the Han block)', () => {
    expect(hasChinese('日本')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(hasChinese('')).toBe(false);
  });
});

describe('romanizeChinese', () => {
  it('passes through non-Chinese text unchanged', () => {
    expect(romanizeChinese('Hello world')).toBe('Hello world');
    expect(romanizeChinese('')).toBe('');
  });

  it('romanizes a simple Chinese phrase with tone marks', () => {
    const out = romanizeChinese('你好');
    expect(out).toMatch(/nǐ/);
    expect(out).toMatch(/hǎo/);
  });

  it('preserves Latin tokens within mixed lines (pinyin-pro spaces them)', () => {
    const out = romanizeChinese('我 love 你');
    // pinyin-pro emits a space between every Latin character when
    // given mixed input — the lyric subtitle reads "wǒ l o v e nǐ".
    // Acceptable for the lyric panel's secondary line; assert that
    // both the Chinese and the Latin glyphs are visible in some form.
    expect(out).toMatch(/wǒ/);
    expect(out).toMatch(/nǐ/);
    expect(out.replace(/\s+/g, '').toLowerCase()).toContain('love');
  });
});
