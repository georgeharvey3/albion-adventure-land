// The wire contract between the app and the Ethelred server (issue #62), and
// the shapes the agent loop passes between its parts.
//
// The server keeps no user state (docs/adr/0002-ethelred-server.md). Every
// question carries its own snapshot of the context and the user state, and the
// server forgets it when the answer is done. The filter is deliberately NOT in
// the request: Ethelred answers from the whole data, not from what happens to
// be on the map.

import type { LatLng } from '../src/geo/haversine';

/** A point with an optional human label ("Sheffield", "Current position"). */
export interface NamedPoint extends LatLng {
  label?: string;
}

/** The two ends of a journey. */
export interface Journey {
  origin: NamedPoint;
  destination: NamedPoint;
}

/** One earlier turn of the conversation. The device keeps the conversation and
 *  sends it again with each question. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskRequest {
  question: string;
  conversation?: ConversationTurn[];
  /** The live position, when the device has a fix. */
  position?: LatLng | null;
  /** The journey set in the app, when there is one. */
  journey?: Journey | null;
  /** The stable id of the site the app is showing in detail. */
  selection?: string | null;
  /** The local date and time on the device, ISO 8601 without a zone:
   *  "2026-09-26T14:30". The weekday is derived from it. */
  now: string;
  visited?: string[];
  wishlist?: string[];
  hidden?: string[];
}

/** A hand-off: an action the answer offers. Nothing changes in the app until
 *  the user taps it. */
export type HandOff =
  | { kind: 'show_on_map'; siteIds: string[] }
  | ({ kind: 'use_as_journey' } & Journey)
  | { kind: 'add_to_trip'; siteId: string }
  | { kind: 'plan_trip'; types: string[]; near?: NamedPoint };

/** The context an answer used, so the app (and the reader) can see whether it
 *  answered about the journey, the live position, or a place the question
 *  named. */
export type AnswerContext =
  | ({ kind: 'journey'; route: 'road' | 'direct' } & Journey)
  | { kind: 'near'; point: NamedPoint }
  | { kind: 'county'; county: string }
  | { kind: 'none' };

export interface Answer {
  /** The prose. Site names are Markdown links to `site:<id>`. */
  text: string;
  /** Every site the answer names, in the order it names them. */
  siteIds: string[];
  handOffs: HandOff[];
  context: AnswerContext;
}

/** One tool call the agent made, and what it returned. The eval reads this to
 *  check the trace and to compute the bounds set. */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  /** Every site id the call returned. */
  siteIds: string[];
}
