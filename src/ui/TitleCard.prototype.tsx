// PROTOTYPE — throwaway, issue #76. Four title cards over the map, switchable
// via `?variant=A|B|C|D` on the main route, cycled from the floating bar.
//
// Question: what should the first-impression title over the map look like?
// All four share the rules from the issue: Cardo title, one tagline, no site
// counts, `pointer-events: none` so the map under it still takes every tap, and
// a fade on the first tap, pan or zoom. What they disagree about is structure:
// where the title sits, what frames it, and whether it explains the pins.
//
// No persistence: a reload shows it again (the real one shows on first visit
// only). ↺ on the bar replays it without a reload.

import { useEffect, useState } from 'react';
import {
  PARENT_CATEGORIES,
  PARENT_CATEGORY_COLORS,
  PARENT_CATEGORY_LABELS,
} from '../data/types';
import { PrototypeSwitcher, readVariant, type PrototypeVariant } from './PrototypeSwitcher';
import { useStore } from '../state/store';
import './titleCard.prototype.css';

const TITLE = 'Albion Adventure Land';
const TAGLINE = 'Holy wells, stone circles, wild swims and old pubs — a field companion for Britain.';

// Round 2: A won round 1. The bar now cycles A with the logo in three places.
// Round 1's B, C and D stay reachable by URL only, for the record.
const VARIANTS: PrototypeVariant[] = [
  { key: 'A', name: 'Cartouche, no logo' },
  { key: 'A1', name: 'Logo above title' },
  { key: 'A2', name: 'Seal, spins while loading' },
  { key: 'A3', name: 'Logo beside title' },
];
const ROUND_1: PrototypeVariant[] = [
  { key: 'B', name: 'Map lettering' },
  { key: 'C', name: 'Masthead' },
  { key: 'D', name: 'Legend' },
];

const LOGO = `${import.meta.env.BASE_URL}favicon.svg`;

// The logo drawn inline (a copy of public/favicon.svg), so the triskele can
// turn on its own while the compass stays still.
const RAY = 'M256 70 L276 236 L256 256 L236 236 Z';
const RAY_SHADE = 'M256 70 L256 256 L236 236 Z';
const MINOR = 'M256 140 L268 244 L256 256 L244 244 Z';
const ARM = 'M256 256 C256 206 318 186 336 226 C350 258 318 280 296 262 C284 252 292 236 304 240';

function LogoMark({ className, spinning, onTurn }: { className: string; spinning: boolean; onTurn: () => void }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden>
      <defs>
        <radialGradient id="tc-logo-g" cx=".5" cy=".45" r=".7">
          <stop offset="0" stopColor="#24573a" />
          <stop offset="1" stopColor="#0b2616" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="96" fill="url(#tc-logo-g)" />
      <circle cx="256" cy="256" r="196" fill="none" stroke="#f2c14e" strokeWidth="3" opacity=".5" />
      <circle cx="256" cy="256" r="180" fill="none" stroke="#f2c14e" strokeWidth="1.5" strokeDasharray="2 10" opacity=".7" />
      {[0, 90, 180, 270].map((r) => (
        <g key={r} transform={`rotate(${r} 256 256)`}>
          <path d={RAY} fill="#f2c14e" />
          <path d={RAY_SHADE} fill="#c8912a" />
        </g>
      ))}
      {[45, 135, 225, 315].map((r) => (
        <path key={r} d={MINOR} transform={`rotate(${r} 256 256)`} fill="#5fa8a0" />
      ))}
      <circle cx="256" cy="256" r="84" fill="#0b2616" />
      <circle cx="256" cy="256" r="84" fill="none" stroke="#f2c14e" strokeWidth="4" />
      {/* The spin wraps the triskele's own transform, so the rest pose is the
          favicon's exactly. A turn always finishes: see onTurn. */}
      <g className={spinning ? 'tc-triskele spinning' : 'tc-triskele'} onAnimationIteration={onTurn}>
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

/** Loaded, as the card sees it. `?hold=MS` keeps it loading for at least MS
 *  milliseconds, because local data loads too fast to see the spin. */
function useLoaded() {
  const dataLoaded = useStore((s) => s.dataLoaded);
  const [held, setHeld] = useState(() => Number(new URLSearchParams(window.location.search).get('hold')) > 0);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(false), Number(new URLSearchParams(window.location.search).get('hold')));
    return () => clearTimeout(t);
  }, [held]);
  return dataLoaded && !held;
}

/** A1 — the logo heads the plate in place of the kicker line; the flourish
 *  goes, because the logo is now the ornament. */
function VariantA1() {
  return (
    <div className="tc-a">
      <div className="tc-a-plate">
        <img className="tc-a1-logo" src={LOGO} alt="" />
        <h1 className="tc-a-title">{TITLE}</h1>
        <p className="tc-a-sub">A field companion for Britain</p>
        <div className="tc-a-hint">Tap the map to begin</div>
      </div>
    </div>
  );
}

/** A2 — the logo sits on the top edge of the frame like a wax seal, half in
 *  and half out. The plate inside is round 1's A, less the flourish. */
function VariantA2() {
  const loaded = useLoaded();
  // Spin while loading, then stop at the end of the current turn rather than
  // snapping back mid-rotation.
  const [spinning, setSpinning] = useState(!loaded);
  useEffect(() => {
    if (!loaded) setSpinning(true);
  }, [loaded]);
  return (
    <div className="tc-a">
      <div className="tc-a-plate tc-a2-plate">
        <LogoMark
          className="tc-a2-seal"
          spinning={spinning}
          onTurn={() => {
            if (loaded) setSpinning(false);
          }}
        />
        <h1 className="tc-a-title">{TITLE}</h1>
        <p className="tc-a-sub">A field companion for Britain</p>
        <div className="tc-a-hint" aria-live="polite">
          {loaded ? 'Tap the map to begin' : 'Loading sites…'}
        </div>
      </div>
    </div>
  );
}

/** A3 — a horizontal lockup: logo left, title right, set as one mark. Wider and
 *  shorter, so it covers less of the land on a phone. */
function VariantA3() {
  return (
    <div className="tc-a">
      <div className="tc-a-plate tc-a3-plate">
        <div className="tc-a3-lockup">
          <img className="tc-a3-logo" src={LOGO} alt="" />
          <div>
            <h1 className="tc-a-title tc-a3-title">{TITLE}</h1>
            <p className="tc-a-sub">A field companion for Britain</p>
          </div>
        </div>
        <div className="tc-a-hint">Tap the map to begin</div>
      </div>
    </div>
  );
}

/** A — the title cartouche of an old map: a framed plate in the middle of the
 *  land, with a hint that says how to get rid of it. */
function VariantA() {
  return (
    <div className="tc-a">
      <div className="tc-a-plate">
        <h1 className="tc-a-title">{TITLE}</h1>
        <p className="tc-a-sub">A field companion for Britain</p>
        <div className="tc-a-flourish" aria-hidden>
          ❧
        </div>
        <div className="tc-a-hint">Tap the map to begin</div>
      </div>
    </div>
  );
}

/** B — no box at all. The title is lettered onto the land the way an old map
 *  names a region: spaced capitals along a gentle arc, with a paper halo. */
function VariantB() {
  return (
    <div className="tc-b">
      <svg className="tc-b-arc" viewBox="0 0 760 160" aria-label={TITLE} role="img">
        <path id="tc-b-path" d="M 10 150 Q 380 20 750 150" fill="none" />
        <text className="tc-b-letters">
          <textPath href="#tc-b-path" startOffset="50%" textAnchor="middle">
            {TITLE.toUpperCase()}
          </textPath>
        </text>
      </svg>
      <p className="tc-b-tagline">{TAGLINE}</p>
    </div>
  );
}

/** C — an almanac masthead: a full-width band across the top of the map, set
 *  left, with a double rule under it. Reads as the page's heading, not a pop-up. */
function VariantC() {
  return (
    <div className="tc-c">
      <div className="tc-c-band">
        <h1 className="tc-c-title">{TITLE}</h1>
        <p className="tc-c-tagline">{TAGLINE}</p>
      </div>
    </div>
  );
}

/** D — the map's own key. The title heads a legend in the corner, and the pin
 *  colours below it answer "what are these dots" in the same glance. */
function VariantD() {
  return (
    <div className="tc-d">
      <div className="tc-d-key">
        <h1 className="tc-d-title">{TITLE}</h1>
        <p className="tc-d-tagline">A field companion to the old places of Britain.</p>
        <ul className="tc-d-list">
          {PARENT_CATEGORIES.map((p) => (
            <li key={p}>
              <span className="tc-d-dot" style={{ background: PARENT_CATEGORY_COLORS[p] }} />
              {PARENT_CATEGORY_LABELS[p]}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const RENDER: Record<string, () => JSX.Element> = {
  A: VariantA,
  A1: VariantA1,
  A2: VariantA2,
  A3: VariantA3, B: VariantB, C: VariantC, D: VariantD };

export function TitleCardPrototype() {
  const [variant, setVariant] = useState(() => readVariant([...VARIANTS, ...ROUND_1]));
  const [shown, setShown] = useState(true);
  const [fading, setFading] = useState(false);

  // First tap, pan or zoom anywhere dismisses it. A tap on the prototype bar
  // does not count. Programmatic map moves (geolocation) never fire these.
  useEffect(() => {
    if (!shown || fading) return;
    const dismiss = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-prototype-chrome]')) return;
      setFading(true);
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
    };
  }, [shown, fading]);

  const replay = () => {
    setFading(false);
    setShown(true);
  };

  const Variant = RENDER[variant];
  return (
    <>
      {shown && (
        <div
          key={variant}
          className={fading ? 'tc-root tc-fading' : 'tc-root'}
          onAnimationEnd={(e) => {
            if (e.animationName === 'tc-fade-out') setShown(false);
          }}
        >
          <Variant />
        </div>
      )}
      {import.meta.env.DEV && (
        <PrototypeSwitcher
          variants={VARIANTS}
          current={variant}
          onChange={(k) => {
            setVariant(k);
            replay();
          }}
          onReplay={replay}
        />
      )}
    </>
  );
}
