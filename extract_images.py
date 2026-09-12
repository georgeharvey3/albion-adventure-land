#!/usr/bin/env python3
"""
extract_images.py - pull listing photos out of a guidebook PDF and join them to
an existing sites CSV.

How it works
------------
Each photo in the book carries a small printed number badge: a round marker
(a two-character "XX" glyph in the layout font) with the listing number set on
top of it. The script anchors on those markers, reads the number, and assigns
the number to the embedded image whose bounding box contains it.

The region is detected page by page. Each page prints its listing headings
(number + title in the display font); the script matches those headings against
the master CSV and picks the region with the most matches. Pages with no
heading inherit the region of the page before. This lets one PDF hold every
chapter of the book.

Usage
-----
  # the whole book, region detected per page
  python extract_images.py --pdf Magical-Britain-listings-only.pdf \
      --master data/magical_britain_master.csv --out data/mb-images

  # a single-region chapter PDF
  python extract_images.py --pdf chapter.pdf --region "West Penwith" \
      --master master.csv --out ./images

  # also write a copy of the master with an image_files column
  python extract_images.py --pdf book.pdf --master master.csv \
      --out ./images --merge

Requires: pdfplumber, Pillow      (pip install pdfplumber Pillow)
"""

import argparse
import csv
import io
import os
import re
import sys
import unicodedata
from collections import defaultdict, Counter

try:
    import pdfplumber
except ImportError:
    sys.exit("Missing dependency: pip install pdfplumber")
try:
    from PIL import Image
except ImportError:
    sys.exit("Missing dependency: pip install Pillow")


# Layout constants for this book. Override on the command line if a different
# book uses different fonts.
BADGE_MARKER = "XX"          # the round badge behind the number
HEADING_FONT = "BrandonGrotesque"
HEADING_SIZE = (10.0, 12.0)  # listing headings
BADGE_MAX_SIZE = 9.5         # badge numerals are much smaller than headings


# ---------------------------------------------------------------- helpers

def norm(s):
    """Loose key for comparing names: strip accents, punctuation, 'and'/'&'."""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\b(the|of)\b", " ", s)
    return " ".join(s.split())


def slug(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


# ---------------------------------------------------------------- master CSV

def load_master(path):
    """Return ({normalised_region: (display_region, {listing_no: title})}, rows)."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f"{path}: empty")
    for col in ("region", "listing_no"):
        if col not in rows[0]:
            sys.exit(f"{path}: missing '{col}' column")

    regions = {}
    for r in rows:
        reg = r["region"].strip()
        try:
            no = int(r["listing_no"])
        except (ValueError, TypeError):
            continue
        disp, titles = regions.setdefault(norm(reg), (reg, {}))
        title = r.get("listing_title", "").strip()
        if title and not titles.get(no):
            titles[no] = title
        titles.setdefault(no, "")
    return regions, rows


# ---------------------------------------------------------------- page text

def words_of(page):
    return page.extract_words(extra_attrs=["fontname", "size"])


def find_headings(words):
    """[(listing_no, title_text)] for the listing headings printed on a page."""
    heads = [w for w in words
             if HEADING_FONT in w["fontname"]
             and HEADING_SIZE[0] <= round(w["size"], 1) <= HEADING_SIZE[1]]
    rows = defaultdict(list)
    for w in heads:
        rows[round(w["top"])].append(w)

    out = []
    for _, row in sorted(rows.items()):
        row.sort(key=lambda w: w["x0"])
        cur = None
        for w in row:
            if re.fullmatch(r"\d{1,2}", w["text"]):
                if cur:
                    out.append(cur)
                cur = [int(w["text"]), []]
            elif cur is not None:
                cur[1].append(w["text"])
        if cur:
            out.append(cur)
    return [(no, " ".join(ws)) for no, ws in out]


def page_region_votes(words, regions):
    """Score every region by how many of this page's headings it explains."""
    votes = Counter()
    for no, text in find_headings(words):
        t = norm(text)
        if len(t) < 4:
            continue
        head = t[:12]
        for key, (_, titles) in regions.items():
            mt = norm(titles.get(no, ""))
            if mt and (mt.startswith(head) or head in mt):
                votes[key] += 1
    return votes


def detect_page_regions(pages_words, regions, forced=None):
    """One region key per page. Unvoted pages inherit the page before."""
    n = len(pages_words)
    if forced:
        return [forced] * n

    best = []
    for words in pages_words:
        votes = page_region_votes(words, regions)
        if not votes:
            best.append(None)
            continue
        top = votes.most_common()
        if len(top) > 1 and top[0][1] == top[1][1]:
            best.append(None)
        else:
            best.append(top[0][0])

    out = list(best)
    last = None
    for i, k in enumerate(out):          # carry forward
        if k is None:
            out[i] = last
        else:
            last = k
    nxt = None                           # then backward, for a leading gap
    for i in range(n - 1, -1, -1):
        if out[i] is None:
            out[i] = nxt
        else:
            nxt = out[i]
    return out


# ---------------------------------------------------------------- detection

def find_badges(words, max_listing):
    """Numbers printed on a badge marker: [{'n', 'x', 'y'}]."""
    markers = [w for w in words if w["text"].strip() == BADGE_MARKER]
    digits = [w for w in words
              if re.fullmatch(r"\d{1,2}", w["text"].strip())
              and round(w["size"], 1) <= BADGE_MAX_SIZE]

    out, unmatched = [], []
    for m in markers:
        near = [d for d in digits
                if abs(d["x0"] - m["x0"]) < 12 and abs(d["top"] - m["top"]) < 6]
        if len(near) != 1:
            unmatched.append((round(m["x0"]), round(m["top"]), len(near)))
            continue
        d = near[0]
        n = int(d["text"])
        if n < 1 or n > max_listing:
            unmatched.append((round(m["x0"]), round(m["top"]), n))
            continue
        out.append({"n": n, "x": d["x0"], "y": d["top"]})
    return out, unmatched


def inside(im, x, y, pad):
    return (im["x0"] - pad <= x <= im["x1"] + pad
            and im["top"] - pad <= y <= im["bottom"] + pad)


def area(im):
    return max(0.0, im["x1"] - im["x0"]) * max(0.0, im["bottom"] - im["top"])


def is_furniture(im, max_aspect):
    """True for the long thin bands the page uses as rules and gradients."""
    w = im["x1"] - im["x0"]
    h = im["bottom"] - im["top"]
    if w <= 0 or h <= 0:
        return True
    return max(w / h, h / w) > max_aspect


def find_captions(words):
    """Short non-numeric labels printed on top of photos (e.g. 'Saint-Martin')."""
    out = []
    for w in words:
        t = w["text"].strip()
        if (t and not re.search(r"\d", t) and t != BADGE_MARKER
                and round(w["size"], 1) <= 9 and len(t) > 2):
            out.append({"t": t, "x": w["x0"], "y": w["top"],
                        "font": w["fontname"].split("+")[-1]})
    return out


def caption_for(im, caps, pad=2):
    """
    A real photo caption sits in one corner of the image in a single font.
    Vector maps drawn as an image would otherwise dump every town label in
    here, so require few words, one font, and a position near an edge.
    """
    hits = [c for c in caps if inside(im, c["x"], c["y"], pad)]
    if not hits:
        return ""
    groups = defaultdict(list)
    for c in hits:
        groups[c["font"]].append(c)
    small = [g for g in groups.values() if len(g) <= 4]
    if len(small) != 1:
        return ""
    g = small[0]
    h = im["bottom"] - im["top"]
    edge = max(20.0, h * 0.15)
    if not all(c["y"] - im["top"] <= edge or im["bottom"] - c["y"] <= edge for c in g):
        return ""
    return " ".join(c["t"] for c in sorted(g, key=lambda c: (c["y"], c["x"])))


# ---------------------------------------------------------------- image bytes

def _indexed_palette(cs):
    """(base_components, palette_bytes) for an /Indexed colour space, else None."""
    while isinstance(cs, list) and len(cs) == 1:
        cs = cs[0]
    if not (isinstance(cs, list) and len(cs) == 4):
        return None
    name = getattr(cs[0], "name", cs[0])
    if name != "Indexed":
        return None

    base = cs[1]
    while isinstance(base, list) and len(base) == 1:
        base = base[0]
    ncomp = 3
    if isinstance(base, list):
        bname = getattr(base[0], "name", base[0])
        if bname == "ICCBased":
            ncomp = int(base[1].get_any(("N",)) or 3) if hasattr(base[1], "get_any") \
                else int(base[1].attrs.get("N", 3))
        elif bname == "DeviceCMYK":
            ncomp = 4
        elif bname == "DeviceGray":
            ncomp = 1
    else:
        bname = getattr(base, "name", base)
        ncomp = {"DeviceGray": 1, "DeviceRGB": 3, "DeviceCMYK": 4}.get(bname, 3)

    lookup = cs[3]
    if hasattr(lookup, "get_data"):
        pal = lookup.get_data()
    elif isinstance(lookup, bytes):
        pal = lookup
    else:
        pal = bytes(lookup)
    return ncomp, pal


def _write_jpeg(img, dest, max_px, quality):
    """Write a Pillow image as a JPEG, no larger than max_px on its long side."""
    if max_px and max(img.size) > max_px:
        scale = max_px / max(img.size)
        img = img.resize((max(1, round(img.width * scale)),
                          max(1, round(img.height * scale))), Image.LANCZOS)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.save(dest, "JPEG", quality=quality, optimize=True, progressive=True)


def save_image(im, dest, max_px=None, quality=95):
    """
    Write the embedded image, preferring a byte-for-byte JPEG copy.

    max_px caps the long side of the picture in pixels. A book printed at a
    high resolution gives pictures of several megabytes each, which is more
    than a phone on a rural road can download. Leave it at None to keep every
    picture at the size the book holds.
    """
    st = im["stream"]
    try:
        filters = [f[0].name for f in st.get_filters()]
    except Exception:
        filters = []

    if filters == ["DCTDecode"]:                       # already a JPEG
        raw = st.get_rawdata()
        if max_px:
            img = Image.open(io.BytesIO(raw))
            if max(img.size) > max_px:
                _write_jpeg(img, dest, max_px, quality)
                return "re-encoded (smaller)"
        with open(dest, "wb") as f:
            f.write(raw)
        return "copied"

    if filters == ["JPXDecode"]:                       # JPEG 2000
        # No browser but Safari shows JPEG 2000, so the codestream is decoded
        # and written again as a JPEG. Pillow needs openjpeg for this.
        _write_jpeg(Image.open(io.BytesIO(st.get_rawdata())), dest, max_px, quality)
        return "re-encoded (jpeg 2000)"

    w, h = im["srcsize"]
    if not w or not h:
        raise ValueError("zero-sized image")
    raw = st.get_data()

    idx = _indexed_palette(im.get("colorspace"))
    if idx and len(raw) >= w * h:
        ncomp, pal = idx
        img = Image.frombytes("P", (w, h), raw[:w * h])
        if ncomp == 3:
            img.putpalette(pal[:768].ljust(768, b"\0"), "RGB")
            img = img.convert("RGB")
        elif ncomp == 1:
            img.putpalette(b"".join(bytes([p, p, p]) for p in pal[:256]).ljust(768, b"\0"))
            img = img.convert("RGB")
        else:                                          # CMYK palette
            img = img.convert("RGB")
        _write_jpeg(img, dest, max_px, quality)
        return "re-encoded (indexed)"

    ncomp = {"DeviceGray": 1, "DeviceRGB": 3, "DeviceCMYK": 4}
    mode = None
    for name, n in ncomp.items():
        if len(raw) == w * h * n:
            mode = {1: "L", 3: "RGB", 4: "CMYK"}[n]
            break
    if mode is None:                                    # guess from data length
        n = len(raw) // (w * h)
        mode = {1: "L", 3: "RGB", 4: "CMYK"}.get(n)
    if mode is None:
        raise ValueError(f"unrecognised image data ({filters}, {len(raw)} bytes for {w}x{h})")

    img = Image.frombytes(mode, (w, h), raw[:w * h * {"L": 1, "RGB": 3, "CMYK": 4}[mode]])
    _write_jpeg(img, dest, max_px, quality)
    return "re-encoded"


# ---------------------------------------------------------------- per-PDF

def process_pdf(path, regions, outdir, args, report):
    forced = None
    if args.region:
        forced = norm(args.region)
        if forced not in regions:
            sys.exit(f"Region {args.region!r} not in master. Known regions:\n  "
                     + "\n  ".join(sorted(d for d, _ in regions.values())))

    base = os.path.basename(path)
    records = []
    counts = defaultdict(int)
    seen_pages = defaultdict(set)
    no_badge = 0

    with pdfplumber.open(path) as pdf:
        pages = pdf.pages
        pages_words = [words_of(p) for p in pages]
        page_regions = detect_page_regions(pages_words, regions, forced)

        for pi, (page, words, key) in enumerate(
                zip(pages, pages_words, page_regions), 1):
            if key is None:
                report.append({"pdf": base, "region": "?", "page": pi, "image": "-",
                               "size": "-", "issue": "region not identified"})
                continue
            disp, titles = regions[key]
            max_listing = max(titles) if titles else 99

            badges, bad = find_badges(words, max_listing)
            for x, y, n in bad:
                report.append({"pdf": base, "region": disp, "page": pi,
                               "image": f"badge@{x},{y}", "size": "-",
                               "issue": f"badge marker with no usable number ({n})"})
            caps = find_captions(words)
            images = sorted((im for im in page.images
                             if not is_furniture(im, args.max_aspect)),
                            key=lambda im: (round(im["top"]), im["x0"]))

            for im in images:
                w, h = im["srcsize"]
                hits = [b for b in badges if inside(im, b["x"], b["y"], args.pad)]
                if not hits:
                    no_badge += 1
                    if min(w, h) >= args.min_px:
                        report.append({"pdf": base, "region": disp, "page": pi,
                                       "image": im.get("name", "?"), "size": f"{w}x{h}",
                                       "issue": "no badge found"})
                    continue
                nums = sorted({b["n"] for b in hits})
                if len(nums) > 1:
                    report.append({"pdf": base, "region": disp, "page": pi,
                                   "image": im.get("name", "?"), "size": f"{w}x{h}",
                                   "issue": f"ambiguous badges {nums}"})
                    continue

                no = nums[0]
                # A badge inside several stacked images belongs to the smallest.
                rivals = [o for o in images
                          if o is not im and inside(o, hits[0]["x"], hits[0]["y"], args.pad)]
                if rivals and any(area(o) < area(im) for o in rivals):
                    continue

                counts[(key, no)] += 1
                seen_pages[(key, no)].add(pi)
                fname = f"{slug(disp)}_listing_{no:02d}_{counts[(key, no)]}.jpg"
                dest = os.path.join(outdir, fname)
                try:
                    how = "would extract" if args.dry_run else save_image(im, dest)
                except Exception as e:
                    counts[(key, no)] -= 1
                    report.append({"pdf": base, "region": disp, "page": pi,
                                   "image": im.get("name", "?"), "size": f"{w}x{h}",
                                   "issue": f"could not decode: {e}"})
                    continue

                records.append({
                    "region": disp, "listing_no": no,
                    "listing_title": titles.get(no, ""),
                    "image_file": fname, "image_no": counts[(key, no)], "page": pi,
                    "width": w, "height": h,
                    "caption": caption_for(im, caps), "extracted": how,
                })

    by_region = defaultdict(set)
    for r in records:
        by_region[r["region"]].add(r["listing_no"])
    for key in dict.fromkeys(k for k in page_regions if k):
        disp, titles = regions[key]
        missing = sorted(set(titles) - by_region.get(disp, set()))
        if missing:
            report.append({"pdf": base, "region": disp, "page": "-", "image": "-",
                           "size": "-", "issue": f"listings with no image: {missing}"})
    return records, no_badge


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--pdf", help="a single PDF (a whole book or one chapter)")
    src.add_argument("--pdf-dir", help="folder of PDFs")
    ap.add_argument("--master", required=True, help="existing sites CSV")
    ap.add_argument("--out", default="images", help="output folder (default: images)")
    ap.add_argument("--region", help="force one region for every page")
    ap.add_argument("--pad", type=float, default=6.0,
                    help="badge/bbox tolerance in points (default: 6)")
    ap.add_argument("--min-px", type=int, default=200,
                    help="do not report images below this size (default: 200)")
    ap.add_argument("--max-aspect", type=float, default=5.0,
                    help="ignore images thinner than this ratio as page furniture "
                         "(default: 5)")
    ap.add_argument("--merge", action="store_true",
                    help="also write master_with_images.csv (image_files on main rows)")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    regions, master_rows = load_master(args.master)

    if args.pdf:
        pdfs = [args.pdf]
    else:
        pdfs = sorted(os.path.join(args.pdf_dir, f)
                      for f in os.listdir(args.pdf_dir) if f.lower().endswith(".pdf"))
    if not pdfs:
        sys.exit("No PDFs found.")

    if not args.dry_run:
        os.makedirs(args.out, exist_ok=True)
    all_records, report = [], []
    skipped = 0

    for path in pdfs:
        recs, no_badge = process_pdf(path, regions, args.out, args, report)
        all_records.extend(recs)
        skipped += no_badge
        n_listings = len({(r["region"], r["listing_no"]) for r in recs})
        n_regions = len({r["region"] for r in recs})
        print(f"  {os.path.basename(path):40} {n_regions:2} regions "
              f"{len(recs):4} images / {n_listings:4} listings "
              f"({no_badge} images with no badge skipped)")

    all_records.sort(key=lambda r: (r["region"], r["listing_no"], r["image_no"]))

    if not args.dry_run:
        idx = os.path.join(args.out, "images_index.csv")
        with open(idx, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["region", "listing_no", "listing_title",
                                              "image_file", "image_no", "page",
                                              "width", "height", "caption", "extracted"])
            w.writeheader()
            w.writerows(all_records)
        print(f"\nIndex: {idx}")

        if args.merge:
            by_listing = defaultdict(list)
            for r in all_records:
                by_listing[(norm(r["region"]), r["listing_no"])].append(r["image_file"])
            out = os.path.join(args.out, "master_with_images.csv")
            fields = list(master_rows[0].keys())
            if "image_files" not in fields:
                fields.append("image_files")
            with open(out, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                for r in master_rows:
                    r = dict(r)
                    try:
                        key = (norm(r["region"]), int(r["listing_no"]))
                    except (ValueError, TypeError):
                        key = None
                    r["image_files"] = ("; ".join(by_listing.get(key, []))
                                        if key and r.get("point_type") == "main" else "")
                    w.writerow(r)
            print(f"Merged CSV: {out}")

    if report:
        kinds = Counter(re.sub(r"[\d\[\],]+", "", p["issue"]).strip() for p in report)
        print(f"\n{len(report)} thing(s) to check:")
        for k, n in kinds.most_common():
            print(f"  {n:4}  {k}")
        if not args.dry_run:
            rp = os.path.join(args.out, "report.csv")
            with open(rp, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["pdf", "region", "page", "image",
                                                  "size", "issue"])
                w.writeheader()
                w.writerows(report)
            print(f"Report: {rp}")
    else:
        print("\nNo problems found.")

    print(f"\nTotal: {len(all_records)} images from {len(pdfs)} PDF(s).")


if __name__ == "__main__":
    main()
