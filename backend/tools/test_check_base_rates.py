import datetime as dt
import json
import unittest

import check_base_rates as c

TABLE = json.loads(c.TABLE.read_text(encoding="utf-8"))


def series(rows, sep=","):
    return "header\n" + "\n".join(f"{d}{sep}{v}" for d, v in rows)


def from_table(table=TABLE):
    return [(r["valid_from"], f"{r['base_rate'] * 100:.2f}") for r in table]


class CheckBaseRates(unittest.TestCase):
    def test_parses_formats(self):
        self.assertEqual(c.parse_csv("2002-01,2.57\n2002-07;2,47")[0], (dt.date(2002, 1, 1), 2.57))
        self.assertEqual(c.parse_csv("x;y\n01.07.2002;2,47;\n")[0], (dt.date(2002, 7, 1), 2.47))

    def test_matches_itself(self):
        obs = c.parse_csv(series(from_table()))
        self.assertEqual(c.compare(TABLE, obs, dt.date(2026, 11, 20)), [])

    def test_reports_a_changed_rate(self):
        rows = from_table()
        rows[10] = (rows[10][0], "9.99")
        problems = c.compare(TABLE, c.parse_csv(series(rows)), dt.date(2026, 11, 20))
        self.assertTrue(problems and "9.99" in problems[0], problems)

    def test_reports_a_table_that_ends(self):
        obs = c.parse_csv(series(from_table()))
        problems = c.compare(TABLE, obs, dt.date(2027, 1, 5))
        self.assertTrue(any("table ends" in p for p in problems), problems)


if __name__ == "__main__":
    unittest.main()
