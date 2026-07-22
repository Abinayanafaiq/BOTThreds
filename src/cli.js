#!/usr/bin/env node
import { createPost, processQueue, listSettings, updateSettings } from "./bot.js";
import { startScheduler } from "./scheduler.js";
import { loadConfig, saveConfig, loadTemplates, saveTemplates } from "./config.js";

const [,, cmd, ...rest] = process.argv;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function printHelp() {
  console.log(`
Repliz Threads Auto-Post Bot

Usage:
  npm start -- <command> [options]

Commands:
  post              Buat 1 post (AI / template / manual)
  schedule          Jalankan cron dari config.json (loop)
  queue             Proses item di config.queue
  list              Lihat pengaturan aktif
  set <key> <val>   Ubah config (dot path), contoh: set contentMode ai
  add-image <url>   Tambah URL gambar
  add-topic <text>  Tambah topik
  add-queue         Tambah job ke queue (pakai flags)
  templates         List template
  help

Flags (post / add-queue):
  --mode ai|template|manual
  --topic "teks topik"
  --description "caption manual"
  --image "https://...png"   (bisa diulang / dipisah koma)
  --type image|text|album
  --scheduleAt 2026-06-01T12:00:00.000Z
  --cta "DM AI"
  --detail "deskripsi produk"
  --draft
  --dry-run   (queue only)

Examples:
  npm start -- post --mode ai --topic "Chatbot AI"
  npm start -- post --mode template --image https://cdn.example.com/a.png
  npm start -- post --description "Promo hari ini!" --type text
  npm start -- set contentMode template
  npm start -- set template.name soft-sell
  npm start -- schedule
`);
}

function parseImages(flags) {
  const raw = [];
  if (flags.image) raw.push(flags.image);
  if (flags.images) raw.push(flags.images);
  // support multiple --image by scanning process.argv is limited; allow comma
  return raw
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  try {
    switch (cmd) {
      case "post": {
        const { flags } = parseFlags(rest);
        const images = parseImages(flags);
        const res = await createPost({
          mode: flags.mode,
          topic: flags.topic,
          description: flags.description,
          images: images.length ? images : undefined,
          type: flags.type,
          scheduleAt: flags.scheduleAt,
          cta: flags.cta,
          detail: flags.detail,
          isDraft: Boolean(flags.draft),
        });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "queue": {
        const { flags } = parseFlags(rest);
        const res = await processQueue({
          limit: flags.limit ? Number(flags.limit) : Infinity,
          dryRun: Boolean(flags["dry-run"]),
        });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "schedule": {
        const task = startScheduler();
        if (!task) {
          console.error("Scheduler tidak start (enabled=false?). Cek config.json schedule.enabled");
          process.exit(1);
        }
        console.log("Bot running. Ctrl+C to stop.");
        console.log("Debug: set LOG_LEVEL=debug untuk log lebih detail.");
        console.log("Debug: set schedule.runOnStart=true untuk fire segera saat start.");
        console.log("Debug: heartbeat tiap schedule.heartbeatMinutes (default 5).");
        // keep alive
        await new Promise(() => {});
        break;
      }
      case "list": {
        console.log(JSON.stringify(listSettings(), null, 2));
        break;
      }
      case "set": {
        const [path, ...valueParts] = rest;
        if (!path || !valueParts.length) {
          console.error("Usage: set <dot.path> <value>");
          process.exit(1);
        }
        let value = valueParts.join(" ");
        if (value === "true") value = true;
        else if (value === "false") value = false;
        else if (value === "null") value = null;
        else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
        else if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
          value = JSON.parse(value);
        }
        const patch = {};
        const keys = path.split(".");
        let cur = patch;
        for (let i = 0; i < keys.length - 1; i++) {
          cur[keys[i]] = {};
          cur = cur[keys[i]];
        }
        cur[keys[keys.length - 1]] = value;
        const next = updateSettings(patch);
        console.log("Updated:", path, "=", value);
        console.log(JSON.stringify(listSettings(), null, 2));
        break;
      }
      case "add-image": {
        const url = rest[0];
        if (!url) throw new Error("Usage: add-image <url>");
        const config = loadConfig();
        config.images = config.images || [];
        config.images.push(url);
        saveConfig(config);
        console.log("Images:", config.images);
        break;
      }
      case "add-topic": {
        const topic = rest.join(" ");
        if (!topic) throw new Error("Usage: add-topic <text>");
        const config = loadConfig();
        config.topics = config.topics || [];
        config.topics.push(topic);
        saveConfig(config);
        console.log("Topics:", config.topics);
        break;
      }
      case "add-queue": {
        const { flags } = parseFlags(rest);
        const config = loadConfig();
        const job = {
          mode: flags.mode,
          topic: flags.topic,
          description: flags.description,
          images: parseImages(flags).length ? parseImages(flags) : undefined,
          type: flags.type,
          scheduleAt: flags.scheduleAt,
          cta: flags.cta,
          detail: flags.detail,
        };
        Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);
        config.queue = config.queue || [];
        config.queue.push(job);
        saveConfig(config);
        console.log("Queue length:", config.queue.length);
        console.log(JSON.stringify(job, null, 2));
        break;
      }
      case "templates": {
        console.log(JSON.stringify(loadTemplates(), null, 2));
        break;
      }
      case "help":
      case undefined:
        printHelp();
        break;
      default:
        console.error("Unknown command:", cmd);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();
