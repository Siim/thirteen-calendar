import { type CalendarSystemId, CALENDAR_SYSTEMS } from '@thirteen/core';
import { useOptionalCalendarSystem } from '../../hooks/CalendarSystemProvider.tsx';
import { SegmentedControl } from '../../primitives/SegmentedControl.tsx';

export interface SystemSwitcherProps {
  /** Controlled value; defaults to the {@link CalendarSystemProvider} selection. */
  readonly value?: CalendarSystemId;
  readonly onChange?: (id: CalendarSystemId) => void;
  readonly size?: 'sm' | 'md';
  readonly hideLegend?: boolean;
  readonly className?: string;
}

/** IFC ⇄ Positivist. Reads and writes the provider unless controlled. */
export function SystemSwitcher({ value, onChange, size = 'sm', hideLegend = true, className }: SystemSwitcherProps) {
  const context = useOptionalCalendarSystem();
  const current = value ?? context?.systemId ?? 'ifc';
  const change = onChange ?? context?.setSystemId;
  return (
    <SegmentedControl<CalendarSystemId>
      legend="Calendar system"
      hideLegend={hideLegend}
      size={size}
      className={className}
      value={current}
      onChange={(id) => change?.(id)}
      options={CALENDAR_SYSTEMS.map((system) => ({
        value: system.id,
        label: system.shortName,
        title: `${system.name} (${system.inventor}, ${system.proposedYear})`,
      }))}
    />
  );
}
