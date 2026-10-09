#!/usr/bin/env python3
"""Check README.md resource entries against the conventions in CONTRIBUTING.md."""
import re
import sys
from pathlib import Path

README = Path(__file__).resolve().parents[2] / "README.md"

# Type marker, then optional beginner (👶), then optional invaluable (💎).
ENTRY = re.compile(r"^- \[(?:📘|🎞️?|📝|🔗|🎧)👶?💎? .+\]\(https?://\S+\)")
LIST_LINK = re.compile(r"^- \[")
URL = re.compile(r"\]\((https?://[^)\s]+(?:\([^)\s]*\))?[^)\s]*)\)")
BAD_CHARS = {"\ufffd": "U+FFFD replacement character", "\u200b": "zero-width space",
             "\u200c": "zero-width non-joiner"}
HEADING = re.compile(r"^#{2,6} ")


def main() -> int:
    errors = []
    section = ""
    seen = {}
    for number, line in enumerate(README.read_text(encoding="utf-8").splitlines(), 1):
        for char, name in BAD_CHARS.items():
            if char in line:
                errors.append(f"{number}: {name}")
        if HEADING.match(line):
            section = line
            seen = {}
            continue
        if not LIST_LINK.match(line):
            continue
        if not ENTRY.match(line):
            errors.append(f"{number}: entry does not match '- [<type>[👶][💎] Title](url)'")
            continue
        match = URL.search(line)
        if match:
            url = match.group(1)
            if url in seen:
                errors.append(f"{number}: duplicate URL in section, first used on line {seen[url]}")
            seen[url] = number
    for error in errors:
        print(f"README.md:{error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
