import type { PaperStyle } from './raster.ts';

export interface PaperPreset extends Omit<PaperStyle, 'rows'> {
  // The sheet holds at least this many lines, and grows with a longer page.
  readonly minRows: number;
  readonly jpegQuality: number;
}

// The ways a paper document reaches the corpus without a text layer.
export const PAPERS = {
  // An A4 sheet on a flatbed scanner: nearly straight, even light, little grain.
  scan: {
    scale: 2,
    columns: 76,
    minRows: 50,
    marginPx: 48,
    skew: 180,
    paper: 240,
    ink: 34,
    noise: 4,
    shade: 8,
    deskPx: 0,
    desk: 248,
    jpegQuality: 55,
  },
  // A sheet that spent decades in a folder, scanned in a hurry: grey, grainy, askew.
  archive: {
    scale: 2,
    columns: 76,
    minRows: 34,
    marginPx: 44,
    skew: -70,
    paper: 212,
    ink: 58,
    noise: 10,
    shade: 26,
    deskPx: 0,
    desk: 236,
    jpegQuality: 50,
  },
  // A sheet photographed on a desk with a phone: askew, lit from one side, desk around it.
  photo: {
    scale: 2,
    columns: 76,
    minRows: 20,
    marginPx: 40,
    skew: 46,
    paper: 228,
    ink: 44,
    noise: 8,
    shade: 52,
    deskPx: 34,
    desk: 92,
    jpegQuality: 55,
  },
  // A till receipt photographed in the hand: narrow, large print.
  receipt: {
    scale: 3,
    columns: 36,
    minRows: 12,
    marginPx: 30,
    skew: -38,
    paper: 232,
    ink: 52,
    noise: 9,
    shade: 44,
    deskPx: 28,
    desk: 70,
    jpegQuality: 55,
  },
  // A ticket shown on a screen and captured: straight, black on white, no grain.
  screen: {
    scale: 3,
    columns: 30,
    minRows: 5,
    marginPx: 24,
    skew: 0,
    paper: 255,
    ink: 0,
    noise: 0,
    shade: 0,
    deskPx: 0,
    desk: 255,
    jpegQuality: 55,
  },
} as const satisfies Readonly<Record<string, PaperPreset>>;

export type PaperName = keyof typeof PAPERS;

export const paperStyle = (name: PaperName, lineCount: number): PaperStyle => {
  const { minRows, jpegQuality: _jpegQuality, ...style } = PAPERS[name];
  return { ...style, rows: Math.max(minRows, lineCount + 1) };
};
