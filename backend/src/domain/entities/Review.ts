export interface Review {
  id: string;
  bookingId: string;
  clientId: string;
  staffId: string;
  serviceId: string;
  rating: number; // 1..5
  comment: string;
  createdAt: string;
}
