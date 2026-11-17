import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, HOME_FOR_ROLE } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import { PageSkeleton } from './components/ui';
import type { Role } from './types';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const LotMapPage = lazy(() => import('./pages/LotMapPage'));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage'));
const VehicleDetailsPage = lazy(() => import('./pages/VehicleDetailsPage'));
const VoiceAssistantPage = lazy(() => import('./pages/VoiceAssistantPage'));
const ServicePage = lazy(() => import('./pages/ServicePage'));
const ActionCenterPage = lazy(() => import('./pages/ActionCenterPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const SustainabilityPage = lazy(() => import('./pages/SustainabilityPage'));
const TrackPage = lazy(() => import('./pages/TrackPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading && !user) return <div className="p-8"><PageSkeleton /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME_FOR_ROLE[user.role]} replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? HOME_FOR_ROLE[user.role] : '/login'} replace />;
}

const ALL: Role[] = ['MANAGER', 'LOT_ASSOCIATE', 'SERVICE_ADVISOR'];
const OPS: Role[] = ['MANAGER', 'SERVICE_ADVISOR'];

export default function App() {
  return (
    <Suspense fallback={<div className="p-8"><PageSkeleton /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/track/:code" element={<TrackPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="/dashboard" element={<RequireAuth roles={OPS}><DashboardPage /></RequireAuth>} />
          <Route path="/voice" element={<RequireAuth roles={['LOT_ASSOCIATE', 'MANAGER']}><VoiceAssistantPage /></RequireAuth>} />
          <Route path="/lot" element={<RequireAuth roles={ALL}><LotMapPage /></RequireAuth>} />
          <Route path="/vehicles" element={<RequireAuth roles={ALL}><VehiclesPage /></RequireAuth>} />
          <Route path="/vehicles/:id" element={<RequireAuth roles={ALL}><VehicleDetailsPage /></RequireAuth>} />
          <Route path="/service" element={<RequireAuth roles={OPS}><ServicePage /></RequireAuth>} />
          <Route path="/actions" element={<RequireAuth roles={OPS}><ActionCenterPage /></RequireAuth>} />
          <Route path="/analytics" element={<RequireAuth roles={['MANAGER']}><AnalyticsPage /></RequireAuth>} />
          <Route path="/customers" element={<RequireAuth roles={OPS}><CustomersPage /></RequireAuth>} />
          <Route path="/sustainability" element={<RequireAuth roles={['MANAGER']}><SustainabilityPage /></RequireAuth>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
