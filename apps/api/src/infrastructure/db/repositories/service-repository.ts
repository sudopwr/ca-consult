import type { Querier } from '../querier.js';
import type { Service, ServiceKind } from '../../../domain/service/service.js';
import type { ServiceRepository, UpsertServiceInput } from '../../../application/ports/service-repository.js';

interface ServiceRow {
  id: string;
  kind: ServiceKind;
  name: string;
  slug: string;
  description: string | null;
  amount_paise: number;
  currency: string;
  duration_minutes: number | null;
  assessment_year: string | null;
  itr_form_type: string | null;
  is_active: boolean;
  sort_order: number;
}

const COLUMNS = `id, kind, name, slug, description, amount_paise, currency, duration_minutes,
                 assessment_year, itr_form_type, is_active, sort_order`;

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    description: row.description,
    amountPaise: row.amount_paise,
    currency: row.currency,
    durationMinutes: row.duration_minutes,
    assessmentYear: row.assessment_year,
    itrFormType: row.itr_form_type,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export class PgServiceRepository implements ServiceRepository {
  constructor(private readonly db: Querier) {}

  async findById(id: string): Promise<Service | null> {
    const { rows } = await this.db.query<ServiceRow>(
      `select ${COLUMNS} from services where id = $1`,
      [id],
    );
    return rows[0] ? toService(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Service | null> {
    const { rows } = await this.db.query<ServiceRow>(
      `select ${COLUMNS} from services where slug = $1`,
      [slug],
    );
    return rows[0] ? toService(rows[0]) : null;
  }

  async listActive(kind?: ServiceKind): Promise<Service[]> {
    const { rows } = await this.db.query<ServiceRow>(
      `select ${COLUMNS} from services
        where is_active and ($1::service_kind is null or kind = $1)
        order by sort_order, name`,
      [kind ?? null],
    );
    return rows.map(toService);
  }

  async listAll(kind?: ServiceKind): Promise<Service[]> {
    const { rows } = await this.db.query<ServiceRow>(
      `select ${COLUMNS} from services
        where ($1::service_kind is null or kind = $1)
        order by kind, sort_order, name`,
      [kind ?? null],
    );
    return rows.map(toService);
  }

  async create(input: UpsertServiceInput): Promise<Service> {
    const { rows } = await this.db.query<ServiceRow>(
      `insert into services
         (kind, name, slug, description, amount_paise, duration_minutes,
          assessment_year, itr_form_type, is_active, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning ${COLUMNS}`,
      [
        input.kind, input.name, input.slug, input.description, input.amountPaise,
        input.durationMinutes, input.assessmentYear, input.itrFormType,
        input.isActive, input.sortOrder,
      ],
    );
    return toService(rows[0]!);
  }

  async update(id: string, input: UpsertServiceInput): Promise<Service> {
    const { rows } = await this.db.query<ServiceRow>(
      `update services set
         kind = $2, name = $3, slug = $4, description = $5, amount_paise = $6,
         duration_minutes = $7, assessment_year = $8, itr_form_type = $9,
         is_active = $10, sort_order = $11
       where id = $1
       returning ${COLUMNS}`,
      [
        id, input.kind, input.name, input.slug, input.description, input.amountPaise,
        input.durationMinutes, input.assessmentYear, input.itrFormType,
        input.isActive, input.sortOrder,
      ],
    );
    return toService(rows[0]!);
  }

  async deactivate(id: string): Promise<void> {
    await this.db.query('update services set is_active = false where id = $1', [id]);
  }

  /**
   * Whether any history points at this service. Appointments snapshot the name
   * and price at booking time, but the foreign key is `on delete restrict`, so
   * a referenced service must be deactivated rather than removed.
   */
  async isReferenced(id: string): Promise<boolean> {
    const { rows } = await this.db.query<{ referenced: boolean }>(
      `select exists(
         select 1 from appointments where service_id = $1
         union all
         select 1 from itr_engagements where service_id = $1
       ) as referenced`,
      [id],
    );
    return rows[0]?.referenced ?? false;
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.query('delete from services where id = $1', [id]);
  }
}
