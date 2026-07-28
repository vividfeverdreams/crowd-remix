export const wordmarkSourceBounds = {
  sourceWidth: 3522,
  sourceHeight: 3522,
  left: 480,
  top: 967,
  right: 2988,
  bottom: 2499
} as const;

const visibleWidth = wordmarkSourceBounds.right - wordmarkSourceBounds.left;
const visibleHeight = wordmarkSourceBounds.bottom - wordmarkSourceBounds.top;

export const wordmarkCropLayout = {
  aspectRatio: `${visibleWidth} / ${visibleHeight}`,
  imageLeft: `${roundPercent((-wordmarkSourceBounds.left / visibleWidth) * 100)}%`,
  imageTop: `${roundPercent((-wordmarkSourceBounds.top / visibleHeight) * 100)}%`,
  imageWidth: `${roundPercent((wordmarkSourceBounds.sourceWidth / visibleWidth) * 100)}%`,
  visibleWidth,
  visibleHeight
} as const;

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}
