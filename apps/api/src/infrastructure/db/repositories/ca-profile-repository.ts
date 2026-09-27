import type { Querier } from '../querier.js';
import type { CaProfile } from '../../../domain/ca-profile/ca-profile.js';
import type { CaProfileRepository, UpsertCaProfileInput } from '../../../application/ports/ca-profile-repository.js';

interface CaProfileRow {
  full_name: string;
  headline: string | null;
  membership_number: string | null;
  firm_name: string | null;
  bio: string | null;
  photo_url: string | null;
  years_experience: number | null;
  qualifications: string[];
  specialisations: string[];
  languages: string[];
  office_address: string | null;
  google_maps_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp_number: string | null;
  linkedin_url: string | null;
  default_meeting_url: string | null;
  timezone: string;
  is_published: boolean;
  updated_at: Date;
}

const COLUMNS = `full_name, headline, membership_number, firm_name, bio, photo_url,
                 years_experience, qualifications, specialisations, languages, office_address,
                 google_maps_url, contact_email, contact_phone, whatsapp_number, linkedin_url,
                 default_meeting_url, timezone, is_published, updated_at`;

function toCaProfile(row: CaProfileRow): CaProfile {
  return {
    fullName: row.full_name,
    headline: row.headline,
    membershipNumber: row.membership_number,
    firmName: row.firm_name,
    bio: row.bio,
    photoUrl: row.photo_url,
    yearsExperience: row.years_experience,
    qualifications: row.qualifications,
    specialisations: row.specialisations,
    languages: row.languages,
    officeAddress: row.office_address,
    googleMapsUrl: row.google_maps_url,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    whatsappNumber: row.whatsapp_number,
    linkedinUrl: row.linkedin_url,
    defaultMeetingUrl: row.default_meeting_url,
    timezone: row.timezone,
    isPublished: row.is_published,
    updatedAt: row.updated_at,
  };
}

export class PgCaProfileRepository implements CaProfileRepository {
  constructor(private readonly db: Querier) {}

  async find(): Promise<CaProfile | null> {
    const { rows } = await this.db.query<CaProfileRow>(`select ${COLUMNS} from ca_profile`);
    return rows[0] ? toCaProfile(rows[0]) : null;
  }

  /**
   * Upsert onto the singleton row. The `published_needs_meeting_url` check
   * constraint is the real backstop here: bookings auto-confirm, so a
   * publishable profile must already have a room to send clients to.
   */
  async upsert(input: UpsertCaProfileInput): Promise<CaProfile> {
    const { rows } = await this.db.query<CaProfileRow>(
      `insert into ca_profile
         (id, full_name, headline, membership_number, firm_name, bio, photo_url,
          years_experience, qualifications, specialisations, languages, office_address,
          google_maps_url, contact_email, contact_phone, whatsapp_number, linkedin_url,
          default_meeting_url, timezone, is_published)
       values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       on conflict (id) do update set
         full_name = excluded.full_name, headline = excluded.headline,
         membership_number = excluded.membership_number, firm_name = excluded.firm_name,
         bio = excluded.bio, photo_url = excluded.photo_url,
         years_experience = excluded.years_experience, qualifications = excluded.qualifications,
         specialisations = excluded.specialisations, languages = excluded.languages,
         office_address = excluded.office_address, google_maps_url = excluded.google_maps_url,
         contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
         whatsapp_number = excluded.whatsapp_number, linkedin_url = excluded.linkedin_url,
         default_meeting_url = excluded.default_meeting_url, timezone = excluded.timezone,
         is_published = excluded.is_published
       returning ${COLUMNS}`,
      [
        input.fullName, input.headline, input.membershipNumber, input.firmName, input.bio,
        input.photoUrl, input.yearsExperience, input.qualifications, input.specialisations,
        input.languages, input.officeAddress, input.googleMapsUrl, input.contactEmail,
        input.contactPhone, input.whatsappNumber, input.linkedinUrl, input.defaultMeetingUrl,
        input.timezone, input.isPublished,
      ],
    );
    return toCaProfile(rows[0]!);
  }
}
