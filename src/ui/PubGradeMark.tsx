import { MAX_PUB_GRADE, pubGrade, type Site } from '../data/types';
import { StarIcon } from './icons';

// The pub's CAMRA heritage grade, on its listing. Pubs only: every other layer
// renders nothing here.
//
// Three marks, always — the empty slots are the whole point. A single star on a
// card reads as "starred", the way the wishlist star does two lines below it;
// one filled mark in a row of three reads as a grade, which is what it is. The
// marks take the ink colour for the same reason: the wish colour is spoken for.
//
// The grade is derived from the pub's source tag (see `pubGrade`), so it costs
// no site field and a re-import of CAMRA.csv carries it along for free.
export function PubGradeMark({ site }: { site: Site }) {
  const grade = pubGrade(site);
  if (!grade) return null;

  return (
    <p className="card-grade">
      <span className="grade-label">CAMRA heritage</span>
      <span
        className="grade-stars"
        role="img"
        aria-label={`${grade} of ${MAX_PUB_GRADE} stars`}
      >
        {Array.from({ length: MAX_PUB_GRADE }, (_, i) => (
          <StarIcon key={i} filled={i < grade} className={i < grade ? 'on' : 'off'} />
        ))}
      </span>
    </p>
  );
}
