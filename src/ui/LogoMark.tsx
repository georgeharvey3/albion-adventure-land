import { useEffect, useRef } from 'react';

// The app logo, drawn inline rather than loaded as an <img>, so the triskele at
// its heart can turn while the compass around it stays still. The geometry is
// a copy of public/favicon.svg, which stays the source of truth: the PWA icons
// are rendered from that file (scripts/render-icons.mjs). Change both together.

const RAY = 'M256 70 L276 236 L256 256 L236 236 Z';
const RAY_SHADE = 'M256 70 L256 256 L236 236 Z';
const MINOR_RAY = 'M256 140 L268 244 L256 256 L244 244 Z';
const ARM = 'M256 256 C256 206 318 186 336 226 C350 258 318 280 296 262 C284 252 292 236 304 240';

/** One full turn while spinning. */
const TURN_MS = 1600;
/** The triskele has three-fold symmetry, so it looks at rest every 120°. */
const THIRD = 120;
/** A stop closer than this to the next rest angle overshoots to the one after,
 *  so the spin never ends in an abrupt jerk. */
const MIN_COAST = 40;
/** A quadratic ease-out. It starts at 1.84 times the average speed, so a
 *  coast of that length begins at exactly the speed of the spin. */
const COAST_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const COAST_START_SLOPE = 1.84;

export function LogoMark({ className, spinning = false }: { className?: string; spinning?: boolean }) {
  const triskele = useRef<SVGGElement>(null);

  useEffect(() => {
    const g = triskele.current;
    if (!spinning || !g || typeof g.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const spin = g.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: TURN_MS,
      iterations: Infinity,
    });

    // When the spin ends, coast to the next rest angle rather than snap back
    // to zero: the triskele slows down and settles, and a fast load reads as
    // the logo settling rather than a spinner cut off mid-turn.
    return () => {
      const elapsed = Number(spin.currentTime ?? 0);
      spin.cancel();
      const angle = ((elapsed % TURN_MS) / TURN_MS) * 360;
      let rest = Math.ceil(angle / THIRD) * THIRD;
      if (rest - angle < MIN_COAST) rest += THIRD;
      const distance = rest - angle;
      g.animate([{ transform: `rotate(${angle}deg)` }, { transform: `rotate(${rest}deg)` }], {
        duration: (distance / 360) * TURN_MS * COAST_START_SLOPE,
        easing: COAST_EASING,
        fill: 'forwards',
      });
    };
  }, [spinning]);

  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <radialGradient id="logo-mark-fill" cx=".5" cy=".45" r=".7">
          <stop offset="0" stopColor="#24573a" />
          <stop offset="1" stopColor="#0b2616" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="96" fill="url(#logo-mark-fill)" />
      <circle cx="256" cy="256" r="196" fill="none" stroke="#f2c14e" strokeWidth="3" opacity=".5" />
      <circle
        cx="256"
        cy="256"
        r="180"
        fill="none"
        stroke="#f2c14e"
        strokeWidth="1.5"
        strokeDasharray="2 10"
        opacity=".7"
      />
      {[0, 90, 180, 270].map((r) => (
        <g key={r} transform={`rotate(${r} 256 256)`}>
          <path d={RAY} fill="#f2c14e" />
          <path d={RAY_SHADE} fill="#c8912a" />
        </g>
      ))}
      {[45, 135, 225, 315].map((r) => (
        <path key={r} d={MINOR_RAY} transform={`rotate(${r} 256 256)`} fill="#5fa8a0" />
      ))}
      <circle cx="256" cy="256" r="84" fill="#0b2616" />
      <circle cx="256" cy="256" r="84" fill="none" stroke="#f2c14e" strokeWidth="4" />
      {/* The spin goes on this outer group, so it wraps the triskele's own
          transform and the rest pose stays the favicon's. */}
      <g ref={triskele} className="logo-triskele">
        <g
          fill="none"
          stroke="#f7f1e1"
          strokeWidth="12"
          strokeLinecap="round"
          transform="translate(256 256) rotate(-72.3) scale(.88) translate(-256 -256)"
        >
          {[0, 120, 240].map((r) => (
            <path key={r} d={ARM} transform={`rotate(${r} 256 256)`} />
          ))}
        </g>
      </g>
    </svg>
  );
}
