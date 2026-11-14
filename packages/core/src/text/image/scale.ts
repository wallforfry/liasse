const CHANNELS = 4;

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

// The largest size with the same proportions whose longer edge is at most `maxEdge`.
// An image that already fits keeps its size: nothing is ever enlarged.
export const fitWithin = ({ width, height }: ImageSize, maxEdge: number): ImageSize => {
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};

// Area averaging: each target pixel is the mean of the source pixels it covers, which
// keeps small print legible where nearest-neighbour sampling would drop strokes.
export const downscaleRgba = (source: RgbaImage, target: ImageSize): RgbaImage => {
  if (target.width === source.width && target.height === source.height) return source;
  const data = new Uint8Array(target.width * target.height * CHANNELS);
  const scaleX = source.width / target.width;
  const scaleY = source.height / target.height;
  for (let y = 0; y < target.height; y += 1) {
    const top = Math.floor(y * scaleY);
    const bottom = Math.max(top + 1, Math.min(source.height, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < target.width; x += 1) {
      const left = Math.floor(x * scaleX);
      const right = Math.max(left + 1, Math.min(source.width, Math.floor((x + 1) * scaleX)));
      const sums = [0, 0, 0, 0];
      for (let sourceY = top; sourceY < bottom; sourceY += 1) {
        for (let sourceX = left; sourceX < right; sourceX += 1) {
          const offset = (sourceY * source.width + sourceX) * CHANNELS;
          sums.forEach((sum, channel) => {
            sums[channel] = sum + (source.data[offset + channel] ?? 0);
          });
        }
      }
      const pixels = (bottom - top) * (right - left);
      sums.forEach((sum, channel) => {
        data[(y * target.width + x) * CHANNELS + channel] = Math.round(sum / pixels);
      });
    }
  }
  return { ...target, data };
};
