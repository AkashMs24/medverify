require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { runAllRules } = require('./rules');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'medverify_secret_key_2024';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Serve frontend
const frontendBuild = path.join(__dirname, '..', '..', 'frontend', 'build');
app.use(express.static(frontendBuild));

const users = [
  { id: '1', username: 'admin',       password: bcrypt.hashSync('admin123',   10), role: 'Administrator', level: 'Admin • System' },
  { id: '2', username: 'prof.sharma', password: bcrypt.hashSync('sharma123',  10), role: 'Professor',     level: 'Faculty • HR'   },
  { id: '3', username: 'dr.mehta',    password: bcrypt.hashSync('mehta123',   10), role: 'Dr. Mehta',     level: 'Doctor • Medical'},
];

const auditLog = [];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/gif','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs allowed'));
  }
});

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ─── LOGIN ───────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, level: user.level },
    JWT_SECRET, { expiresIn: '24h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, level: user.level } });
});

// ─── STEP 1: OCR — extract fields from image via Gemini ──────────────────────
async function extractWithGemini(fileBuffer, mimeType) {
  if (!GEMINI_API_KEY) return null;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `Extract all fields from this medical certificate. Respond ONLY with valid JSON, no markdown:
{
  "doctorName": "",
  "hospitalName": "",
  "patientName": "",
  "diagnosis": "",
  "issueDate": "",
  "leaveFrom": "",
  "leaveTo": "",
  "phone": "",
  "referenceNumber": "",
  "signatureSealPresent": "Yes/No",
  "address": "",
  "doctorQualifications": "",
  "registrationNumber": ""
}`;
    const result = await model.generateContent([
      { inlineData: { mimeType, data: fileBuffer.toString('base64') } },
      prompt
    ]);
    const text = result.response.text().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    try { return JSON.parse(text); }
    catch { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  } catch (e) {
    console.error('OCR failed:', e.message);
    return null;
  }
}

// ─── STEP 2: AI OBSERVATIONS — deep fraud analysis via Gemini ────────────────
async function getAiObservations(extractedInfo, fileBuffer, mimeType) {
  if (!GEMINI_API_KEY) return null;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are a medical certificate fraud expert. Given this extracted info:
${JSON.stringify(extractedInfo, null, 2)}

Look at the certificate image and give 5 specific fraud observations about:
- Template/Canva design indicators
- Grammatical errors or contradictions  
- Role conflicts (patient listed as doctor etc.)
- Signature authenticity (digital overlays, cloned stamps)
- Any other red flags

Respond ONLY with a JSON array of 5 strings. No markdown:
["observation 1", "observation 2", "observation 3", "observation 4", "observation 5"]`;

    const result = await model.generateContent([
      { inlineData: { mimeType, data: fileBuffer.toString('base64') } },
      prompt
    ]);
    const text = result.response.text().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    try { return JSON.parse(text); }
    catch { const m = text.match(/\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : null; }
  } catch (e) {
    console.error('AI observations failed:', e.message);
    return null;
  }
}

// ─── ANALYZE ─────────────────────────────────────────────────────────────────
app.post('/api/analyze', authMiddleware, upload.single('certificate'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const analysisId = uuidv4();
  const startTime  = Date.now();
  const mimeType   = req.file.mimetype;
  const fileBuffer = req.file.buffer;

  // ── STEP 1: OCR (Gemini) ──────────────────────────────────────────────────
  let extractedInfo = await extractWithGemini(fileBuffer, mimeType);
  let ocrAvailable  = extractedInfo !== null;

  // If Gemini OCR failed, use empty shell so rules still run
  if (!extractedInfo) {
    extractedInfo = {
      doctorName: '', hospitalName: '', patientName: '', diagnosis: '',
      issueDate: '', leaveFrom: '', leaveTo: '', phone: '',
      referenceNumber: '', signatureSealPresent: 'No',
      address: '', doctorQualifications: '', registrationNumber: ''
    };
  }

  // ── STEP 2: RULE ENGINE (pure JS — always runs) ───────────────────────────
  const { checks, passed, failed, ruleScore } = runAllRules(extractedInfo);

  // ── STEP 3: AI OBSERVATIONS (Gemini) ─────────────────────────────────────
  let aiObservations = await getAiObservations(extractedInfo, fileBuffer, mimeType);
  let aiAvailable    = aiObservations !== null;

  if (!aiObservations) {
    aiObservations = [
      'AI analysis unavailable — Gemini API not reachable. Rule-based checks have been applied.',
      `${passed} out of 12 rule checks passed based on extracted certificate data.`,
      'Connect Gemini API for deep fraud observations including template detection and grammar analysis.',
      'The rule engine independently verified dates, phone format, leave duration, and field completeness.',
      'Manual review recommended when AI analysis is unavailable.'
    ];
  }

  // ── STEP 4: COMBINED SCORE ────────────────────────────────────────────────
  // If AI available: 40% rule score + 60% AI score
  // If AI unavailable: 100% rule score
  let authenticityScore;
  let aiScore = 0;

  if (aiAvailable) {
    // Estimate AI score from observations (negative language = lower score)
    const negativeWords = ['fraudulent','suspicious','conflict','error','fake','template','identical','invalid','missing','generic'];
    const negCount = aiObservations.join(' ').toLowerCase().split(/\s+/)
      .filter(w => negativeWords.some(n => w.includes(n))).length;
    aiScore = Math.max(0, 100 - (negCount * 8));
    authenticityScore = Math.round((ruleScore * 0.4) + (aiScore * 0.6));
  } else {
    authenticityScore = ruleScore;
  }

  // Risk level
  const riskLevel = authenticityScore >= 70 ? 'LOW_RISK'
                  : authenticityScore >= 40 ? 'MEDIUM_RISK'
                  : 'HIGH_RISK';

  const verdict = !ocrAvailable
    ? `Rule-only analysis (AI unavailable): ${passed}/12 checks passed. Score based on rule engine only.`
    : riskLevel === 'HIGH_RISK'
    ? `Likely fraudulent: ${failed} critical checks failed with suspicious AI observations.`
    : riskLevel === 'MEDIUM_RISK'
    ? `Uncertain authenticity: some checks failed. Manual review recommended.`
    : `Appears legitimate: ${passed}/12 checks passed with no major red flags.`;

  // Audit log
  auditLog.unshift({
    id: analysisId,
    timestamp: new Date().toISOString(),
    user: req.user.username,
    filename: req.file.originalname,
    score: authenticityScore,
    riskLevel,
    passed,
    failed
  });

  res.json({
    analysisId,
    timestamp: new Date().toISOString(),
    processingTime: Date.now() - startTime,
    filename: req.file.originalname,
    fileSize: req.file.size,
    ocrAvailable,
    aiAvailable,
    extractedInfo,
    validationChecks: checks,
    aiObservations,
    authenticityScore,
    riskLevel,
    verdict,
    passedCount: passed,
    failedCount: failed,
    rawResponse: `OCR: ${ocrAvailable ? 'OK' : 'FAILED'} | Rules: ${passed}/${checks.length} passed | AI: ${aiAvailable ? 'OK' : 'FAILED'} | Score: ${authenticityScore}`
  });
});

// ─── AUDIT & HEALTH ───────────────────────────────────────────────────────────
app.get('/api/audit',  authMiddleware, (req, res) => res.json(auditLog));
app.get('/api/health', (req, res) => res.json({
  status: 'ok', version: '2.0',
  geminiConfigured: !!GEMINI_API_KEY,
  architecture: 'hybrid: OCR(Gemini) + Rules(JS) + AI(Gemini)'
}));

// Catch-all → React
app.get('*', (req, res) => res.sendFile(path.join(frontendBuild, 'index.html')));

app.listen(PORT, () => {
  console.log(`✅ MedVerify v2.0 running on port ${PORT}`);
  console.log(`🤖 Gemini: ${GEMINI_API_KEY ? 'Configured ✓' : 'NOT set → rule-only mode'}`);
  console.log(`⚙️  Architecture: OCR(Gemini) + Rules(JS) + AI(Gemini)`);
});
