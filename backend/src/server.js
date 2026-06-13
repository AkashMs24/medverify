require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'medverify_secret_key_2024';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Serve frontend FIRST before API routes
const frontendBuild = path.join(__dirname, '..', '..', 'frontend', 'build');
app.use(express.static(frontendBuild));
console.log('Serving frontend from:', frontendBuild);

const users = [
  { id: '1', username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'Administrator', level: 'Admin • System' },
  { id: '2', username: 'prof.sharma', password: bcrypt.hashSync('sharma123', 10), role: 'Professor', level: 'Faculty • HR' },
  { id: '3', username: 'dr.mehta', password: bcrypt.hashSync('mehta123', 10), role: 'Dr. Mehta', level: 'Doctor • Medical' },
];

const auditLog = [];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs allowed'));
  }
});

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// API ROUTES
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, level: user.level },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, level: user.level } });
});

app.post('/api/analyze', authMiddleware, upload.single('certificate'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const analysisId = uuidv4();
  const startTime = Date.now();

  try {
    if (!GEMINI_API_KEY) {
      const demo = getMockAnalysis(analysisId, req.file.originalname, req.file.size);
      auditLog.unshift({ id: analysisId, timestamp: new Date().toISOString(), user: req.user.username, filename: req.file.originalname, score: demo.authenticityScore, riskLevel: demo.riskLevel, passed: demo.passedCount, failed: demo.failedCount });
      return res.json(demo);
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const imageData = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    const prompt = `You are a medical certificate fraud detection expert. Analyze this medical certificate thoroughly.

Respond ONLY with valid JSON (no markdown backticks) in this exact structure:
{
  "extractedInfo": {
    "doctorName": "","hospitalName": "","patientName": "","diagnosis": "",
    "issueDate": "","leaveFrom": "","leaveTo": "","phone": "",
    "referenceNumber": "","signatureSealPresent": "Yes/No",
    "address": "","doctorQualifications": "","registrationNumber": ""
  },
  "validationChecks": [
    {"id":"doctor_registration","name":"Doctor Registration Format","passed":true,"description":""},
    {"id":"issue_date_validity","name":"Issue Date Validity","passed":true,"description":""},
    {"id":"weekend_holiday","name":"Weekend/Holiday Issue","passed":true,"description":""},
    {"id":"required_fields","name":"Required Fields Complete","passed":true,"description":""},
    {"id":"date_logic","name":"Date Logic Valid","passed":true,"description":""},
    {"id":"leave_duration","name":"Leave Duration Reasonable","passed":true,"description":""},
    {"id":"medical_terminology","name":"Medical Terminology Valid","passed":true,"description":""},
    {"id":"hospital_legitimate","name":"Hospital Name Legitimate","passed":true,"description":""},
    {"id":"phone_format","name":"Phone Format Valid","passed":true,"description":""},
    {"id":"reference_number","name":"Reference Number Present","passed":true,"description":""},
    {"id":"signature_seal","name":"Signature/Seal Present","passed":true,"description":""},
    {"id":"diagnosis_duration","name":"Diagnosis Matches Duration","passed":true,"description":""}
  ],
  "aiObservations": ["obs1","obs2","obs3","obs4","obs5"],
  "authenticityScore": 75,
  "riskLevel": "LOW_RISK",
  "verdict": "Brief verdict"
}
riskLevel must be HIGH_RISK/MEDIUM_RISK/LOW_RISK exactly.`;

    const result = await model.generateContent([{ inlineData: { mimeType, data: imageData } }, prompt]);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let analysisResult;
    try { analysisResult = JSON.parse(cleanJson); }
    catch { const m = responseText.match(/\{[\s\S]*\}/); if (m) analysisResult = JSON.parse(m[0]); else throw new Error('Parse failed'); }

    const passedCount = analysisResult.validationChecks.filter(c => c.passed).length;
    const failedCount = analysisResult.validationChecks.filter(c => !c.passed).length;

    auditLog.unshift({ id: analysisId, timestamp: new Date().toISOString(), user: req.user.username, filename: req.file.originalname, score: analysisResult.authenticityScore, riskLevel: analysisResult.riskLevel, passed: passedCount, failed: failedCount });

    res.json({ analysisId, timestamp: new Date().toISOString(), processingTime: Date.now() - startTime, filename: req.file.originalname, fileSize: req.file.size, ...analysisResult, passedCount, failedCount, rawResponse: responseText });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

app.get('/api/audit', authMiddleware, (req, res) => res.json(auditLog));
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '2.0', geminiConfigured: !!GEMINI_API_KEY }));

// Catch all - serve React for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuild, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ MedVerify running on port ${PORT}`);
  console.log(`🤖 Gemini: ${GEMINI_API_KEY ? 'Configured ✓' : 'NOT set → demo mode'}`);
  console.log(`🌍 Mode: ${NODE_ENV}`);
});

function getMockAnalysis(analysisId, filename, fileSize) {
  return {
    analysisId, timestamp: new Date().toISOString(), processingTime: 1200, filename, fileSize,
    extractedInfo: { doctorName: "Dr. Sample Doctor", hospitalName: "Sample General Hospital", patientName: "John Doe", diagnosis: "Acute Respiratory Infection", issueDate: "June 10, 2024", leaveFrom: "June 10, 2024", leaveTo: "June 14, 2024", phone: "555-123-4567", referenceNumber: "REF-2024-001", signatureSealPresent: "Yes", address: "123 Medical Street", doctorQualifications: "MBBS, MD", registrationNumber: "MED-12345" },
    validationChecks: [
      { id: "doctor_registration", name: "Doctor Registration Format", passed: true, description: "Valid registration number present." },
      { id: "issue_date_validity", name: "Issue Date Validity", passed: true, description: "Date format is standard and consistent." },
      { id: "weekend_holiday", name: "Weekend/Holiday Issue", passed: true, description: "Issued on a standard business day." },
      { id: "required_fields", name: "Required Fields Complete", passed: false, description: "Missing official hospital stamp/seal." },
      { id: "date_logic", name: "Date Logic Valid", passed: true, description: "Timeline is logically consistent." },
      { id: "leave_duration", name: "Leave Duration Reasonable", passed: true, description: "4 days is reasonable for this diagnosis." },
      { id: "medical_terminology", name: "Medical Terminology Valid", passed: true, description: "Diagnosis uses valid medical terminology." },
      { id: "hospital_legitimate", name: "Hospital Name Legitimate", passed: true, description: "Hospital name matches address." },
      { id: "phone_format", name: "Phone Format Valid", passed: true, description: "Phone number follows standard format." },
      { id: "reference_number", name: "Reference Number Present", passed: true, description: "Reference number cited." },
      { id: "signature_seal", name: "Signature/Seal Present", passed: false, description: "Signature present but seal appears digital." },
      { id: "diagnosis_duration", name: "Diagnosis Matches Duration", passed: true, description: "Leave duration appropriate for diagnosis." }
    ],
    aiObservations: [
      "DEMO MODE: Add GEMINI_API_KEY to environment variables for real AI analysis.",
      "Real analysis detects template design, grammatical errors, and logical conflicts.",
      "Hospital address is cross-referenced against the hospital name in public records.",
      "Signature analysis detects digitally overlaid or cloned stamp artifacts.",
      "Role conflict detection flags cases where patient name appears as the doctor."
    ],
    authenticityScore: 72, riskLevel: "MEDIUM_RISK",
    verdict: "Demo mode — configure GEMINI_API_KEY for real fraud detection.",
    passedCount: 10, failedCount: 2,
    rawResponse: "Demo mode. Get free Gemini API key at https://aistudio.google.com/app/apikey"
  };
}
