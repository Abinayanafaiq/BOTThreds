const { readFileSync, writeFileSync, existsSync } = require("fs");
const { resolve } = require("path");
const dotenv = require("dotenv");

const ROOT = resolve(__dirname, "..");

dotenv.config({ path: resolve(ROOT, ".env") });

const CONFIG_PATH = resolve(ROOT, "config.json");
const TEMPLATES_PATH = resolve(ROOT, "templates.json");

function loadEnv() {
  const required = ["REPLIZ_ACCESS_KEY", "REPLIZ_SECRET_KEY", "REPLIZ_ACCOUNT_ID"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}. Copy .env.example to .env`);
  }
  return {
    accessKey: process.env.REPLIZ_ACCESS_KEY,
    secretKey: process.env.REPLIZ_SECRET_KEY,
    accountId: process.env.REPLIZ_ACCOUNT_ID,
    openRouterKey: process.env.OPENROUTER_API_KEY || "",
    openRouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  };
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error("config.json not found");
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function loadTemplates() {
  if (!existsSync(TEMPLATES_PATH)) return {};
  return JSON.parse(readFileSync(TEMPLATES_PATH, "utf8"));
}

function saveTemplates(templates) {
  writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2) + "\n", "utf8");
}

module.exports = {
  loadEnv,
  loadConfig,
  saveConfig,
  loadTemplates,
  saveTemplates,
  ROOT,
  CONFIG_PATH,
  TEMPLATES_PATH,
};
