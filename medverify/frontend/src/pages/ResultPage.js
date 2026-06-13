import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ResultPage.css';

export default function ResultPage({ result, onNew }) {
  const [showRaw, setShowRaw] = useState(false);
  const navigate = useNavigate();

  const {
    authenticityScore,
    riskLevel,
    verdict,
    extractedInfo,
    validationChecks,
    aiObservations,
    passedCount,
    failedCount,
    rawResponse,
    processingTime,
    filename,
    analysisId
  } = result;

  const getRiskColor = (risk) => {
    if (risk === 'HIGH_RISK') return '#e53e3e';
    if (risk === 'MEDIUM_RISK') return '#f6ad55';
    return '#00d084';
  };

  const getRiskLabel = (risk) => {
    if (risk === 'HIGH_RISK') return 'HIGH RISK';
    if (risk === 'MEDIUM_RISK') return 'MEDIUM RISK';
    return 'LOW RISK';
  };

  const riskColor = getRiskColor(riskLevel);

  const handleExport = () => {
    const reportData = JSON.stringify(result, null, 2);
    const blob = new Blob([reportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medverify-report-${analysisId?.slice(0, 8) || 'result'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNew = () => {
    onNew();
    navigate('/');
  };

  return (
    <div className="result-container fade-in">
      {/* Score Header */}
      <div className="result-header">
        <div className="score-card">
          <div className="risk-badge" style={{ background: `${riskColor}20`, color: riskColor, borderColor: `${riskColor}40` }}>
            {getRiskLabel(riskLevel)}
          </div>
          <div className="score-row">
            <div className="score-icon" style={{ borderColor: riskColor }}>
              {authenticityScore >= 60 ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={riskColor} strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={riskColor} strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              )}
            </div>
            <div>
              <h1 className="score-value">{authenticityScore}% Authenticity Score</h1>
              <p className="score-verdict">{verdict}</p>
            </div>
          </div>

          <div className="score-bar-container">
            <div className="score-bar-track">
              <div
                className="score-bar-fill"
                style={{
                  width: `${authenticityScore}%`,
                  background: `linear-gradient(90deg, #e53e3e, ${riskColor})`
                }}
              />
            </div>
            <div className="score-bar-labels">
              <span>0% (High Risk)</span>
              <span>100% (Low Risk)</span>
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

      {/* Extracted Info */}
      <div className="result-section">
        <h3 className="section-title">Extracted Information</h3>
        <div className="info-grid">
          {[
            { label: 'DOCTOR NAME', value: extractedInfo?.doctorName },
            { label: 'HOSPITAL NAME', value: extractedInfo?.hospitalName },
            { label: 'PATIENT NAME', value: extractedInfo?.patientName },
            { label: 'DIAGNOSIS', value: extractedInfo?.diagnosis },
            { label: 'ISSUE DATE', value: extractedInfo?.issueDate },
            { label: 'LEAVE FROM', value: extractedInfo?.leaveFrom },
            { label: 'LEAVE TO', value: extractedInfo?.leaveTo },
            { label: 'PHONE', value: extractedInfo?.phone },
            { label: 'REFERENCE NUMBER', value: extractedInfo?.referenceNumber },
            { label: 'SIGNATURE/SEAL PRESENT', value: extractedInfo?.signatureSealPresent },
            { label: 'REG. NUMBER', value: extractedInfo?.registrationNumber || 'Not found' },
            { label: 'QUALIFICATIONS', value: extractedInfo?.doctorQualifications || 'Not found' },
          ].map(({ label, value }) => (
            <div className="info-cell" key={label}>
              <div className="info-label">{label}</div>
              <div className="info-value">{value || '—'}</div>
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
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
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
              <path d="M12 8v4"/>
              <path d="M12 16h.01"/>
            </svg>
            AI Observations
          </h3>
          <div className="observations-list">
            {aiObservations.map((obs, i) => (
              <div className="observation-item" key={i}>
                <span className="obs-bullet">•</span>
                <p>{obs}</p>
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
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            Debug Console (Raw API Response)
          </h3>
          <span className="debug-toggle">{showRaw ? '▲ Hide' : '▼ Show'}</span>
        </div>
        {showRaw && (
          <pre className="debug-content">{rawResponse}</pre>
        )}
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
        <button className="action-btn secondary" onClick={() => navigate('/result')}>
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

      {/* Footer */}
      <div className="result-footer">
        <span>MedVerify v2.0</span>
        <span>•</span>
        <span>Powered by OCR + Gemini Flash</span>
        <span>•</span>
        <span>12-Point Validation</span>
        {processingTime && <><span>•</span><span>{(processingTime / 1000).toFixed(1)}s</span></>}
      </div>
    </div>
  );
}
