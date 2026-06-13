import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './DashboardPage.css';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function DashboardPage({ setAnalysisResult, token }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const onDrop = useCallback((acceptedFiles) => {
    const f = acceptedFiles[0];
    if (!f) return;
    setFile(f);
    setError('');
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.gif'], 'application/pdf': ['.pdf'] },
    maxSize: 10 * 1024 * 1024,
    multiple: false
  });

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setError('');

    const steps = [
      'Uploading certificate...',
      'Running OCR extraction...',
      'Applying 12-point validation rules...',
      'Consulting Gemini AI for deep analysis...',
      'Generating authenticity score...',
    ];

    let stepIdx = 0;
    setProgress(steps[0]);
    const interval = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, steps.length - 1);
      setProgress(steps[stepIdx]);
    }, 1800);

    try {
      const formData = new FormData();
      formData.append('certificate', file);

      const res = await axios.post(`${API_URL}/api/analyze`, formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      clearInterval(interval);
      setAnalysisResult(res.data);
      navigate('/result');
    } catch (err) {
      clearInterval(interval);
      setError(err.response?.data?.error || 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const removeFile = () => {
    setFile(null);
    setPreview(null);
    setError('');
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header fade-in">
        <h2>Certificate Analysis</h2>
        <p>Upload a medical certificate to verify its authenticity using AI + Rule-based detection</p>
      </div>

      <div className="upload-section fade-in">
        {!file ? (
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            <div className="dropzone-content">
              <div className="upload-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
              </div>
              <h3>{isDragActive ? 'Drop the file here...' : 'Drop certificate here'}</h3>
              <p>or <span>browse files</span></p>
              <div className="upload-hints">
                <span>JPG, PNG, GIF, PDF</span>
                <span>•</span>
                <span>Max 10MB</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="file-preview">
            {preview ? (
              <div className="image-preview">
                <img src={preview} alt="Certificate preview" />
              </div>
            ) : (
              <div className="pdf-preview">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                </svg>
                <span>{file.name}</span>
              </div>
            )}
            <div className="file-info">
              <div className="file-meta">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>{file.name}</span>
                <span className="file-size">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button className="remove-btn" onClick={removeFile}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Remove
              </button>
            </div>
          </div>
        )}

        {error && <div className="analyze-error">{error}</div>}

        {loading ? (
          <div className="analyzing-state">
            <div className="analyzing-spinner">
              <div className="spinner-ring" />
              <div className="spinner-logo">
                <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                  <path d="M16 2L4 8v8c0 7.18 5.16 13.9 12 15.56C23.84 29.9 29 23.18 29 16V8L16 2z" stroke="#00d084" strokeWidth="2" fill="none"/>
                  <path d="M11 16l3 3 7-7" stroke="#00d084" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <p className="analyzing-text">{progress}</p>
            <p className="analyzing-sub">This may take 10-30 seconds</p>
          </div>
        ) : (
          <button
            className="analyze-btn"
            onClick={handleAnalyze}
            disabled={!file}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Analyze Certificate
          </button>
        )}
      </div>

      <div className="info-cards fade-in">
        <div className="info-card">
          <div className="info-card-icon green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 11 12 14 22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <h4>12-Point Validation</h4>
          <p>Comprehensive rule-based checks covering doctor registration, dates, hospital legitimacy, and more.</p>
        </div>
        <div className="info-card">
          <div className="info-card-icon blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>
              <path d="M12 8v4l3 3"/>
            </svg>
          </div>
          <h4>Gemini AI Analysis</h4>
          <p>Google's Gemini AI detects logical conflicts, grammatical errors, and template-style designs.</p>
        </div>
        <div className="info-card">
          <div className="info-card-icon orange">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h4>Risk Scoring</h4>
          <p>Authenticity score from 0–100 with HIGH / MEDIUM / LOW risk classification and detailed report.</p>
        </div>
      </div>
    </div>
  );
}
