//! Report (tabular document) for `/v1/documents` (`type: "report"`).
//!
//! A generic document for lists and evaluations (journal, trial balance, BWA, procedure
//! documentation, cover sheet of an audit export): title, period, a meta block and one or more tables
//! with typed columns, optional groups with subtotals and a total row. The page layout (repeated table
//! header, page numbers, landscape) is in `frontend/src/template/report.typ`. PDFCraft only lays out
//! what it is given: the sums are computed here in fixed point so that the printed values never drift
//! from the cells. Nothing is stored and no e-invoice XML is produced.

use crate::einvoice::{decimal, div_round, fixed};
use crate::invoice::{one_of, text, Errors, MAX_LONG, MAX_SHORT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use utoipa::ToSchema;

pub const MAX_TABLES: usize = 20;
pub const MAX_COLUMNS: usize = 12;
/// Rows of all tables of one document, group rows and sums not counted. The request body is limited
/// to 2 MB as well, which is reached first with very wide rows.
pub const MAX_ROWS: usize = 10_000;
pub const MAX_META: usize = 12;
pub const MAX_DECIMALS: u32 = 4;
pub const TYPES: [&str; 3] = ["text", "number", "amount"];
pub const ALIGNS: [&str; 3] = ["left", "center", "right"];

const MAX_VALUE: f64 = 1e12;
/// A broken table of 10 000 rows would otherwise answer with 10 000 messages.
const MAX_ERRORS: usize = 50;

/// One line of the meta block (label and value) below the title.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct ReportMeta {
    /// Label, for example `Mandant`.
    #[schema(required = true, max_length = 200)]
    pub label: String,
    /// Value; entries without a value are not printed.
    #[schema(max_length = 200)]
    pub value: String,
}

/// A table cell: text in `text` columns, a number in `number` and `amount` columns. `null` is an
/// empty cell that adds nothing to a sum.
#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(untagged)]
pub enum ReportCell {
    Number(f64),
    Text(String),
}

/// A table column.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct ReportColumn {
    /// Column heading.
    #[schema(required = true, max_length = 200)]
    pub label: String,
    /// `text` (default), `number` or `amount`. Numbers and amounts are formatted like the other
    /// documents (`1.234,56`) and aligned to the right.
    #[serde(rename = "type")]
    pub kind: Option<String>,
    /// `left`, `center` or `right`. Default: `left` for text, `right` for numbers and amounts.
    pub align: Option<String>,
    /// Relative width (1 to 100). Columns with a width share the space that the others leave free;
    /// without any width the column with the longest text takes the free space and the others fit
    /// their content.
    #[schema(minimum = 1, maximum = 100)]
    pub width: Option<f64>,
    /// Decimal places (0 to 4) of numbers and amounts, values are rounded half away from zero.
    /// Default: 2 for `amount`, 0 for `number`.
    #[schema(minimum = 0, maximum = 4)]
    pub decimals: Option<f64>,
    /// Print the sum of the column in the subtotal and total rows (`number` and `amount` only).
    pub sum: bool,
}

/// A group of rows with an optional heading and a subtotal row.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct ReportGroup {
    /// Heading row above the group; without it the group has no heading row.
    #[schema(max_length = 200)]
    pub title: String,
    /// The rows of the group: one array per row with one cell per column.
    #[schema(required = true, min_items = 1)]
    pub rows: Vec<Vec<Option<ReportCell>>>,
    /// Print a subtotal row with the sums of the group (default: true when a column has `sum`).
    pub subtotal: Option<bool>,
    /// Label of the subtotal row (default: `Zwischensumme <title>` / `Subtotal <title>`).
    #[schema(max_length = 200)]
    pub subtotal_label: String,
}

/// A table; its header is repeated on every page.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct ReportTable {
    /// Heading above the table.
    #[schema(max_length = 200)]
    pub title: String,
    /// 1 to 12 columns.
    #[schema(required = true, min_items = 1, max_items = 12)]
    pub columns: Vec<ReportColumn>,
    /// The rows of a table without groups: one array per row with one cell per column. Use either
    /// `rows` or `groups`.
    pub rows: Vec<Vec<Option<ReportCell>>>,
    /// Groups of rows with subtotals. Use either `rows` or `groups`.
    pub groups: Vec<ReportGroup>,
    /// Print a total row with the sums of the table (default: true when a column has `sum`).
    pub total: Option<bool>,
    /// Label of the total row (default: `Gesamt` / `Total`).
    #[schema(max_length = 200)]
    pub total_label: String,
}

/// The report fields of a document.
pub struct Fields<'a> {
    pub title: &'a str,
    pub period: &'a str,
    pub meta: &'a [ReportMeta],
    pub tables: &'a [ReportTable],
    pub landscape: bool,
}

#[derive(Clone)]
struct Col {
    label: String,
    align: String,
    numeric: bool,
    decimals: u32,
    sum: bool,
    width: Option<u32>,
}

/// Validated template data (`doc.report`): texts and numbers are already formatted. A table row is
/// an array of strings whose first entry is the kind (`r` row, `g` group heading, `s` subtotal,
/// `t` total).
pub fn check(f: &Fields, english: bool, e: &mut Errors) -> JsonValue {
    let title = text(e, "document.title", f.title, MAX_SHORT, true);
    let period = text(e, "document.period", f.period, MAX_SHORT, false);
    if f.meta.len() > MAX_META {
        e.add(
            "document.meta",
            &format!("needs at most {MAX_META} entries"),
        );
    }
    let meta: Vec<JsonValue> = f
        .meta
        .iter()
        .take(MAX_META)
        .enumerate()
        .map(|(i, m)| {
            json!({
                "label": text(e, &format!("document.meta[{i}].label"), &m.label, MAX_SHORT, true),
                "value": text(e, &format!("document.meta[{i}].value"), &m.value, MAX_SHORT, false),
            })
        })
        .collect();

    let mut tables = Vec::new();
    if f.tables.is_empty() || f.tables.len() > MAX_TABLES {
        e.add(
            "document.tables",
            &format!("needs 1 to {MAX_TABLES} tables"),
        );
    } else if row_count(f.tables) > MAX_ROWS {
        e.add(
            "document.tables",
            &format!("needs at most {MAX_ROWS} rows in total"),
        );
    } else {
        for (i, t) in f.tables.iter().enumerate() {
            tables.push(check_table(e, &format!("document.tables[{i}]"), t, english));
        }
    }
    json!({
        "title": title,
        "period": period,
        "landscape": f.landscape,
        "meta": meta,
        "tables": tables,
    })
}

fn row_count(tables: &[ReportTable]) -> usize {
    tables
        .iter()
        .map(|t| t.rows.len() + t.groups.iter().map(|g| g.rows.len()).sum::<usize>())
        .sum()
}

fn columns(e: &mut Errors, tp: &str, list: &[ReportColumn]) -> Vec<Col> {
    list.iter()
        .enumerate()
        .map(|(i, c)| {
            let cp = format!("{tp}.columns[{i}]");
            let kind = one_of(e, &format!("{cp}.type"), c.kind.as_ref(), &TYPES, "text");
            let numeric = kind != "text";
            let align = one_of(
                e,
                &format!("{cp}.align"),
                c.align.as_ref(),
                &ALIGNS,
                if numeric { "right" } else { "left" },
            );
            let decimals = match c.decimals {
                None if kind == "amount" => 2,
                None => 0,
                Some(d) if d.fract() == 0.0 && (0.0..=f64::from(MAX_DECIMALS)).contains(&d) => {
                    d as u32
                }
                Some(_) => {
                    e.add(
                        &format!("{cp}.decimals"),
                        &format!("must be a whole number from 0 to {MAX_DECIMALS}"),
                    );
                    0
                }
            };
            let width = match c.width {
                None => None,
                Some(w) if w.fract() == 0.0 && (1.0..=100.0).contains(&w) => Some(w as u32),
                Some(_) => {
                    e.add(
                        &format!("{cp}.width"),
                        "must be a whole number from 1 to 100",
                    );
                    None
                }
            };
            if c.sum && !numeric {
                e.add(
                    &format!("{cp}.sum"),
                    "is only possible for number and amount columns",
                );
            }
            Col {
                label: text(e, &format!("{cp}.label"), &c.label, MAX_SHORT, true),
                align,
                numeric,
                decimals,
                sum: c.sum && numeric,
                width,
            }
        })
        .collect()
}

fn check_table(e: &mut Errors, tp: &str, t: &ReportTable, english: bool) -> JsonValue {
    let title = text(e, &format!("{tp}.title"), &t.title, MAX_SHORT, false);
    if t.columns.is_empty() || t.columns.len() > MAX_COLUMNS {
        e.add(
            &format!("{tp}.columns"),
            &format!("needs 1 to {MAX_COLUMNS} columns"),
        );
        return json!({});
    }
    let cols = columns(e, tp, &t.columns);
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut longest = vec![0_usize; cols.len()];
    let mut totals = vec![0_i128; cols.len()];

    if !t.rows.is_empty() && !t.groups.is_empty() {
        e.add(tp, "use either `rows` or `groups`, not both");
    }
    if t.groups.is_empty() {
        if t.rows.is_empty() {
            e.add(&format!("{tp}.rows"), "needs at least one row");
        }
        let mut ctx = Rows {
            cols: &cols,
            longest: &mut longest,
            sums: &mut totals,
            out: &mut out,
        };
        ctx.add(e, &format!("{tp}.rows"), &t.rows);
    } else {
        let has_sum = cols.iter().any(|c| c.sum);
        for (gi, g) in t.groups.iter().enumerate() {
            let gp = format!("{tp}.groups[{gi}]");
            let group_title = text(e, &format!("{gp}.title"), &g.title, MAX_SHORT, false);
            if g.rows.is_empty() {
                e.add(&format!("{gp}.rows"), "needs at least one row");
            }
            if !group_title.is_empty() {
                out.push(vec!["g".into(), group_title.clone()]);
            }
            let mut sums = vec![0_i128; cols.len()];
            Rows {
                cols: &cols,
                longest: &mut longest,
                sums: &mut sums,
                out: &mut out,
            }
            .add(e, &format!("{gp}.rows"), &g.rows);
            for (total, sum) in totals.iter_mut().zip(&sums) {
                *total += sum;
            }
            if has_sum && g.subtotal.unwrap_or(true) {
                let given = text(
                    e,
                    &format!("{gp}.subtotalLabel"),
                    &g.subtotal_label,
                    MAX_SHORT,
                    false,
                );
                let label = if !given.is_empty() {
                    given
                } else {
                    let base = if english { "Subtotal" } else { "Zwischensumme" };
                    format!("{base} {group_title}").trim().to_string()
                };
                out.push(summary("s", &cols, &sums, &label));
            }
        }
    }
    if cols.iter().any(|c| c.sum) && t.total.unwrap_or(true) {
        let given = text(
            e,
            &format!("{tp}.totalLabel"),
            &t.total_label,
            MAX_SHORT,
            false,
        );
        let label = if !given.is_empty() {
            given
        } else if english {
            "Total".to_string()
        } else {
            "Gesamt".to_string()
        };
        out.push(summary("t", &cols, &totals, &label));
    }

    json!({
        "title": title,
        "columns": cols.iter().map(|c| json!({"label": c.label, "align": c.align})).collect::<Vec<_>>(),
        "widths": widths(&cols, &longest),
        "rows": out,
    })
}

/// Typst column widths: relative widths where given, otherwise the column with the longest text
/// takes the free space (all columns share it when there is no text column).
fn widths(cols: &[Col], longest: &[usize]) -> Vec<String> {
    if cols.iter().any(|c| c.width.is_some()) {
        return cols
            .iter()
            .map(|c| c.width.map_or("auto".into(), |w| format!("{w}fr")))
            .collect();
    }
    let mut stretch: Option<usize> = None;
    for (i, c) in cols.iter().enumerate() {
        if !c.numeric && stretch.is_none_or(|s| longest[i] > longest[s]) {
            stretch = Some(i);
        }
    }
    match stretch {
        Some(s) => (0..cols.len())
            .map(|i| if i == s { "1fr" } else { "auto" }.to_string())
            .collect(),
        None => vec!["1fr".to_string(); cols.len()],
    }
}

/// A subtotal or total row: the label in the first column that is not summed, the sums in the others.
fn summary(kind: &str, cols: &[Col], sums: &[i128], label: &str) -> Vec<String> {
    let label_column = cols.iter().position(|c| !c.sum);
    let mut row = vec![kind.to_string()];
    for (i, c) in cols.iter().enumerate() {
        row.push(if c.sum {
            decimal(sums[i], c.decimals as usize, true)
        } else if Some(i) == label_column {
            label.to_string()
        } else {
            String::new()
        });
    }
    row
}

struct Rows<'a> {
    cols: &'a [Col],
    longest: &'a mut [usize],
    sums: &'a mut [i128],
    out: &'a mut Vec<Vec<String>>,
}

impl Rows<'_> {
    fn add(&mut self, e: &mut Errors, path: &str, rows: &[Vec<Option<ReportCell>>]) {
        for (ri, row) in rows.iter().enumerate() {
            if e.0.len() >= MAX_ERRORS {
                return;
            }
            let rp = format!("{path}[{ri}]");
            if row.len() != self.cols.len() {
                e.add(
                    &rp,
                    &format!("needs {} cells, one per column", self.cols.len()),
                );
                continue;
            }
            let mut cells = Vec::with_capacity(row.len() + 1);
            cells.push("r".to_string());
            for (ci, (cell, col)) in row.iter().zip(self.cols).enumerate() {
                let cp = format!("{rp}[{ci}]");
                cells.push(match (cell, col.numeric) {
                    (None, _) => String::new(),
                    (Some(ReportCell::Text(s)), false) => {
                        let shown = text(e, &cp, s, MAX_LONG, false);
                        self.longest[ci] = self.longest[ci].max(shown.chars().count());
                        shown
                    }
                    (Some(ReportCell::Number(v)), true) => {
                        if !v.is_finite() || v.abs() > MAX_VALUE {
                            e.add(&cp, "must be a number between -1e12 and 1e12");
                            String::new()
                        } else {
                            let unit = 10_i128.pow(MAX_DECIMALS - col.decimals);
                            let rounded = div_round(fixed(*v), unit) * unit;
                            self.sums[ci] += rounded;
                            decimal(rounded, col.decimals as usize, true)
                        }
                    }
                    (Some(_), numeric) => {
                        e.add(
                            &cp,
                            if numeric {
                                "must be a number"
                            } else {
                                "must be text"
                            },
                        );
                        String::new()
                    }
                });
            }
            self.out.push(cells);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(tables: JsonValue) -> (JsonValue, Vec<String>) {
        let tables: Vec<ReportTable> = serde_json::from_value(tables).unwrap();
        let mut e = Errors::default();
        let out = check(
            &Fields {
                title: "Summen- und Saldenliste",
                period: "2026",
                meta: &[],
                tables: &tables,
                landscape: false,
            },
            false,
            &mut e,
        );
        (out, e.0)
    }

    fn trial_balance() -> JsonValue {
        json!([{
            "columns": [
                {"label": "Konto"},
                {"label": "Bezeichnung"},
                {"label": "Soll", "type": "amount", "sum": true},
                {"label": "Haben", "type": "amount", "sum": true},
            ],
            "groups": [
                {"title": "Klasse 1", "rows": [
                    ["1000", "Kasse", 1000.5, 200],
                    ["1200", "Bank", 0.1, null],
                ]},
                {"title": "Klasse 4", "rows": [["4400", "Erlöse", null, 0.2]]},
            ],
        }])
    }

    #[test]
    fn sums_groups_and_total_are_computed_in_fixed_point() {
        let (out, errors) = run(trial_balance());
        assert!(errors.is_empty(), "{errors:?}");
        let rows = &out["tables"][0]["rows"];
        let rows: Vec<Vec<String>> = serde_json::from_value(rows.clone()).unwrap();
        assert_eq!(rows[0], ["g", "Klasse 1"]);
        assert_eq!(rows[1], ["r", "1000", "Kasse", "1.000,50", "200,00"]);
        assert_eq!(rows[2], ["r", "1200", "Bank", "0,10", ""]);
        assert_eq!(
            rows[3],
            ["s", "Zwischensumme Klasse 1", "", "1.000,60", "200,00"]
        );
        assert_eq!(rows[6], ["s", "Zwischensumme Klasse 4", "", "0,00", "0,20"]);
        assert_eq!(rows[7], ["t", "Gesamt", "", "1.000,60", "200,20"]);
        assert_eq!(
            out["tables"][0]["widths"],
            json!(["auto", "1fr", "auto", "auto"])
        );
        assert_eq!(out["tables"][0]["columns"][2]["align"], "right");
    }

    #[test]
    fn english_labels_and_custom_labels() {
        let mut input = trial_balance();
        input[0]["groups"][0]["subtotalLabel"] = json!("Sum \"class\" 1");
        input[0]["totalLabel"] = json!("Balance");
        let tables: Vec<ReportTable> = serde_json::from_value(input).unwrap();
        let mut e = Errors::default();
        let out = check(
            &Fields {
                title: "x",
                period: "",
                meta: &[],
                tables: &tables,
                landscape: true,
            },
            true,
            &mut e,
        );
        assert!(e.0.is_empty());
        let rows: Vec<Vec<String>> =
            serde_json::from_value(out["tables"][0]["rows"].clone()).unwrap();
        assert_eq!(rows[3][1], "Sum \\\"class\\\" 1");
        assert_eq!(rows[6][1], "Subtotal Klasse 4");
        assert_eq!(rows[7][1], "Balance");
        assert_eq!(out["landscape"], true);
    }

    #[test]
    fn flat_tables_and_switches() {
        let (out, errors) = run(json!([{
            "columns": [
                {"label": "Nr.", "type": "number", "decimals": 0},
                {"label": "Menge", "type": "number", "decimals": 3, "sum": true, "width": 2},
            ],
            "rows": [[1, 1.0005], [2, 2]],
            "total": false,
        }]));
        assert!(errors.is_empty(), "{errors:?}");
        let rows: Vec<Vec<String>> =
            serde_json::from_value(out["tables"][0]["rows"].clone()).unwrap();
        assert_eq!(rows, [["r", "1", "1,001"], ["r", "2", "2,000"]]);
        assert_eq!(out["tables"][0]["widths"], json!(["auto", "2fr"]));

        let (out, _) = run(json!([{
            "columns": [{"label": "A", "type": "amount", "sum": true}],
            "rows": [[1], [2]],
        }]));
        let rows: Vec<Vec<String>> =
            serde_json::from_value(out["tables"][0]["rows"].clone()).unwrap();
        assert_eq!(rows[2], ["t", "3,00"]);
        assert_eq!(out["tables"][0]["widths"], json!(["1fr"]));
    }

    #[test]
    fn invalid_reports_name_the_field() {
        let (_, mut errors) = run(json!([{
            "columns": [
                {"label": "A"},
                {"label": "B", "type": "amount", "sum": true},
                {"label": "C", "type": "date", "decimals": 5, "width": 0, "align": "top"},
                {"label": "D", "sum": true},
            ],
            "rows": [["a", 1, "x"], ["a", "oops", "", ""], [1, 2, "x", "y"], ["a", 1e13, "", ""]],
        }]));
        let (_, group_errors) = run(json!([{
            "columns": [{"label": "A"}],
            "rows": [["a"]],
            "groups": [{"rows": []}],
        }]));
        errors.extend(group_errors);
        for expected in [
            "document.tables[0]: use either `rows` or `groups`, not both",
            "document.tables[0].columns[2].type: must be one of: text, number, amount",
            "document.tables[0].columns[2].align: must be one of: left, center, right",
            "document.tables[0].columns[2].decimals: must be a whole number from 0 to 4",
            "document.tables[0].columns[2].width: must be a whole number from 1 to 100",
            "document.tables[0].columns[3].sum: is only possible for number and amount columns",
            "document.tables[0].groups[0].rows: needs at least one row",
            "document.tables[0].rows[0]: needs 4 cells, one per column",
            "document.tables[0].rows[1][1]: must be a number",
            "document.tables[0].rows[2][0]: must be text",
            "document.tables[0].rows[3][1]: must be a number between -1e12 and 1e12",
        ] {
            assert!(
                errors.iter().any(|m| m == expected),
                "{expected} in {errors:?}"
            );
        }
    }

    #[test]
    fn limits() {
        let (_, errors) = run(json!([]));
        assert_eq!(errors, ["document.tables: needs 1 to 20 tables"]);
        let (_, errors) = run(json!([{"columns": [], "rows": [[]]}]));
        assert_eq!(
            errors,
            ["document.tables[0].columns: needs 1 to 12 columns"]
        );
        let rows: Vec<_> = (0..=MAX_ROWS).map(|i| json!([i])).collect();
        let (_, errors) = run(json!([{"columns": [{"label": "A"}], "rows": rows}]));
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert!(errors[0].contains("at most 10000 rows in total"));

        let rows: Vec<_> = (0..MAX_ROWS).map(|_| json!([1])).collect();
        let (_, errors) = run(json!([{"columns": [{"label": "A"}], "rows": rows}]));
        assert_eq!(
            errors.len(),
            MAX_ERRORS,
            "stops after {MAX_ERRORS} messages"
        );
    }
}
