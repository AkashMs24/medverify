# MedVerify - Medical Certificate Authenticator

> 🏆 Ideathon 2nd Prize Winner — AI-powered medical certificate fraud detection

![MedVerify](https://img.shields.io/badge/MedVerify-v2.0-00d084)
![Gemini](https://img.shields.io/badge/AI-Gemini%201.5%20Flash-blue)
![React](https://img.shields.io/badge/Frontend-React%2018-61dafb)
![Node](https://img.shields.io/badge/Backend-Node.js%2018-green)

## Features

- 🔐 **JWT Authentication** — Multi-user login (admin, faculty, doctor roles)
- 📄 **OCR + AI Extraction** — Extracts doctor, hospital, patient, diagnosis, dates from any certificate image
- ✅ **12-Point Rule Validation** — Doctor registration, date logic, hospital legitimacy, phone format, etc.
- 🤖 **Gemini AI Deep Analysis** — Detects template design, grammatical errors, role conflicts, fake signatures
- 📊 **Authenticity Score** — 0-100 score with HIGH/MEDIUM/LOW risk classification
- 📋 **Audit Log** — Full history of all analyses
- 📤 **Export Reports** — Download JSON report

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/yourusername/medverify.git
cd medverify
npm run install:all
```

### 2. Configure Gemini API Key
```bash
cd backend
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

Get a **free** Gemini API key at: https://aistudio.google.com/app/apikey

### 3. Run Development
```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend  
cd frontend && npm start
```

Open http://localhost:3000

### Demo Accounts
| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Administrator |
| prof.sharma | sharma123 | Faculty |
| dr.mehta | mehta123 | Doctor |

## Deploy to Render (Free)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your repo
4. Render auto-detects `render.yaml`
5. Add `GEMINI_API_KEY` in Environment Variables
6. Deploy!

## Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project
3. Deploy from GitHub repo
4. Add `GEMINI_API_KEY` environment variable
5. Done!

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router, react-dropzone |
| Backend | Node.js, Express, Multer |
| AI | Google Gemini 1.5 Flash (free tier) |
| Auth | JWT + bcrypt |
| Styling | Custom CSS (dark theme) |

## How It Works

1. **Upload** — Drag & drop a medical certificate (JPG, PNG, PDF)
2. **OCR** — Gemini AI reads and extracts all fields
3. **Rule Check** — 12 deterministic rules validate the certificate
4. **AI Analysis** — Gemini analyzes for fraud indicators
5. **Score** — Get an authenticity score with detailed findings

## Project Structure

```
medverify/
├── frontend/          # React app
│   └── src/
│       ├── pages/     # Login, Dashboard, Result, Audit
│       └── components/ # Layout/Navbar
├── backend/           # Express API
│   └── src/
│       └── server.js  # All API routes
├── render.yaml        # Render deployment
└── railway.toml       # Railway deployment
```

---
Made with ❤️ for Ideathon • MedVerify v2.0
