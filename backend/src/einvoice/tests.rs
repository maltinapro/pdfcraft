use super::*;

#[test]
fn rounds_half_away_from_zero() {
    assert_eq!(
        money(div_round(fixed(1.5) * fixed(9.99), 10_000 * 100)),
        "14,99"
    );
}

#[test]
fn formats_amounts() {
    assert_eq!(xml_amount(1_234_567), "12345.67");
    assert_eq!(group_thousands("1234567"), "1.234.567");
}

#[test]
fn validates_iban_and_bic() {
    assert!(iban_valid("DE89370400440532013000"));
    assert!(!iban_valid("DE89370400440532013001"));
    assert!(bic_valid("COBADEFFXXX"));
    assert!(!bic_valid("X"));
}

#[test]
fn adds_days_across_months() {
    assert_eq!(add_days((2026, 1, 15), 30), (2026, 2, 14));
    assert_eq!(add_days((2026, 12, 20), 14), (2027, 1, 3));
}

#[test]
fn escapes_xml() {
    assert_eq!(xml_escape("a&b<c>\"d\""), "a&amp;b&lt;c&gt;&quot;d&quot;");
}
