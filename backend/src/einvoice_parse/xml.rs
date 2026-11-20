//! Minimal XML reader, a port of `frontend/src/lib/einvoice/xml.ts`. It ignores namespace prefixes (nodes are
//! addressed by their local name) and never resolves external or custom entities, so a hostile file cannot
//! trigger entity expansion or network requests. The nesting depth is limited, so a deeply nested file cannot
//! exhaust the stack.

use std::collections::BTreeMap;

/// Deepest element nesting accepted (real e-invoices stay below 20).
const MAX_DEPTH: usize = 256;

#[derive(Debug, Default)]
pub struct XmlNode {
    /// Local name without namespace prefix.
    pub name: String,
    pub attrs: BTreeMap<String, String>,
    pub children: Vec<XmlNode>,
    /// Concatenated text content of this node itself (without child elements), trimmed.
    pub text: String,
}

impl XmlNode {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.get(name).map(String::as_str)
    }
}

fn local(qualified: &str) -> &str {
    qualified
        .split_once(':')
        .map_or(qualified, |(_, name)| name)
}

/// Decodes the predefined and numeric entities; anything else stays as written.
fn decode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        // Longest reference that can matter is `#x10ffff`; looking further would make `&&&&...` quadratic
        let Some(semi) = rest.bytes().take(32).position(|b| b == b';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let reference = &rest[1..semi];
        let decoded = if let Some(hex) = reference.strip_prefix("#x") {
            (!hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| u32::from_str_radix(hex, 16).ok().and_then(char_of))
        } else if let Some(dec) = reference.strip_prefix('#') {
            (!dec.is_empty() && dec.bytes().all(|b| b.is_ascii_digit()))
                .then(|| dec.parse::<u32>().ok().and_then(char_of))
        } else {
            match reference {
                "lt" => Some(Some('<')),
                "gt" => Some(Some('>')),
                "amp" => Some(Some('&')),
                "quot" => Some(Some('"')),
                "apos" => Some(Some('\'')),
                _ => None,
            }
        };
        match decoded {
            Some(ch) => {
                out.extend(ch);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn char_of(code: u32) -> Option<char> {
    if code > 0 {
        char::from_u32(code)
    } else {
        None
    }
}

/// Parses an XML document and returns its root element. Returns a message for malformed XML.
pub fn parse_xml(source: &str) -> Result<XmlNode, String> {
    let bytes = source.as_bytes();
    let mut pos = if source.starts_with('\u{feff}') { 3 } else { 0 };
    let mut stack: Vec<(XmlNode, String)> = Vec::new();
    let mut root: Option<XmlNode> = None;

    macro_rules! fail {
        ($($arg:tt)*) => {
            return Err(format!("XML: {} (position {})", format!($($arg)*), pos))
        };
    }
    macro_rules! skip_to {
        ($marker:expr, $label:expr) => {
            match source[pos..].find($marker) {
                Some(end) => pos += end + $marker.len(),
                None => fail!("{} is not closed", $label),
            }
        };
    }

    while pos < source.len() {
        let Some(lt) = source[pos..].find('<').map(|i| i + pos) else {
            if !source[pos..].trim().is_empty() {
                fail!("text after the root element");
            }
            break;
        };
        if lt > pos {
            if let Some((_, text)) = stack.last_mut() {
                text.push_str(&decode(&source[pos..lt]));
            }
        }
        pos = lt;
        let here = &source[pos..];
        if here.starts_with("<!--") {
            skip_to!("-->", "comment");
        } else if here.starts_with("<![CDATA[") {
            let Some(end) = here.find("]]>") else {
                fail!("CDATA is not closed")
            };
            if let Some((_, text)) = stack.last_mut() {
                text.push_str(&here[9..end]);
            }
            pos += end + 3;
        } else if here.starts_with("<?") {
            skip_to!("?>", "processing instruction");
        } else if here.starts_with("<!") {
            // DOCTYPE: skipped including an internal subset; declared entities are intentionally never expanded
            let Some(close) = here.find('>') else {
                fail!("DOCTYPE is not closed")
            };
            if here[..close].contains('[') {
                skip_to!("]>", "DOCTYPE");
            } else {
                pos += close + 1;
            }
        } else if here.starts_with("</") {
            let Some(end) = here.find('>') else {
                fail!("closing tag is not closed")
            };
            let name = local(here[2..end].trim());
            match stack.pop() {
                Some((mut node, text)) if node.name == name => {
                    node.text = text.trim().to_string();
                    match stack.last_mut() {
                        Some((parent, _)) => parent.children.push(node),
                        None => root = Some(node),
                    }
                }
                _ => fail!("unexpected closing tag </{name}>"),
            }
            pos += end + 1;
        } else {
            let mut i = pos + 1;
            let name_end = source[i..]
                .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
                .map_or(source.len(), |n| n + i);
            let name = local(&source[i..name_end]).to_string();
            if name.is_empty() {
                fail!("empty element name");
            }
            i = name_end;
            let mut node = XmlNode {
                name,
                ..XmlNode::default()
            };
            loop {
                let (attr, next) = read_attribute(source, i);
                let Some((key, value)) = attr else { break };
                // xmlns declarations are not needed, everything is addressed by local name
                if key != "xmlns" && !key.starts_with("xmlns:") {
                    node.attrs.insert(local(key).to_string(), decode(value));
                }
                i = next;
            }
            i = source.len() - source[i..].trim_start().len();
            let mut self_closing = false;
            if bytes.get(i) == Some(&b'/') {
                self_closing = true;
                i += 1;
            }
            if bytes.get(i) != Some(&b'>') {
                pos = i;
                fail!("malformed start tag");
            }
            pos = i + 1;
            if stack.is_empty() && root.is_some() {
                fail!("more than one root element");
            }
            if self_closing {
                match stack.last_mut() {
                    Some((parent, _)) => parent.children.push(node),
                    None => root = Some(node),
                }
            } else {
                if stack.len() >= MAX_DEPTH {
                    fail!("elements are nested too deeply");
                }
                stack.push((node, String::new()));
            }
        }
    }
    if let Some((node, _)) = stack.last() {
        fail!("element <{}> is not closed", node.name);
    }
    match root {
        Some(root) => Ok(root),
        None => fail!("no root element"),
    }
}

/// Reads one `name="value"` attribute starting at `from` (leading whitespace allowed). Returns the attribute
/// and the position after it, or `None` when no attribute follows.
fn read_attribute(source: &str, from: usize) -> (Option<(&str, &str)>, usize) {
    let rest = source[from..].trim_start();
    let key_len = rest
        .find(|c: char| c.is_whitespace() || c == '=' || c == '/' || c == '>')
        .unwrap_or(rest.len());
    if key_len == 0 {
        return (None, from);
    }
    let key = &rest[..key_len];
    let after = rest[key_len..].trim_start();
    let Some(after) = after.strip_prefix('=') else {
        return (None, from);
    };
    let after = after.trim_start();
    let Some(quote) = after.chars().next().filter(|c| *c == '"' || *c == '\'') else {
        return (None, from);
    };
    let Some(close) = after[1..].find(quote) else {
        return (None, from);
    };
    let value = &after[1..1 + close];
    let end = source.len() - after.len() + 1 + close + 1;
    (Some((key, value)), end)
}

/// Direct children with the given local name.
pub fn kids<'a>(node: Option<&'a XmlNode>, name: &str) -> Vec<&'a XmlNode> {
    node.map(|n| n.children.iter().filter(|c| c.name == name).collect())
        .unwrap_or_default()
}

/// First node found by following a `/`-separated path of local names (each step takes the first match).
pub fn find<'a>(node: Option<&'a XmlNode>, path: &str) -> Option<&'a XmlNode> {
    let mut current = node?;
    for step in path.split('/') {
        current = current.children.iter().find(|c| c.name == step)?;
    }
    Some(current)
}

/// All nodes at the end of a path (every branch is followed).
pub fn find_all<'a>(node: Option<&'a XmlNode>, path: &str) -> Vec<&'a XmlNode> {
    let mut level: Vec<&XmlNode> = node.into_iter().collect();
    for step in path.split('/') {
        level = level
            .into_iter()
            .flat_map(|n| n.children.iter().filter(move |c| c.name == step))
            .collect();
    }
    level
}

/// Text at the end of a path, or `None` when missing or empty.
pub fn text(node: Option<&XmlNode>, path: &str) -> Option<String> {
    find(node, path)
        .map(|n| n.text.as_str())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}
