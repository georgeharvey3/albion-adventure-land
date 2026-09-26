import { describe, expect, it } from 'vitest';
import { resolvePlace } from './resolvePlace';
import { context, fakeNet } from './fixtures';

describe('resolve_place', () => {
  it('answers a known place from the place dictionary, with no network call', async () => {
    const net = fakeNet();
    const out = await resolvePlace(context({}, { net }), { text: 'Sheffield' });
    expect(out).toMatchObject({ found: true, label: 'Sheffield', lat: 53.383, lng: -1.4659 });
    expect(net.calls).toEqual([]);
  });

  it('matches an alternate name of a place', async () => {
    const out = await resolvePlace(context(), { text: 'Caerwynt' });
    expect(out).toMatchObject({ found: true, label: 'Winchester' });
  });

  it('prefers the bigger of two places with one name, and lists the other', async () => {
    const out = await resolvePlace(context(), { text: 'Newport' });
    expect(out).toMatchObject({ found: true, lat: 51.5877, lng: -2.9983 });
    if (!out.found) throw new Error('not found');
    expect(out.alternatives).toEqual([expect.objectContaining({ lat: 52.7668, lng: -2.3773 })]);
  });

  it('prefers the nearer of two places with one name when the device has a position', async () => {
    const out = await resolvePlace(context({ position: { lat: 52.7, lng: -2.4 } }), { text: 'Newport' });
    expect(out).toMatchObject({ found: true, lat: 52.7668 });
  });

  it('resolves a full postcode through postcodes.io', async () => {
    const net = fakeNet({ postcode: { 'SO23 9LS': { lat: 51.0612, lng: -1.3131 } } });
    const out = await resolvePlace(context({}, { net }), { text: 'so23 9ls' });
    expect(out).toMatchObject({ found: true, lat: 51.0612, lng: -1.3131, kind: 'postcode' });
  });

  it('falls back to the postcode district when postcodes.io has no answer', async () => {
    const out = await resolvePlace(context(), { text: 'SO23 9LS' });
    expect(out).toMatchObject({ found: true, lat: 51.07, lng: -1.31, approximate: true });
  });

  it('reads an OS grid reference', async () => {
    const out = await resolvePlace(context(), { text: 'SU 4829' });
    if (!out.found) throw new Error('not found');
    expect(out.kind).toBe('coords');
    expect(out.lat).toBeCloseTo(51.06, 1);
    expect(out.lng).toBeCloseTo(-1.32, 1);
  });

  it('resolves the name of a site', async () => {
    const out = await resolvePlace(context(), { text: 'Old Sarum' });
    expect(out).toMatchObject({ found: true, kind: 'site', siteId: 'old-sarum' });
  });

  it('resolves a site id, as the model sometimes passes one', async () => {
    const net = fakeNet();
    const out = await resolvePlace(context({}, { net }), { text: 'old-sarum' });
    expect(out).toMatchObject({ found: true, kind: 'site', siteId: 'old-sarum', label: 'Old Sarum' });
    expect(net.calls).toEqual([]);
  });

  it('does not resolve the name of a hidden site', async () => {
    const out = await resolvePlace(context({ hidden: ['old-sarum'] }), { text: 'Old Sarum' });
    expect(out).toMatchObject({ found: false });
  });

  it('asks Photon for a name the dictionary does not hold', async () => {
    const net = fakeNet({ photon: { 'Hay Bluff': [{ label: 'Hay Bluff', lat: 52.02, lng: -3.12 }] } });
    const out = await resolvePlace(context({}, { net }), { text: 'Hay Bluff' });
    expect(out).toMatchObject({ found: true, label: 'Hay Bluff', lat: 52.02 });
  });

  it('ignores a Photon answer outside Britain', async () => {
    const net = fakeNet({ photon: { Paris: [{ label: 'Paris', lat: 48.85, lng: 2.35 }] } });
    const out = await resolvePlace(context({}, { net }), { text: 'Paris' });
    expect(out).toMatchObject({ found: false });
  });

  it('ignores a Photon answer that shares no main word with the text', async () => {
    const net = fakeNet({ photon: { 'Nowhereville-on-Sea': [{ label: 'Southend-on-Sea', lat: 51.54, lng: 0.71 }] } });
    const out = await resolvePlace(context({}, { net }), { text: 'Nowhereville-on-Sea' });
    expect(out).toMatchObject({ found: false });
  });

  it('accepts a Photon answer that names more than the text', async () => {
    const net = fakeNet({ photon: { 'Brecon Beacons': [{ label: 'Brecon Beacons Visitor Centre', lat: 51.93, lng: -3.49 }] } });
    const out = await resolvePlace(context({}, { net }), { text: 'Brecon Beacons' });
    expect(out).toMatchObject({ found: true, lat: 51.93 });
  });

  it('does not resolve "me" or "here", and points to the live position instead', async () => {
    const net = fakeNet({ photon: { me: [{ label: 'Mendip', lat: 51.23, lng: -2.62 }] } });
    for (const text of ['me', 'here', 'my location', 'position']) {
      const out = await resolvePlace(context({}, { net }), { text });
      expect(out).toMatchObject({ found: false });
      expect(out).toHaveProperty('hint');
    }
    expect(net.calls).toEqual([]);
  });

  it('says so when nothing matches', async () => {
    const out = await resolvePlace(context(), { text: 'Nowhereville' });
    expect(out).toEqual({ found: false, text: 'Nowhereville' });
  });
});
