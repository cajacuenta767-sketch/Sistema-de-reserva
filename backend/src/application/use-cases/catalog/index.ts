import { AppError } from '../../../shared/AppError.js';
import type { Clock } from '../../../shared/Clock.js';
import { newId } from '../../../shared/id.js';
import type { Category, Service } from '../../../domain/entities/Service.js';
import type { CategoryRepository, ServiceRepository } from '../../ports/index.js';

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export type ServiceInput = Pick<Service, 'name' | 'description' | 'durationMinutes' | 'priceCents'> &
  Partial<Pick<Service, 'categoryId' | 'bufferMinutes' | 'currency' | 'imageUrl' | 'isActive' | 'isFeatured'>>;

export class CatalogUseCases {
  constructor(
    private readonly services: ServiceRepository,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  listCategories() {
    return this.categories.list();
  }

  async createCategory(input: Pick<Category, 'name'> & Partial<Category>) {
    const c: Category = {
      id: newId(),
      name: input.name,
      slug: input.slug ?? slugify(input.name),
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? 0,
    };
    await this.categories.save(c);
    return c;
  }

  async updateCategory(id: string, patch: Partial<Category>) {
    const c = await this.categories.findById(id);
    if (!c) throw AppError.notFound('Categoría');
    const updated = { ...c, ...patch, id };
    await this.categories.update(updated);
    return updated;
  }

  async deleteCategory(id: string) {
    if (!(await this.categories.findById(id))) throw AppError.notFound('Categoría');
    await this.categories.delete(id);
  }

  listServices(opts?: { includeInactive?: boolean; categoryId?: string }) {
    return this.services.list(opts);
  }

  async getService(idOrSlug: string) {
    const s = (await this.services.findById(idOrSlug)) ?? (await this.services.findBySlug(idOrSlug));
    if (!s) throw AppError.notFound('Servicio');
    return s;
  }

  async createService(input: ServiceInput) {
    if (input.durationMinutes <= 0) throw AppError.validation('La duración debe ser mayor a 0');
    const now = this.clock.now().toISOString();
    let slug = slugify(input.name);
    if (await this.services.findBySlug(slug)) slug = `${slug}-${newId().slice(0, 6)}`;
    const s: Service = {
      id: newId(),
      categoryId: input.categoryId ?? null,
      name: input.name,
      slug,
      description: input.description,
      durationMinutes: input.durationMinutes,
      bufferMinutes: input.bufferMinutes ?? 0,
      priceCents: input.priceCents,
      currency: input.currency ?? 'COP',
      imageUrl: input.imageUrl ?? null,
      isActive: input.isActive ?? true,
      isFeatured: input.isFeatured ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await this.services.save(s);
    return s;
  }

  async updateService(id: string, patch: Partial<ServiceInput>) {
    const s = await this.services.findById(id);
    if (!s) throw AppError.notFound('Servicio');
    const updated: Service = { ...s, ...patch, id, updatedAt: this.clock.now().toISOString() };
    await this.services.update(updated);
    return updated;
  }

  async deleteService(id: string) {
    if (!(await this.services.findById(id))) throw AppError.notFound('Servicio');
    await this.services.delete(id);
  }
}
