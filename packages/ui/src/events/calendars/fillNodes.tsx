import { Fragment, type ReactNode } from 'react';

/**
 * Fills a catalogue template with nodes, so a calendar or file name inside a
 * sentence can be its own element (`data-user-text`, excluded from the no-dash
 * scan of §2.19) while the rest of the sentence is the catalogue's text.
 */
export function fillNodes(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode {
  const parts = template.split(/(\{[^{}]+\})/);
  return parts.map((part, index) => {
    const match = /^\{([^{}]+)\}$/.exec(part);
    if (match === null) return part === '' ? null : <Fragment key={index}>{part}</Fragment>;
    const value = values[match[1]!];
    return <Fragment key={index}>{value === undefined ? part : value}</Fragment>;
  });
}

/** A name the user or another app supplied, marked for the no-dash scan (§2.19). */
export function UserText({ children }: { readonly children: ReactNode }) {
  return <span data-user-text>{children}</span>;
}
