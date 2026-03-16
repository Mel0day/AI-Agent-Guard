use crate::models::{Event, EventFilter};
use anyhow::{Context, Result};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;

const RING_BUFFER_SIZE: usize = 100;
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_QUERY_SIZE: usize = 1000;

pub struct EventLogger {
    log_path: PathBuf,
    ring_buffer: Mutex<VecDeque<Event>>,
}

impl EventLogger {
    /// Create a new EventLogger, ensuring the log directory and file exist
    pub fn new() -> Result<Self> {
        let dir = aigentguard_dir()?;
        fs::create_dir_all(&dir).context("Failed to create ~/.aigentguard directory")?;
        let log_path = dir.join("events.jsonl");

        let logger = EventLogger {
            log_path,
            ring_buffer: Mutex::new(VecDeque::with_capacity(RING_BUFFER_SIZE + 1)),
        };

        // Pre-populate ring buffer from existing log
        logger.load_recent_into_buffer()?;

        Ok(logger)
    }

    /// Append an event to the JSONL file and update the in-memory ring buffer
    pub fn append(&self, event: &Event) -> Result<()> {
        // Check if rotation is needed
        self.maybe_rotate()?;

        let line = serde_json::to_string(event).context("Failed to serialize event")?;

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .context("Failed to open events.jsonl for appending")?;

        writeln!(file, "{}", line).context("Failed to write event to log")?;

        // Update ring buffer
        let mut buf = self.ring_buffer.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?;
        buf.push_back(event.clone());
        while buf.len() > RING_BUFFER_SIZE {
            buf.pop_front();
        }

        Ok(())
    }

    /// Get the most recent n events from the ring buffer (fast path)
    pub fn get_recent(&self, n: usize) -> Result<Vec<Event>> {
        let buf = self.ring_buffer.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?;
        let take = n.min(buf.len());
        let events: Vec<Event> = buf.iter().rev().take(take).cloned().collect();
        Ok(events)
    }

    /// Query events with filter, reading from file if needed for large offsets
    pub fn query(&self, filter: &EventFilter) -> Result<Vec<Event>> {
        let limit = filter.limit.unwrap_or(100).min(MAX_QUERY_SIZE);
        let offset = filter.offset.unwrap_or(0);

        // If offset is within ring buffer range, use it
        if offset < RING_BUFFER_SIZE {
            let buf = self.ring_buffer.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?;
            let all: Vec<Event> = buf.iter().rev().cloned().collect();
            drop(buf);

            let filtered: Vec<Event> = all
                .into_iter()
                .filter(|e| matches_filter(e, filter))
                .skip(offset)
                .take(limit)
                .collect();

            if !filtered.is_empty() || offset < RING_BUFFER_SIZE {
                return Ok(filtered);
            }
        }

        // Fall back to reading from file (for deep history)
        self.query_from_file(filter, limit, offset)
    }

    fn query_from_file(&self, filter: &EventFilter, limit: usize, offset: usize) -> Result<Vec<Event>> {
        if !self.log_path.exists() {
            return Ok(Vec::new());
        }

        let file = File::open(&self.log_path).context("Failed to open events.jsonl for reading")?;
        let reader = BufReader::new(file);

        let mut all_events: Vec<Event> = Vec::new();
        for line in reader.lines() {
            let line = match line {
                Ok(l) if l.trim().is_empty() => continue,
                Ok(l) => l,
                Err(_) => continue,
            };
            if let Ok(event) = serde_json::from_str::<Event>(&line) {
                all_events.push(event);
            }
        }

        // Most recent first
        all_events.reverse();

        let result: Vec<Event> = all_events
            .into_iter()
            .filter(|e| matches_filter(e, filter))
            .skip(offset)
            .take(limit)
            .collect();

        Ok(result)
    }

    fn load_recent_into_buffer(&self) -> Result<()> {
        if !self.log_path.exists() {
            return Ok(());
        }

        let file = match File::open(&self.log_path) {
            Ok(f) => f,
            Err(_) => return Ok(()),
        };
        let reader = BufReader::new(file);

        let mut all_lines: Vec<String> = reader
            .lines()
            .filter_map(|l| l.ok())
            .filter(|l| !l.trim().is_empty())
            .collect();

        // Keep only last RING_BUFFER_SIZE lines
        if all_lines.len() > RING_BUFFER_SIZE {
            all_lines = all_lines.split_off(all_lines.len() - RING_BUFFER_SIZE);
        }

        let mut buf = self.ring_buffer.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?;
        for line in all_lines {
            if let Ok(event) = serde_json::from_str::<Event>(&line) {
                buf.push_back(event);
            }
        }

        Ok(())
    }

    fn maybe_rotate(&self) -> Result<()> {
        if !self.log_path.exists() {
            return Ok(());
        }

        let metadata = match fs::metadata(&self.log_path) {
            Ok(m) => m,
            Err(_) => return Ok(()),
        };

        if metadata.len() >= MAX_FILE_SIZE {
            let rotated = self.log_path.with_extension("jsonl.1");
            // Remove old rotated file if it exists
            if rotated.exists() {
                let _ = fs::remove_file(&rotated);
            }
            fs::rename(&self.log_path, &rotated).context("Failed to rotate log file")?;
        }

        Ok(())
    }
}

fn matches_filter(event: &Event, filter: &EventFilter) -> bool {
    if let Some(ref level) = filter.risk_level {
        if &event.risk_level != level {
            return false;
        }
    }

    if let Some(ref search) = filter.search {
        let search_lower = search.to_lowercase();
        let tool_match = event.tool_name.to_lowercase().contains(&search_lower);
        let reason_match = event.reason.to_lowercase().contains(&search_lower);
        let input_match = event.tool_input.to_string().to_lowercase().contains(&search_lower);
        let rule_match = event
            .rule_name
            .as_deref()
            .map(|n| n.to_lowercase().contains(&search_lower))
            .unwrap_or(false);

        if !tool_match && !reason_match && !input_match && !rule_match {
            return false;
        }
    }

    true
}

/// Return the path to the ~/.aigentguard directory
pub fn aigentguard_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Cannot determine home directory")?;
    Ok(home.join(".aigentguard"))
}
