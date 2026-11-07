import { createCn } from 'cn/config'

/**
 * Class merging that knows the §2.11 token names (WP 7b). Without these groups
 * the merger reads text-chrome and text-neutral-12 as one group and drops the
 * first, so a font size would vanish beside a colour.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: ['chrome', 'content', 'reading', 'heading', 'mono'] }],
      rounded: [{ rounded: ['control', 'panel'] }],
    },
  },
})
