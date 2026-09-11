import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, Mail, MapPin, Pencil, Phone, Smartphone } from 'lucide-react';
import {
  Badge,
  Button,
  ErrorState,
  PageHeader,
  PageLoader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { Can } from '@/lib/authz/useCan';
import { date, money } from '@/lib/format';
import { PartyDialog } from '../components/PartyDialog';
import { ContactsPanel } from '../components/ContactsPanel';
import { AddressesPanel } from '../components/AddressesPanel';
import { ActivitiesPanel } from '../components/ActivitiesPanel';
import { TagsPanel } from '../components/TagsPanel';
import { documentLabel, taxRegimeLabel } from '../lib/party';
import type { PartyDetail } from '../lib/types';

const TABS = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'contactos', label: 'Contactos' },
  { value: 'direcciones', label: 'Direcciones' },
  { value: 'actividades', label: 'Actividades' },
] as const;

export function PartyDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  // La pestaña vive en la URL: compartir el enlace de una ficha abierta en
  // "Actividades" tiene que abrirla ahí, no en el resumen.
  const [params, setParams] = useSearchParams();
  const tab = params.get('pestana') ?? 'resumen';

  const query = useResource<PartyDetail>(`/parties/${id}`);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: [`/parties/${id}`] });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar la ficha"
        description={(query.error as Error | null)?.message}
        action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
      />
    );
  }

  const { party, addresses, contacts, customerProfile, vendorProfile, tags, activities } = query.data;
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];

  return (
    <>
      <PageHeader
        title={party.displayName}
        description={documentLabel(party.taxIdType, party.taxId, party.taxIdDv)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/clientes')}>
              Volver
            </Button>
            <Can perm="crm:party:update">
              <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar
              </Button>
            </Can>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {party.isCustomer && <Badge tone="accent">Cliente</Badge>}
        {party.isVendor && <Badge tone="info">Proveedor</Badge>}
        <Badge tone={party.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
          {party.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
        </Badge>
        <TagsPanel partyId={party.id} tags={tags} onChanged={invalidate} />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setParams({ pestana: value }, { replace: true })}
        className="mt-2"
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.value === 'contactos' && contacts.length > 0 && (
                <span className="ml-1.5 text-xs text-fg-subtle">{contacts.length}</span>
              )}
              {t.value === 'direcciones' && addresses.length > 0 && (
                <span className="ml-1.5 text-xs text-fg-subtle">{addresses.length}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="resumen">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold">Contacto</h2>
              <dl className="space-y-2 text-sm">
                <Line icon={<Mail className="size-4" />} label="Correo" value={party.email} href={party.email ? `mailto:${party.email}` : undefined} />
                <Line icon={<Phone className="size-4" />} label="Teléfono" value={party.phone} href={party.phone ? `tel:${party.phone}` : undefined} />
                <Line icon={<Smartphone className="size-4" />} label="Celular" value={party.mobile} href={party.mobile ? `tel:${party.mobile}` : undefined} />
                <Line icon={<Globe className="size-4" />} label="Sitio web" value={party.website} href={party.website ?? undefined} />
                <Line
                  icon={<MapPin className="size-4" />}
                  label="Dirección"
                  value={defaultAddress ? [defaultAddress.line1, defaultAddress.city].filter(Boolean).join(', ') : null}
                />
              </dl>
            </section>

            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold">Datos fiscales</h2>
              <dl className="space-y-2 text-sm">
                <Line label="Razón social" value={party.legalName} />
                <Line label="Documento" value={documentLabel(party.taxIdType, party.taxId, party.taxIdDv)} />
                <Line label="Régimen" value={taxRegimeLabel(party.taxRegime)} />
                <Line label="Sector" value={party.industry} />
                <Line label="Alta" value={date(party.createdAt)} />
              </dl>
            </section>

            {customerProfile && (
              <section className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold">Condiciones como cliente</h2>
                <dl className="space-y-2 text-sm">
                  <Line label="Plazo de pago" value={`${customerProfile.paymentTermsDays} días`} />
                  <Line
                    label="Cupo de crédito"
                    value={
                      customerProfile.creditLimit
                        ? money(customerProfile.creditLimit, customerProfile.defaultCurrency)
                        : 'Sin cupo'
                    }
                  />
                  <Line label="Moneda" value={customerProfile.defaultCurrency} />
                </dl>
              </section>
            )}

            {vendorProfile && (
              <section className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold">Condiciones como proveedor</h2>
                <dl className="space-y-2 text-sm">
                  <Line label="Plazo de pago" value={`${vendorProfile.paymentTermsDays} días`} />
                  <Line label="Tiempo de entrega" value={`${vendorProfile.leadTimeDays} días`} />
                  <Line label="Moneda" value={vendorProfile.defaultCurrency} />
                </dl>
              </section>
            )}

            {party.notes && (
              <section className="card space-y-2 p-4 lg:col-span-2">
                <h2 className="text-sm font-semibold">Notas</h2>
                <p className="text-sm whitespace-pre-wrap text-fg-muted">{party.notes}</p>
              </section>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contactos">
          <ContactsPanel partyId={party.id} contacts={contacts} onChanged={invalidate} />
        </TabsContent>

        <TabsContent value="direcciones">
          <AddressesPanel partyId={party.id} addresses={addresses} onChanged={invalidate} />
        </TabsContent>

        <TabsContent value="actividades">
          <ActivitiesPanel partyId={party.id} activities={activities} onChanged={invalidate} />
        </TabsContent>
      </Tabs>

      {editing && (
        <PartyDialog
          partyId={party.id}
          initial={{
            kind: party.kind,
            displayName: party.displayName,
            legalName: party.legalName ?? '',
            taxIdType: party.taxIdType,
            taxId: party.taxId ?? '',
            taxIdDv: party.taxIdDv ?? '',
            taxRegime: party.taxRegime,
            email: party.email ?? '',
            phone: party.phone ?? '',
            mobile: party.mobile ?? '',
            website: party.website ?? '',
            industry: party.industry ?? '',
            notes: party.notes ?? '',
            isCustomer: party.isCustomer,
            isVendor: party.isVendor,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function Line({
  icon,
  label,
  value,
  href,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string | undefined;
}) {
  return (
    <div className="flex items-start gap-2">
      {icon && <span className="mt-0.5 shrink-0 text-fg-subtle">{icon}</span>}
      <dt className="w-32 shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">
        {value ? (
          href ? (
            <a className="text-accent hover:underline" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </dd>
    </div>
  );
}
