import { Link } from './Link.tsx';
import { PageHeader } from './PageHeader.tsx';
import { useDocumentTitle } from '../lib/useDocumentTitle.ts';

/** Unknown hash routes. */
export function NotFoundPage({ path }: { readonly path: string }) {
  useDocumentTitle('Not found');
  return (
    <PageHeader
      mark="§ 0"
      kicker="Errata"
      title={
        <>
          No such <em>page</em>
        </>
      }
      lede={
        <>
          Nothing is filed under <code>{path || '/'}</code>. Try <Link to={{ name: 'today' }}>today’s date</Link> or the{' '}
          <Link to={{ name: 'year', year: null, day: null }}>whole year</Link>.
        </>
      }
    />
  );
}
