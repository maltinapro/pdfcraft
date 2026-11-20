#!/usr/bin/env python3
"""Compares backend/src/data/base-rates.json with the Bundesbank series BBK01.SU0115.

The series is the base rate of § 247 BGB. The check never changes the table: it reports
differences (exit 1), a table that does not cover today (exit 1) and a CSV it cannot read
(exit 2). The Bundesanzeiger notice stays the legal source; this is a safety net.

    python3 backend/tools/check_base_rates.py            # download and compare
    python3 backend/tools/check_base_rates.py file.csv   # compare a saved CSV
"""
import csv
import datetime as dt
import io
import json
import pathlib
import re
import sys
import urllib.request

TABLE = pathlib.Path(__file__).resolve().parents[1] / "src/data/base-rates.json"
URL = (
    "https://api.statistiken.bundesbank.de/rest/data/BBK01/SU0115"
    "?format=csv&lang=en"
)
DATE = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$|^(\d{2})\.(\d{2})\.(\d{4})$")


def parse_date(cell):
    m = DATE.match(cell.strip())
    if not m:
        return None
    if m.group(1):
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3) or 1))
    return dt.date(int(m.group(6)), int(m.group(5)), int(m.group(4)))


def parse_number(cell):
    cell = cell.strip().replace(",", ".")
    try:
        return round(float(cell), 2)
    except ValueError:
        return None


def parse_csv(text):
    """Observations (date, percent): the first date cell and the first number after it per row."""
    delimiter = ";" if text.count(";") > text.count(",") else ","
    out = {}
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        for i, cell in enumerate(row):
            day = parse_date(cell)
            if day is None:
                continue
            for other in row[i + 1 :]:
                value = parse_number(other)
                if value is not None:
                    out[day] = value
                    break
            break
    return sorted(out.items())


def rate_on(observations, day):
    value = None
    for obs_day, obs_value in observations:
        if obs_day > day:
            break
        value = obs_value
    return value


def compare(table, observations, today):
    problems = []
    for row in table:
        start = dt.date.fromisoformat(row["valid_from"])
        end = dt.date.fromisoformat(row["valid_to"])
        ours = round(row["base_rate"] * 100, 2)
        for day in (start, min(end, today)):
            if day < start:
                continue
            theirs = rate_on(observations, day)
            if theirs is None:
                problems.append(f"{day}: not in the Bundesbank series")
            elif theirs != ours:
                problems.append(
                    f"{day}: table {ours:.2f} %, Bundesbank {theirs:.2f} %"
                )
    last = max(dt.date.fromisoformat(r["valid_to"]) for r in table)
    if today > last:
        problems.append(f"the table ends on {last}, add the periods up to {today}")
    newest = rate_on(observations, today)
    covered = [
        r
        for r in table
        if dt.date.fromisoformat(r["valid_from"]) <= today <= dt.date.fromisoformat(r["valid_to"])
    ]
    if covered and newest is not None and round(covered[0]["base_rate"] * 100, 2) != newest:
        problems.append(f"current rate: table {covered[0]['base_rate'] * 100:.2f} %, Bundesbank {newest:.2f} %")
    return sorted(set(problems))


def main(argv):
    if len(argv) > 1:
        text = pathlib.Path(argv[1]).read_text(encoding="utf-8-sig")
    else:
        request = urllib.request.Request(URL, headers={"User-Agent": "pdfcraft-base-rate-check"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode("utf-8-sig")
        except OSError as error:
            print(f"could not download the series: {error}")
            return 2
    observations = parse_csv(text)
    if len(observations) < 20:
        print(f"could not read the series ({len(observations)} observations); has the CSV format changed?")
        return 2
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    problems = compare(table, observations, dt.date.today())
    if problems:
        print("base-rates.json and the Bundesbank series BBK01.SU0115 differ:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"base-rates.json matches BBK01.SU0115 ({len(observations)} observations)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
