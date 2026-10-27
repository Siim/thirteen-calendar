import { useEffect } from 'react';

const SUFFIX = 'Thirteen';

/** Sets `document.title` to "<title> · Thirteen". */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : `${SUFFIX}: the 13-month calendar`;
  }, [title]);
}
