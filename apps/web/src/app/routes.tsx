import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../layouts/PublicLayout';
import { AdminLayout } from '../layouts/AdminLayout';
import { RequireAdmin, RequireAuth, RequireCompleteProfile, RequireEngagement } from './guards';
import { LandingPage } from '../features/landing/LandingPage';
import { SignInPage, AuthCallbackPage } from '../features/auth/AuthPages';
import { Loading } from '../shared/ui';

// The admin panel is a separate chunk: a client booking a consultation should
// not download the practitioner's tooling.
const AdminDashboard = lazy(() =>
  import('../features/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })),
);
const AdminProfilePage = lazy(() =>
  import('../features/admin/AdminProfilePage').then((m) => ({ default: m.AdminProfilePage })),
);
const AdminServicesPage = lazy(() =>
  import('../features/admin/AdminServicesPage').then((m) => ({ default: m.AdminServicesPage })),
);
const AdminSchedulePage = lazy(() =>
  import('../features/admin/AdminSchedulePage').then((m) => ({ default: m.AdminSchedulePage })),
);
const AdminAppointmentsPage = lazy(() =>
  import('../features/admin/AdminAppointmentsPage').then((m) => ({
    default: m.AdminAppointmentsPage,
  })),
);
const AdminItrPage = lazy(() =>
  import('../features/admin/AdminItrPage').then((m) => ({ default: m.AdminItrPage })),
);
const AdminUsersPage = lazy(() =>
  import('../features/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminInboxPage = lazy(() =>
  import('../features/admin/AdminInboxPage').then((m) => ({ default: m.AdminInboxPage })),
);
const AdminEnquiriesPage = lazy(() =>
  import('../features/admin/AdminEnquiriesPage').then((m) => ({ default: m.AdminEnquiriesPage })),
);

const BookingWizard = lazy(() =>
  import('../features/booking/BookingWizard').then((m) => ({ default: m.BookingWizard })),
);
const ItrRegistrationPage = lazy(() =>
  import('../features/itr/ItrRegistrationPage').then((m) => ({ default: m.ItrRegistrationPage })),
);
const MyEngagementsPage = lazy(() =>
  import('../features/engagements/MyEngagementsPage').then((m) => ({
    default: m.MyEngagementsPage,
  })),
);
const MessagesPage = lazy(() =>
  import('../features/messaging/MessagesPage').then((m) => ({ default: m.MessagesPage })),
);
const ContactPage = lazy(() =>
  import('../features/contact/ContactPage').then((m) => ({ default: m.ContactPage })),
);
const CompleteProfilePage = lazy(() =>
  import('../features/onboarding/CompleteProfilePage').then((m) => ({
    default: m.CompleteProfilePage,
  })),
);

export function AppRoutes(): React.ReactElement {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<PublicLayout />}>
          {/* Open to anyone */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          {/* Signed in */}
          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<CompleteProfilePage />} />

            {/* Signed in, and we know who they are */}
            <Route element={<RequireCompleteProfile />}>
              <Route path="/book" element={<BookingWizard />} />
              <Route path="/itr" element={<ItrRegistrationPage />} />
              <Route path="/me" element={<MyEngagementsPage />} />

              {/* …and they hold a live engagement */}
              <Route element={<RequireEngagement />}>
                <Route path="/messages" element={<MessagesPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        {/* The practitioner */}
        <Route element={<RequireAuth />}>
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="appointments" element={<AdminAppointmentsPage />} />
              <Route path="itr" element={<AdminItrPage />} />
              <Route path="inbox" element={<AdminInboxPage />} />
              <Route path="enquiries" element={<AdminEnquiriesPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="schedule" element={<AdminSchedulePage />} />
              <Route path="services" element={<AdminServicesPage />} />
              <Route path="profile" element={<AdminProfilePage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
