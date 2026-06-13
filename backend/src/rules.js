// ============================================
// MedVerify - Pure JavaScript Rule Engine
// Runs independently of any AI/API
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
  'kidney stone', 'back pain', 'abdominal pain', 'chest pain', 'headache'
];

const INDIAN_PUBLIC_HOLIDAYS = [
  '01-01', '01-26', '03-25', '04-14', '04-18', '05-01',
  '08-15', '10-02', '10-12', '10-24', '11-01', '11-14',
  '12-25', '12-31'
];

// Reasonable leave durations per diagnosis (in days)
const DIAGNOSIS_DURATION = {
  'influenza': [3, 10], 'fever': [2, 7], 'malaria': [5, 14],
  'typhoid': [7, 21], 'dengue': [5, 14], 'covid': [7, 21],
  'pneumonia': [7, 21], 'bronchitis': [5, 14], 'fracture': [7, 60],
  'appendicitis': [7, 21], 'gastroenteritis': [2, 7],
  'food poisoning': [2, 5], 'viral': [3, 7], 'cold': [2, 5],
  'migraine': [1, 3], 'injury': [3, 30], 'default': [1, 30]
};

function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    // Try common formats
    const formats = [
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
      /(\w+)\s+(\d{1,2}),?\s+(\d{4})/
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

// ============================================
// THE 12 RULE CHECKS - Pure JavaScript
// ============================================

function checkDoctorRegistration(info) {
  const hasReg = info.registrationNumber &&
    info.registrationNumber !== 'Not found' &&
    info.registrationNumber.length > 3;
  return {
    id: 'doctor_registration',
    name: 'Doctor Registration Format',
    passed: hasReg,
    description: hasReg
      ? `Registration number found: ${info.registrationNumber}`
      : 'No medical registration or license number provided for the signatory.'
  };
}

function checkIssueDateValidity(info) {
  const date = parseDate(info.issueDate);
  const valid = date !== null && date <= new Date();
  return {
    id: 'issue_date_validity',
    name: 'Issue Date Validity',
    passed: valid,
    description: valid
      ? `Issue date "${info.issueDate}" is valid and not in the future.`
      : `Issue date "${info.issueDate}" is missing, invalid, or in the future.`
  };
}

function checkWeekendHoliday(info) {
  const date = parseDate(info.issueDate);
  if (!date) return { id: 'weekend_holiday', name: 'Weekend/Holiday Issue', passed: false, description: 'Could not verify issue date.' };

  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const isHoliday = INDIAN_PUBLIC_HOLIDAYS.includes(mmdd);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const passed = !isWeekend && !isHoliday;
  return {
    id: 'weekend_holiday',
    name: 'Weekend/Holiday Issue',
    passed,
    description: passed
      ? `${info.issueDate} was a ${dayNames[day]} (standard business day).`
      : `${info.issueDate} was a ${isWeekend ? dayNames[day] + ' (weekend)' : 'public holiday'} — suspicious for a clinic visit.`
  };
}

function checkRequiredFields(info) {
  const required = ['doctorName', 'hospitalName', 'patientName', 'diagnosis', 'issueDate'];
  const missing = required.filter(f => !info[f] || info[f] === 'Not found' || info[f].trim() === '');
  const passed = missing.length === 0;
  return {
    id: 'required_fields',
    name: 'Required Fields Complete',
    passed,
    description: passed
      ? 'All required fields are present in the certificate.'
      : `Missing fields: ${missing.join(', ')}.`
  };
}

function checkDateLogic(info) {
  const issue = parseDate(info.issueDate);
  const from = parseDate(info.leaveFrom);
  const to = parseDate(info.leaveTo);

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
  const to = parseDate(info.leaveTo);
  if (!from || !to) return { id: 'leave_duration', name: 'Leave Duration Reasonable', passed: false, description: 'Cannot calculate leave duration.' };

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
      ? `${days} day(s) leave is reasonable for ${info.diagnosis || 'this condition'}.`
      : `${days} day(s) is ${days < range[0] ? 'unusually short' : 'unusually long'} for ${info.diagnosis || 'this condition'} (expected ${range[0]}–${range[1]} days).`
  };
}

function checkMedicalTerminology(info) {
  const diag = (info.diagnosis || '').toLowerCase();
  const valid = VALID_MEDICAL_TERMS.some(term => diag.includes(term));
  return {
    id: 'medical_terminology',
    name: 'Medical Terminology Valid',
    passed: valid,
    description: valid
      ? `"${info.diagnosis}" is a recognised medical condition.`
      : `"${info.diagnosis}" does not match known medical terminology — possible vague or fabricated diagnosis.`
  };
}

function checkHospitalName(info) {
  const name = (info.hospitalName || '').toLowerCase();
  const address = (info.address || '').toLowerCase();

  // Red flags in hospital names
  const suspiciousWords = ['general', 'city', 'central', 'holy', 'divine', 'blessing', 'grace'];
  const genericCount = suspiciousWords.filter(w => name.includes(w)).length;

  // Check if city in address matches hospital name hints
  const hasAddress = address && address.length > 5;

  // Very generic single-word names are suspicious
  const tooGeneric = name.split(' ').length <= 1;

  const passed = !tooGeneric && hasAddress;
  return {
    id: 'hospital_legitimate',
    name: 'Hospital Name Legitimate',
    passed,
    description: passed
      ? `Hospital name "${info.hospitalName}" appears legitimate with address on record.`
      : !hasAddress
        ? `No verifiable address found for "${info.hospitalName}".`
        : `"${info.hospitalName}" appears generic — could not verify in public records.`
  };
}

function checkPhoneFormat(info) {
  const phone = (info.phone || '').replace(/\s/g, '');
  // Indian: 10 digits starting with 6-9, or with +91
  // US: XXX-XXX-XXXX
  const indianRegex = /^(\+91)?[6-9]\d{9}$/;
  const usRegex = /^\d{3}[-.\s]\d{3}[-.\s]\d{4}$/;
  const genericRegex = /^\+?[\d\s\-().]{7,15}$/;

  const passed = phone.length > 0 && (indianRegex.test(phone) || usRegex.test(phone) || genericRegex.test(phone));
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
  const ref = info.referenceNumber || '';
  const passed = ref.length > 2 && ref !== 'Not found';
  return {
    id: 'reference_number',
    name: 'Reference Number Present',
    passed,
    description: passed
      ? `Reference/employee number "${ref}" is present.`
      : 'No reference or employee number found on the certificate.'
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
      : 'No signature or official seal detected on the certificate.'
  };
}

function checkDiagnosisDuration(info) {
  const from = parseDate(info.leaveFrom);
  const to = parseDate(info.leaveTo);
  const diag = (info.diagnosis || '').toLowerCase();

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
      ? `${days} day(s) is appropriate leave for ${info.diagnosis}.`
      : `${days} day(s) does not match typical recovery for ${info.diagnosis} (expected ${range[0]}–${range[1]} days).`
  };
}

// ============================================
// MAIN EXPORT - Run all 12 checks
// ============================================
function runAllRules(extractedInfo) {
  const info = extractedInfo || {};
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

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  const ruleScore = Math.round((passed / checks.length) * 100);

  return { checks, passed, failed, ruleScore };
}

module.exports = { runAllRules };
