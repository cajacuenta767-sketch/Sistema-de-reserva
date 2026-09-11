import { AppError } from '../../../shared/AppError.js';
import type { Clock } from '../../../shared/Clock.js';
import { newId } from '../../../shared/id.js';
import type { WaitlistEntry } from '../../../domain/entities/Waitlist.js';
import type { LocalDate } from '../../../shared/dates.js';
import type { ServiceRepository, WaitlistRepository } from '../../ports/index.js';

export class WaitlistUseCases {
  constructor(
    private readonly waitlist: WaitlistRepository,
    private readonly services: ServiceRepository,
    private readonly clock: Clock,
  ) {}

  async join(clientId: string, serviceId: string, date: LocalDate, staffId: string | null) {
    if (!(await this.services.findById(serviceId))) throw AppError.notFound('Servicio');
    const existing = await this.waitlist.listForClient(clientId);
    if (existing.some((e) => e.serviceId === serviceId && e.date === date && e.staffId === staffId))
      throw AppError.conflict('Ya estás en la lista de espera para esa fecha');
    const w: WaitlistEntry = { id: newId(), clientId, serviceId, staffId, date, notifiedAt: null, createdAt: this.clock.now().toISOString() };
    await this.waitlist.save(w);
    return w;
  }

  listMine(clientId: string) {
    return this.waitlist.listForClient(clientId);
  }

  async leave(clientId: string, id: string) {
    const mine = await this.waitlist.listForClient(clientId);
    if (!mine.some((e) => e.id === id)) throw AppError.notFound('Entrada de lista de espera');
    await this.waitlist.delete(id);
  }
}
