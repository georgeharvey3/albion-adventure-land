import type L from 'leaflet';
import { siteSwatch, SITE_TYPE_LABELS, type Site } from '../data/types';

/** Room for the pin between it and the plate. The CSS uses 14px. */
const PIN_GAP = 20;

// The peek (issue #88): a small plate over a pin under the mouse, or under the
// keyboard cursor. It shows the site's first picture, its name and its type,
// so a reader can tell what a pin is before they open it.
//
// A site with no picture gets a painted placeholder in its layer colour: the
// same swatch the list dot wears, under a wash. The peek shows no numbers.
//
// It is plain DOM in the map container, like the speck hint, and takes no
// pointer events, so it never steals the hover from the pin under it.
export class PinPeek {
  private readonly root: HTMLDivElement;
  private readonly plate: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly type: HTMLDivElement;
  private siteId: string | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pin-peek';
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    this.plate = document.createElement('div');
    this.plate.className = 'pin-peek-plate';
    this.name = document.createElement('div');
    this.name.className = 'pin-peek-name';
    this.type = document.createElement('div');
    this.type.className = 'pin-peek-type';
    this.root.append(this.plate, this.name, this.type);
    container.append(this.root);
  }

  show(site: Site, at: L.Point) {
    if (this.siteId !== site.id) {
      this.siteId = site.id;
      this.fill(site);
    }
    this.root.style.left = `${at.x}px`;
    this.root.style.top = `${at.y}px`;
    this.root.hidden = false;
    // Above the pin, or below it when the pin is too near the top of the map
    // for the plate to fit. Measured, so the CSS alone sets its size.
    this.root.classList.toggle('below', at.y < this.root.offsetHeight + PIN_GAP);
  }

  hide() {
    this.root.hidden = true;
  }

  remove() {
    this.root.remove();
  }

  private fill(site: Site) {
    this.name.textContent = site.name;
    this.type.textContent = SITE_TYPE_LABELS[site.category];
    this.plate.replaceChildren();
    const image = site.images?.[0];
    const paint = () => {
      this.plate.replaceChildren();
      this.plate.classList.add('blank');
      this.plate.style.background = siteSwatch(site);
    };
    if (!image) {
      paint();
      return;
    }
    this.plate.classList.remove('blank');
    this.plate.style.background = '';
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = `${import.meta.env.BASE_URL}${image.url}`;
    // A picture that fails to load falls back to the placeholder, as a list
    // thumbnail does, and never to a broken-image box.
    img.onerror = () => {
      if (this.siteId === site.id) paint();
    };
    this.plate.append(img);
  }
}
