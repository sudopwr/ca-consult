import type { AppointmentWithUser } from '../ports/appointment-repository.js';
import type { ItrStatus } from '../../domain/itr/itr-engagement.js';
import { addDays, instantToLocalDate, zonedToInstant } from '../../domain/shared/time.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface AdminDashboard {
  today: { date: string; appointments: AppointmentWithUser[]; remainingCount: number };
  upcomingSevenDays: number;
  itrPipeline: Array<{ status: ItrStatus; count: number }>;
  awaitingClientInfo: number;
  newUsersThisWeek: number;
  unreadThreads: number;
  newEnquiries: number;
  outbox: { pending: number; failed: number; dead: number };
}

/**
 * What the practitioner sees on opening the panel. Everything here is
 * something they might act on today — no vanity metrics.
 */
export class GetAdminDashboard {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(): Promise<AdminDashboard> {
    const { uow, clock } = this.deps;
    const now = clock.now();

    const profile = await uow.repos.caProfile.find();
    const timezone = profile?.timezone ?? 'Asia/Kolkata';

    const today = instantToLocalDate(now, timezone);
    const dayStart = zonedToInstant(today, '00:00', timezone);
    const dayEnd = zonedToInstant(addDays(today, 1), '00:00', timezone);
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

    const [
      todaysAppointments,
      upcomingSevenDays,
      itrPipeline,
      newUsersThisWeek,
      unreadThreads,
      newEnquiries,
      outbox,
    ] = await Promise.all([
      uow.repos.appointments.findConfirmedInRange(dayStart, dayEnd),
      uow.repos.appointments.countUpcomingBetween(now, weekAhead),
      uow.repos.itrEngagements.pipelineCounts(),
      uow.repos.users.countCreatedSince(weekAgo),
      uow.repos.messages.countThreadsAwaitingAdmin(),
      uow.repos.contactEnquiries.countNew(),
      uow.repos.outbox.counts(),
    ]);

    const remainingCount = todaysAppointments.filter(
      (a) => a.endsAt.getTime() > now.getTime(),
    ).length;

    const awaitingClientInfo =
      itrPipeline.find((row) => row.status === 'INFO_REQUESTED')?.count ?? 0;

    return {
      today: { date: today, appointments: todaysAppointments, remainingCount },
      upcomingSevenDays,
      itrPipeline,
      awaitingClientInfo,
      newUsersThisWeek,
      unreadThreads,
      newEnquiries,
      outbox,
    };
  }
}
