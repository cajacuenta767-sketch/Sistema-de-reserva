import { useId } from 'react';
import { Input } from '@/design-system';

interface Props {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  /** Los informes de saldo (balance general) solo necesitan la fecha de corte. */
  onlyTo?: boolean;
}

/**
 * Rango de fechas de un informe.
 *
 * Dos campos nativos y nada más. Un selector propio de rangos se ve mejor en
 * una captura y es peor de usar con teclado, que es como un contador introduce
 * fechas todo el día.
 *
 * La etiqueta va unida por `htmlFor`, no envolviendo al campo: `Input` es un
 * componente propio, y envolverlo deja la asociación al azar de que el
 * componente renderice un `<input>` en la raíz.
 */
export function RangePicker({ from, to, onChange, onlyTo = false }: Props) {
  const id = useId();

  return (
    <div className="flex flex-wrap items-end gap-3">
      {!onlyTo && (
        <div>
          <label htmlFor={`${id}-from`} className="mb-1 block text-xs text-fg-muted">
            Desde
          </label>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            max={to}
            onChange={(e) => onChange({ from: e.target.value, to })}
            className="h-9 w-auto"
          />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-to`} className="mb-1 block text-xs text-fg-muted">
          {onlyTo ? 'Fecha de corte' : 'Hasta'}
        </label>
        <Input
          id={`${id}-to`}
          type="date"
          value={to}
          min={onlyTo ? undefined : from}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className="h-9 w-auto"
        />
      </div>
    </div>
  );
}
