import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchStudents } from '../api/adminApi';
import { adminQueryKeys } from '../queries/queryKeys';
import { useAuth } from '../auth/authStore';
import { Pagination } from '../components/Pagination';
import { ErrorMessage } from '../components/ErrorMessage';
import { DEFAULT_PAGE_LIMIT } from '../const/AdminUiConsts';
import { formatDate } from '../utils/formatDate';
import { adminQueryRetry } from '../utils/queryRetry';

export const StudentsPage = (): ReactElement => {
    const auth = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
    const limit = Math.max(1, Number(searchParams.get('limit') ?? String(DEFAULT_PAGE_LIMIT)));

    const { data, isLoading, isError, error } = useQuery({
        queryKey: adminQueryKeys.students(page, limit),
        queryFn: () => fetchStudents({ page, limit }, auth!.accessToken),
        retry: adminQueryRetry,
    });

    const setPage = (next: number): void => {
        setSearchParams((prev) => {
            const updated = new URLSearchParams(prev);
            updated.set('page', String(next));
            return updated;
        });
    };

    return (
        <div className="resource-page">
            <h1>Students</h1>
            {isLoading ? (
                <p className="loading-text">Loading…</p>
            ) : isError ? (
                <ErrorMessage error={error} />
            ) : data ? (
                <>
                    <p className="total-count">Total: {data.total}</p>
                    <div className="table-wrapper">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Email</th>
                                    <th>First Name</th>
                                    <th>Last Name</th>
                                    <th>Date of Birth</th>
                                    <th>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.data.map((row) => (
                                    <tr key={row.id}>
                                        <td>{row.id}</td>
                                        <td>{row.email}</td>
                                        <td>{row.firstName ?? '—'}</td>
                                        <td>{row.lastName ?? '—'}</td>
                                        <td>{row.dateOfBirth ? formatDate(row.dateOfBirth) : '—'}</td>
                                        <td>{formatDate(row.createdAt)}</td>
                                    </tr>
                                ))}
                                {data.data.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="empty-row">No students found.</td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                    <Pagination page={page} limit={limit} total={data.total} onPageChange={setPage} />
                </>
            ) : null}
        </div>
    );
};
