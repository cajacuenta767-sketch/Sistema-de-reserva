import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, FileUp, Play } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Field, Select, Spinner } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { patch, post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import type { ImportPreview, ImportRunResult, ImportType } from '../lib/types';

interface Props {
  entityType?: string | undefined;
  onClose: () => void;
  onFinished: (importId: string) => void;
}

/**
 * Asistente de importación en tres pasos: elegir archivo → revisar el mapeo →
 * ejecutar.
 *
 * El paso intermedio es el que justifica todo lo demás. Un botón único que
 * importe de golpe mete 500 registros mal antes de que nadie vea nada; aquí se
 * ve qué columna va a cada campo y las diez primeras filas tal como quedarán,
 * mientras todavía se puede corregir.
 */
export function ImportWizard({ entityType, onClose, onFinished }: Props) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const types = useCollection<ImportType>('/imports/catalog');

  const [selectedType, setSelectedType] = useState(entityType ?? '');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      return post<ImportPreview>('/imports', {
        entityType: selectedType,
        filename: file.name,
        content,
      });
    },
    onSuccess: (result) => {
      setPreview(result);
      setMapping(result.job.mapping);
    },
    onError: toast.error,
  });

  const saveMapping = useMutation({
    mutationFn: () => patch<ImportPreview>(`/imports/${preview!.job.id}/mapping`, { mapping }),
    onSuccess: (result) => setPreview(result),
    onError: toast.error,
  });

  const run = useMutation({
    mutationFn: async () => {
      if (Object.keys(mapping).length > 0) await saveMapping.mutateAsync();
      let result = await post<ImportRunResult>(`/imports/${preview!.job.id}/run`);
      // El backend procesa por lotes para que ninguna petición se eternice; se
      // sigue llamando hasta que no quede ninguna fila pendiente.
      while (result.remaining > 0) {
        result = await post<ImportRunResult>(`/imports/${preview!.job.id}/run`);
      }
      return result;
    },
    onSuccess: (result) => {
      if (result.failed > 0) {
        toast.error(new Error(`${result.imported} importadas · ${result.failed} con error`));
      } else {
        toast.success(`${result.imported} registros importados`);
      }
      onFinished(result.job.id);
    },
    onError: toast.error,
  });

  const fields = preview?.fields ?? types.data?.items.find((t) => t.entityType === selectedType)?.fields ?? [];
  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  const usedColumns = new Set(Object.values(mapping).filter(Boolean));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Importar desde un archivo"
        description="Se admite CSV separado por comas o por punto y coma, como el que exporta Excel."
        size="xl"
        footer={
          preview ? (
            <>
              <Button onClick={onClose}>Cancelar</Button>
              <Button
                variant="primary"
                icon={<Play className="size-4" />}
                loading={run.isPending}
                disabled={missing.length > 0}
                onClick={() => run.mutate()}
              >
                Importar {preview.job.totalRows} filas
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Cancelar</Button>
          )
        }
      >
        {!preview && (
          <div className="space-y-4">
            <Field label="Qué vas a importar" required>
              {(props) => (
                <Select
                  {...props}
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  disabled={types.isLoading}
                >
                  <option value="">Elige una opción</option>
                  {types.data?.items.map((type) => (
                    <option key={type.entityType} value={type.entityType}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {selectedType && fields.length > 0 && (
              <div className="rounded-[var(--radius-control)] bg-surface-2 p-3 text-sm">
                <p className="font-medium">Columnas que se reconocen solas</p>
                <p className="mt-1 text-fg-muted">
                  Si tu archivo tiene estas cabeceras, el mapeo se rellena sin que toques nada. Los campos
                  obligatorios van marcados.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {fields.map((field) => (
                    <li key={field.key}>
                      <Badge tone={field.required ? 'accent' : 'neutral'}>
                        {field.label}
                        {field.required && ' *'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="primary"
              icon={<FileUp className="size-4" />}
              disabled={!selectedType}
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              Elegir archivo
            </Button>
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{preview.job.filename}</span>
              <Badge tone="neutral">{preview.job.totalRows} filas</Badge>
              <Badge tone="neutral">
                separador «{preview.delimiter === '\t' ? 'tabulador' : preview.delimiter}»
              </Badge>
            </div>

            {missing.length > 0 && (
              <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-soft p-3 text-sm text-warning-soft-fg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Falta asignar una columna a: <strong>{missing.map((f) => f.label).join(', ')}</strong>.
                </span>
              </p>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Qué columna va a cada campo</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={mapping[field.key] ?? ''}
                        onChange={(e) =>
                          setMapping((m) => {
                            const next = { ...m };
                            if (e.target.value) next[field.key] = e.target.value;
                            else delete next[field.key];
                            return next;
                          })
                        }
                      >
                        <option value="">No importar</option>
                        {preview.headers.map((header) => (
                          <option
                            key={header}
                            value={header}
                            // Una columna asignada a dos campos duplicaría el dato
                            // en sitios distintos sin avisar.
                            disabled={usedColumns.has(header) && mapping[field.key] !== header}
                          >
                            {header}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Primeras filas del archivo</h3>
              <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2">
                    <tr>
                      {preview.headers.map((header) => (
                        <th key={header} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                          {header}
                          {usedColumns.has(header) && <span className="ml-1 text-accent">•</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.sample.map((row, index) => (
                      <tr key={index}>
                        {preview.headers.map((header) => (
                          <td key={header} className="px-3 py-2 whitespace-nowrap text-fg-muted">
                            {row[header] || <span className="text-fg-subtle">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-fg-subtle">
                Las columnas marcadas con • se importarán. El resto se ignora.
              </p>
            </section>

            {(saveMapping.isPending || run.isPending) && (
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <Spinner /> Procesando…
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
