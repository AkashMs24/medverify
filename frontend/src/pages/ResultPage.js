import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ResultPage.css';

export default function ResultPage({ result, onNew }) {
  const [showRaw, setShowRaw] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const navigate = useNavigate();

  const {
    authenticityScore, riskLevel, verdict,
    extractedInfo, validationChecks, aiObservations,
    passedCount, failedCount, rawResponse, processingTime,
    filename, analysisId, isBlankTemplate, templateWarning,
    confidenceMap, prcVerification, submissionType, ocrAvailable, aiAvailable
  } = result;

  const getRiskColor = (risk) => {
    if (risk === 'HIGH_RISK') return '#e53e3e';
    if (risk === 'MEDIUM_RISK') return '#f6ad55';
    if (risk === 'TEMPLATE_DETECTED') return '#a78bfa';
    return '#00d084';
  };

  const getRiskLabel = (risk) => {
    if (risk === 'HIGH_RISK') return 'HIGH RISK';
    if (risk === 'MEDIUM_RISK') return 'MEDIUM RISK';
    if (risk === 'TEMPLATE_DETECTED') return 'BLANK TEMPLATE';
    return 'LOW RISK';
  };

  const getConfidenceBadge = (field) => {
    if (!confidenceMap || !confidenceMap[field]) return null;
    const { confidence, label } = confidenceMap[field];
    const color = confidence >= 80 ? '#00d084' : confidence >= 50 ? '#f6ad55' : '#e53e3e';
    return (
      <span style={{
        fontSize: '10px', padding: '1px 6px', borderRadius: '10px',
        background: `${color}20`, color, border: `1px solid ${color}40`,
        marginLeft: '6px', fontWeight: 600
      }}>
        {confidence}% {label}
      </span>
    );
  };

  const getSubmissionBadge = () => {
    const labels = {
      'pdf': '📄 PDF',
      'scanned_image': '🖼 Scanned Image',
      'screenshot': '📸 Screenshot',
      'gif_animation': '🎞 GIF',
      'unknown': '❓ Unknown'
    };
    return labels[submissionType] || submissionType;
  };

  const riskColor = getRiskColor(riskLevel);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `medverify-report-${analysisId?.slice(0, 8) || 'result'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNew = () => { onNew(); navigate('/'); };

  // ── BLANK TEMPLATE VIEW ────────────────────────────────────────────────────
  if (isBlankTemplate) {
    return (
      <div className="result-container fade-in">
        <div className="result-header">
          <div className="score-card" style={{ borderColor: '#a78bfa40' }}>
            <div className="risk-badge" style={{ background: '#a78bfa20', color: '#a78bfa', borderColor: '#a78bfa40' }}>
              📋 BLANK TEMPLATE DETECTED
            </div>
            <div style={{ margin: '20px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📄</div>
              <h2 style={{ color: '#a78bfa', fontSize: '20px', marginBottom: '8px' }}>
                Unfilled Official Template
              </h2>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto', lineHeight: 1.6 }}>
                {templateWarning}
              </p>
            </div>
            <div style={{
              background: '#a78bfa10', border: '1px solid #a78bfa30',
              borderRadius: '8px', padding: '16px', marginTop: '12px'
            }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '8px', fontWeight: 600 }}>
                What to do:
              </p>
              <ul style={{ color: 'var(--text-secondary)', fontSize: '13px', paddingLeft: '20px', lineHeight: 1.8 }}>
                <li>Upload a completed certificate with patient information filled in</li>
                <li>Ensure the certificate has the patient's name, date of issue, and diagnosis</li>
                <li>The doctor's signature or official seal should be present</li>
                <li>A reference or control number improves verification accuracy</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Still show what was extracted */}
        <div className="result-section">
          <h3 className="section-title">Fields Detected (All Empty)</h3>
          <div className="info-grid">
            {[
              { label: 'DOCTOR NAME', value: extractedInfo?.doctorName, field: 'doctorName' },
              { label: 'PATIENT NAME', value: extractedInfo?.patientName, field: 'patientName' },
              { label: 'ISSUE DATE', value: extractedInfo?.issueDate, field: 'issueDate' },
              { label: 'DIAGNOSIS', value: extractedInfo?.diagnosis, field: 'diagnosis' },
              { label: 'REG. NUMBER', value: extractedInfo?.registrationNumber, field: 'registrationNumber' },
              { label: 'QUALIFICATIONS', value: extractedInfo?.doctorQualifications, field: 'doctorQualifications' },
            ].map(({ label, value, field }) => (
              <div className="info-cell" key={label}>
                <div className="info-label">{label}</div>
                <div className="info-value" style={{ color: !value ? 'var(--text-muted)' : undefined }}>
                  {value || '— empty field —'}
                  {value && getConfidenceBadge(field)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="result-section">
          <h3 className="section-title">AI Observations</h3>
          <div className="observations-list">
            {aiObservations?.map((obs, i) => (
              <div className="observation-item" key={i}>
                <span className="obs-bullet">•</span><p>{obs}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="result-actions">
          <button className="action-btn primary" onClick={handleNew}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Upload a Completed Certificate
          </button>
        </div>
        <div className="result-footer">
          <span>MedVerify v3.0</span><span>•</span>
          <span>{getSubmissionBadge()}</span><span>•</span>
          <span>Template Detection Active</span>
          {processingTime && <><span>•</span><span>{(processingTime/1000).toFixed(1)}s</span></>}
        </div>
      </div>
    );
  }

  // ── NORMAL RESULT VIEW ─────────────────────────────────────────────────────
  return (
    <div className="result-container fade-in">
      {/* Score Header */}
      <div className="result-header">
        <div className="score-card">
          {/* Status badges */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div className="risk-badge" style={{ background: `${riskColor}20`, color: riskColor, borderColor: `${riskColor}40` }}>
              {getRiskLabel(riskLevel)}
            </div>
            <div style={{
              padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
              background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)'
            }}>
              {getSubmissionBadge()}
            </div>
            {!ocrAvailable && (
              <div style={{ padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'#e53e3e20', color:'#e53e3e', border:'1px solid #e53e3e40' }}>
                ⚠ OCR Unavailable
              </div>
            )}
            {!aiAvailable && (
              <div style={{ padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'#f6ad5520', color:'#f6ad55', border:'1px solid #f6ad5540' }}>
                ⚠ AI Unavailable
              </div>
            )}
          </div>

          <div className="score-row">
            <div className="score-icon" style={{ borderColor: riskColor }}>
              {authenticityScore >= 60 ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={riskColor} strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={riskColor} strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              )}
            </div>
            <div>
              <h1 className="score-value">{authenticityScore}% Authenticity Score</h1>
              <p className="score-verdict">{verdict}</p>
            </div>
          </div>

          {/* Gradient score bar */}
          <div className="score-bar-container">
            <div className="score-bar-track">
              <div className="score-bar-fill" style={{
                width: `${authenticityScore}%`,
                background: authenticityScore >= 70
                  ? 'linear-gradient(90deg, #f6ad55, #00d084)'
                  : authenticityScore >= 40
                  ? 'linear-gradient(90deg, #e53e3e, #f6ad55)'
                  : 'linear-gradient(90deg, #7b0000, #e53e3e)'
              }}/>
            </div>
            <div className="score-bar-labels">
              <span>0% (High Risk)</span><span>100% (Low Risk)</span>
            </div>
          </div>

          <div className="pass-fail-summary">
            <div className="summary-item passed">
              <span className="summary-num">{passedCount}</span>
              <span className="summary-label">Passed</span>
            </div>
            <div className="summary-item failed">
              <span className="summary-num">{failedCount}</span>
              <span className="summary-label">Failed</span>
            </div>
          </div>
        </div>
      </div>

      {/* PRC Verification */}
      {prcVerification && (
        <div className="result-section">
          <h3 className="section-title">🇵🇭 PRC License Verification</h3>
          <div style={{
            background: prcVerification.verified === 'format_ok' ? '#00d08410' : '#e53e3e10',
            border: `1px solid ${prcVerification.verified === 'format_ok' ? '#00d08430' : '#e53e3e30'}`,
            borderRadius: '8px', padding: '14px 16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '16px' }}>
                {prcVerification.verified === 'format_ok' ? '✅' : '❌'}
              </span>
              <strong style={{ color: prcVerification.verified === 'format_ok' ? '#00d084' : '#e53e3e', fontSize: '13px' }}>
                {prcVerification.verified === 'format_ok' ? 'Valid PRC Format' : 'Invalid/Missing License'}
              </strong>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
              {prcVerification.note}
            </p>
            {prcVerification.prcUrl && (
              <a href={prcVerification.prcUrl} target="_blank" rel="noreferrer"
                style={{ color: '#63b3ed', fontSize: '12px', display: 'block', marginTop: '8px' }}>
                Verify manually at prc.gov.ph →
              </a>
            )}
          </div>
        </div>
      )}

      {/* Extracted Info with Confidence */}
      <div className="result-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>Extracted Information</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Confidence scores shown per field
          </span>
        </div>
        <div className="info-grid">
          {[
            { label: 'DOCTOR NAME',         value: extractedInfo?.doctorName,          field: 'doctorName' },
            { label: 'HOSPITAL NAME',        value: extractedInfo?.hospitalName,         field: 'hospitalName' },
            { label: 'PATIENT NAME',         value: extractedInfo?.patientName,          field: 'patientName' },
            { label: 'DIAGNOSIS',            value: extractedInfo?.diagnosis,            field: 'diagnosis' },
            { label: 'ISSUE DATE',           value: extractedInfo?.issueDate,            field: 'issueDate' },
            { label: 'LEAVE FROM',           value: extractedInfo?.leaveFrom,            field: 'leaveFrom' },
            { label: 'LEAVE TO',             value: extractedInfo?.leaveTo,              field: 'leaveTo' },
            { label: 'PHONE',                value: extractedInfo?.phone,                field: 'phone' },
            { label: 'REFERENCE NUMBER',     value: extractedInfo?.referenceNumber,      field: 'referenceNumber' },
            { label: 'SIGNATURE/SEAL',       value: extractedInfo?.signatureSealPresent, field: 'signatureSealPresent' },
            { label: 'REG. NUMBER',          value: extractedInfo?.registrationNumber,   field: 'registrationNumber' },
            { label: 'QUALIFICATIONS',       value: extractedInfo?.doctorQualifications, field: 'doctorQualifications' },
          ].map(({ label, value, field }) => (
            <div className="info-cell" key={label}>
              <div className="info-label">{label}</div>
              <div className="info-value">
                <span style={{ color: !value ? 'var(--text-muted)' : undefined }}>{value || '—'}</span>
                {value && getConfidenceBadge(field)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Validation Checks */}
      <div className="result-section">
        <h3 className="section-title">Validation Rule Checks</h3>
        <div className="checks-list">
          {validationChecks?.map((check) => (
            <div className={`check-item ${check.passed ? 'pass' : 'fail'}`} key={check.id}>
              <div className="check-icon">
                {check.passed ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00d084" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53e3e" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                )}
              </div>
              <div className="check-content">
                <div className="check-name">{check.name}</div>
                <div className="check-desc">{check.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Observations */}
      {aiObservations?.length > 0 && (
        <div className="result-section">
          <h3 className="section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>
              <path d="M12 8v4"/><path d="M12 16h.01"/>
            </svg>
            AI Observations
          </h3>
          <div className="observations-list">
            {aiObservations.map((obs, i) => (
              <div className="observation-item" key={i}>
                <span className="obs-bullet">•</span><p>{obs}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debug Console */}
      <div className="result-section">
        <div className="debug-header" onClick={() => setShowRaw(!showRaw)}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            Debug Console (Raw API Response)
          </h3>
          <span className="debug-toggle">{showRaw ? '▲ Hide' : '▼ Show'}</span>
        </div>
        {showRaw && <pre className="debug-content">{rawResponse}</pre>}
      </div>

      {/* Action Buttons */}
      <div className="result-actions">
        <button className="action-btn secondary" onClick={handleExport}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export Report
        </button>
        <button className="action-btn secondary" onClick={() => navigate('/')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4"/>
          </svg>
          Retry Analysis
        </button>
        <button className="action-btn primary" onClick={handleNew}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Analysis
        </button>
      </div>

      <div className="result-footer">
        <span>MedVerify v3.0</span><span>•</span>
        <span>OCR + Gemini Flash</span><span>•</span>
        <span>12-Point Validation</span><span>•</span>
        <span>PRC Check</span>
        {processingTime && <><span>•</span><span>{(processingTime/1000).toFixed(1)}s</span></>}
      </div>
    </div>
  );
}
