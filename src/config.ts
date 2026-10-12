/** Free tier clip length cap in seconds. */
export const FREE_CLIP_SECONDS = 15;

/**
 * Premium has no cap in spirit, but everything is edited in the phone's memory, so a very long
 * clip would crash the page. 10 minutes is comfortably safe on an iPhone.
 */
export const PREMIUM_CLIP_SECONDS = 600;

export const clipLimit = (premium: boolean) => (premium ? PREMIUM_CLIP_SECONDS : FREE_CLIP_SECONDS);

export function formatLimit(seconds: number): string {
  return seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
}
