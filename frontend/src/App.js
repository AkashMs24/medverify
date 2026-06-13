import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AnalyzePage from './pages/AnalyzePage';
import ResultPage from './pages/ResultPage';
import AuditPage from './pages/AuditPage';
import Layout from './components/Layout';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('medverify_token');
    const savedUser = localStorage.getItem('medverify_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const login = (userData, userToken) => {
    setUser(userData);
    setToken(userToken);
    localStorage.setItem('medverify_token', userToken);
    localStorage.setItem('medverify_user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setAnalysisResult(null);
    localStorage.removeItem('medverify_token');
    localStorage.removeItem('medverify_user');
  };

  if (!user) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <Router>
      <Layout user={user} onLogout={logout}>
        <Routes>
          <Route path="/" element={<DashboardPage setAnalysisResult={setAnalysisResult} token={token} />} />
          <Route path="/analyze" element={<AnalyzePage setAnalysisResult={setAnalysisResult} token={token} />} />
          <Route path="/result" element={
            analysisResult
              ? <ResultPage result={analysisResult} onNew={() => setAnalysisResult(null)} />
              : <Navigate to="/" />
          } />
          <Route path="/audit" element={<AuditPage token={token} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
