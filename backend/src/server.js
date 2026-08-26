require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { runAllRules, detectBlankTemplate } = require('./rules');

// Only require pdf-parse if needed
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.log('📄 pdf-parse not available, PDF text extraction disabled');
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'medverify_secret_key_2024';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ─── AI PROVIDER CONFIG ─────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview';
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '30000', 10);

// Initialize Gemini with correct package
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const frontendBuild = path.join(__dirname, '..', '..', 'frontend', 'build');
app.use(express.static(frontendBuild));

// ─── USERS ─────────────────────────────────────────────────────────────────────
const users = [
  { id: '1', username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'Administrator', level: 'Admin • System' },
  { id: '2', username: 'prof.sharma', password: bcrypt.hashSync('sharma123', 10), role: 'Professor', level: 'Faculty • HR' },
  { id: '3', username: 'dr.mehta', password: bcrypt.hashSync('mehta123', 10), role: 'Dr. Mehta', level: 'Doctor • Medical' },
];

const auditLog = [];

// Configure multer to save files temporarily for PDF processing
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs allowed'));
  }
});

const uploadBatch = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs allowed'));
  }
}).array('certificates', 10);

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ─── DETECT SUBMISSION TYPE ────────────────────────────────────────────────
function detectSubmissionType(fileBuffer, mimeType, filename) {
  const isPDF = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');
  const isGIF = mimeType === 'image/gif';
  const looksLikeScreenshot = filename && /screenshot|screen.shot|capture|snip/i.test(filename);

  if (isPDF) return 'pdf';
  if (isGIF) return 'gif_animation';
  if (looksLikeScreenshot) return 'screenshot';
  if (isImage) return 'scanned_image';
  return 'unknown';
}

// ─── PRC LICENSE VERIFICATION ──────────────────────────────────────────────
function verifyPRCLicense(licenseNumber, doctorName) {
  if (!licenseNumber || licenseNumber.length < 4) {
    return { verified: false, method: 'format_check', note: 'License number too short or missing.' };
  }
  const isPRCFormat = /^\d{5,10}$/.test(licenseNumber.replace(/\s/g, ''));
  if (!isPRCFormat) {
    return { verified: false, method: 'format_check', note: `"${licenseNumber}" does not match PRC 7-digit format.` };
  }
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

// ─── SHARED PROMPT ─────────────────────────────────────────────────────────
function buildCombinedPrompt(submissionType, extractedText = '') {
  const textContext = extractedText ? `\n\nHere is the extracted text from the document:\n${extractedText}\n\n` : '';
  
  return `You are a medical-certificate OCR and fraud-detection expert.
Submission type: ${submissionType}${textContext}

Look carefully at the attached certificate and respond with ONLY a single valid JSON object — no markdown, no code fences, no commentary — in EXACTLY this shape:

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
    "observation 1: blank/unfilled template vs completed",
    "observation 2: template/formatting indicators",
    "observation 3: signature authenticity",
    "observation 4: logical conflicts",
    "observation 5: overall fraud risk assessment"
  ]
}

IMPORTANT: Extract ALL available information. Look for:
- Doctor: "Dr.", "Doctor" names
- Hospital/Clinic names
- Patient: "patient", "Mr.", "Ms.", "Mrs." names
- Diagnosis/condition
- Dates: "Date:", "Dated:", "from...to"
- Registration: "Reg. No:", "Registration No:"
- Qualifications: "M.B.B.S.", "M.D.", etc.

Rules:
- If a field is blank/empty, return ""
- If unclear, return "unclear"
- If this is a completed certificate, set isFilledTemplate to "Yes"
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
  return !!parsed &&
    parsed.extractedInfo && typeof parsed.extractedInfo === 'object' &&
    Array.isArray(parsed.aiObservations) &&
    parsed.aiObservations.length > 0;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─── EXTRACT TEXT FROM PDF ──────────────────────────────────────────────────
async function extractTextFromPDF(filePath) {
  if (!pdfParse) {
    console.log('⚠️ pdf-parse not available');
    return '';
  }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// ─── READ FILE TO BUFFER ──────────────────────────────────────────────────
function readFileToBuffer(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
}

// ─── MANUAL TEXT EXTRACTION ──────────────────────────────────────────────────
function manualExtractFromText(text) {
  const extracted = {};
  
  // Extract Doctor Name
  let doctorMatch = text.match(/(?:Dr\.|Doctor)\s+([A-Za-z]+\s+[A-Za-z]+)/i);
  if (doctorMatch) extracted.doctorName = doctorMatch[1].trim();
  
  // Try alternative: "I, Dr. X" pattern
  let doctorMatch2 = text.match(/I,\s*Dr\.\s*([A-Za-z]+\s+[A-Za-z]+)/i);
  if (doctorMatch2 && !extracted.doctorName) extracted.doctorName = doctorMatch2[1].trim();
  
  // Try: just "Dr. X" at start
  let doctorMatch3 = text.match(/^Dr\.\s+([A-Za-z]+\s+[A-Za-z]+)/im);
  if (doctorMatch3 && !extracted.doctorName) extracted.doctorName = doctorMatch3[1].trim();
  
  // Extract Registration Number
  const regMatch = text.match(/(?:Reg\.\s*No\.|Registration\s*No\.)\s*[:.]?\s*([A-Z0-9\-]+)/i);
  if (regMatch) extracted.registrationNumber = regMatch[1].trim();
  
  // Extract Patient Name
  let patientMatch = text.match(/(?:patient|Mr\.|Ms\.|Mrs\.)\s+([A-Za-z]+\s+[A-Za-z]+)/i);
  if (patientMatch) extracted.patientName = patientMatch[1].trim();
  
  // Alternative: "certify that X" pattern
  let patientMatch2 = text.match(/certify that\s+([A-Za-z]+\s+[A-Za-z]+)/i);
  if (patientMatch2 && !extracted.patientName) extracted.patientName = patientMatch2[1].trim();
  
  // Alternative: "hereby certify that X" pattern
  let patientMatch3 = text.match(/hereby certify that\s+([A-Za-z]+\s+[A-Za-z]+)/i);
  if (patientMatch3 && !extracted.patientName) extracted.patientName = patientMatch3[1].trim();
  
  // Extract Diagnosis
  let diagMatch = text.match(/(?:suffering from|diagnosis|diagnosed with)\s+([A-Za-z\s,]+?)(?:,|\.|and|for|\(|the following)/i);
  if (diagMatch) extracted.diagnosis = diagMatch[1].trim();
  
  // Alternative: "is suffering from X" pattern
  let diagMatch2 = text.match(/is suffering from\s+([A-Za-z\s,]+?)(?:,|\.|and)/i);
  if (diagMatch2 && !extracted.diagnosis) extracted.diagnosis = diagMatch2[1].trim();
  
  // Alternative: "advised: X to Y" pattern
  let diagMatch3 = text.match(/advised:\s*([A-Za-z\s,]+?)(?:\d|\,|\.)/i);
  if (diagMatch3 && !extracted.diagnosis) extracted.diagnosis = diagMatch3[1].trim();
  
  // Extract Date
  let dateMatch = text.match(/(?:Date|Dated)\s*[:.]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  if (dateMatch) extracted.issueDate = dateMatch[1].trim();
  
  // Alternative: date at start
  let dateMatch2 = text.match(/^Date:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/im);
  if (dateMatch2 && !extracted.issueDate) extracted.issueDate = dateMatch2[1].trim();
  
  // Extract Hospital/Clinic
  let hospitalMatch = text.match(/([A-Za-z]+\s+(?:Hospital|Clinic|Medical Center|Health Center|Family Clinic))/i);
  if (hospitalMatch) extracted.hospitalName = hospitalMatch[1].trim();
  
  // Extract Qualifications
  let qualMatch = text.match(/(M\.B\.B\.S\.|M\.D\.|B\.H\.M\.S\.|B\.A\.M\.S\.|B\.D\.S\.|D\.M\.D\.|M\.S\.|D\.N\.B\.)/g);
  if (qualMatch) {
    // Remove duplicates
    const uniqueQuals = [...new Set(qualMatch)];
    extracted.doctorQualifications = uniqueQuals.join(', ');
  }
  
  // Extract leave dates
  let leaveMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*to\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  if (leaveMatch) {
    extracted.leaveFrom = leaveMatch[1].trim();
    extracted.leaveTo = leaveMatch[2].trim();
  }
  
  // Alternative: date range with "to"
  let leaveMatch2 = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*–\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  if (leaveMatch2 && !extracted.leaveFrom) {
    extracted.leaveFrom = leaveMatch2[1].trim();
    extracted.leaveTo = leaveMatch2[2].trim();
  }
  
  // Extract signature presence
  if (text.match(/signature|Signature|SIGNATURE|seal|Seal|SEAL/)) {
    extracted.signatureSealPresent = 'Yes';
  }
  
  // Check if it's filled - patient name and doctor name are key indicators
  if (extracted.patientName || extracted.doctorName || extracted.diagnosis) {
    extracted.isFilledTemplate = 'Yes';
  } else {
    extracted.isFilledTemplate = 'No';
  }
  
  // If we have patient name but no doctor name, try to find it again
  if (!extracted.doctorName) {
    const docNameMatch = text.match(/SIGNATURE OF MEDICAL OFFICER\s+([A-Za-z]+\s+[A-Za-z]+)/i);
    if (docNameMatch) extracted.doctorName = docNameMatch[1].trim();
  }
  
  // Try to get doctor qualifications from signature block
  if (!extracted.doctorQualifications) {
    const qualMatch2 = text.match(/Dr\.\s+[A-Za-z]+\s+[A-Za-z]+\s+([A-Za-z.,\s]+?)(?:\n|Reg)/i);
    if (qualMatch2) {
      const quals = qualMatch2[1].trim();
      if (quals.match(/(M\.B\.B\.S\.|M\.D\.|B\.H\.M\.S\.)/i)) {
        extracted.doctorQualifications = quals;
      }
    }
  }
  
  return extracted;
}

// ─── FIXED: GEMINI CALL ──────────────────────────────────────────────────
async function callGemini(filePath, mimeType, submissionType, extractedText = '') {
  if (!genAI) throw new Error('Gemini not configured (GEMINI_API_KEY missing)');

  try {
    // Read file to buffer
    const fileBuffer = readFileToBuffer(filePath);
    if (!fileBuffer) {
      throw new Error('Could not read file');
    }

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      }
    });

    const base64Data = fileBuffer.toString('base64');
    const prompt = buildCombinedPrompt(submissionType, extractedText);

    let result;
    if (mimeType === 'application/pdf' && extractedText) {
      // Use text-only mode for PDFs
      const textPrompt = `Analyze this medical certificate text and extract information in JSON format.\n\n${extractedText}\n\n${prompt}`;
      result = await model.generateContent(textPrompt);
    } else {
      // Use vision mode for images
      result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            { text: prompt }
          ]
        }]
      });
    }

    const response = result.response;
    const text = response.text();

    if (!text || text.trim() === '') {
      throw new Error('Empty response from Gemini');
    }

    return parseCombinedJson(text);

  } catch (error) {
    console.error('Gemini API error:', error.message);
    throw new Error(`Gemini failed: ${error.message}`);
  }
}

// ─── GROQ CALL ──────────────────────────────────────────────────────────
async function callGroq(filePath, mimeType, submissionType, extractedText = '') {
  if (!GROQ_API_KEY) throw new Error('Groq not configured (GROQ_API_KEY missing)');
  
  // Read file to buffer
  const fileBuffer = readFileToBuffer(filePath);
  if (!fileBuffer) {
    throw new Error('Could not read file');
  }
  
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  const prompt = buildCombinedPrompt(submissionType, extractedText);

  let messages;
  if (mimeType === 'application/pdf' && extractedText) {
    messages = [{
      role: 'user',
      content: `Analyze this medical certificate text and extract information in JSON format.\n\n${extractedText}\n\n${prompt}`
    }];
  } else {
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }];
  }

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: messages,
      temperature: 0.1,
      max_completion_tokens: 2048,
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

// ─── AI ORCHESTRATOR ────────────────────────────────────────────────────
async function analyzeWithAI(filePath, mimeType, submissionType, extractedText = '') {
  const providers = [];

  if (GROQ_API_KEY) providers.push({ name: 'groq', fn: callGroq });
  if (GEMINI_API_KEY) providers.push({ name: 'gemini', fn: callGemini });

  for (const provider of providers) {
    try {
      console.log(`🔄 Trying ${provider.name}...`);
      const parsed = await withTimeout(
        provider.fn(filePath, mimeType, submissionType, extractedText),
        AI_TIMEOUT_MS,
        provider.name
      );
      if (isValidCombinedResult(parsed)) {
        console.log(`✅ ${provider.name} succeeded`);
        return {
          extractedInfo: parsed.extractedInfo,
          aiObservations: parsed.aiObservations,
          provider: provider.name
        };
      }
      console.error(`${provider.name} returned malformed data`);
    } catch (e) {
      console.error(`${provider.name} failed:`, e.message);
    }
  }

  console.log('❌ All AI providers failed');
  return null;
}

// ─── CORE ANALYSIS FUNCTION ──────────────────────────────────────────────────
async function analyzeOneCertificate(filePath, mimeType, originalname, fileSize, username) {
  const analysisId = uuidv4();
  const startTime = Date.now();
  const submissionType = detectSubmissionType(null, mimeType, originalname);

  // Extract text from PDF if applicable
  let extractedText = '';
  if (mimeType === 'application/pdf' && pdfParse) {
    try {
      extractedText = await extractTextFromPDF(filePath);
      console.log('📄 Extracted PDF Text:', extractedText.substring(0, 500) + '...');
    } catch (e) {
      console.error('Failed to extract PDF text:', e);
    }
  }

  // Try AI analysis
  const aiResult = await analyzeWithAI(filePath, mimeType, submissionType, extractedText);
  const aiAvailable = aiResult !== null;

  let extractedInfo = aiResult?.extractedInfo || {
    doctorName: '', hospitalName: '', patientName: '', diagnosis: '',
    issueDate: '', leaveFrom: '', leaveTo: '', phone: '',
    referenceNumber: '', signatureSealPresent: 'No',
    address: '', doctorQualifications: '', registrationNumber: '',
    isFilledTemplate: 'No', documentType: 'unknown'
  };

  // If AI failed or incomplete, use manual parsing
  if ((!aiAvailable || !extractedInfo.doctorName) && extractedText) {
    console.log('⚠️ AI failed or incomplete, attempting manual text parsing...');
    const manualExtracted = manualExtractFromText(extractedText);
    // Merge, but don't override AI data if it exists
    extractedInfo = { ...manualExtracted, ...extractedInfo };
    console.log('📊 Manual Extraction:', manualExtracted);
  }

  // Check if the document has actual data
  const hasData = extractedInfo.doctorName || extractedInfo.patientName || 
                  extractedInfo.issueDate || extractedInfo.diagnosis || 
                  extractedInfo.registrationNumber;

  // If there's data, it's NOT a blank template
  if (hasData) {
    extractedInfo.isFilledTemplate = 'Yes';
  }

  const { isBlankTemplate, blankCoreFields, blankRatio } = detectBlankTemplate(extractedInfo);
  const isExplicitlyUnfilled = extractedInfo.isFilledTemplate === 'No';

  // Only mark as blank if truly blank
  const actuallyBlank = (isBlankTemplate || isExplicitlyUnfilled) && !hasData;

  if (actuallyBlank) {
    const result = {
      analysisId,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      filename: originalname,
      fileSize,
      submissionType,
      isBlankTemplate: true,
      templateWarning: `This is an unfilled official template — ${blankRatio}% of fields are empty. Please upload a completed certificate with patient details filled in.`,
      ocrAvailable: false,
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
    // Clean up
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return result;
  }

  // Run rules on extracted info
  const { checks, passed, failed, ruleScore, confidenceMap } = runAllRules(extractedInfo);
  const prcVerification = verifyPRCLicense(extractedInfo.registrationNumber, extractedInfo.doctorName);

  let aiObservations = aiResult?.aiObservations || null;
  if (!aiObservations) {
    aiObservations = [
      `AI analysis ${aiAvailable ? 'completed' : 'unavailable'} — ${aiAvailable ? 'Combined with' : 'Rule-based'} checks applied.`,
      `${passed} of ${checks.length} rule checks passed based on extracted certificate data.`,
      `${aiAvailable ? 'AI provider (' + aiResult.provider + ') analyzed the document.' : 'Add GEMINI_API_KEY and/or GROQ_API_KEY for AI analysis.'}`,
      'The rule engine verified dates, phone format, leave duration, and field completeness.',
      'Manual review recommended for final verification.'
    ];
  }

  let authenticityScore;
  if (aiAvailable) {
    const negativeWords = ['fraudulent', 'suspicious', 'conflict', 'error', 'fake', 'template', 'invalid', 'missing', 'generic', 'absent', 'blank', 'unclear', 'forged', 'fabricated'];
    const negCount = aiObservations.join(' ').toLowerCase().split(/\s+/)
      .filter(w => negativeWords.some(n => w.includes(n))).length;
    const aiScore = Math.max(0, 100 - (negCount * 7));
    authenticityScore = Math.round((ruleScore * 0.5) + (aiScore * 0.5));
  } else {
    authenticityScore = ruleScore;
  }

  if (submissionType === 'screenshot') authenticityScore = Math.max(0, authenticityScore - 5);
  if (prcVerification.verified === 'format_ok') authenticityScore = Math.min(100, authenticityScore + 5);

  const riskLevel = authenticityScore >= 70 ? 'LOW_RISK' :
    authenticityScore >= 40 ? 'MEDIUM_RISK' :
    'HIGH_RISK';

  const verdict = riskLevel === 'HIGH_RISK' ?
    `Likely fraudulent: ${failed} critical checks failed.` :
    riskLevel === 'MEDIUM_RISK' ?
    `Uncertain authenticity: ${failed} checks failed. Manual review recommended.` :
    `Appears legitimate: ${passed}/${checks.length} checks passed with no major red flags.`;

  auditLog.unshift({
    id: analysisId, timestamp: new Date().toISOString(),
    user: username, filename: originalname,
    score: authenticityScore, riskLevel, passed, failed
  });

  // Clean up
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return {
    analysisId,
    timestamp: new Date().toISOString(),
    processingTime: Date.now() - startTime,
    filename: originalname,
    fileSize,
    submissionType,
    isBlankTemplate: false,
    ocrAvailable: aiAvailable || !!extractedText,
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
      req.file.path,
      req.file.mimetype,
      req.file.originalname,
      req.file.size,
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
          analyzeOneCertificate(f.path, f.mimetype, f.originalname, f.size, req.user.username)
        )
      );
      res.json({
        batchId: uuidv4(),
        totalFiles: results.length,
        timestamp: new Date().toISOString(),
        results,
        summary: {
          highRisk: results.filter(r => r.riskLevel === 'HIGH_RISK').length,
          mediumRisk: results.filter(r => r.riskLevel === 'MEDIUM_RISK').length,
          lowRisk: results.filter(r => r.riskLevel === 'LOW_RISK').length,
          templates: results.filter(r => r.isBlankTemplate).length,
          avgScore: Math.round(results.filter(r => r.authenticityScore !== null)
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
app.get('/api/audit', authMiddleware, (req, res) => res.json(auditLog));
app.get('/api/health', (req, res) => res.json({
  status: 'ok', version: '3.1',
  geminiConfigured: !!GEMINI_API_KEY,
  groqConfigured: !!GROQ_API_KEY,
  pdfParseAvailable: !!pdfParse,
  aiTimeoutMs: AI_TIMEOUT_MS,
  features: ['blank-template-detection', 'prc-format-check', 'batch-upload', 'confidence-scoring', 'submission-type-detection', 'ai-provider-fallback', 'pdf-text-extraction']
}));

app.get('*', (req, res) => res.sendFile(path.join(frontendBuild, 'index.html')));

app.listen(PORT, () => {
  console.log(`✅ MedVerify v3.1 running on port ${PORT}`);
  console.log(`🤖 Gemini: ${GEMINI_API_KEY ? `Configured ✓ (${GEMINI_MODEL})` : 'NOT set'}`);
  console.log(`🤖 Groq fallback: ${GROQ_API_KEY ? `Configured ✓ (${GROQ_VISION_MODEL})` : 'NOT set'}`);
  console.log(`📄 PDF Parse: ${pdfParse ? 'Available ✓' : 'Not available'}`);
  if (!GEMINI_API_KEY && !GROQ_API_KEY) console.log('⚠️  No AI provider configured → rule-only mode');
  console.log(`🚀 Features: Blank Template Detection | PRC Format Check | Batch Upload | Confidence Scores | AI Fallback | PDF Text Extraction`);
});
