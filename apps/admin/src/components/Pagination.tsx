import type { ReactElement } from 'react';

interface IPaginationProps {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
}

export const Pagination = ({ page, limit, total, onPageChange }: IPaginationProps): ReactElement => {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasPrev = page > 1;
    const hasNext = page < totalPages;

    return (
        <div className="pagination">
            <span className="pagination-info">
                {total === 0 ? 'No results' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}
            </span>
            <div className="pagination-controls">
                <button type="button" className="btn btn-secondary" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>
                    Previous
                </button>
                <span className="pagination-page">
                    Page {page} of {totalPages}
                </span>
                <button type="button" className="btn btn-secondary" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>
                    Next
                </button>
            </div>
        </div>
    );
};
