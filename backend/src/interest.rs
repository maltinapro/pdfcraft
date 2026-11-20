//! Default interest (Verzugszinsen) of § 288 BGB: base rate (§ 247 BGB) + 5 percentage points
//! (consumer) or + 9 percentage points (business transactions).
//!
//! The base rates are data, not code: `data/base-rates.json` lists every half-year with `valid_from`,
//! `valid_to`, `base_rate` (fraction, `0.0152` = 1.52 %) and `source_ref` (where the value comes from).
//! The environment variable `BASE_RATES` adds or replaces half-years without a new build
//! (`2027-01-01=1.77,2027-07-01=…`, only 1 January / 1 July; the source is then `BASE_RATES`), and
//! `interest.baseRate` of a request replaces the table for one document. Every calculation returns the
//! periods with the rate and source that were used, so a document can show and prove them.
//! The calculation uses whole numbers only: rates in hundredths of a percent, amounts in cents.

use serde::Deserialize;
use std::sync::OnceLock;

const TABLE: &str = include_str!("data/base-rates.json");

#[derive(Deserialize)]
struct Row {
    valid_from: String,
    valid_to: Option<String>,
    base_rate: f64,
    source_ref: String,
}

/// A half-year (day numbers, inclusive) with its base rate in hundredths of a percent.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub from: i64,
    pub to: i64,
    pub rate: i64,
    pub source: String,
}

/// Whole days since 1970-01-01 (proleptic Gregorian calendar).
pub fn days((y, m, d): (i32, u32, u32)) -> i64 {
    let (y, m, d) = (i64::from(y), i64::from(m), i64::from(d));
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Premium of § 288 para. 1 (consumer) or para. 2 (business) in hundredths of a percent.
pub fn premium(debtor: &str) -> Option<i64> {
    match debtor {
        "consumer" => Some(500),
        "business" => Some(900),
        _ => None,
    }
}

fn entry(from: &str, to: Option<&str>, rate: f64, source: &str) -> Result<Entry, String> {
    let start = crate::invoice::valid_date(from).ok_or("invalid valid_from")?;
    if !matches!((start.1, start.2), (1, 1) | (7, 1)) {
        return Err(format!("{from} is not a 1 January / 1 July"));
    }
    let end = match to {
        Some(to) => crate::invoice::valid_date(to).ok_or("invalid valid_to")?,
        None if start.1 == 1 => (start.0, 6, 30),
        None => (start.0, 12, 31),
    };
    if !rate.is_finite() || !(-0.1..=0.2).contains(&rate) {
        return Err(format!("base rate of {from} is out of range"));
    }
    let (from, to) = (days(start), days(end));
    if to < from {
        return Err(format!("valid_to is before valid_from ({from})"));
    }
    Ok(Entry {
        from,
        to,
        rate: (rate * 10_000.0).round() as i64,
        source: source.to_string(),
    })
}

/// The built-in table; checked by a test (no gaps, no overlaps).
fn builtin() -> Result<Vec<Entry>, String> {
    let rows: Vec<Row> = serde_json::from_str(TABLE).map_err(|e| e.to_string())?;
    rows.iter()
        .map(|r| {
            entry(
                &r.valid_from,
                r.valid_to.as_deref(),
                r.base_rate,
                &r.source_ref,
            )
        })
        .collect()
}

/// Built-in table plus `BASE_RATES`, sorted by date.
pub fn rates() -> &'static [Entry] {
    static RATES: OnceLock<Vec<Entry>> = OnceLock::new();
    RATES.get_or_init(|| {
        let mut all = builtin().unwrap_or_else(|e| {
            tracing::error!(error = e, "built-in base rate table is invalid");
            Vec::new()
        });
        for item in std::env::var("BASE_RATES").unwrap_or_default().split(',') {
            let item = item.trim();
            if item.is_empty() {
                continue;
            }
            match parse_entry(item) {
                Some(extra) => {
                    all.retain(|e| e.from != extra.from);
                    all.push(extra);
                }
                None => tracing::warn!(entry = item, "ignored invalid BASE_RATES entry"),
            }
        }
        all.sort_by_key(|e| e.from);
        all
    })
}

/// `YYYY-01-01=1.27` / `YYYY-07-01=1.27` (percent).
fn parse_entry(item: &str) -> Option<Entry> {
    let (date, rate) = item.split_once('=')?;
    let percent: f64 = rate.trim().parse().ok()?;
    entry(date.trim(), None, percent / 100.0, "BASE_RATES").ok()
}

fn iso(day: i64) -> String {
    // inverse of `days` (Howard Hinnant's civil_from_days)
    let z = day + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// One period of an interest calculation with a single base rate.
#[derive(Clone, Debug, PartialEq)]
pub struct Segment {
    pub from: i64,
    pub to: i64,
    pub days: i64,
    /// Base rate in hundredths of a percent.
    pub base: i64,
    pub source: String,
}

impl Segment {
    /// Cents x hundredths of a percent x days; divide by `365 * 10_000` to get cents.
    pub fn weighted(&self, open: i128, premium: i64) -> i128 {
        open * i128::from(self.base + premium) * i128::from(self.days)
    }
}

/// Splits `from..=to` (day numbers) at the changes of the base rate. `base_override` (hundredths of a
/// percent) replaces the table for the whole period.
pub fn segments(from: i64, to: i64, base_override: Option<i64>) -> Result<Vec<Segment>, String> {
    if let Some(base) = base_override {
        return Ok(vec![Segment {
            from,
            to,
            days: to - from + 1,
            base,
            source: "request".into(),
        }]);
    }
    let table = rates();
    let mut out = Vec::new();
    let mut cur = from;
    while cur <= to {
        let Some(found) = table.iter().find(|e| e.from <= cur && cur <= e.to) else {
            return Err(match table.first() {
                Some(first) if cur < first.from => format!(
                    "the base rate is not known before {}; send interest.baseRate",
                    iso(first.from)
                ),
                _ => format!(
                    "the base rate is not known for {}; send interest.baseRate or add it to BASE_RATES",
                    iso(cur)
                ),
            });
        };
        let end = found.to.min(to);
        out.push(Segment {
            from: cur,
            to: end,
            days: end - cur + 1,
            base: found.rate,
            source: found.source.clone(),
        });
        cur = end + 1;
    }
    Ok(out)
}

/// ISO date of a day number.
pub fn iso_date(day: i64) -> String {
    iso(day)
}

/// Rounds half up to whole cents.
pub fn cents(weighted: i128) -> i128 {
    let divisor = 365 * 10_000;
    (weighted + divisor / 2).div_euclid(divisor)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        open: i128,
        from: (i32, u32, u32),
        to: (i32, u32, u32),
        premium: i64,
    ) -> Result<(i128, Vec<i64>), String> {
        let segs = segments(days(from), days(to), None)?;
        let weighted = segs.iter().map(|s| s.weighted(open, premium)).sum();
        Ok((cents(weighted), segs.iter().map(|s| s.base).collect()))
    }

    #[test]
    fn built_in_table_has_no_gaps_or_overlaps() {
        let table = builtin().unwrap();
        assert!(table.len() >= 9);
        for pair in table.windows(2) {
            assert_eq!(
                pair[0].to + 1,
                pair[1].from,
                "{} -> {}",
                iso(pair[0].to),
                iso(pair[1].from)
            );
        }
        for e in &table {
            assert!(!e.source.is_empty());
        }
        assert_eq!(iso(table.last().unwrap().to), "2026-12-31");
        assert_eq!(table.last().unwrap().rate, 152);
    }

    #[test]
    fn table_matches_the_bundesbank_history() {
        let rate = |y, m, d| segments(days((y, m, d)), days((y, m, d)), None).unwrap()[0].base;
        assert_eq!(rate(2002, 1, 1), 257);
        assert_eq!(rate(2008, 1, 1), 332);
        assert_eq!(rate(2010, 3, 1), 12);
        assert_eq!(rate(2013, 9, 1), -38);
        assert_eq!(rate(2016, 6, 30), -83);
        assert_eq!(rate(2016, 7, 1), -88);
        assert_eq!(rate(2022, 12, 31), -88);
        assert_eq!(rate(2024, 7, 1), 337);
        // across the change of 2016-07-01: -0.83 and -0.88
        let (_, across) = run(100_000, (2016, 6, 20), (2016, 7, 10), 500).unwrap();
        assert_eq!(across, vec![-83, -88]);
    }

    #[test]
    fn day_numbers_round_trip() {
        assert_eq!(days((1970, 1, 1)), 0);
        assert_eq!(days((2000, 3, 1)) - days((2000, 2, 28)), 2);
        for d in [0, 11_016, 20_500, 60_000] {
            let s = iso(d);
            let p = crate::invoice::valid_date(&s).unwrap();
            assert_eq!(days(p), d, "{s}");
        }
    }

    #[test]
    fn calculates_within_one_half_year() {
        // 1000 EUR, 2025-07-01 .. 2025-07-31 (31 days), business: 1.27 + 9 = 10.27 %
        let (c, base) = run(100_000, (2025, 7, 1), (2025, 7, 31), 900).unwrap();
        assert_eq!(base, vec![127]);
        assert_eq!(c, 872); // 1000 * 0.1027 * 31 / 365 = 8.7217...
    }

    #[test]
    fn splits_at_the_change_of_the_base_rate() {
        // 2024-12-17 .. 2025-01-15: 15 days at 3.37 + 5 and 15 days at 2.27 + 5
        let segs = segments(days((2024, 12, 17)), days((2025, 1, 15)), None).unwrap();
        assert_eq!(
            segs.iter().map(|s| (s.base, s.days)).collect::<Vec<_>>(),
            vec![(337, 15), (227, 15)]
        );
        let (c, _) = run(100_000, (2024, 12, 17), (2025, 1, 15), 500).unwrap();
        let expected = (100_000i128 * 837 * 15 + 100_000 * 727 * 15) as f64 / 3_650_000.0;
        assert_eq!(c, expected.round() as i128);
    }

    #[test]
    fn uses_the_base_rate_of_the_second_half_of_2026() {
        // 1.52 % + 5 = 6.52 % (consumer), + 9 = 10.52 % (business)
        let (c, base) = run(100_000, (2026, 7, 1), (2026, 12, 31), 900).unwrap();
        assert_eq!(base, vec![152]);
        assert_eq!(c, (100_000f64 * 0.1052 * 184.0 / 365.0).round() as i128);
        let (_, across) = run(100_000, (2026, 6, 20), (2026, 7, 10), 500).unwrap();
        assert_eq!(across, vec![127, 152]);
    }

    #[test]
    fn rejects_periods_the_table_does_not_cover() {
        assert!(run(100, (2001, 12, 30), (2002, 1, 5), 500)
            .unwrap_err()
            .contains("before 2002-01-01"));
        assert!(run(100, (2026, 12, 1), (2027, 1, 5), 500)
            .unwrap_err()
            .contains("for 2027-01-01"));
    }

    #[test]
    fn base_rate_override_covers_any_period() {
        let segs = segments(days((2030, 1, 1)), days((2030, 1, 10)), Some(200)).unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(cents(segs[0].weighted(100_000, 900)), 301); // 1000 * 0.11 * 10 / 365
    }

    #[test]
    fn parses_base_rate_entries() {
        let e = parse_entry("2027-01-01=1.77").unwrap();
        assert_eq!(
            (e.rate, iso(e.to), e.source.as_str()),
            (177, "2027-06-30".to_string(), "BASE_RATES")
        );
        assert_eq!(
            parse_entry("2027-07-01=1").unwrap().to,
            days((2027, 12, 31))
        );
        assert!(parse_entry("2026-07-02=1.77").is_none());
        assert!(parse_entry("2026-07-01=abc").is_none());
        assert!(parse_entry("2026-07-01=99").is_none());
    }

    #[test]
    fn premiums() {
        assert_eq!(premium("consumer"), Some(500));
        assert_eq!(premium("business"), Some(900));
        assert_eq!(premium("x"), None);
    }
}
