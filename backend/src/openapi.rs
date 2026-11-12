//! OpenAPI description of the public `/v1` API (`docs/openapi.yaml`).
//!
//! The paths, request/response schemas and validation limits are generated from the Rust code
//! (`utoipa` derives and `#[utoipa::path]` on the handlers). The allowed values (fonts, locales,
//! units, tax rates, document types) are taken from the constants of the validation. Texts that
//! cannot be derived (introduction, shared error responses, request examples) live in
//! `openapi_overlay.yaml` and are merged here.
//!
//! `pdfcraft-backend openapi` prints the YAML; `cargo test` regenerates `docs/openapi.yaml`
//! (and fails in CI when the committed file is outdated).
use crate::{documents::Kind, invoice};
use serde_json::{json, Map, Value};
use utoipa::OpenApi;

const OVERLAY: &str = include_str!("openapi_overlay.yaml");

#[derive(OpenApi)]
#[openapi(
    paths(crate::v1::single, crate::v1::bulk, crate::v1::document_single, crate::v1::document_bulk, crate::mollie::token_info),
    components(schemas(crate::ErrorResponse))
)]
struct ApiDoc;

/// Error responses every `POST` operation can return.
const POST_ERRORS: [(&str, &str); 8] = [
    ("400", "BadRequest"),
    ("401", "Unauthorized"),
    ("413", "TooLarge"),
    ("415", "UnsupportedMediaType"),
    ("422", "Unprocessable"),
    ("429", "RateLimited"),
    ("500", "ServerError"),
    ("503", "Unavailable"),
];
/// `GET /v1/token` does not cost a rate-limit unit and has no body.
const TOKEN_ERRORS: [(&str, &str); 2] = [("401", "Unauthorized"), ("503", "Unavailable")];

fn reference(name: &str) -> Value {
    json!({ "$ref": format!("#/components/responses/{name}") })
}

fn object<'a>(value: &'a mut Value, what: &str) -> &'a mut Map<String, Value> {
    value.as_object_mut().unwrap_or_else(|| panic!("{what} is an object"))
}

/// The complete specification as JSON.
pub fn spec() -> Value {
    let mut spec = serde_json::to_value(ApiDoc::openapi()).expect("the specification serializes");
    let mut overlay: Value = serde_yaml::from_str(OVERLAY).expect("openapi_overlay.yaml is valid YAML");

    for key in ["info", "servers", "security", "tags"] {
        spec[key] = overlay[key].take();
    }
    for key in ["securitySchemes", "headers", "responses"] {
        spec["components"][key] = overlay["components"][key].take();
    }

    clean_schemas(&mut spec["components"]["schemas"]);
    inject_allowed_values(&mut spec["components"]["schemas"], &overlay["errorCodes"]);
    complete_operations(&mut spec, &mut overlay);
    spec
}

/// Generic cleanups of what `utoipa` derives from the Rust types.
fn clean_schemas(schemas: &mut Value) {
    for (_, schema) in object(schemas, "schemas") {
        let required: Vec<String> = schema["required"]
            .as_array()
            .map(|r| r.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) else { continue };
        for (name, property) in properties {
            let Some(property) = property.as_object_mut() else { continue };
            // Optional `Option<T>` field: an omitted field and `null` are both fine; document it as optional only.
            if let (false, Some(Value::Array(types))) = (required.contains(name), property.get("type")) {
                let types: Vec<Value> = types.iter().filter(|t| *t != "null").cloned().collect();
                if let [single] = types.as_slice() {
                    property.insert("type".into(), single.clone());
                }
            }
            // A wrapped `$ref` (optional or defaulted object): reference it directly.
            if let Some(Value::Array(options)) = property.get("oneOf").cloned() {
                let options: Vec<&Value> = options.iter().filter(|o| o["type"] != "null").collect();
                if let [only] = options.as_slice() {
                    if let Some(target) = only.get("$ref") {
                        property.remove("oneOf");
                        property.remove("default");
                        property.insert("$ref".into(), target.clone());
                        if let Some(description) = only.get("description") {
                            property.insert("description".into(), description.clone());
                        }
                    }
                }
            }
            // Defaults of the Rust `Default` that are not real defaults of the API.
            let noise = match property.get("default") {
                Some(Value::String(s)) => s.is_empty(),
                Some(Value::Array(a)) => a.is_empty(),
                Some(Value::Object(_)) | Some(Value::Null) => true,
                Some(Value::Number(n)) => n.as_f64() == Some(0.0) && property.get("type") == Some(&json!("number")),
                _ => false,
            };
            if noise || required.contains(name) {
                property.remove("default");
            }
        }
    }
}

/// Allowed values come from the constants the validation uses, so they cannot drift.
fn inject_allowed_values(schemas: &mut Value, error_codes: &Value) {
    fn set_enum(property: &mut Value, values: Value) {
        property["enum"] = values;
    }
    set_enum(&mut schemas["Settings"]["properties"]["font"], json!(invoice::FONTS));
    set_enum(&mut schemas["Settings"]["properties"]["locale"], json!(invoice::LOCALES));
    set_enum(&mut schemas["Settings"]["properties"]["einvoiceProfile"], json!(invoice::PROFILES));
    set_enum(&mut schemas["Item"]["properties"]["unit"], json!(invoice::UNITS));
    set_enum(&mut schemas["Item"]["properties"]["taxRate"], json!(invoice::TAX_RATES));
    set_enum(&mut schemas["DocumentType"], json!(Kind::ALL.iter().map(|k| k.slug()).collect::<Vec<_>>()));
    set_enum(&mut schemas["TokenInfo"]["properties"]["kind"], json!(["free", "paid"]));
    set_enum(&mut schemas["Error"]["properties"]["error"], error_codes.clone());
}

/// Examples, shared error responses and the binary success responses of every operation.
fn complete_operations(spec: &mut Value, overlay: &mut Value) {
    for (path, item) in object(&mut spec["paths"], "paths") {
        for (_, operation) in object(item, path) {
            let id = operation["operationId"].as_str().expect("operationId").to_string();
            let is_get = operation["requestBody"].is_null();
            if !is_get {
                operation["requestBody"]["content"]["application/json"]["examples"] = overlay["examples"][&id].take();
            } else {
                operation["responses"]["200"]["content"]["application/json"]["examples"] = overlay["responseExamples"][&id].take();
            }
            let responses = object(&mut operation["responses"], "responses");
            if path.ends_with("/bulk") {
                responses.insert("200".into(), reference("Zip"));
            } else if !is_get {
                responses.insert("200".into(), reference("Pdf"));
            }
            for (status, name) in if is_get { &TOKEN_ERRORS[..] } else { &POST_ERRORS[..] } {
                responses.insert((*status).into(), reference(name));
            }
        }
    }
}

/// The specification as YAML (what `docs/openapi.yaml` contains).
pub fn yaml() -> String {
    let spec = spec();
    // Top-level keys in reading order; everything below is sorted alphabetically.
    let mut document = serde_yaml::Mapping::new();
    document.insert("openapi".into(), serde_yaml::to_value(&spec["openapi"]).unwrap());
    for key in ["info", "servers", "security", "tags", "paths", "components"] {
        document.insert(key.into(), serde_yaml::to_value(&spec[key]).unwrap());
    }
    quote_dates(&serde_yaml::to_string(&document).expect("the specification serializes to YAML"))
}

/// `serde_yaml` leaves date-like strings unquoted, which YAML 1.1 parsers read as dates.
fn quote_dates(yaml: &str) -> String {
    let is_date = |s: &str| {
        s.len() == 10 && s.char_indices().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
    };
    let mut out = String::with_capacity(yaml.len());
    for line in yaml.lines() {
        match line.rsplit_once(": ") {
            Some((key, value)) if is_date(value) => out.push_str(&format!("{key}: '{value}'")),
            _ => out.push_str(line),
        }
        out.push('\n');
    }
    out
}

/// `pdfcraft-backend openapi`: print the specification.
pub fn run_cli(args: &[String]) -> bool {
    if args.first().map(String::as_str) != Some("openapi") {
        return false;
    }
    print!("{}", yaml());
    true
}

#[cfg(test)]
mod tests {
    use super::yaml;

    /// `docs/openapi.yaml` is the generated specification. Locally `cargo test` rewrites it when the
    /// code changed (commit the result); in CI (`CI` is set) an outdated file fails the build.
    #[test]
    fn openapi_file_is_up_to_date() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../docs/openapi.yaml");
        let generated = yaml();
        let current = std::fs::read_to_string(path).unwrap_or_default();
        if current == generated {
            return;
        }
        assert!(
            std::env::var_os("CI").is_none(),
            "docs/openapi.yaml is outdated: run `cd backend && cargo test openapi_file_is_up_to_date` (or `cargo run -- openapi > ../docs/openapi.yaml`) and commit the result"
        );
        std::fs::write(path, generated).expect("docs/openapi.yaml is writable");
        eprintln!("docs/openapi.yaml was regenerated, please commit it");
    }
}
