import React, { useState } from 'react';
import axios from 'axios';
import './LoginPage.css';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
      onLogin(res.data.user, res.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const demoLogin = (u, p) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div className="login-container">
      <div className="login-card fade-in">
        <div className="login-logo">
          <div className="logo-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 8v8c0 7.18 5.16 13.9 12 15.56C23.84 29.9 29 23.18 29 16V8L16 2z" fill="#00d084" opacity="0.2"/>
              <path d="M16 2L4 8v8c0 7.18 5.16 13.9 12 15.56C23.84 29.9 29 23.18 29 16V8L16 2z" stroke="#00d084" strokeWidth="2" fill="none"/>
              <path d="M11 16l3 3 7-7" stroke="#00d084" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <h1 className="login-title">MedVerify</h1>
        <p className="login-subtitle">Medical Certificate Authenticator</p>
        <p className="login-tag">Hybrid Rule + AI System</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign In'}
          </button>
        </form>

        <div className="demo-accounts">
          <p>Demo Accounts:</p>
          <button onClick={() => demoLogin('admin', 'admin123')}>
            <span className="demo-icon">👤</span> admin / admin123
          </button>
          <button onClick={() => demoLogin('prof.sharma', 'sharma123')}>
            <span className="demo-icon">👤</span> prof.sharma / sharma123
          </button>
          <button onClick={() => demoLogin('dr.mehta', 'mehta123')}>
            <span className="demo-icon">👤</span> dr.mehta / mehta123
          </button>
        </div>
      </div>
    </div>
  );
}
