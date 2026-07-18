"""Generate the versioned employee-portal calendar snapshot.

Maintenance tool only: it downloads the pinned upstream editions, never runs in
the application or request flow, and writes deterministic JSON for review.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "KajovoDagmar calendar snapshot maintainer/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - pinned maintenance sources
        return response.read().decode("utf-8", errors="replace")


def parse_slovak(text: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for day, month, names in re.findall(r"(?m)^(\d{1,2})\.\s*(\d{1,2})\.\s+(.+)$", text):
        value = names.strip()
        if value != "-":
            result[f"{int(month):02d}-{int(day):02d}"] = value.split()
    return result


def parse_common_worship(source: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    sections = re.split(r"<h5[^>]*>", source, flags=re.I)
    for section in sections:
        heading = html.unescape(re.sub(r"<[^>]+>", " ", section.split("</h5>", 1)[0])).strip()
        month = MONTHS.get(next((name for name in MONTHS if name in heading), ""))
        if not month:
            continue
        body = section.split("</h5>", 1)[-1]
        for paragraph in re.findall(r"<p[^>]*class=\"[^\"]*(?:nl1|nl2|ve1)[^\"]*\"[^>]*>(.*?)</p>", body, flags=re.I | re.S):
            value = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", paragraph)).replace("\xa0", " ").split())
            match = re.match(r"^(\d{1,2})\s+(.+)$", value)
            if match:
                key = f"{month:02d}-{int(match.group(1)):02d}"
                result.setdefault(key, []).append(match.group(2).strip())
    return result


async def parse_german() -> dict[str, list[str]]:
    semaphore = asyncio.Semaphore(16)

    async def one(month: int, day: int) -> tuple[str, list[str]]:
        url = "https://namenstage.katholisch.de/namenstage.php?" + urllib.parse.urlencode({"day": day, "month": f"{month:02d}"})
        async with semaphore:
            source = await asyncio.to_thread(fetch, url)
        names = [html.unescape(name).strip() for name in re.findall(r"<h2><a href=['\"]\?name=[^'\"]+['\"]>(.*?)</a></h2>", source, flags=re.S)]
        return f"{month:02d}-{day:02d}", list(dict.fromkeys(re.sub(r"<[^>]+>", "", name) for name in names))

    tasks = [one(month, day) for month in range(1, 13) for day in range(1, 32)]
    return {key: names for key, names in await asyncio.gather(*tasks) if names}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slovak-text", type=Path, help="Text extracted from the pinned official PDF")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.slovak_text:
        slovak = parse_slovak(args.slovak_text.read_text(encoding="utf-8"))
    elif args.output.exists():
        slovak = json.loads(args.output.read_text(encoding="utf-8"))["sk"]
    else:
        parser.error("--slovak-text is required when no existing output snapshot can be reused")
    common_worship = fetch("https://www.churchofengland.org/prayer-and-worship/worship-texts-and-resources/common-worship/churchs-year/calendar")
    payload = {
        "meta": {
            "version": "2026-07-18",
            "retrieved": "2026-07-18",
            "cs": "namedays-cs 1.2.1 (MIT), pinned npm snapshot",
            "sk": "Ministry of Culture of the Slovak Republic, Official calendar 2025",
            "de": "katholisch.de Heiligen- und Namenstagskalender, selected Catholic variant",
            "en": "Church of England, Common Worship Calendar, observances (not a statutory UK nameday calendar)",
        },
        "cs": json.loads(fetch("https://unpkg.com/namedays-cs@1.2.1/dist/names.json")),
        "sk": slovak,
        "de": asyncio.run(parse_german()),
        "en": parse_common_worship(common_worship),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
