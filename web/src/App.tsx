import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import ActiveConsultationPage from './pages/ActiveConsultationPage';
import ConsultationDetailPage from './pages/ConsultationDetailPage';
import AdminDashboardPage from './pages/AdminDashboardPage';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/signup"
        element={user ? <Navigate to="/dashboard" replace /> : <SignupPage />}
      />
      <Route
        path="/dashboard"
        element={user ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/consultations/:id"
        element={user ? <ActiveConsultationPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/consultations/:id/detail"
        element={user ? <ConsultationDetailPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/admin"
        element={user?.role === 'admin' ? <AdminDashboardPage /> : <Navigate to="/dashboard" replace />}
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;

