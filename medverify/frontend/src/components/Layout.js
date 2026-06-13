import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Layout.css';

export default function Layout({ user, onLogout, children }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="layout">
      <header className="navbar">
        <div className="navbar-left" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <div className="nav-logo">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 8v8c0 7.18 5.16 13.9 12 15.56C23.84 29.9 29 23.18 29 16V8L16 2z" fill="#00d084" opacity="0.2"/>
              <path d="M16 2L4 8v8c0 7.18 5.16 13.9 12 15.56C23.84 29.9 29 23.18 29 16V8L16 2z" stroke="#00d084" strokeWidth="2" fill="none"/>
              <path d="M11 16l3 3 7-7" stroke="#00d084" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="nav-title">MedVerify</div>
            <div className="nav-subtitle">Hybrid Rule + AI System</div>
          </div>
        </div>

        <nav className="navbar-nav">
          <button
            className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
            onClick={() => navigate('/')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
            Dashboard
          </button>
          <button
            className={`nav-link ${location.pathname === '/audit' ? 'active' : ''}`}
            onClick={() => navigate('/audit')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Audit Log
          </button>
        </nav>

        <div className="navbar-right">
          <div className="user-info">
            <div className="user-details">
              <span className="user-name">{user.role}</span>
              <span className="user-level">{user.level}</span>
            </div>
            <button className="logout-btn" onClick={onLogout} title="Logout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
