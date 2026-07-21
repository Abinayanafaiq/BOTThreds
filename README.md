# Repliz Threads Auto-Post Bot

Bot auto post **Threads** via [Repliz API](https://api.repliz.com) — caption dari **OpenRouter AI** atau **template**, gambar & topik bebas di-set.

## Setup

```bash
cd C:\Repliz
copy .env.example .env
npm install
```

Isi `.env`:

| Key | Keterangan |
|-----|------------|
| `REPLIZ_ACCESS_KEY` | Access key Repliz |
| `REPLIZ_SECRET_KEY` | Secret key Repliz |
| `REPLIZ_ACCOUNT_ID` | Account ID Threads di Repliz |
| `OPENROUTER_API_KEY` | (opsional) untuk mode AI |
| `OPENROUTER_MODEL` | default `openai/gpt-4o-mini` |

## Atur sesuka hati — `config.json`

| Field | Fungsi |
|-------|--------|
| `contentMode` | `"ai"` atau `"template"` |
| `topics` + `topicMode` | daftar topik; `random` / `sequential` / `first` |
| `images` + `imageMode` | URL gambar; `random` / `sequential` / `all` (album) |
| `template.name` | nama pack di `templates.json` |
| `cta`, `productDetail` | dipakai di template & prompt AI |
| `ai.systemPrompt` / `userPromptTemplate` | custom prompt AI |
| `schedule.enabled` + `cron` | auto post berkala |
| `queue` | antrian post manual |

### Contoh `config.json` (ringkas)

```json
{
  "contentMode": "ai",
  "cta": "DM 'AI' buat demo",
  "productDetail": "Jasa setup AI chatbot + auto post",
  "topics": ["AI untuk UMKM", "Chatbot WA"],
  "topicMode": "random",
  "images": [
    "https://storage.repliz.com/promo1.png",
    "https://storage.repliz.com/promo2.png"
  ],
  "imageMode": "random",
  "template": { "name": "promo-ai", "variant": "random" },
  "schedule": {
    "enabled": true,
    "cron": "0 9,15,20 * * *",
    "postsPerRun": 1
  }
}
```

## Commands

```bash
# 1 post (pakai config)
npm start -- post

# AI + topik custom + gambar custom
npm start -- post --mode ai --topic "Chatbot AI" --image https://cdn.example.com/a.png

# Template
npm start -- post --mode template

# Caption manual (text only)
npm start -- post --description "Promo flash sale!" --type text

# Jadwal waktu tertentu
npm start -- post --scheduleAt 2026-06-01T12:00:00.000Z

# Ubah setting
npm start -- set contentMode template
npm start -- set template.name soft-sell
npm start -- add-image https://cdn.example.com/b.png
npm start -- add-topic "Auto reply AI"

# Lihat setting
npm start -- list
npm start -- templates

# Queue
npm start -- add-queue --mode ai --topic "Promo AI"
npm start -- queue

# Cron loop (biarkan jalan)
npm start -- schedule
```

## Template (`templates.json`)

Placeholder: `{{topic}}`, `{{detail}}`, `{{cta}}`

```json
{
  "promo-ai": {
    "variants": [
      "🔥 {{detail}}\n\n{{cta}}",
      "Topik {{topic}}: {{detail}}\n\n{{cta}}"
    ]
  }
}
```

## Catatan API Repliz

- Auth: Basic (`AccessKey` / `SecretKey`)
- Endpoint: `POST https://api.repliz.com/public/schedule`
- Threads support: `text`, `image`, `album`, ...
- Field `topic` dipakai khusus Threads
- `scheduleAt` wajib (ISO 8601) — bot default +5 menit dari sekarang

## Tips jualan AI

1. Isi `productDetail` + `cta` yang jelas.
2. Upload gambar ke storage (Repliz / CDN) → taruh URL di `images`.
3. Mode `ai` untuk variasi caption; mode `template` untuk konsisten & hemat token.
4. Aktifkan `schedule` biar post 2–3x sehari otomatis.
