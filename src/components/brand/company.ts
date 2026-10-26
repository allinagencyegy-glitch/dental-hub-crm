/**
 * Dental Hub's contact facts and brand artwork.
 *
 * The facts that read the same in every language live here. The company's
 * name and address are words, so they live in the messages (`company`).
 * The artwork is the supplied logo, cut out from its black background so it
 * sits on white paper and on the dark sidebar alike.
 */
export const COMPANY = {
  /** Dialled as written; shown with the grouping customers know. */
  phone: '+201116516419',
  phoneDisplay: '0111 6516 419',
  mapUrl: 'https://maps.google.com/?q=30.034927,31.236965',
} as const;

export const BRAND_LOGO = { src: '/brand/dental-hub-logo.png', width: 900, height: 219 } as const;
export const BRAND_MARK = { src: '/brand/dental-hub-mark.png', width: 256, height: 256 } as const;
