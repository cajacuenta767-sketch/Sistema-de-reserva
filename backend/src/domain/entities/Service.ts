export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
}

export interface Service {
  id: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  /** Minutos de descanso obligatorio tras el servicio */
  bufferMinutes: number;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  isActive: boolean;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
}
