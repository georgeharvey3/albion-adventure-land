#!/usr/bin/env python3
"""
extract_ruin_images.py - pull listing photos out of Wild Ruins and join them to
the listings in data/ruins.csv.

This is extract_images.py adapted to a third guidebook. The image decoding and
the badge-inside-bounding-box join are shared with that script (imported from
it); what changes is the typography the anchors are read from.

How this book differs from the other two
----------------------------------------
page     One PDF page is one printed spread, so a page holds the photos, the
         badges and the headings of two book pages at once. Nothing in this
         script cares, because every anchor is joined by its position.
badge    A photo's listing number is printed on a round badge made of two 'X'
         glyphs of the layout font (ApexNewPS-MediumTabular, 7pt), as in Wild
         Swimming Britain. The numeral on the badge is set in the display font
         (JacobRiley, 7pt), not in the badge font, so the marker and the number
         are read separately and joined by position.
chapter  Listing numbers restart at 1 in each chapter, so a photo is identified
         by chapter + number. The chapter is the running head at the top of
         each page. A chapter opener page prints no running head, so it takes
         its chapter from the large title it prints instead.
photo    Every photo in this book is stored as JPEG 2000, which no browser but
         Safari shows, so each one is decoded and written again as a JPEG. The
         book is printed at a high resolution, so --max-px also caps the long
         side of a picture at 1600 pixels. Without the cap a single photo is
         several megabytes, which is more than the field use of the app can
         afford.
master   The listings come from data/ruins.csv, which holds one row per listing
         in book order but no chapter and no listing number. The script reads
         the printed headings (number + title, display font at 27.6pt and
         10pt), walks them in book order, and gives each master row the chapter
         and the number the book prints for it. With --merge (the default) it
         writes those two columns back to the CSV, which is what the app joins
         the pictures on.

Not every listing has a photo, and a chapter prints its photos in galleries
that can sit pages away from the write-up. A listing with no photo is normal
and is only counted; the report names them so a miss can be told from a gap.

Usage
-----
  python3 extract_ruin_images.py --pdf pdfs/Wild-Ruins-book-ALL-eqiboz.pdf \
      --master data/ruins.csv --out data/ruin-images

  python3 extract_ruin_images.py --pdf book.pdf --master data/ruins.csv --dry-run

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

# Columns of the master CSV. The last two are written by --merge.
MASTER_NAME = "Name"
MASTER_REGION = "Region"
MASTER_NO = "Listing no"

# Layout constants for this book.
DISPLAY_FONT = "JacobRiley"    # every anchor except the badge marker
HEAD_SIZE = 9.0                # the running head at the top of a page
HEAD_BAND = 40.0               # the running head sits in the top 40pt
HEAD_GAP = 40.0                # x step between the two halves of a spread
OPENER_MIN_SIZE = 30.0         # the title on a chapter opener page
NUMBER_SIZE = 27.6             # the number printed beside a listing heading
TITLE_SIZE = 10.0              # the title of a listing heading
TITLE_GAP = 25.0               # x step between two headings on one line
TITLE_LEAD = 8.0               # y step between the lines of one title
BADGE_FONT = "MediumTabular"   # the two 'X' glyphs of the badge
BADGE_MAX_SIZE = 7.5
BADGE_GAP = 6.0                # largest x step between the glyphs of one badge
NUMERAL_MAX_SIZE = 7.5         # the numeral set on the badge
NUMERAL_DX = 12.0              # how far the numeral sits from the marker
NUMERAL_DY = 10.0

# Words the book sets lower case in its small-capital display font. The running
# head is the only name of a chapter this script has, so it is cased here.
SMALL_WORDS = {"and", "of", "the"}


def display_name(head):
    """Title case for a running head read from a small-capital font."""
    words = []
    for i, w in enumerate(head.split()):
        if i and w.lower() in SMALL_WORDS:
            words.append(w.lower())
        else:
            words.append(w[:1].upper() + w[1:])
    return " ".join(words)


# ---------------------------------------------------------------- master CSV

def load_master(path):
    """The rows of the master CSV, in book order."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f"{path}: empty")
    if MASTER_NAME not in rows[0]:
        sys.exit(f"{path}: missing '{MASTER_NAME}' column")
    return rows


def write_master(path, rows):
    """Write the master CSV back with the Region and Listing no columns."""
    fields = list(rows[0].keys())
    for col in (MASTER_REGION, MASTER_NO):
        if col not in fields:
            fields.append(col)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


# ---------------------------------------------------------------- page text

def running_head(words):
    """The chapter name printed at the top of a page, '' if there is none."""
    band = [w for w in words
            if DISPLAY_FONT in w["fontname"]
            and round(w["size"], 1) == HEAD_SIZE
            and w["top"] < HEAD_BAND]
    rows = defaultdict(list)
    for w in band:
        rows[round(w["top"])].append(w)

    # A spread prints the name once over each of its two halves. Either copy
    # will do, but one of them can be clipped, so keep the longest.
    best = ""
    for row in rows.values():
        row.sort(key=lambda w: w["x0"])
        groups = [[row[0]]]
        for prev, w in zip(row, row[1:]):
            if w["x0"] - prev["x1"] > HEAD_GAP:
                groups.append([w])
            else:
                groups[-1].append(w)
        for g in groups:
            text = " ".join(w["text"] for w in g)
            if len(text) > len(best):
                best = text
    return best


def opener_title(words):
    """The large title printed on a chapter opener page, '' if there is none."""
    big = [w for w in words
           if DISPLAY_FONT in w["fontname"]
           and round(w["size"], 1) >= OPENER_MIN_SIZE]
    if not big:
        return ""
    big.sort(key=lambda w: (round(w["top"] / 6), w["x0"]))
    # The title opens with a decorative initial set as its own one-letter word.
    return re.sub(r"\b\w\b", "", " ".join(w["text"] for w in big))


def find_headings(words):
    """[(listing_no, title)] for the listing headings printed on a page."""
    numbers = [w for w in words
               if DISPLAY_FONT in w["fontname"]
               and round(w["size"], 1) == NUMBER_SIZE
               and w["text"].isdigit()]
    title_words = [w for w in words
                   if DISPLAY_FONT in w["fontname"]
                   and round(w["size"], 1) == TITLE_SIZE]

    rows = defaultdict(list)
    for w in title_words:
        rows[round(w["top"])].append(w)

    lines = []
    for _, row in sorted(rows.items()):
        row.sort(key=lambda w: w["x0"])
        run = [row[0]]
        for prev, w in zip(row, row[1:]):
            if w["x0"] - prev["x1"] > TITLE_GAP:
                lines.append(run)
                run = [w]
            else:
                run.append(w)
        lines.append(run)

    blocks = [{"text": " ".join(w["text"] for w in g),
               "x": min(w["x0"] for w in g),
               "top": min(w["top"] for w in g),
               "bottom": max(w["bottom"] for w in g)} for g in lines]
    blocks.sort(key=lambda b: (b["top"], b["x"]))

    # A title that does not fit one line is set as two lines on the same left
    # edge, so join a line to the one above it when both edges agree.
    joined = []
    for b in blocks:
        last = joined[-1] if joined else None
        if (last and abs(last["x"] - b["x"]) < 6
                and -1 < b["top"] - last["bottom"] < TITLE_LEAD):
            last["text"] += " " + b["text"]
            last["bottom"] = b["bottom"]
        else:
            joined.append(dict(b))

    out = []
    for n in numbers:
        near = [b for b in joined
                if b["x"] > n["x0"] - 2 and -20 < b["top"] - n["top"] < 14]
        if not near:
            out.append((int(n["text"]), ""))
            continue
        best = min(near, key=lambda b: abs(b["top"] - n["top"]) + abs(b["x"] - n["x0"]) * 0.2)
        out.append((int(n["text"]), best["text"]))
    return out


# ---------------------------------------------------------------- detection

def find_badges(chars, words):
    """
    The numbers printed on badges: ([{'n', 'x', 'y'}], unreadable). A badge is
    two 'X' glyphs of the badge font with a numeral of the display font set on
    them, so the marker is found first and the numeral beside it second. The
    number is not range-checked here — the chapter, and so the number of
    listings, is known later.
    """
    rows = defaultdict(list)
    for c in chars:
        rows[round(c["top"])].append(c)

    markers = []
    for top, row in sorted(rows.items()):
        row.sort(key=lambda c: c["x0"])
        clusters = [[row[0]]]
        for prev, c in zip(row, row[1:]):
            if c["x0"] - prev["x0"] <= BADGE_GAP:
                clusters[-1].append(c)
            else:
                clusters.append([c])
        for cl in clusters:
            if len(cl) >= 2:
                markers.append((min(c["x0"] for c in cl), top))

    numerals = [w for w in words
                if DISPLAY_FONT in w["fontname"]
                and round(w["size"], 1) <= NUMERAL_MAX_SIZE
                and re.fullmatch(r"\d{1,2}", w["text"].strip())]

    out, unreadable = [], []
    for mx, my in markers:
        near = [d for d in numerals
                if abs(d["x0"] - mx) < NUMERAL_DX and abs(d["top"] - my) < NUMERAL_DY]
        if len(near) != 1:
            unreadable.append((round(mx), round(my),
                               f"{len(near)} numerals on the marker"))
            continue
        d = near[0]
        out.append({"n": int(d["text"]), "x": d["x0"], "y": d["top"]})
    return out, unreadable


def read_pages(pdf):
    """
    One pass over the book: the chapter, the headings, the badges and the photo
    boxes of every page. The chapter of an opener page is only known once every
    running head is read, so every page is collected first and the photos are
    written afterwards.
    """
    pages = []
    n = len(pdf.pages)
    for pi, page in enumerate(pdf.pages, 1):
        words = page.extract_words(extra_attrs=["fontname", "size"])
        chars = [c for c in page.chars
                 if BADGE_FONT in c["fontname"]
                 and c["text"] == "X"
                 and round(c["size"], 1) <= BADGE_MAX_SIZE]
        badges, unreadable = find_badges(chars, words)
        pages.append({"page": pi, "head": running_head(words),
                      "opener": opener_title(words),
                      "headings": find_headings(words),
                      "badges": badges, "unreadable": unreadable,
                      "images": page.images})
        page.flush_cache()          # the page text is read once; do not hold it
        print(f"\rpage {pi}/{n}", end="", file=sys.stderr)
    print(file=sys.stderr)

    names = {norm(p["head"]) for p in pages if p["head"]}
    for p in pages:
        if p["head"]:
            p["chapter"] = norm(p["head"])
        elif p["opener"] and norm(p["opener"]) in names:
            p["chapter"] = norm(p["opener"])   # a chapter opener page
        else:
            p["chapter"] = None                # front or back matter
    return pages


# ---------------------------------------------------------------- the listings

def read_listings(pages):
    """
    ([chapter_key], {chapter_key: display}, {chapter_key: {no: title}}) for the
    listings the book prints, in book order.
    """
    order, display, listings = [], {}, defaultdict(dict)
    for p in pages:
        key = p["chapter"]
        if not key:
            continue
        if p["head"]:
            display.setdefault(key, display_name(p["head"]))
        if p["headings"] and key not in order:
            order.append(key)
        for no, title in p["headings"]:
            listings[key].setdefault(no, title)
    return order, display, listings


def match_master(order, display, listings, rows, report, base):
    """
    Give every master row the chapter and the number the book prints for it.
    The master holds one row per listing in book order, so the two are walked
    together. Returns {(chapter_key, no): name} and whether the walk is sound:
    a walk that does not line up is reported and never written back.
    """
    counted = sum(len(listings[k]) for k in order)
    ok = True
    if counted != len(rows):
        report.append({"pdf": base, "region": "-", "page": "-", "image": "-",
                       "size": "-",
                       "issue": f"the book prints {counted} listings but the master "
                                f"CSV holds {len(rows)} rows"})
        ok = False

    names, i = {}, 0
    for key in order:
        numbers = sorted(listings[key])
        if numbers != list(range(1, len(numbers) + 1)):
            report.append({"pdf": base, "region": display.get(key, key), "page": "-",
                           "image": "-", "size": "-",
                           "issue": f"listing numbers are not 1..{len(numbers)}: "
                                    f"{numbers}"})
            ok = False
        for no in numbers:
            if i >= len(rows):
                break
            row = rows[i]
            title, name = norm(listings[key][no]), norm(row[MASTER_NAME])
            if title and title not in name and not name.startswith(title):
                report.append({"pdf": base, "region": display.get(key, key),
                               "page": "-", "image": "-", "size": "-",
                               "issue": f"listing {no} is printed as "
                                        f"'{listings[key][no]}' but the master row "
                                        f"is '{row[MASTER_NAME]}'"})
            names[(key, no)] = row[MASTER_NAME]
            row[MASTER_REGION] = display.get(key, key)
            row[MASTER_NO] = no
            i += 1
    return names, ok


def written_size(srcsize, max_px):
    """The size a picture is written at, once --max-px caps its long side."""
    w, h = srcsize
    if max_px and max(w, h) > max_px:
        scale = max_px / max(w, h)
        return max(1, round(w * scale)), max(1, round(h * scale))
    return w, h


# ---------------------------------------------------------------- extraction

def process(pages, display, listings, names, outdir, args, report, base):
    records = []
    counts = defaultdict(int)
    no_badge = 0

    for p in pages:
        key = p["chapter"]
        if key is None or key not in listings:
            continue                          # front matter holds no listings
        region = display.get(key, key)
        max_listing = max(listings[key])

        badges = []
        for b in p["badges"]:
            if 1 <= b["n"] <= max_listing:
                badges.append(b)
            else:
                report.append({"pdf": base, "region": region, "page": p["page"],
                               "image": f"badge@{round(b['x'])},{round(b['y'])}",
                               "size": "-",
                               "issue": f"badge number {b['n']} is not a listing "
                                        f"of this chapter"})
        for x, y, why in p["unreadable"]:
            report.append({"pdf": base, "region": region, "page": p["page"],
                           "image": f"badge@{x},{y}", "size": "-",
                           "issue": f"badge not read ({why})"})

        images = sorted((im for im in p["images"]
                         if not is_furniture(im, args.max_aspect)),
                        key=lambda im: (round(im["top"]), im["x0"]))

        # A badge is printed in a corner of its own photo, and a photo can sit
        # on top of a larger one. Give the badge to the smallest photo that
        # holds it, so the photo under it is not claimed as well.
        owners = defaultdict(list)
        for b in badges:
            holders = [im for im in images if inside(im, b["x"], b["y"], args.pad)]
            if not holders:
                report.append({"pdf": base, "region": region, "page": p["page"],
                               "image": f"badge@{round(b['x'])},{round(b['y'])}",
                               "size": "-",
                               "issue": f"badge {b['n']} sits on no photo"})
                continue
            owners[id(min(holders, key=area))].append(b)

        for im in images:
            w, h = im["srcsize"]
            hits = owners.get(id(im))
            if not hits:
                no_badge += 1
                if min(w, h) >= args.min_px:
                    report.append({"pdf": base, "region": region, "page": p["page"],
                                   "image": im.get("name", "?"), "size": f"{w}x{h}",
                                   "issue": "no badge found"})
                continue
            numbers = sorted({b["n"] for b in hits})
            if len(numbers) > 1:
                report.append({"pdf": base, "region": region, "page": p["page"],
                               "image": im.get("name", "?"), "size": f"{w}x{h}",
                               "issue": f"ambiguous badges {numbers}"})
                continue

            no = numbers[0]
            counts[(key, no)] += 1
            fname = f"{slug(region)}_listing_{no:02d}_{counts[(key, no)]}.jpg"
            try:
                how = ("would extract" if args.dry_run
                       else save_image(im, os.path.join(outdir, fname),
                                       max_px=args.max_px, quality=args.quality))
            except Exception as e:
                counts[(key, no)] -= 1
                report.append({"pdf": base, "region": region, "page": p["page"],
                               "image": im.get("name", "?"), "size": f"{w}x{h}",
                               "issue": f"could not decode: {e}"})
                continue

            # The written size, not the size in the book: the app reads these
            # two columns to hold a picture's shape before it loads.
            out_w, out_h = written_size(im["srcsize"], args.max_px)
            records.append({
                "region": region, "listing_no": no,
                "listing_title": names.get((key, no), ""),
                "image_file": fname, "image_no": counts[(key, no)],
                "page": p["page"], "width": out_w, "height": out_h,
                "caption": "", "extracted": how,
            })

    return records, no_badge


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", required=True, help="the Wild Ruins PDF")
    ap.add_argument("--master", default="data/ruins.csv", help="the ruins CSV")
    ap.add_argument("--out", default="data/ruin-images", help="output folder")
    ap.add_argument("--pad", type=float, default=2.0,
                    help="badge/bbox tolerance in points (default: 2)")
    ap.add_argument("--min-px", type=int, default=200,
                    help="do not report images below this size (default: 200)")
    ap.add_argument("--max-px", type=int, default=1600,
                    help="cap the long side of a picture in pixels; 0 keeps the "
                         "size the book holds (default: 1600)")
    ap.add_argument("--quality", type=int, default=85,
                    help="JPEG quality of the written pictures (default: 85)")
    ap.add_argument("--max-aspect", type=float, default=5.0,
                    help="ignore images thinner than this ratio as page furniture "
                         "(default: 5)")
    ap.add_argument("--no-merge", dest="merge", action="store_false",
                    help="do not write the Region and Listing no columns back to "
                         "the master CSV")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args()
    args.max_px = args.max_px or None

    rows = load_master(args.master)
    print(f"{len(rows)} listings in {args.master}")

    if not args.dry_run:
        os.makedirs(args.out, exist_ok=True)

    base = os.path.basename(args.pdf)
    report = []
    with pdfplumber.open(args.pdf) as pdf:
        pages = read_pages(pdf)
        order, display, listings = read_listings(pages)
        names, sound = match_master(order, display, listings, rows, report, base)
        print(f"{len(order)} chapters, {sum(len(listings[k]) for k in order)} listings "
              f"in {base}")
        records, no_badge = process(pages, display, listings, names, args.out,
                                    args, report, base)
    records.sort(key=lambda r: (r["region"], r["listing_no"], r["image_no"]))

    done = {(r["region"], r["listing_no"]) for r in records}
    n_listings = sum(len(listings[k]) for k in order)
    for key in order:
        region = display.get(key, key)
        missing = sorted(n for n in listings[key] if (region, n) not in done)
        if missing:
            report.append({"pdf": base, "region": region, "page": "-", "image": "-",
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

        if args.merge and sound:
            write_master(args.master, rows)
            print(f"Master: {args.master} now holds the "
                  f"{MASTER_REGION} and {MASTER_NO} columns")
        elif args.merge:
            print(f"Master: {args.master} not written — the book and the CSV do "
                  f"not line up (see the report)")

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
