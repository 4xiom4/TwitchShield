export function preventBackgroundThrottling(): void {
  try {
    Object.defineProperty(document, 'visibilityState', {
      get() {
        return 'visible';
      }
    });
  } catch {}

  try {
    Object.defineProperty(document, 'hidden', {
      get() {
        return false;
      }
    });
  } catch {}

  const blockEvent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const onVisibilityChange = () => {
    const video = document.querySelector('video');
    if (video && video.paused && !video.ended && video.muted) {
      video.play().catch(() => {});
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange, true);
  document.addEventListener('webkitvisibilitychange', onVisibilityChange, true);
  document.addEventListener('mozvisibilitychange', onVisibilityChange, true);
  document.addEventListener('hasFocus', blockEvent, true);
}
