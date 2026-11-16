//! Number, date, text and bank-account helpers for the amounts, texts and XML of `einvoice`.

/// A decimal number with 4 decimals, stored as an integer (value * 10_000).
pub(super) fn fixed(v: f64) -> i128 {
    (v * 10_000.0).round() as i128
}

pub(super) fn div_round(n: i128, d: i128) -> i128 {
    let half = d / 2;
    if n >= 0 {
        (n + half) / d
    } else {
        -((-n + half) / d)
    }
}

pub(super) fn group_thousands(int: &str) -> String {
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out
}

/// Formats a 4-decimal fixed-point value with at least `min` decimals.
pub(super) fn decimal(v: i128, min: usize, comma: bool) -> String {
    let sign = if v < 0 { "-" } else { "" };
    let abs = v.abs();
    let mut frac = format!("{:04}", abs % 10_000);
    while frac.len() > min && frac.ends_with('0') {
        frac.pop();
    }
    let int = (abs / 10_000).to_string();
    if comma {
        let sep = if frac.is_empty() { "" } else { "," };
        format!("{sign}{}{sep}{frac}", group_thousands(&int))
    } else {
        let sep = if frac.is_empty() { "" } else { "." };
        format!("{sign}{int}{sep}{frac}")
    }
}

/// Cents (value * 100) as a German amount: `1.234,56`.
pub(super) fn money(cents: i128) -> String {
    decimal(cents * 100, 2, true)
}

pub(super) fn xml_amount(cents: i128) -> String {
    decimal(cents * 100, 2, false)
}

pub(super) fn month_days(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        _ => 28,
    }
}

pub(super) fn add_days((mut y, mut m, mut d): (i32, u32, u32), days: i64) -> (i32, u32, u32) {
    for _ in 0..days {
        d += 1;
        if d > month_days(y, m) {
            d = 1;
            m += 1;
            if m > 12 {
                m = 1;
                y += 1;
            }
        }
    }
    (y, m, d)
}

pub(crate) fn german_date((y, m, d): (i32, u32, u32)) -> String {
    format!("{d:02}.{m:02}.{y}")
}

pub(super) fn xml_date((y, m, d): (i32, u32, u32)) -> String {
    format!("{y}{m:02}{d:02}")
}

pub(super) fn xml_escape(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(*c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}'))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub(super) fn compact(s: &str) -> String {
    s.split_whitespace().collect()
}

pub(super) fn iban_valid(iban: &str) -> bool {
    let b = iban.as_bytes();
    if !(15..=34).contains(&b.len())
        || !b[..2].iter().all(u8::is_ascii_uppercase)
        || !b[2..4].iter().all(u8::is_ascii_digit)
        || !b.iter().all(u8::is_ascii_alphanumeric)
    {
        return false;
    }
    let mut rem: u32 = 0;
    for &c in b[4..].iter().chain(b[..4].iter()) {
        let v = if c.is_ascii_digit() {
            (c - b'0') as u32
        } else {
            (c - b'A') as u32 + 10
        };
        rem = (rem * if v >= 10 { 100 } else { 10 } + v) % 97;
    }
    rem == 1
}

pub(super) fn bic_valid(bic: &str) -> bool {
    matches!(bic.len(), 8 | 11)
        && bic
            .bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && bic.bytes().take(6).all(|c| c.is_ascii_uppercase())
}

pub(super) fn group_iban(iban: &str) -> String {
    iban.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join(" ")
}
