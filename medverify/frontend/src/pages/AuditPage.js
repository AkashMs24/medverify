import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AuditPage.css';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function AuditPage({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/audit`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setLogs(res.data);
      } catch (err) {
        console.error('Failed to fetch audit logs');
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [token]);

  const getRiskColor = (risk) => {
    if (risk === 'HIGH_RISK') return '#e53e3e';
    if (risk === 'MEDIUM_RISK') return '#f6ad55';
    return '#00d084';
  };

  const getRiskLabel = (risk) => {
    if (risk === 'HIGH_RISK') return 'HIGH';
    if (risk === 'MEDIUM_RISK') return 'MED';
    return 'LOW';
  };

  return (
    <div className="audit-container">
      <div className="audit-header fade-in">
        <h2>Audit Log</h2>
        <p>History of all certificate analyses performed in this session</p>
        <div className="audit-count">{logs.length} {logs.length === 1 ? 'record' : 'records'}</div>
      </div>

      {loading ? (
        <div className="audit-loading">
          <div className="spinner" />
          <span>Loading audit log...</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="audit-empty fade-in">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <h3>No analyses yet</h3>
          <p>Upload a medical certificate from the Dashboard to get started.</p>
        </div>
      ) : (
        <div className="audit-table-wrap fade-in">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>File</th>
                <th>User</th>
                <th>Score</th>
                <th>Risk</th>
                <th>Passed</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="td-time">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="td-file">
                    <span title={log.filename}>
                      {log.filename?.length > 24 ? log.filename.slice(0, 24) + '…' : log.filename}
                    </span>
                  </td>
                  <td className="td-user">{log.user}</td>
                  <td className="td-score">{log.score}%</td>
                  <td>
                    <span className="risk-pill" style={{
                      background: `${getRiskColor(log.riskLevel)}20`,
                      color: getRiskColor(log.riskLevel),
                      borderColor: `${getRiskColor(log.riskLevel)}40`
                    }}>
                      {getRiskLabel(log.riskLevel)}
                    </span>
                  </td>
                  <td className="td-pass">{log.passed}</td>
                  <td className="td-fail">{log.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
