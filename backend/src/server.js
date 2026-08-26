require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const { GoogleGenAI } = require('@google/genai');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const { runAllRules, detectBlankTemplate } = require('./rules');

const app        = express();
const PORT       = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'medverify_secret_key_2024';
const NODE_ENV   = process.env.NODE_ENV || 'development';

// ─── AI PROVIDER CONFIG ─────────────────────────────────────────────────────
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY     = process.env.GROQ_API_KEY || '';
const GEMINI_MODEL     = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
// Groq's multimodal lineup changes often — override via env if this model gets retired.
// Check https://console.groq.com/docs/vision for the current list.
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
// Per-provider hard timeout. If a provider doesn't answer in time we fail over
// instead of leaving the user staring at a spinner.
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '15000', 10);

const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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

// ─── SHARED PROMPT (one call does OCR + fraud observations together) ─────────
function buildCombinedPrompt(submissionType) {
  return `You are a medical-certificate OCR and fraud-detection expert.
Submission type: ${submissionType}

Look carefully at the attached certificate image/document and respond with ONLY a single valid JSON object — no markdown, no code fences, no commentary before or after it — in EXACTLY this shape:

{
  "extractedInfo": {
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
  },
  "aiObservations": [
    "observation about whether this is a blank/unfilled template vs a completed certificate",
    "observation about template/Canva design indicators or non-standard formatting",
    "observation about signature authenticity - wet ink vs digital overlay vs absent",
    "observation about logical conflicts - role conflicts, date issues, address mismatches",
    "observation giving an overall fraud risk assessment"
  ]
}

Rules:
- If a field is blank/empty in the document, return "" for that field.
- If a field exists but you cannot read it clearly, return "unclear".
- aiObservations must contain exactly 5 strings, in the order described above.
- If this is a blank/unfilled official template, say so clearly in the first observation and set isFilledTemplate to "No".
- Respond with raw JSON only.`;
}

function parseCombinedJson(rawText) {
  const cleaned = (rawText || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse AI JSON response');
  }
}

function isValidCombinedResult(parsed) {
  return !!parsed
    && parsed.extractedInfo && typeof parsed.extractedInfo === 'object'
    && Array.isArray(parsed.aiObservations)
    && parsed.aiObservations.length > 0;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─── PROVIDER: GEMINI ──────────────────────────────────────────────────────
// Uses the current @google/genai SDK (the old @google/generative-ai package
// is end-of-life and was archived). thinkingConfig.thinkingBudget=0 turns off
// Gemini 2.5's "thinking" step, which is the main reason plain OCR/JSON
// extraction calls were taking many extra seconds for no benefit here.
async function callGemini(fileBuffer, mimeType, submissionType) {
  if (!genAI) throw new Error('Gemini not configured (GEMINI_API_KEY missing)');
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: fileBuffer.toString('base64') } },
        { text: buildCombinedPrompt(submissionType) }
      ]
    }],
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  });
  const text = response.text ?? response.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
  return parseCombinedJson(text);
}

// ─── PROVIDER: GROQ (fallback) ─────────────────────────────────────────────
// OpenAI-compatible endpoint, no SDK dependency needed (Node 18+ has fetch).
// Groq's LPU inference is typically much faster than Gemini even with
// thinking disabled, which makes it a good "speed" fallback too, not just
// a reliability one.
async function callGroq(fileBuffer, mimeType, submissionType) {
  if (!GROQ_API_KEY) throw new Error('Groq not configured (GROQ_API_KEY missing)');
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildCombinedPrompt(submissionType) },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }],
      temperature: 0.2,
      max_completion_tokens: 1500,
      response_format: { type: 'json_object' }
    })
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Groq API error ${resp.status}: ${errBody.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseCombinedJson(text);
}

// ─── AI ORCHESTRATOR: try Gemini, fail over to Groq, else null ────────────
// This makes ONE model call per provider attempt (not two, like the old
// extractWithGemini + getAiObservations pair did) and enforces a hard
// per-provider timeout so a slow provider can't stall the whole request.
async function analyzeWithAI(fileBuffer, mimeType, submissionType) {
  const providers = [];
  if (GEMINI_API_KEY) providers.push({ name: 'gemini', fn: callGemini });
  if (GROQ_API_KEY)   providers.push({ name: 'groq',   fn: callGroq   });

  for (const provider of providers) {
    try {
      const parsed = await withTimeout(
        provider.fn(fileBuffer, mimeType, submissionType),
        AI_TIMEOUT_MS,
        provider.name
      );
      if (isValidCombinedResult(parsed)) {
        return { extractedInfo: parsed.extractedInfo, aiObservations: parsed.aiObservations, provider: provider.name };
      }
      console.error(`${provider.name} returned malformed data, trying next provider`);
    } catch (e) {
      console.error(`${provider.name} failed:`, e.message);
      // fall through to next provider
    }
  }
  return null; // every configured provider failed -> caller drops to rule-only mode
}

// ─── CORE ANALYSIS FUNCTION (reused by single + batch) ───────────────────────
async function analyzeOneCertificate(fileBuffer, mimeType, originalname, fileSize, username) {
  const analysisId    = uuidv4();
  const startTime      = Date.now();
  const submissionType = detectSubmissionType(fileBuffer, mimeType, originalname);

  // STEP 1: ONE combined AI call (OCR + fraud observations), with fallback
  const aiResult = await analyzeWithAI(fileBuffer, mimeType, submissionType);
  const aiAvailable = aiResult !== null;
  const ocrAvailable = aiAvailable; // OCR and observations now come from the same call

  let extractedInfo = aiResult?.extractedInfo || {
    doctorName:'', hospitalName:'', patientName:'', diagnosis:'',
    issueDate:'', leaveFrom:'', leaveTo:'', phone:'',
    referenceNumber:'', signatureSealPresent:'No',
    address:'', doctorQualifications:'', registrationNumber:'',
    isFilledTemplate:'No', documentType:'unknown'
  };

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
      aiProvider: aiResult?.provider || null,
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

  // STEP 5: AI OBSERVATIONS (already fetched in STEP 1 — reuse, with a rule-only fallback)
  let aiObservations = aiResult?.aiObservations || null;
  if (!aiObservations) {
    aiObservations = [
      'AI analysis unavailable — no AI provider responded in time. Rule-based checks applied only.',
      `${passed} of ${checks.length} rule checks passed based on extracted certificate data.`,
      'Add GEMINI_API_KEY and/or GROQ_API_KEY to enable deep fraud analysis including template and signature detection.',
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
    : `Appears legitimate: ${passed}/${checks.length} checks passed with no major red flags.`;

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
    aiProvider: aiResult?.provider || null,
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
    rawResponse: `AI: ${aiAvailable ? `OK (${aiResult.provider})` : 'FAILED'} | Rules: ${passed}/${checks.length} | Type: ${submissionType} | Score: ${authenticityScore}`
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
  status: 'ok', version: '3.1',
  geminiConfigured: !!GEMINI_API_KEY,
  groqConfigured: !!GROQ_API_KEY,
  aiTimeoutMs: AI_TIMEOUT_MS,
  features: ['blank-template-detection','prc-format-check','batch-upload','confidence-scoring','submission-type-detection','ai-provider-fallback']
}));

app.get('*', (req, res) => res.sendFile(path.join(frontendBuild, 'index.html')));

app.listen(PORT, () => {
  console.log(`✅ MedVerify v3.1 running on port ${PORT}`);
  console.log(`🤖 Gemini: ${GEMINI_API_KEY ? `Configured ✓ (${GEMINI_MODEL})` : 'NOT set'}`);
  console.log(`🤖 Groq fallback: ${GROQ_API_KEY ? `Configured ✓ (${GROQ_VISION_MODEL})` : 'NOT set'}`);
  if (!GEMINI_API_KEY && !GROQ_API_KEY) console.log('⚠️  No AI provider configured → rule-only mode');
  console.log(`🚀 Features: Blank Template Detection | PRC Format Check | Batch Upload | Confidence Scores | AI Fallback`);
});
