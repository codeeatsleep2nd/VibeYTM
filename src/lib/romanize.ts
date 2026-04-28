import { pinyin } from 'pinyin-pro';

/**
 * Detect any Han ideograph in the string. Reused as the "is this a
 * Chinese line" gate before romanization. The range covers the CJK
 * Unified Ideographs block plus its first extension — enough for
 * modern lyrics; rare glyphs in further extensions are omitted on
 * purpose to keep the regex tight.
 */
const HAN_IDEOGRAPH = /[㐀-鿿]/;

/**
 * True when the input contains at least one Han ideograph. Used by
 * `LyricLineView` to decide whether to render the romanized
 * (`pinyin`) line under the original.
 */
export function hasChinese(text: string): boolean {
  return HAN_IDEOGRAPH.test(text);
}

/**
 * Romanize Chinese characters in `text` to Hanyu Pinyin with tone
 * marks (mā, má, mǎ, mà). Non-Chinese characters pass through
 * unchanged so mixed-script lines (e.g. "我love你") render naturally.
 *
 * Returns the input verbatim when there's no Chinese in it — caller
 * doesn't have to gate.
 */
export function romanizeChinese(text: string): string {
  if (!hasChinese(text)) return text;
  // pinyin-pro returns a space-separated string for the marks style
  // when given a string input; perfect for inline rendering as a
  // secondary line under the original lyric.
  return pinyin(text, { toneType: 'symbol', type: 'string' });
}
