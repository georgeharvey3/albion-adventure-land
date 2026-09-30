// The named parts of `SiteBody` (SiteDetail.tsx), and where each layout puts
// them (issue #90). The card and the browse row stack every part in one
// column. The spread shows the pictures across its top, and reads the write-up in a main column and puts the actions
// and the facts in a side column, and a container query folds the two into one
// column when the spread is narrow.
//
// CSS alone cannot make the two columns from one flat list: a grid shares its
// row heights between the columns, so a long write-up spaced the buttons out.
// So the parts are named here and each layout lists them. A new part must go
// in every layout, and tests/siteBody.test.ts fails until it does.
//
// No imports, so the test runs without the DOM.

export const SITE_BODY_PARTS = [
  'header',
  'grade',
  'badges',
  'partOf',
  'walkTime',
  'access',
  'hours',
  'gallery',
  'writeUp',
  'source',
  'listing',
  'actions',
] as const;

export type SiteBodyPart = (typeof SITE_BODY_PARTS)[number];

export const SITE_BODY_LAYOUT: {
  card: readonly SiteBodyPart[];
  spread: {
    lead: readonly SiteBodyPart[];
    main: readonly SiteBodyPart[];
    side: readonly SiteBodyPart[];
  };
} = {
  card: SITE_BODY_PARTS,
  // The spread shows its pictures as the lead, across the top of the page:
  // one at a time, full size, in a carousel.
  spread: {
    lead: ['gallery'],
    main: ['header', 'writeUp', 'source', 'listing'],
    side: ['actions', 'badges', 'grade', 'partOf', 'walkTime', 'access', 'hours'],
  },
};
