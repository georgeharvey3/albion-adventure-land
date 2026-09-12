#!/usr/bin/env python3
"""
extract_swim_images.py - pull listing photos out of Wild Swimming Britain and
join them to the listings in data/swims.csv.

This is extract_images.py adapted to a second guidebook. The image decoding and
the badge-inside-bounding-box join are shared with that script (imported from
it); what changes is the typography the anchors are read from.

How this book differs from Magical Britain
------------------------------------------
badge    A photo's listing number is printed on a round badge made of two 'X'
         glyphs of the layout font (ApexNewPS-MediumTabular, 7pt), with the
         numerals set on top of those two glyphs. Magical Britain prints the
         marker as one "XX" word with the number beside it, so here the badge
         is read from the characters of a page, not from its words.
region   Listing numbers restart at 1 in each chapter, so a photo is identified
         by chapter + number. The chapter is the name printed in the page
         footer (see `page_chapter` in extract_swims.py), which is the same
         value that script writes to the Region column, so no region has to be
         guessed from the page text.
master   The listings come from data/swims.csv, which extract_swims.py makes
         from the same book. Run that script first: this one needs its Region
         and Listing no columns.

Not every listing has a photo, and a chapter prints its photos in galleries
that can sit pages away from the write-up. A listing with no photo is normal
and is only counted; the report names them so a miss can be told from a gap.

Usage
-----
  python3 extract_swim_images.py --pdf pdfs/Wild-Swimming-Britain-3rd-Ed-t0x6x2.pdf \
      --master data/swims.csv --out data/swim-images

  python3 extract_swim_images.py --pdf book.pdf --master data/swims.csv --dry-run

Requires: pdfplumber, Pillow      (pip install pdfplumber Pillow)
"""

import argparse
import csv
import os
import re
import sys
from collections import Counter, defaultdict

try:
    import pdfplumber
except ImportError:
    sys.exit("Missing dependency: pip install pdfplumber")

from extract_images import area, inside, is_furniture, norm, save_image, slug
from extract_swims import page_chapter, page_chapters

# Columns of the master CSV (written by extract_swims.py).
MASTER_REGION = "Region"
MASTER_NO = "Listing no"
MASTER_NAME = "Name"

# Layout constants for this book.
BADGE_FONT = "MediumTabular"   # the badge glyphs and the numerals on them
BADGE_MAX_SIZE = 7.5           # numerals in the body text of this font are 9pt
BADGE_GAP = 6.0                # largest x step between characters of one badge


# ---------------------------------------------------------------- master CSV

def load_master(path):
    """{normalised_region: (display_region, {listing_no: name})} from swims.csv."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f"{path}: empty")
    for col in (MASTER_REGION, MASTER_NO, MASTER_NAME):
        if col not in rows[0]:
            sys.exit(f"{path}: missing '{col}' column — run extract_swims.py again "
                     "to write it")

    regions = {}
    for r in rows:
        region = (r[MASTER_REGION] or "").strip()
        if not region:
            continue
        try:
            no = int(r[MASTER_NO])
        except (ValueError, TypeError):
            continue
        _, names = regions.setdefault(norm(region), (region, {}))
        names.setdefault(no, (r[MASTER_NAME] or "").strip())
    return regions


# ---------------------------------------------------------------- detection

def find_badges(chars):
    """
    The numbers printed on badges: ([{'n', 'x', 'y'}], unreadable). A badge is
    two 'X' glyphs with the numerals set on them, so one cluster of badge-font
    characters on one baseline is one badge. The number is not range-checked
    here — the chapter, and so the number of listings, is known later.
    """
    rows = defaultdict(list)
    for c in chars:
        rows[round(c["top"])].append(c)

    out, unreadable = [], []
    for top, row in sorted(rows.items()):
        row.sort(key=lambda c: c["x0"])
        clusters = []
        for c in row:
            if clusters and c["x0"] - clusters[-1][-1]["x0"] <= BADGE_GAP:
                clusters[-1].append(c)
            else:
                clusters.append([c])

        for cl in clusters:
            marks = {round(c["x0"], 1) for c in cl if c["text"] == "X"}
            digits = [c for c in cl if c["text"].isdigit()]
            if len(marks) < 2 or not digits:
                continue                   # a stray numeral or glyph, not a badge
            x = min(c["x0"] for c in cl)
            # One numeral to a position. Two different numerals on the same
            # position are two badges printed on top of each other, which this
            # book does on a few map pages — report it, never guess.
            by_x = defaultdict(set)
            for d in digits:
                by_x[round(d["x0"])].add(d["text"])
            if any(len(v) > 1 for v in by_x.values()):
                unreadable.append((round(x), round(top), "two badges overprinted"))
                continue
            out.append({"n": int("".join(sorted(v)[0] for _, v in sorted(by_x.items()))),
                        "x": x, "y": top})
    return out, unreadable


def read_pages(pdf):
    """
    One pass over the book: the footer chapter, the badges and the photo boxes
    of every page. The chapter of a page with no footer is only known once
    every footer is read, so every page is collected first and the photos are
    written afterwards.
    """
    pages = []
    footers = []
    n = len(pdf.pages)
    for pi, page in enumerate(pdf.pages, 1):
        words = page.extract_words(extra_attrs=["fontname", "size"])
        footers.append(page_chapter(page, words))
        badges, overprinted = find_badges(
            [c for c in page.chars if BADGE_FONT in c["fontname"]
             and round(c["size"], 1) <= BADGE_MAX_SIZE])
        pages.append({"page": pi, "badges": badges, "overprinted": overprinted,
                      "images": page.images})
        page.flush_cache()          # the page text is read once; do not hold it
        print(f"\rpage {pi}/{n}", end="", file=sys.stderr)
    print(file=sys.stderr)

    for p, chapter in zip(pages, page_chapters(footers)):
        p["chapter"] = chapter
    return pages


# ---------------------------------------------------------------- extraction

def process(pages, regions, outdir, args, report, base):
    records = []
    counts = defaultdict(int)
    no_badge = 0

    for p in pages:
        chapter = p["chapter"]
        if chapter is None:
            continue                          # front matter holds no listings
        key = norm(chapter)
        if key not in regions:
            report.append({"pdf": base, "region": chapter, "page": p["page"],
                           "image": "-", "size": "-",
                           "issue": "chapter is not a Region in the master CSV"})
            continue
        display, names = regions[key]
        max_listing = max(names) if names else 99

        badges = []
        for b in p["badges"]:
            if 1 <= b["n"] <= max_listing:
                badges.append(b)
            else:
                report.append({"pdf": base, "region": display, "page": p["page"],
                               "image": f"badge@{round(b['x'])},{round(b['y'])}",
                               "size": "-",
                               "issue": f"badge number {b['n']} is not a listing "
                                        f"of this chapter"})
        for x, y, why in p["overprinted"]:
            report.append({"pdf": base, "region": display, "page": p["page"],
                           "image": f"badge@{x},{y}", "size": "-",
                           "issue": f"badge not read ({why})"})

        images = sorted((im for im in p["images"]
                         if not is_furniture(im, args.max_aspect)),
                        key=lambda im: (round(im["top"]), im["x0"]))
        placed = set()

        for im in images:
            w, h = im["srcsize"]
            hits = [b for b in badges if inside(im, b["x"], b["y"], args.pad)]
            if not hits:
                no_badge += 1
                if min(w, h) >= args.min_px:
                    report.append({"pdf": base, "region": display, "page": p["page"],
                                   "image": im.get("name", "?"), "size": f"{w}x{h}",
                                   "issue": "no badge found"})
                continue
            nums = sorted({b["n"] for b in hits})
            if len(nums) > 1:
                report.append({"pdf": base, "region": display, "page": p["page"],
                               "image": im.get("name", "?"), "size": f"{w}x{h}",
                               "issue": f"ambiguous badges {nums}"})
                continue

            no = nums[0]
            # A badge inside several stacked images belongs to the smallest.
            rivals = [o for o in images
                      if o is not im and inside(o, hits[0]["x"], hits[0]["y"], args.pad)]
            if rivals and any(area(o) < area(im) for o in rivals):
                continue
            # Some pages print the same artwork twice, one image on top of the
            # other. Take the first copy of a badge on a page only.
            mark = (no, round(hits[0]["x"]), round(hits[0]["y"]))
            if mark in placed:
                continue
            placed.add(mark)

            counts[(key, no)] += 1
            fname = f"{slug(display)}_listing_{no:02d}_{counts[(key, no)]}.jpg"
            try:
                how = ("would extract" if args.dry_run
                       else save_image(im, os.path.join(outdir, fname)))
            except Exception as e:
                counts[(key, no)] -= 1
                report.append({"pdf": base, "region": display, "page": p["page"],
                               "image": im.get("name", "?"), "size": f"{w}x{h}",
                               "issue": f"could not decode: {e}"})
                continue

            records.append({
                "region": display, "listing_no": no,
                "listing_title": names.get(no, ""),
                "image_file": fname, "image_no": counts[(key, no)],
                "page": p["page"], "width": w, "height": h,
                "caption": "", "extracted": how,
            })

        for b in badges:
            if not any(inside(im, b["x"], b["y"], args.pad) for im in images):
                report.append({"pdf": base, "region": display, "page": p["page"],
                               "image": f"badge@{round(b['x'])},{round(b['y'])}",
                               "size": "-",
                               "issue": f"badge {b['n']} sits on no photo"})

    return records, no_badge


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", required=True, help="the Wild Swimming Britain PDF")
    ap.add_argument("--master", default="data/swims.csv",
                    help="the swims CSV written by extract_swims.py")
    ap.add_argument("--out", default="data/swim-images", help="output folder")
    ap.add_argument("--pad", type=float, default=6.0,
                    help="badge/bbox tolerance in points (default: 6)")
    ap.add_argument("--min-px", type=int, default=200,
                    help="do not report images below this size (default: 200)")
    ap.add_argument("--max-aspect", type=float, default=5.0,
                    help="ignore images thinner than this ratio as page furniture "
                         "(default: 5)")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    regions = load_master(args.master)
    n_listings = sum(len(names) for _, names in regions.values())
    print(f"{len(regions)} chapters, {n_listings} listings in {args.master}")

    if not args.dry_run:
        os.makedirs(args.out, exist_ok=True)

    base = os.path.basename(args.pdf)
    report = []
    with pdfplumber.open(args.pdf) as pdf:
        pages = read_pages(pdf)
        records, no_badge = process(pages, regions, args.out, args, report, base)
    records.sort(key=lambda r: (r["region"], r["listing_no"], r["image_no"]))

    done = {(norm(r["region"]), r["listing_no"]) for r in records}
    for key, (display, names) in regions.items():
        missing = sorted(n for n in names if (key, n) not in done)
        if missing:
            report.append({"pdf": base, "region": display, "page": "-", "image": "-",
                           "size": "-", "issue": f"listings with no photo: {missing}"})

    print(f"{len(records)} photos on {len(done)} of {n_listings} listings "
          f"({no_badge} images with no badge skipped)")

    if not args.dry_run:
        idx = os.path.join(args.out, "images_index.csv")
        with open(idx, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["region", "listing_no", "listing_title",
                                              "image_file", "image_no", "page",
                                              "width", "height", "caption", "extracted"])
            w.writeheader()
            w.writerows(records)
        print(f"Index: {idx}")

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


if __name__ == "__main__":
    main()
