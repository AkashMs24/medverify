# 🏥 MedVerify — Medical Certificate Authenticator

<div align="center">

**🔗 Live Demo → [medverify-nws7.onrender.com](https://medverify-nws7.onrender.com/)**

![MedVerify](https://img.shields.io/badge/MedVerify-v2.0-00d084)
![Gemini](https://img.shields.io/badge/AI-Gemini%201.5%20Flash-blue)
![React](https://img.shields.io/badge/Frontend-React%2018-61dafb)
![Node](https://img.shields.io/badge/Backend-Node.js%2018-green)

> 🏆 **Ideathon 2nd Prize Winner** — AI-powered medical certificate fraud detection

</div>

---

## ✨ Features

- 🔐 **JWT Authentication** — Multi-user login with Admin, Faculty, and Doctor roles
- 📄 **OCR + AI Extraction** — Extracts doctor, hospital, patient, diagnosis, dates from any certificate image
- ✅ **12-Point Rule Validation** — Doctor registration, date logic, hospital legitimacy, phone format, and more
- 🤖 **Gemini AI Deep Analysis** — Detects template design, grammatical errors, role conflicts, fake signatures
- 📊 **Authenticity Score** — 0–100 score with HIGH / MEDIUM / LOW risk classification
- 📋 **Audit Log** — Full history of all analyses with user attribution
- 📤 **Export Reports** — Download full JSON analysis report

---

## 🚀 Quick Start

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
# Add your GEMINI_API_KEY to .env
```

Get a **free** Gemini API key at: https://aistudio.google.com/app/apikey

### 3. Run in Development
```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm start
```

Open http://localhost:3000

### Demo Accounts
| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Administrator |
| prof.sharma | sharma123 | Faculty |
| dr.mehta | mehta123 | Doctor |

---

## 🧠 How It Works

1. **Upload** — Drag & drop a medical certificate (JPG, PNG, PDF)
2. **OCR** — Gemini AI reads and extracts all fields from the document
3. **Rule Check** — 12 deterministic rules validate the certificate
4. **AI Analysis** — Gemini analyzes for fraud indicators (templates, grammatical errors, role conflicts)
5. **Score** — Get an authenticity score with detailed findings

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router, react-dropzone |
| Backend | Node.js, Express, Multer |
| AI | Google Gemini 1.5 Flash (free tier) |
| Auth | JWT + bcrypt |
| Styling | Custom CSS (dark theme) |

---

## 📁 Project Structure

```
medverify/
├── frontend/          # React app
│   └── src/
│       ├── pages/     # Login, Dashboard, Result, Audit
│       └── components/ # Layout/Navbar
├── backend/           # Express API
│   └── src/
│       └── server.js
             rule.js
  # All API routes + Gemini integration
├── render.yaml        # Render deployment config
└── railway.toml       # Railway deployment config
```

---

## ☁️ Deploy to Render (Free)

1. Push your repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Render auto-detects `render.yaml`
5. Add `GEMINI_API_KEY` in **Environment Variables**
6. Deploy!

## ☁️ Deploy to Railway

1. Push your repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project**
3. Select **Deploy from GitHub repo**
4. Add `GEMINI_API_KEY` as an environment variable
5. Done!

---

## 📱 Responsive Design

MedVerify is **primarily optimized for desktop browsers**. The dashboard, result cards, and audit log are best experienced on a screen ≥ 768px wide. Key pages (Dashboard, Result) include basic responsive breakpoints at `640px` so they reflow to a single-column layout on narrower viewports — meaning it is usable on mobile but not pixel-perfect. For the best experience, use a laptop or desktop browser.

---

## 🔒 Demo Mode

If no `GEMINI_API_KEY` is set, the app runs in **demo mode** — returning mock analysis results so you can explore the full UI without an API key.

---

<div align="center">

Made with ❤️ for Ideathon &nbsp;•&nbsp; MedVerify v2.0

</div>
