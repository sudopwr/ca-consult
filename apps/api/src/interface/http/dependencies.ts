import type { Clock } from '../../application/ports/clock.js';
import type { UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { BookingPolicy } from '../../domain/appointment/booking-policy.js';
import type { GetHealth } from '../../application/use-cases/get-health.js';
import type { BookAppointment } from '../../application/use-cases/book-appointment.js';
import type { CancelAppointment } from '../../application/use-cases/cancel-appointment.js';
import type { RescheduleAppointment } from '../../application/use-cases/reschedule-appointment.js';
import type { UpdateAppointment } from '../../application/use-cases/update-appointment.js';
import type { ListAvailableSlots } from '../../application/use-cases/list-available-slots.js';
import type { CompleteUserProfile } from '../../application/use-cases/complete-user-profile.js';
import type { RegisterItrEngagement } from '../../application/use-cases/register-itr-engagement.js';
import type { AdvanceItrEngagement } from '../../application/use-cases/advance-itr-engagement.js';
import type {
  CloseThread,
  MarkThreadRead,
  PostMessage,
  StartThread,
} from '../../application/use-cases/messaging.js';
import type { SubmitContactEnquiry } from '../../application/use-cases/submit-contact-enquiry.js';
import type { GetMyEngagements } from '../../application/use-cases/get-my-engagements.js';
import type { GetAdminDashboard } from '../../application/use-cases/get-admin-dashboard.js';
import type { ManageCaProfile, ManageServices } from '../../application/use-cases/manage-catalogue.js';
import type { ManageAvailability } from '../../application/use-cases/manage-schedule.js';
import type { ManageUsers } from '../../application/use-cases/manage-users.js';

/**
 * Everything the routes are allowed to reach.
 *
 * Note what is absent: no Pool, no Supabase client, no mailer. A route handler
 * that wanted to run a query would have nowhere to get a connection from,
 * which is the point.
 */
export interface AppDeps {
  clock: Clock;
  uow: UnitOfWork;
  policy: BookingPolicy;
  timezone: string;

  getHealth: GetHealth;
  bookAppointment: BookAppointment;
  cancelAppointment: CancelAppointment;
  rescheduleAppointment: RescheduleAppointment;
  updateAppointment: UpdateAppointment;
  listAvailableSlots: ListAvailableSlots;
  completeUserProfile: CompleteUserProfile;
  registerItrEngagement: RegisterItrEngagement;
  advanceItrEngagement: AdvanceItrEngagement;
  startThread: StartThread;
  postMessage: PostMessage;
  markThreadRead: MarkThreadRead;
  closeThread: CloseThread;
  submitContactEnquiry: SubmitContactEnquiry;
  getMyEngagements: GetMyEngagements;
  getAdminDashboard: GetAdminDashboard;
  manageCaProfile: ManageCaProfile;
  manageServices: ManageServices;
  manageAvailability: ManageAvailability;
  manageUsers: ManageUsers;
}
