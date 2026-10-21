"""Rebuild the vendored picker data (Python standard library only).

Download the pinned sources below to a directory, then pass that directory as argv[1].
Files are named emoji-test.txt, annotations-{en,de}.xml, annotationsDerived-{en,de}.xml.
Data is licensed Unicode-3.0; see public/licenses/unicode.txt.
"""
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

UNICODE_SOURCE = "https://unicode.org/Public/17.0.0/emoji/emoji-test.txt"
CLDR_SOURCE = "https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/{folder}/{locale}.xml"
source = Path(sys.argv[1])
annotations = {}
for locale in ("en", "de"):
    names, keywords = {}, {}
    for folder in ("annotations", "annotationsDerived"):
        for node in ET.parse(source / f"{folder}-{locale}.xml").iter("annotation"):
            key = node.attrib["cp"].replace("\ufe0f", "")
            text = node.text or ""
            if node.get("type") == "tts":
                names[key] = text
            else:
                keywords[key] = text
    annotations[locale] = (names, keywords)

rows, categories = [], []
for line in (source / "emoji-test.txt").read_text().splitlines():
    if line.startswith("# group: "):
        group = line.removeprefix("# group: ")
        categories.append(group)
    match = re.match(r"^([0-9A-F ]+)\s*; (fully-qualified|component)\s*# (\S+) E[\d.]+ (.+)$", line)
    if not match:
        continue
    emoji, fallback = match[3], match[4]
    key = emoji.replace("\ufe0f", "")
    en = annotations["en"][0].get(key, fallback)
    de = annotations["de"][0].get(key, en)
    terms = set()
    for locale in ("en", "de"):
        terms.update(annotations[locale][1].get(key, "").split(" | "))
    # The displayed names already participate in search, so don't repeat their words.
    words = set((en + " " + de).lower().split())
    terms = sorted(term for term in terms if term and term.lower() not in words)
    rows.append([emoji, en, de, " ".join(terms), len(categories) - 1])
output = Path(__file__).resolve().parents[1] / "src/lib/emoji/data.json"
output.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"{len(rows)} emoji, {output.stat().st_size} bytes; categories: {categories}")
