import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button, Dialog, DialogContent, Field, Input } from '@/design-system';
import { post } from '@/lib/api/client';
import { useToast } from '@/store/toast';

interface Attribute {
  key: string;
  value: string;
}

/**
 * Alta de una variante.
 *
 * Los atributos son pares libres (`talla: M`) y no una lista fija porque los
 * ejes cambian con el producto: una camisa se diferencia por talla y color, y
 * una pintura por litros y acabado. Una tabla de atributos predefinidos
 * obligaría a configurarlos antes de poder crear el primer producto.
 */
export function VariantDialog({
  productId,
  onClose,
  onSaved,
}: {
  productId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [sku, setSku] = useState('');
  const [priceDelta, setPriceDelta] = useState('');
  const [attributes, setAttributes] = useState<Attribute[]>([{ key: '', value: '' }]);
  const [error, setError] = useState('');

  const setAttribute = (index: number, patch: Partial<Attribute>) =>
    setAttributes((list) => list.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const save = useMutation({
    mutationFn: () =>
      post(`/products/${productId}/variants`, {
        sku: sku.trim() || null,
        priceDelta: priceDelta.trim() ? priceDelta.trim().replace(',', '.') : '0',
        attributes: Object.fromEntries(
          attributes
            .filter((a) => a.key.trim() && a.value.trim())
            .map((a) => [a.key.trim().toLowerCase(), a.value.trim()]),
        ),
      }),
    onSuccess: () => {
      toast.success('Variante añadida');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    const filled = attributes.filter((a) => a.key.trim() && a.value.trim());
    if (filled.length === 0) {
      setError('Añade al menos un atributo, como talla o color');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Nueva variante"
        description="El código se genera a partir del producto si lo dejas vacío."
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Añadir
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Atributos</legend>
            {error && <p className="text-sm text-danger-fg">{error}</p>}
            {attributes.map((attribute, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  placeholder="talla"
                  aria-label={`Atributo ${index + 1}`}
                  value={attribute.key}
                  onChange={(e) => setAttribute(index, { key: e.target.value })}
                />
                <Input
                  placeholder="M"
                  aria-label={`Valor del atributo ${index + 1}`}
                  value={attribute.value}
                  onChange={(e) => setAttribute(index, { value: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  icon={<X className="size-4" />}
                  aria-label={`Quitar atributo ${index + 1}`}
                  disabled={attributes.length === 1}
                  onClick={() => setAttributes((list) => list.filter((_, i) => i !== index))}
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setAttributes((list) => [...list, { key: '', value: '' }])}
            >
              Otro atributo
            </Button>
          </fieldset>

          <Field label="Código" hint="Se genera desde el del producto">
            {(props) => <Input {...props} value={sku} onChange={(e) => setSku(e.target.value)} />}
          </Field>

          <Field label="Diferencia de precio" hint="Puede ser negativa; se suma al precio del producto">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                placeholder="0"
                value={priceDelta}
                onChange={(e) => setPriceDelta(e.target.value)}
              />
            )}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
