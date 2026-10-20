import { Link, useLocation } from 'react-router';

import { Button } from '@/components/ui/button';

import { ledgerDictionary as text } from '../ledgerDictionary';

interface HistoryPaginationProps {
  page: number;
  totalPages: number;
}

export function HistoryPagination({ page, totalPages }: HistoryPaginationProps) {
  const location = useLocation();
  if (totalPages <= 1) {
    return null;
  }
  function pageLink(next: number) {
    const search = new URLSearchParams(location.search);
    search.set('page', String(next));
    return `${location.pathname}?${search}`;
  }
  return (
    <nav aria-label={text.pagination} className="flex flex-wrap items-center gap-3">
      {page > 1 ? (
        <Button asChild variant="outline">
          <Link to={pageLink(page - 1)}>{text.previous}</Link>
        </Button>
      ) : (
        <Button variant="outline" disabled>
          {text.previous}
        </Button>
      )}
      <p className="text-sm" role="status">
        {text.page(page, totalPages)}
      </p>
      {page < totalPages ? (
        <Button asChild variant="outline">
          <Link to={pageLink(page + 1)}>{text.next}</Link>
        </Button>
      ) : (
        <Button variant="outline" disabled>
          {text.next}
        </Button>
      )}
    </nav>
  );
}
