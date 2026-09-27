import type { Querier } from '../querier.js';
import { SqlBuilder } from '../querier.js';
import type {
  ContactEnquiry,
  ContactEnquiryRepository,
  CreateContactEnquiryInput,
  EnquiryStatus,
} from '../../../application/ports/contact-enquiry-repository.js';

interface EnquiryRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  body: string;
  status: EnquiryStatus;
  admin_note: string | null;
  replied_at: Date | null;
  source_ip: string | null;
  created_at: Date;
}

const COLUMNS = `id, name, email, phone, subject, body, status, admin_note, replied_at,
                 host(source_ip) as source_ip, created_at`;

function toEnquiry(row: EnquiryRow): ContactEnquiry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    body: row.body,
    status: row.status,
    adminNote: row.admin_note,
    repliedAt: row.replied_at,
    sourceIp: row.source_ip,
    createdAt: row.created_at,
  };
}

export class PgContactEnquiryRepository implements ContactEnquiryRepository {
  constructor(private readonly db: Querier) {}

  async create(input: CreateContactEnquiryInput): Promise<ContactEnquiry> {
    const { rows } = await this.db.query<EnquiryRow>(
      `insert into contact_enquiries (name, email, phone, subject, body, source_ip, user_agent)
       values ($1, $2, $3, $4, $5, $6::inet, $7)
       returning ${COLUMNS}`,
      [
        input.name, input.email, input.phone, input.subject, input.body,
        input.sourceIp, input.userAgent,
      ],
    );
    return toEnquiry(rows[0]!);
  }

  async findById(id: string): Promise<ContactEnquiry | null> {
    const { rows } = await this.db.query<EnquiryRow>(
      `select ${COLUMNS} from contact_enquiries where id = $1`,
      [id],
    );
    return rows[0] ? toEnquiry(rows[0]) : null;
  }

  async list(query: { status?: EnquiryStatus | undefined; page: number; pageSize: number }) {
    const builder = new SqlBuilder();
    builder.whereIf(query.status, 'status = ?', query.status);

    const where = builder.build();
    const limit = builder.param(query.pageSize);
    const offset = builder.param((query.page - 1) * query.pageSize);

    const { rows } = await this.db.query<EnquiryRow & { total: number }>(
      `select ${COLUMNS}, count(*) over ()::int as total
         from contact_enquiries ${where}
        order by case status when 'NEW' then 0 else 1 end, created_at desc
        limit ${limit} offset ${offset}`,
      builder.params,
    );

    return { rows: rows.map(toEnquiry), total: rows[0]?.total ?? 0 };
  }

  async update(
    id: string,
    input: { status?: EnquiryStatus; adminNote?: string | null; repliedAt?: Date | null },
  ): Promise<ContactEnquiry> {
    const { rows } = await this.db.query<EnquiryRow>(
      `update contact_enquiries set
         status     = coalesce($2, status),
         admin_note = case when $3::boolean then $4 else admin_note end,
         replied_at = coalesce($5, replied_at)
       where id = $1
       returning ${COLUMNS}`,
      [
        id,
        input.status ?? null,
        input.adminNote !== undefined,
        input.adminNote ?? null,
        input.repliedAt ?? null,
      ],
    );
    return toEnquiry(rows[0]!);
  }

  async countNew(): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from contact_enquiries where status = 'NEW'`,
    );
    return rows[0]?.count ?? 0;
  }

  async countFromIpSince(ip: string, since: Date): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from contact_enquiries
        where source_ip = $1::inet and created_at >= $2`,
      [ip, since],
    );
    return rows[0]?.count ?? 0;
  }
}
