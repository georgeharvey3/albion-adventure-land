#!/usr/bin/env python3
"""Extract wild-swimming listings from Wild Swimming Britain PDF into CSV.

Usage: python3 extract_swims.py input.pdf output.csv

Relies on the book's typography:
  - Entry titles:      ApexNewPS-BoldTabular (bold), starting with the entry number
  - Entry terminator:  teal-coloured line "N mins, lat, lng"
  - Section headers:   ApexNewPS-MediumCaps 12pt (skipped)
  - Chapter name:      ApexNewPS-Light 9pt in the page footer (the Region column)
  - Amenity icons:     WildGuideSymbols font, kept and mapped to tag names (see TAGS)
  - Photo labels/footers: MediumTabular, small MediumCaps, Light (dropped)

Entries flow across columns and across page spreads; the parser reads
columns left-to-right per page as one continuous stream.

Entry numbers restart at 1 in each chapter, so an entry is identified by its
chapter (Region) and its number (Listing no). extract_swim_images.py joins the
book's photos to the entries on that pair.
"""
import sys
import re
import csv
import json
from collections import Counter

import pdfplumber

TEAL = (0.214, 0.538, 0.599)
SYM_FONT = "Symbols"

# Amenity icons are single characters of the WildGuideSymbols font, printed at
# the end of the teal "N mins, lat, lng" line (and, for the fee icon, at the
# end of the entry title). The first 20 come from the printed key on p3
# ("Finding your way in Wild Swimming"); the rest are not in that key, so the
# names below come from the icon artwork and from the entries that carry them.
TAGS = {
    # printed key
    "T": "Jump or rope swing",
    "=": "Waterfall",
    "1": "Long swim possible",
    "U": "Uncertain access",
    "q": "Kids / paddling",
    "h": "Secluded, remote",
    "K": "Popular / busy",
    "2": "Good for SUPs",
    "7": "Heritage / ruins",
    "6": "Sunset / view",
    "9": "Caves / canyons",
    "E": "Scramble / climb",
    "d": "Campsite",
    "g": "Accommodation",
    "s": "Food / facilities",
    "b": "Near a train station",
    "c": "On a cycle route",
    "v": "Difficult path",
    "w": "Take extra care",
    "l": "Variable water quality",
    # not in the printed key
    "z": "Walk in",             # hiker with pack and pole
    "5": "Nature / wild flowers",  # flower
    "W": "Picnic spot",         # picnic table
    "a": "Pub",                 # pint glass
    "*": "Dark skies",          # stars
    "A": "Private land, be discreet",  # key
    "o": "Beach",               # scallop shell
    "`": "Island",              # palm island
    "D": "Birdlife",            # bird of prey
    "Q": "Ancient site",        # triskelion
    "8": "Church / chapel",     # cross
    "&": "Mine / industry",     # winding wheel
    "e": "Castle",              # crenellated walls
    "N": "Tidal",               # flow arrow
    "3": "Notable tree",        # tree
    "4": "Wildlife",            # deer
    "0": "Fishing",             # fish and hook
    ">": "Dog friendly",        # dog
    "£": "Entry fee",           # pound sign
}
# Spreadsheet errors that the publisher printed in the icon font (real, in the
# book) - they are not icons, so they never become tags.
JUNK_RUNS = ("#ERROR!", "#NAME?")
MINS_RE = re.compile(r"^(\d+)\s*mins?,\s*(-?\d+\.?\d*),\s*(-?\d+\.?\d*)")
NUM_TITLE_RE = re.compile(r"^(\d+)\s+(.*)")
COL_TOL = 12       # x tolerance when snapping words to column anchors
LINE_TOL = 3       # vertical tolerance when grouping words into lines
GAP_MIN = 40       # min gap (pt) between anchor clusters
SYM_TOL = 6        # vertical tolerance when snapping icons to a line


def keep_word(w):
    fn, sz = w["fontname"], round(w["size"], 1)
    if SYM_FONT in fn:
        return True                       # amenity icon glyphs -> tags
    if "MediumTabular" in fn:
        return False                      # photo number labels
    if "MediumCaps" in fn and sz < 11:
        return False                      # page numbers
    if "Light" in fn:
        return False                      # footer chapter name
    return True


def find_anchors(words):
    """Cluster line-start x positions into column anchors for this page."""
    rows = {}
    for w in words:
        if SYM_FONT in w["fontname"]:
            continue                      # icons trail a line, never start one
        rows.setdefault(round(w["top"] / LINE_TOL), []).append(w)
    starts = []
    for ws in rows.values():
        ws.sort(key=lambda w: w["x0"])
        prev_end = None
        for w in ws:
            if prev_end is None or w["x0"] - prev_end > 30:
                starts.append(w["x0"])
            prev_end = w["x1"]
    counts = Counter(round(s / 5) * 5 for s in starts)
    anchors = []
    for x in sorted(counts):
        if counts[x] < 3:
            continue
        if anchors and x - anchors[-1] < GAP_MIN:
            continue
        anchors.append(x)
    return anchors or [0]


FOOTER_FONT = "Light"   # chapter name printed in the page footer
FOOTER_SIZE = 9.0
FOOTER_FROM = 0.9       # footers sit in the bottom tenth of the page
CHAPTER_MIN_PAGES = 3   # fewer pages than this is front matter, not a chapter


def page_chapter(page, words):
    """The chapter name printed in this page's footer, '' if there is none."""
    foot = [w for w in words
            if FOOTER_FONT in w["fontname"]
            and round(w["size"], 1) == FOOTER_SIZE
            and w["top"] > page.height * FOOTER_FROM]
    foot.sort(key=lambda w: w["x0"])
    return " ".join(w["text"] for w in foot).strip()


def page_chapters(footers):
    """
    One chapter name per page, or None for front matter. A page with no footer
    takes the chapter of the page after it: the pages without a footer are the
    chapter opener spreads, which belong to the chapter they open. A name that
    appears on fewer than CHAPTER_MIN_PAGES pages is front matter, not a
    chapter.
    """
    real = {c for c, n in Counter(c for c in footers if c).items()
            if n >= CHAPTER_MIN_PAGES}
    out = [c if c in real else None for c in footers]
    nxt = None
    for i in range(len(out) - 1, -1, -1):
        if out[i] is None:
            out[i] = nxt
        else:
            nxt = out[i]
    first = next((i for i, c in enumerate(footers) if c in real), len(out))
    for i in range(first):
        out[i] = None                 # anything before chapter one is front matter
    return out


def page_lines(all_words):
    words = [w for w in all_words if keep_word(w)]
    if not words:
        return []
    anchors = find_anchors(words)

    def col_of(x0):
        best = 0
        for i, a in enumerate(anchors):
            if x0 >= a - COL_TOL:
                best = i
        return best

    lines = {}
    syms = []
    for w in words:
        if SYM_FONT in w["fontname"]:
            syms.append(w)
            continue
        key = (col_of(w["x0"]), round(w["top"] / LINE_TOL))
        lines.setdefault(key, []).append(w)

    out = []
    for (col, row), ws in lines.items():
        ws.sort(key=lambda w: w["x0"])
        out.append({
            "col": col,
            "top": row,
            "mid": sum(w["top"] for w in ws) / len(ws),
            "text": " ".join(w["text"] for w in ws).strip(),
            "bold": any("Bold" in w["fontname"] for w in ws),
            "section": any("MediumCaps" in w["fontname"] for w in ws),
            "teal": any(w["non_stroking_color"] == TEAL for w in ws),
            "syms": "",
            "x1": max(w["x1"] for w in ws),
        })

    # Icons sit at the end of a line but are set on their own baseline, so they
    # do not always fall in the same LINE_TOL bucket as the text they follow.
    # Snap each icon word to the nearest line of its column that it trails.
    for w in syms:
        col = col_of(w["x0"])
        near = [l for l in out
                if l["col"] == col and abs(l["mid"] - w["top"]) <= SYM_TOL
                and w["x0"] >= l["x1"] - COL_TOL]
        if near:
            near.sort(key=lambda l: abs(l["mid"] - w["top"]))
            near[0]["syms"] += w["text"]
        else:
            out.append({"col": col, "top": round(w["top"] / LINE_TOL),
                        "mid": w["top"], "text": "", "bold": False,
                        "section": False, "teal": False, "syms": w["text"],
                        "x1": w["x1"]})

    out.sort(key=lambda l: (l["col"], l["top"]))
    return out


def join_lines(parts):
    s = ""
    for p in parts:
        if not p:
            continue
        if s.endswith("-"):
            s = s[:-1] + p          # de-hyphenate line-break splits
        elif s:
            s = s + " " + p
        else:
            s = p
    return re.sub(r"\s+", " ", s).strip()


def add_syms(entry, line):
    if entry is not None and line["syms"]:
        entry["syms"] += line["syms"]


def extract(pdf_path):
    entries = []
    footers = []
    cur = None
    with pdfplumber.open(pdf_path) as pdf:
        n_pages = len(pdf.pages)
        for pi, page in enumerate(pdf.pages):
            all_words = page.extract_words(
                extra_attrs=["fontname", "size", "non_stroking_color"])
            footers.append(page_chapter(page, all_words))
            for l in page_lines(all_words):
                if l["section"]:
                    continue
                m = MINS_RE.match(l["text"]) if l["teal"] else None
                if m and cur and not cur["done"]:
                    cur["mins"], cur["lat"], cur["lng"] = m.groups()
                    cur["done"] = True
                    add_syms(cur, l)        # icons trail the time/coords line
                    continue
                if l["bold"]:
                    nm = NUM_TITLE_RE.match(l["text"])
                    if nm:                              # numbered -> new entry
                        cur = {"num": int(nm.group(1)), "title": [nm.group(2)],
                               "desc": [], "done": False, "page": pi + 1,
                               "mins": "", "lat": "", "lng": "", "syms": ""}
                        entries.append(cur)
                    elif cur and not cur["desc"] and not cur["done"]:
                        cur["title"].append(l["text"])  # wrapped title line
                    elif cur and not cur["done"]:
                        cur["desc"].append(l["text"])   # bold text inside body
                    add_syms(cur, l)        # the fee icon trails the title
                    continue
                if cur and not cur["done"]:
                    cur["desc"].append(l["text"])
                add_syms(cur, l)
            print(f"\rpage {pi + 1}/{n_pages}", end="", file=sys.stderr)
    print(file=sys.stderr)
    chapters = page_chapters(footers)
    for e in entries:
        e["region"] = chapters[e["page"] - 1] or ""
        e["title"] = join_lines(e["title"])
        e["desc"] = join_lines(e["desc"])
        e["tags"], e["unknown"] = tags_of(e["syms"])
    return entries


def tags_of(syms):
    """Map an icon run to tag names. Returns (tags, unmapped characters)."""
    for junk in JUNK_RUNS:
        syms = syms.replace(junk, "")
    tags, unknown = [], []
    for ch in syms:
        name = TAGS.get(ch)
        if name is None:
            unknown.append(ch)
        elif name not in tags:
            tags.append(name)
    return tags, unknown


def validate(entries):
    problems = []
    prev = None
    for e in entries:
        n = e["num"]
        if prev is not None and n not in (prev + 1, 1):
            problems.append(f"p{e['page']}: sequence jump {prev} -> {n} at '{e['title']}'")
        prev = n
        if not e["done"]:
            problems.append(f"p{e['page']}: #{n} '{e['title']}' has no time/coords line")
        if len(e["desc"]) < 40:
            problems.append(f"p{e['page']}: #{n} '{e['title']}' suspiciously short description ({len(e['desc'])} chars)")
        if not e["tags"]:
            problems.append(f"p{e['page']}: #{n} '{e['title']}' has no icons")
        if not e["region"]:
            problems.append(f"p{e['page']}: #{n} '{e['title']}' has no chapter name")
    return problems


def icon_report(entries):
    """Counts per tag, plus every icon character with no name in TAGS."""
    used = Counter()
    unknown = Counter()
    for e in entries:
        used.update(e["tags"])
        unknown.update(e["unknown"])
    return used, unknown


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: python3 extract_swims.py input.pdf output.csv")
    entries = extract(sys.argv[1])
    problems = validate(entries)
    with open(sys.argv[2], "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Name", "Description", "Walk time", "Location", "Tags",
                    "Region", "Listing no"])
        for e in entries:
            loc = f"{e['lat']}, {e['lng']}" if e["lat"] else ""
            w.writerow([e["title"], e["desc"],
                        f"{e['mins']} mins" if e["mins"] else "", loc,
                        json.dumps(e["tags"]), e["region"], e["num"]])
    print(f"{len(entries)} entries written to {sys.argv[2]}")

    used, unknown = icon_report(entries)
    print(f"\n{sum(used.values())} tags over {len(used)} names:")
    for name, n in used.most_common():
        print(f"  {n:5d}  {name}")
    if unknown:
        print("\nicon characters with no name in TAGS (left out of Tags):")
        for ch, n in unknown.most_common():
            print(f"  {n:5d}  {ch!r}")

    if problems:
        print(f"\n{len(problems)} entries need manual review:")
        for p in problems:
            print("  " + p)
    else:
        print("validation clean: sequential numbering, all entries have time+coords")


if __name__ == "__main__":
    main()
