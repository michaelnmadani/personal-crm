export const TEXT_SIZES = ['small', 'medium', 'large'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

/**
 * Scales the whole UI by changing the root font size — every size in the app is
 * expressed in rem, so text, spacing and controls grow together and nothing
 * overflows. "Small" is the original 16px root and stays the default, so the app
 * looks unchanged unless you pick otherwise.
 */
export function applyTextSize(size: TextSize) {
  if (size === 'small') delete document.documentElement.dataset.text
  else document.documentElement.dataset.text = size
  localStorage.setItem('textSize', size)
}

export function currentTextSize(): TextSize {
  const saved = localStorage.getItem('textSize') as TextSize | null
  return saved && TEXT_SIZES.includes(saved) ? saved : 'small'
}

export function initTextSize() {
  applyTextSize(currentTextSize())
}
