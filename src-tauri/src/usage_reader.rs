use std::{
    io::Write,
    process::{Command, Stdio},
};

use serde::Deserialize;

const READER_SCRIPT: &str = include_str!("../scripts/read-usage.applescript");
const RUNNER_SCRIPT: &str = include_str!("../scripts/runner.js");
const POLL_SCRIPT: &str = include_str!("../scripts/poll.js");
const CODEX_SCRIPT: &str = include_str!("../scripts/codex.js");
const CLAUDE_SCRIPT: &str = include_str!("../scripts/claude.js");

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Claude,
}

struct ProviderPage {
    url_prefix: &'static str,
    start_url: &'static str,
    script: &'static str,
}

impl Provider {
    fn page(self) -> ProviderPage {
        match self {
            Provider::Codex => ProviderPage {
                url_prefix: "https://chatgpt.com/",
                start_url: "https://chatgpt.com/",
                script: CODEX_SCRIPT,
            },
            Provider::Claude => ProviderPage {
                url_prefix: "https://claude.ai/",
                start_url: "https://claude.ai/",
                script: CLAUDE_SCRIPT,
            },
        }
    }
}

/// Runs the bundled AppleScript against Chrome and returns its JSON output unparsed.
/// Only these fixed scripts are executed; the UI chooses the provider, never the code.
pub fn read(provider: Provider, open_if_missing: bool) -> Result<String, String> {
    let page = provider.page();
    let start_script = format!("(() => {{\n{}\n{}\n}})()", page.script, RUNNER_SCRIPT);
    let open_mode = if open_if_missing { "open" } else { "existing" };

    let mut child = Command::new("/usr/bin/osascript")
        .arg("-")
        .args([page.url_prefix, page.start_url, &start_script, POLL_SCRIPT, open_mode])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    // Dropping stdin after writing lets osascript start executing.
    child
        .stdin
        .take()
        .ok_or("osascript stdin is unavailable")?
        .write_all(READER_SCRIPT.as_bytes())
        .map_err(|error| error.to_string())?;

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
