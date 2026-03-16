use crate::event_logger::aigentguard_dir;
use crate::models::Config;
use anyhow::{Context, Result};
use std::fs;

pub fn load_config() -> Result<Config> {
    let path = aigentguard_dir()?.join("config.json");
    if !path.exists() {
        return Ok(Config::default());
    }
    let data = fs::read_to_string(&path).context("Failed to read config.json")?;
    let config: Config = serde_json::from_str(&data).context("Failed to parse config.json")?;
    Ok(config)
}

pub fn save_config(config: &Config) -> Result<()> {
    let dir = aigentguard_dir()?;
    fs::create_dir_all(&dir).context("Failed to create ~/.aigentguard directory")?;
    let path = dir.join("config.json");
    let data = serde_json::to_string_pretty(config).context("Failed to serialize config")?;
    fs::write(&path, data).context("Failed to write config.json")?;
    Ok(())
}
