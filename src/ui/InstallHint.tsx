import { useState } from 'react';

// One-time nudge to install the app to the home screen.
//
// iOS has no `beforeinstallprompt` — Safari never offers installation itself, so
// on iOS the only way a user discovers it is being told. This renders only in a
// browser (never inside the installed app) and only on iOS, where the
// instructions are accurate.

const DISMISS_KEY = 'albion:install-hint-dismissed';

/** iPadOS reports itself as MacIntel, so touch points are the giveaway. */
function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** True once launched from the home screen — `navigator.standalone` is the iOS one. */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallHint() {
  // Both are evaluated once: neither can change without a reload.
  const [eligible] = useState(() => isIos() && !isStandalone());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false; // Private mode / storage blocked — just show it this session.
    }
  });

  if (!eligible || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* Nothing to do — it'll reappear next visit, which is acceptable. */
    }
  };

  return (
    <div className="install-hint" role="note">
      <p>
        <strong>Add this to your home screen</strong> — tap Share{' '}
        <svg
          className="share-glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12" />
          <path d="M8 7l4-4 4 4" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>{' '}
        then <strong>Add to Home Screen</strong>, for a full-screen app that keeps working
        with no signal.
      </p>
      <button className="install-hint-close" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
