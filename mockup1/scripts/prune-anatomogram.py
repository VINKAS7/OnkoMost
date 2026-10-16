#!/usr/bin/env python3
"""
prune-anatomogram.py — the body drawings behind <onco-anatomogram>
(components/onco-anatomogram/assets/anatomogram-hs-{male,female}.svg).

Adapted from pharmacolibrary-dev/scripts/docs/prune-anatomogram.py (the /sites anatomogram of
pharmacolibrary-docs and <dbs-pksites>). Same source and technique, but a different organ set:
the pharmacology drawing has no pancreas or duodenum, which the HPB tumour board needs.

Source: EMBL-EBI Expression Atlas anatomogram, homo_sapiens.{male,female}.svg
  https://github.com/ebi-gene-expression-group/anatomogram  (images CC BY 4.0, code Apache-2.0)
  pinned commit 9fcc37022cce1e2862692a5f5fbfb78572b87e67

Each organ is a <g>/<path> whose id is its UBERON id and whose style is fill:none;stroke:none
(invisible until coloured), plus a LAYER_OUTLINE silhouette. The component drives fill/stroke
per organ id.

    python3 scripts/prune-anatomogram.py --sex male            # downloads upstream when --src is absent
    python3 scripts/prune-anatomogram.py --sex female --src ~/…/homo_sapiens.female.svg
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

COMMIT = "9fcc37022cce1e2862692a5f5fbfb78572b87e67"
UPSTREAM = ("https://raw.githubusercontent.com/ebi-gene-expression-group/anatomogram/"
            + COMMIT + "/src/svg/homo_sapiens.{sex}.svg")
OUT = str(Path(__file__).resolve().parents[1] / "components" / "onco-anatomogram" / "assets" / "anatomogram-hs-{sex}.svg")

# Draw order = list order; the second field keeps an organ to one sex's drawing. Organs lying behind
# others in the front view come later so they stay visible when tinted (pancreas and duodenum behind
# the stomach/intestine, kidney behind the gut, adnexa behind the bowel loops).
KEEP = [
    ("UBERON_0000955", None),       # brain
    ("UBERON_0001043", None),       # esophagus
    ("UBERON_0000977", "female"),   # pleura
    ("UBERON_0002048", None),       # lung
    ("UBERON_0000310", "female"),   # breast
    ("UBERON_0000948", None),       # heart
    ("UBERON_0002107", None),       # liver
    ("UBERON_0002106", None),       # spleen
    ("UBERON_0000945", None),       # stomach
    ("UBERON_0001155", None),       # colon
    ("UBERON_0002108", None),       # small intestine
    ("UBERON_0001255", None),       # urinary bladder
    ("UBERON_0002367", "male"),     # prostate gland
    ("UBERON_0002113", None),       # kidney
    ("UBERON_0002369", None),       # adrenal gland
    ("UBERON_0002110", None),       # gall bladder (stands in for the bile ducts)
    ("UBERON_0002114", None),       # duodenum
    ("UBERON_0001264", None),       # pancreas
    ("UBERON_0000029", "female"),   # lymph node
    ("UBERON_0000995", "female"),   # uterus
    ("UBERON_0003889", "female"),   # fallopian tube
    ("UBERON_0000992", "female"),   # ovary
]
SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"


def prune(src: Path, sex: str) -> str:
    keep = [i for i, only in KEEP if only in (None, sex)]
    ET.register_namespace("", SVG)
    ET.register_namespace("xlink", XLINK)
    root = ET.parse(src).getroot()
    layers = {g.get("id"): g for g in root if g.get("id") in ("LAYER_EFO", "LAYER_OUTLINE")}
    efo, outline = layers["LAYER_EFO"], layers["LAYER_OUTLINE"]
    by_id = {el.get("id"): el for el in efo}
    missing = [i for i in keep if i not in by_id]
    if missing:
        sys.exit(f"upstream lacks organ(s): {missing}")
    for el in list(root):
        if el is not efo and el is not outline:
            root.remove(el)
    for el in list(efo):
        efo.remove(el)
    for i in keep:
        efo.append(by_id[i])
    root.remove(outline)
    root.insert(0, outline)
    for el in [root, *root.iter()]:
        for k in list(el.attrib):
            if k.startswith("{http://www.inkscape.org") or k.startswith("{http://sodipodi"):
                del el.attrib[k]
    root.attrib.pop("width", None)
    root.attrib.pop("height", None)
    root.set("id", "mdt-anatomogram")
    text = ET.tostring(root, encoding="unicode")
    text = re.sub(r"\s+", " ", text).replace("> <", "><")
    return (f"<!-- EMBL-EBI Expression Atlas anatomogram, homo_sapiens.{sex}.svg, CC BY 4.0; "
            f"pruned by scripts/prune-anatomogram.py from commit {COMMIT} -->\n" + text + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sex", choices=("male", "female"), default="male")
    ap.add_argument("--src", type=Path, default=None, help="upstream homo_sapiens.<sex>.svg (downloaded when absent)")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    a.out = a.out or Path(OUT.format(sex=a.sex))
    if a.src is None:
        a.src = Path(tempfile.mkdtemp()) / f"homo_sapiens.{a.sex}.svg"
        print(f"downloading {UPSTREAM.format(sex=a.sex)}")
        urllib.request.urlretrieve(UPSTREAM.format(sex=a.sex), a.src)
    text = prune(a.src.expanduser(), a.sex)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(text, encoding="utf-8")
    print(f"{a.out}: {len(text) / 1e3:.0f} kB, {sum(1 for _, only in KEEP if only in (None, a.sex))} organ(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
