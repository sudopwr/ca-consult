export type EnquiryStatus = 'NEW' | 'READ' | 'REPLIED' | 'SPAM';

export interface ContactEnquiry {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly subject: string;
  readonly body: string;
  readonly status: EnquiryStatus;
  readonly adminNote: string | null;
  readonly repliedAt: Date | null;
  readonly sourceIp: string | null;
  readonly createdAt: Date;
}

export interface CreateContactEnquiryInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly subject: string;
  readonly body: string;
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
}

export interface ContactEnquiryRepository {
  create(input: CreateContactEnquiryInput): Promise<ContactEnquiry>;
  findById(id: string): Promise<ContactEnquiry | null>;
  list(query: { status?: EnquiryStatus | undefined; page: number; pageSize: number }): Promise<{
    rows: ContactEnquiry[];
    total: number;
  }>;
  update(id: string, input: { status?: EnquiryStatus; adminNote?: string | null; repliedAt?: Date | null }): Promise<ContactEnquiry>;
  countNew(): Promise<number>;
  /** Backstop behind the route's rate limit, in case a proxy rewrites the IP. */
  countFromIpSince(ip: string, since: Date): Promise<number>;
}
