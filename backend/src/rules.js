// ============================================
// MedVerify - Pure JavaScript Rule Engine v3.0
// ============================================

const VALID_MEDICAL_TERMS = [
  'influenza', 'fever', 'malaria', 'typhoid', 'dengue', 'covid', 'coronavirus',
  'pneumonia', 'bronchitis', 'asthma', 'tuberculosis', 'tb', 'diabetes',
  'hypertension', 'migraine', 'gastroenteritis', 'diarrhea', 'vomiting',
  'appendicitis', 'fracture', 'sprain', 'injury', 'infection', 'viral',
  'bacterial', 'acute', 'chronic', 'respiratory', 'urinary tract infection',
  'uti', 'anemia', 'jaundice', 'hepatitis', 'chickenpox', 'measles',
  'mumps', 'allergy', 'sinusitis', 'tonsillitis', 'conjunctivitis',
  'vertigo', 'anxiety', 'depression', 'stress', 'fatigue', 'weakness',
  'cold', 'cough', 'throat infection', 'food poisoning', 'dehydration',
  'kidney stone', 'back pain', 'abdominal pain', 'chest pain', 'headache',
  'normal health findings', 'essentially normal', 'fit to work', 'fit to study',
  'cleared for', 'no abnormalities', 'physically fit', 'medical clearance',
  'upper respiratory', 'lrti', 'urti', 'ari', 'acute respiratory infection'
];

const PUBLIC_HOLIDAYS = [
  '01-01', '01-26', '02-25', '03-25', '04-09', '04-14', '04-18',
  '05-01', '06-12', '08-21', '08-25', '08-15', '10-02', '10-12',
  '10-24', '11-01', '11-30', '12-08', '12-25', '12-30', '12-31'
];

const DIAGNOSIS_DURATION = {
  'influenza': [3, 10], 'fever': [2, 7], 'malaria': [5, 14],
  'typhoid': [7, 21], 'dengue': [5, 14], 'covid': [7, 21],
  'pneumonia': [7, 21], 'bronchitis': [5, 14], 'fracture': [7, 60],
  'appendicitis': [7, 21], 'gastroenteritis': [2, 7],
  'food poisoning': [2, 5], 'viral': [3, 7], 'cold': [2, 5],
  'migraine': [1, 3], 'injury': [3, 30],
  'normal health findings': [0, 3],
  'essentially normal': [0, 3],
  'fit to work': [0, 1],
  'medical clearance': [0, 1],
  'default': [1, 30]
};

function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    const formats = [
      /(\\d{1,2})[\\/\\-](\\d{1,2})[\\/\\-](\\d{4})/,
      /(\\w+)\\s+(\\d{1,2}),?\\s+(\\d{4})/
    ];
    for (const fmt of formats) {
      const m = dateStr.match(fmt);
      if (m) {
        const attempt = new Date(dateStr);
        if (!isNaN(attempt.getTime())) return attempt;
      }
    }
    return null;
  } catch { return null; }
}

function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  return Math.round(Math.abs((d2 - d1) / (1000 * 60 * 60 * 24)));
}

// ── BLANK TEMPLATE DETECTION ─────────────────────────────────────────────────
function detectBlankTemplate(info) {
  const coreFields = ['patientName', 'doctorName', 'issueDate', 'diagnosis'];
  const blankCore = coreFields.filter(f => !info[f] || info[f].trim() === '' || info[f] === 'Not found');
  const allFields = Object.keys(info);
  const blankAll = allFields.filter(f => !info[f] || info[f] === '—' || info[f].trim() === '' || info[f] === 'Not found');
  const blankRatio = blankAll.length / allFields.length;

  return {
    isBlankTemplate: blankCore.length >= 2 && blankRatio >= 0.45,
    blankCoreFields: blankCore,
    blankRatio: Math.round(blankRatio * 100)
  };
}

// ── FIELD CONFIDENCE SCORING ──────────────────────────────────────────────────
function getFieldConfidence(value, fieldType) {
  if (!value || value === 'Not found' || value === '—' || value.trim() === '') {
    return { confidence: 0, label: 'Not Found' };
  }
  switch (fieldType) {
    case 'date':
      return parseDate(value)
        ? { confidence: 95, label: 'High' }
        : { confidence: 40, label: 'Low' };
    case 'phone':
      return /^\\+?[\\d\\s\\-().]{7,15}$/.test(value.replace(/\\s/g, ''))
        ? { confidence: 90, label: 'High' }
        : { confidence: 35, label: 'Low' };
    case 'regnum':
      return value.length >= 4
        ? { confidence: 88, label: 'High' }
        : { confidence: 50, label: 'Medium' };
    case 'name':
      return value.split(' ').length >= 2
        ? { confidence: 85, label: 'High' }
        : { confidence: 60, label: 'Medium' };
    default:
      return value.length > 3
        ? { confidence: 75, label: 'Medium' }
        : { confidence: 40, label: 'Low' };
  }
}

function buildConfidenceMap(info) {
  return {
    doctorName:          getFieldConfidence(info.doctorName, 'name'),
    hospitalName:        getFieldConfidence(info.hospitalName, 'name'),
    patientName:         getFieldConfidence(info.patientName, 'name'),
    diagnosis:           getFieldConfidence(info.diagnosis, 'text'),
    issueDate:           getFieldConfidence(info.issueDate, 'date'),
    leaveFrom:           getFieldConfidence(info.leaveFrom, 'date'),
    leaveTo:             getFieldConfidence(info.leaveTo, 'date'),
    phone:               getFieldConfidence(info.phone, 'phone'),
    referenceNumber:     getFieldConfidence(info.referenceNumber, 'text'),
    registrationNumber:  getFieldConfidence(info.registrationNumber, 'regnum'),
    signatureSealPresent:getFieldConfidence(info.signatureSealPresent, 'text'),
    doctorQualifications:getFieldConfidence(info.doctorQualifications, 'text'),
  };
}

// ============================================
// THE 12 RULE CHECKS
// ============================================

function checkDoctorRegistration(info) {
  const reg = (info.registrationNumber || '').trim();
  const hasReg = reg.length >= 4 && reg !== 'Not found';
  // PRC format: 7 digits, or license numbers like 0086417
  const isPRC = /^\\d{5,10}$/.test(reg);
  const isIndianMCI = /^[A-Z]{2}\\d{5,8}$/.test(reg);
  const formatNote = isPRC ? ' (PRC format)' : isIndianMCI ? ' (MCI format)' : '';
  return {
    id: 'doctor_registration',
    name: 'Doctor Registration Format',
    passed: hasReg,
    description: hasReg
      ? `Registration number found: ${reg}${formatNote}`
      : 'No medical registration or license number found for the signatory.'
  };
}

function checkIssueDateValidity(info) {
  // Only year present = unfilled template
  const raw = (info.issueDate || '').trim();
  if (/^\\d{4}$/.test(raw)) {
    return {
      id: 'issue_date_validity',
      name: 'Issue Date Validity',
      passed: false,
      description: `Only year "${raw}" found — full date (day/month/year) is required on a valid certificate.`
    };
  }
  const date = parseDate(raw);
  const valid = date !== null && date <= new Date();
  return {
    id: 'issue_date_validity',
    name: 'Issue Date Validity',
    passed: valid,
    description: valid
      ? `Issue date "${raw}" is valid and not in the future.`
      : `Issue date "${raw}" is missing, invalid, or in the future.`
  };
}

function checkWeekendHoliday(info) {
  const raw = (info.issueDate || '').trim();
  if (/^\\d{4}$/.test(raw) || !raw) {
    return {
      id: 'weekend_holiday',
      name: 'Weekend/Holiday Issue',
      passed: false,
      description: 'Cannot verify — no full date found on the certificate.'
    };
  }
  const date = parseDate(raw);
  if (!date) return { id: 'weekend_holiday', name: 'Weekend/Holiday Issue', passed: false, description: 'Could not parse issue date.' };
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const isHoliday = PUBLIC_HOLIDAYS.includes(mmdd);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const passed = !isWeekend && !isHoliday;
  return {
    id: 'weekend_holiday',
    name: 'Weekend/Holiday Issue',
    passed,
    description: passed
      ? `${raw} was a ${dayNames[day]} (standard business day).`
      : `${raw} was a ${isWeekend ? dayNames[day] + ' (weekend)' : 'public holiday'} — suspicious for a clinic visit.`
  };
}

function checkRequiredFields(info) {
  const required = ['doctorName', 'hospitalName', 'patientName', 'diagnosis', 'issueDate'];
  // Distinguish: field truly missing vs intentionally blank in template
  const missing = required.filter(f => !info[f] || info[f] === 'Not found' || info[f].trim() === '');
  const passed = missing.length === 0;
  const { isBlankTemplate } = detectBlankTemplate(info);
  const note = isBlankTemplate ? ' (This appears to be an unfilled template — not a completed certificate.)' : '';
  return {
    id: 'required_fields',
    name: 'Required Fields Complete',
    passed,
    description: passed
      ? 'All required fields are present in the certificate.'
      : `Missing fields: ${missing.join(', ')}.${note}`
  };
}

function checkDateLogic(info) {
  const issue = parseDate(info.issueDate);
  const from  = parseDate(info.leaveFrom);
  const to    = parseDate(info.leaveTo);
  // Medical clearance certs have no leave dates — that's okay
  const isClearance = (info.diagnosis || '').toLowerCase().match(/clearance|fit to|normal|essentially normal/);
  if (!from && !to && isClearance) {
    return { id: 'date_logic', name: 'Date Logic Valid', passed: true, description: 'Medical clearance certificate — leave dates not required.' };
  }
  if (!issue || !from || !to) {
    return { id: 'date_logic', name: 'Date Logic Valid', passed: false, description: 'Could not parse all dates for logic check.' };
  }
  const issueBeforeOrOnLeave = issue <= from;
  const fromBeforeTo = from <= to;
  const passed = issueBeforeOrOnLeave && fromBeforeTo;
  return {
    id: 'date_logic',
    name: 'Date Logic Valid',
    passed,
    description: passed
      ? 'Date sequence is logical: issue date → leave start → leave end.'
      : !issueBeforeOrOnLeave
        ? 'Certificate issued AFTER leave start date — major red flag.'
        : 'Leave end date is before leave start date — invalid.'
  };
}

function checkLeaveDuration(info) {
  const from = parseDate(info.leaveFrom);
  const to   = parseDate(info.leaveTo);
  const isClearance = (info.diagnosis || '').toLowerCase().match(/clearance|fit to|normal|essentially normal/);
  if (!from && !to && isClearance) {
    return { id: 'leave_duration', name: 'Leave Duration Reasonable', passed: true, description: 'Medical clearance certificate — no leave dates required.' };
  }
  if (!from || !to) return { id: 'leave_duration', name: 'Leave Duration Reasonable', passed: false, description: 'Cannot calculate leave duration — dates missing.' };
  const days = daysBetween(from, to) + 1;
  const diagLower = (info.diagnosis || '').toLowerCase();
  let range = DIAGNOSIS_DURATION['default'];
  for (const [key, val] of Object.entries(DIAGNOSIS_DURATION)) {
    if (diagLower.includes(key)) { range = val; break; }
  }
  const passed = days >= range[0] && days <= range[1];
  return {
    id: 'leave_duration',
    name: 'Leave Duration Reasonable',
    passed,
    description: passed
      ? `${days} day(s) leave is reasonable for "${info.diagnosis || 'this condition'}".`
      : `${days} day(s) is ${days < range[0] ? 'unusually short' : 'unusually long'} for "${info.diagnosis}" (expected ${range[0]}–${range[1]} days).`
  };
}

function checkMedicalTerminology(info) {
  const diag = (info.diagnosis || '').toLowerCase();
  if (!diag || diag.trim() === '') {
    return { id: 'medical_terminology', name: 'Medical Terminology Valid', passed: false, description: 'No diagnosis found on the certificate.' };
  }
  const valid = VALID_MEDICAL_TERMS.some(term => diag.includes(term));
  return {
    id: 'medical_terminology',
    name: 'Medical Terminology Valid',
    passed: valid,
    description: valid
      ? `"${info.diagnosis}" is a recognised medical finding.`
      : `"${info.diagnosis}" does not match known medical terminology — possible vague or fabricated diagnosis.`
  };
}

function checkHospitalName(info) {
  const name    = (info.hospitalName || '').toLowerCase().trim();
  const address = (info.address || '').toLowerCase();
  const isDeped = (info.hospitalName || '').toLowerCase().includes('deped') ||
                  (info.address || '').toLowerCase().includes('deped') ||
                  (info.doctorQualifications || '').toLowerCase().includes('division medical officer');
  if (isDeped) {
    return {
      id: 'hospital_legitimate',
      name: 'Hospital Name Legitimate',
      passed: true,
      description: 'DepEd Division Medical Office — recognized government health facility.'
    };
  }
  const hasAddress = address && address.length > 5;
  const tooGeneric = !name || name.split(' ').length <= 1;
  const passed = !tooGeneric && hasAddress;
  return {
    id: 'hospital_legitimate',
    name: 'Hospital Name Legitimate',
    passed,
    description: passed
      ? `Hospital/clinic "${info.hospitalName}" appears legitimate with address on record.`
      : !name
        ? 'No hospital or clinic name found on the certificate.'
        : !hasAddress
          ? `No verifiable address found for "${info.hospitalName}".`
          : `"${info.hospitalName}" appears too generic — could not verify.`
  };
}

function checkPhoneFormat(info) {
  const phone = (info.phone || '').replace(/\\s/g, '');
  const philippineRegex = /^(\\+63|0)?[\\d\\s\\-().]{7,15}$/;
  const indianRegex = /^(\\+91)?[6-9]\\d{9}$/;
  const genericRegex = /^\\+?[\\d\\s\\-().]{7,15}$/;
  const passed = phone.length > 0 && (philippineRegex.test(phone) || indianRegex.test(phone) || genericRegex.test(phone));
  return {
    id: 'phone_format',
    name: 'Phone Format Valid',
    passed,
    description: passed
      ? `Phone number "${info.phone}" follows a valid format.`
      : `Phone number "${info.phone || 'missing'}" is invalid or absent.`
  };
}

function checkReferenceNumber(info) {
  const ref = (info.referenceNumber || '').trim();
  const passed = ref.length > 2 && ref !== 'Not found';
  return {
    id: 'reference_number',
    name: 'Reference Number Present',
    passed,
    description: passed
      ? `Reference/control number "${ref}" is present.`
      : 'No reference or control number found — common in government-issued certificates.'
  };
}

function checkSignatureSeal(info) {
  const val = (info.signatureSealPresent || '').toLowerCase();
  const passed = val === 'yes';
  return {
    id: 'signature_seal',
    name: 'Signature/Seal Present',
    passed,
    description: passed
      ? 'Signature and/or seal reported as present.'
      : 'No wet signature or official seal detected — certificate may be a blank template or digital copy.'
  };
}

function checkDiagnosisDuration(info) {
  const from  = parseDate(info.leaveFrom);
  const to    = parseDate(info.leaveTo);
  const diag  = (info.diagnosis || '').toLowerCase();
  const isClearance = diag.match(/clearance|fit to|normal|essentially normal/);
  if (isClearance && !from && !to) {
    return { id: 'diagnosis_duration', name: 'Diagnosis Matches Duration', passed: true, description: 'Medical clearance — no leave duration expected.' };
  }
  if (!from || !to || !diag) {
    return { id: 'diagnosis_duration', name: 'Diagnosis Matches Duration', passed: false, description: 'Insufficient data to validate diagnosis vs duration.' };
  }
  const days = daysBetween(from, to) + 1;
  let range = DIAGNOSIS_DURATION['default'];
  let matchedDiag = 'condition';
  for (const [key, val] of Object.entries(DIAGNOSIS_DURATION)) {
    if (diag.includes(key)) { range = val; matchedDiag = key; break; }
  }
  const passed = days >= range[0] && days <= range[1];
  return {
    id: 'diagnosis_duration',
    name: 'Diagnosis Matches Duration',
    passed,
    description: passed
      ? `${days} day(s) is appropriate for "${info.diagnosis}".`
      : `${days} day(s) does not match typical recovery for "${info.diagnosis}" (expected ${range[0]}–${range[1]} days).`
  };
}

// ============================================
// MAIN EXPORT
// ============================================
function runAllRules(extractedInfo) {
  const info = extractedInfo || {};
  const templateCheck = detectBlankTemplate(info);
  const confidenceMap = buildConfidenceMap(info);

  const checks = [
    checkDoctorRegistration(info),
    checkIssueDateValidity(info),
    checkWeekendHoliday(info),
    checkRequiredFields(info),
    checkDateLogic(info),
    checkLeaveDuration(info),
    checkMedicalTerminology(info),
    checkHospitalName(info),
    checkPhoneFormat(info),
    checkReferenceNumber(info),
    checkSignatureSeal(info),
    checkDiagnosisDuration(info),
  ];

  const passed    = checks.filter(c => c.passed).length;
  const failed    = checks.filter(c => !c.passed).length;
  const ruleScore = Math.round((passed / checks.length) * 100);

  return { checks, passed, failed, ruleScore, templateCheck, confidenceMap };
}

module.exports = { runAllRules, detectBlankTemplate, buildConfidenceMap };
