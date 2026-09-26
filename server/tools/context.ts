// What every tool can see while it answers one question (issue #62).
//
// The request state is the snapshot the device sent with the question. It
// lives for one answer and is never stored (docs/adr/0002-ethelred-server.md).

import type { LatLng } from '../../src/geo/haversine';
import type { SiteData } from '../data';
import type { Net } from '../net';
import type { SemanticIndex } from '../semantic';
import type { AskRequest, Journey } from '../types';

export interface RequestState {
  position: LatLng | null;
  journey: Journey | null;
  selection: string | null;
  now: string;
  visited: ReadonlySet<string>;
  wishlist: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}

export interface ToolContext {
  data: SiteData;
  net: Net;
  /** Null when the index could not be loaded. `meaning` then has no effect,
   *  and the shortlist keeps its distance order. */
  semantic: SemanticIndex | null;
  request: RequestState;
}

export function requestState(req: AskRequest): RequestState {
  return {
    position: req.position ?? null,
    journey: req.journey ?? null,
    selection: req.selection ?? null,
    now: req.now,
    visited: new Set(req.visited ?? []),
    wishlist: new Set(req.wishlist ?? []),
    hidden: new Set(req.hidden ?? []),
  };
}
