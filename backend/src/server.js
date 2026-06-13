require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const { runAllRules, detectBlankTemplate } = require('./rules');

const app        = express();
const PORT       = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'medverify_secret_key_2024';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const NODE_ENV   = process.env.NODE_ENV || 'development';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const frontendBuild = path.join(__dirname, '..', '..', 'frontend', 'build');
app.use(express.static(frontendBuild));

const users = [
  { id: '1', username: 'admin',       password: bcrypt.hashSync('admin123',  10), role: 'Administrator', level: 'Admin • System'   },
  { id: '2', username: 'prof.sharma', password: bcrypt.hashSync('sharma123', 10), role: 'Professor',     level: 'Faculty • HR'     },
  { id: '3', username: 'dr.mehta',    password: bcrypt.hashSync('mehta123',  10), role: 'Dr. Mehta',     level: 'Doctor • Medical' },
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

// Batch upload: up to 10 files
const uploadBatch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/gif','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs allowed'));
  }
}).array('certificates', 10);

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ─── DETECT SUBMISSION TYPE ────────────────────────────────────────────────
function detectSubmissionType(fileBuffer, mimeType, filename) {
  const isPDF      = mimeType === 'application/pdf';
  const isImage    = mimeType.startsWith('image/');
  const isGIF      = mimeType === 'image/gif';
  const looksLikeScreenshot = filename && /screenshot|screen.shot|capture|snip/i.test(filename);

  if (isPDF) return 'pdf';
  if (isGIF) return 'gif_animation';
  if (looksLikeScreenshot) return 'screenshot';
  if (isImage) return 'scanned_image';
  return 'unknown';
}

// ─── PRC LICENSE VERIFICATION (Philippines) ─────────────────────────────────
// Checks format against PRC numbering rules.
// For live verification connect to: https://www.prc.gov.ph/
// (They don't have a public API — you'd need a scraper or official partnership)
function verifyPRCLicense(licenseNumber, doctorName) {
  if (!licenseNumber || licenseNumber.length < 4) {
    return { verified: false, method: 'format_check', note: 'License number too short or missing.' };
  }
  const isPRCFormat = /^\d{5,10}$/.test(licenseNumber.replace(/\s/g, ''));
  if (!isPRCFormat) {
    return { verified: false, method: 'format_check', note: `"${licenseNumber}" does not match PRC 7-digit format.` };
  }
  // Format passes — flag for manual verification since no public API exists
  return {
    verified: 'format_ok',
    method: 'format_check',
    licenseNumber,
    note: `License number ${licenseNumber} has valid PRC format. Manual verification at prc.gov.ph recommended.`,
    prcUrl: `https://www.prc.gov.ph/`
  };
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
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

// ─── STEP 1: OCR ──────────────────────────────────────────────────────────────
async function extractWithGemini(fileBuffer, mimeType) {
  if (!GEMINI_API_KEY) return null;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `Extract all fields from this medical certificate image carefully.
If a field is blank/empty in the document, return "" for that field.
If a field exists but you cannot read it clearly, return "unclear".
Respond ONLY with valid JSON, no markdown:
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
  "registrationNumber": "",
  "isFilledTemplate": "Yes/No",
  "documentType": "medical_certificate/clearance/prescription/other"
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

// ─── STEP 2: AI OBSERVATIONS ──────────────────────────────────────────────────
async function getAiObservations(extractedInfo, fileBuffer, mimeType, submissionType) {
  if (!GEMINI_API_KEY) return null;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are a medical certificate fraud detection expert.
Submission type: ${submissionType}
Extracted info: ${JSON.stringify(extractedInfo, null, 2)}

Analyze the certificate image carefully and give 5 specific fraud observations covering:
1. Whether this is a blank/unfilled template vs a completed certificate
2. Template/Canva design indicators or non-standard formatting
3. Signature authenticity — wet ink vs digital overlay vs absent
4. Logical conflicts — role conflicts, date issues, address mismatches
5. Overall fraud risk assessment

IMPORTANT: If this is a blank template, say so clearly in observation 1.
Respond ONLY with a JSON array of exactly 5 strings. No markdown:
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

// ─── CORE ANALYSIS FUNCTION (reused by single + batch) ───────────────────────
async function analyzeOneCertificate(fileBuffer, mimeType, originalname, fileSize, username) {
  const analysisId    = uuidv4();
  const startTime     = Date.now();
  const submissionType = detectSubmissionType(fileBuffer, mimeType, originalname);

  // STEP 1: OCR
  let extractedInfo = await extractWithGemini(fileBuffer, mimeType);
  const ocrAvailable = extractedInfo !== null;
  if (!extractedInfo) {
    extractedInfo = {
      doctorName:'', hospitalName:'', patientName:'', diagnosis:'',
      issueDate:'', leaveFrom:'', leaveTo:'', phone:'',
      referenceNumber:'', signatureSealPresent:'No',
      address:'', doctorQualifications:'', registrationNumber:'',
      isFilledTemplate:'No', documentType:'unknown'
    };
  }

  // STEP 2: BLANK TEMPLATE CHECK
  const { isBlankTemplate, blankCoreFields, blankRatio } = detectBlankTemplate(extractedInfo);
  const isExplicitlyUnfilled = extractedInfo.isFilledTemplate === 'No';

  if (isBlankTemplate || isExplicitlyUnfilled) {
    const result = {
      analysisId,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      filename: originalname,
      fileSize,
      submissionType,
      isBlankTemplate: true,
      templateWarning: `This is an unfilled official template — ${blankRatio}% of fields are empty. Please upload a completed certificate with patient details filled in.`,
      ocrAvailable,
      aiAvailable: false,
      extractedInfo,
      validationChecks: [],
      aiObservations: [
        'This document is an official blank template — it has not been filled out with patient-specific information.',
        `${blankCoreFields.length} core fields are empty: ${blankCoreFields.join(', ')}.`,
        'A blank template cannot be fraudulent or authentic — it is simply incomplete.',
        'Please upload a completed certificate with patient name, date of issue, diagnosis, and doctor signature.',
        'Score has been set to N/A as authenticity cannot be assessed on an empty template.'
      ],
      authenticityScore: null,
      riskLevel: 'TEMPLATE_DETECTED',
      verdict: 'This is a blank unfilled template — authenticity cannot be assessed. Please upload a completed certificate.',
      passedCount: 0,
      failedCount: 0,
      confidenceMap: {},
      prcVerification: null,
      rawResponse: `TEMPLATE DETECTED: ${blankRatio}% fields blank`
    };
    auditLog.unshift({
      id: analysisId, timestamp: new Date().toISOString(),
      user: username, filename: originalname,
      score: 'N/A', riskLevel: 'TEMPLATE_DETECTED', passed: 0, failed: 0
    });
    return result;
  }

  // STEP 3: RULE ENGINE
  const { checks, passed, failed, ruleScore, confidenceMap } = runAllRules(extractedInfo);

  // STEP 4: PRC LICENSE VERIFICATION
  const prcVerification = verifyPRCLicense(
    extractedInfo.registrationNumber,
    extractedInfo.doctorName
  );

  // STEP 5: AI OBSERVATIONS
  let aiObservations = await getAiObservations(extractedInfo, fileBuffer, mimeType, submissionType);
  const aiAvailable  = aiObservations !== null;
  if (!aiObservations) {
    aiObservations = [
      'AI analysis unavailable — Gemini API not configured. Rule-based checks applied only.',
      `${passed} of 12 rule checks passed based on extracted certificate data.`,
      'Add GEMINI_API_KEY to enable deep fraud analysis including template and signature detection.',
      'The rule engine independently verified dates, phone format, leave duration, and field completeness.',
      'Manual review recommended when AI analysis is unavailable.'
    ];
  }

  // STEP 6: COMBINED SCORE
  let authenticityScore;
  if (aiAvailable) {
    const negativeWords = ['fraudulent','suspicious','conflict','error','fake','template','invalid','missing','generic','absent','blank','unclear','forged','fabricated'];
    const negCount = aiObservations.join(' ').toLowerCase().split(/\s+/)
      .filter(w => negativeWords.some(n => w.includes(n))).length;
    const aiScore = Math.max(0, 100 - (negCount * 7));
    authenticityScore = Math.round((ruleScore * 0.5) + (aiScore * 0.5));
  } else {
    authenticityScore = ruleScore;
  }

  // Submission type penalty
  if (submissionType === 'screenshot') authenticityScore = Math.max(0, authenticityScore - 5);

  // PRC format bonus
  if (prcVerification.verified === 'format_ok') authenticityScore = Math.min(100, authenticityScore + 5);

  const riskLevel = authenticityScore >= 70 ? 'LOW_RISK'
                  : authenticityScore >= 40 ? 'MEDIUM_RISK'
                  : 'HIGH_RISK';

  const verdict = riskLevel === 'HIGH_RISK'
    ? `Likely fraudulent: ${failed} critical checks failed.`
    : riskLevel === 'MEDIUM_RISK'
    ? `Uncertain authenticity: ${failed} checks failed. Manual review recommended.`
    : `Appears legitimate: ${passed}/12 checks passed with no major red flags.`;

  auditLog.unshift({
    id: analysisId, timestamp: new Date().toISOString(),
    user: username, filename: originalname,
    score: authenticityScore, riskLevel, passed, failed
  });

  return {
    analysisId,
    timestamp: new Date().toISOString(),
    processingTime: Date.now() - startTime,
    filename: originalname,
    fileSize,
    submissionType,
    isBlankTemplate: false,
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
    confidenceMap,
    prcVerification,
    rawResponse: `OCR: ${ocrAvailable ? 'OK' : 'FAILED'} | Rules: ${passed}/${checks.length} | AI: ${aiAvailable ? 'OK' : 'FAILED'} | Type: ${submissionType} | Score: ${authenticityScore}`
  };
}

// ─── SINGLE ANALYZE ───────────────────────────────────────────────────────────
app.post('/api/analyze', authMiddleware, upload.single('certificate'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await analyzeOneCertificate(
      req.file.buffer, req.file.mimetype,
      req.file.originalname, req.file.size,
      req.user.username
    );
    res.json(result);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// ─── BATCH ANALYZE ────────────────────────────────────────────────────────────
app.post('/api/analyze/batch', authMiddleware, (req, res) => {
  uploadBatch(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    try {
      const results = await Promise.all(
        req.files.map(f =>
          analyzeOneCertificate(f.buffer, f.mimetype, f.originalname, f.size, req.user.username)
        )
      );
      res.json({
        batchId: uuidv4(),
        totalFiles: results.length,
        timestamp: new Date().toISOString(),
        results,
        summary: {
          highRisk:    results.filter(r => r.riskLevel === 'HIGH_RISK').length,
          mediumRisk:  results.filter(r => r.riskLevel === 'MEDIUM_RISK').length,
          lowRisk:     results.filter(r => r.riskLevel === 'LOW_RISK').length,
          templates:   results.filter(r => r.isBlankTemplate).length,
          avgScore:    Math.round(results.filter(r => r.authenticityScore !== null)
                         .reduce((s, r) => s + r.authenticityScore, 0) /
                         Math.max(1, results.filter(r => r.authenticityScore !== null).length))
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Batch analysis failed: ' + error.message });
    }
  });
});

// ─── AUDIT & HEALTH ───────────────────────────────────────────────────────────
app.get('/api/audit',  authMiddleware, (req, res) => res.json(auditLog));
app.get('/api/health', (req, res) => res.json({
  status: 'ok', version: '3.0',
  geminiConfigured: !!GEMINI_API_KEY,
  features: ['blank-template-detection','prc-format-check','batch-upload','confidence-scoring','submission-type-detection']
}));

app.get('*', (req, res) => res.sendFile(path.join(frontendBuild, 'index.html')));

app.listen(PORT, () => {
  console.log(`✅ MedVerify v3.0 running on port ${PORT}`);
  console.log(`🤖 Gemini: ${GEMINI_API_KEY ? 'Configured ✓' : 'NOT set → rule-only mode'}`);
  console.log(`🚀 Features: Blank Template Detection | PRC Format Check | Batch Upload | Confidence Scores`);
});
