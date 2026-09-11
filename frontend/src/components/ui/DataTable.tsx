import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export const DataTable = <T,>({ rows, columns, getRowKey, onRowClick }: DataTableProps<T>) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[48rem] border-collapse text-left">
      <thead className="bg-neutral-50 text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              className={`border-b border-neutral-200 px-6 py-3 ${column.className ?? ''}`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100 text-xs">
        {rows.map((row) => (
          <tr
            key={getRowKey(row)}
            onClick={() => onRowClick?.(row)}
            className={
              onRowClick
                ? 'cursor-pointer transition hover:bg-neutral-50'
                : 'transition hover:bg-neutral-50'
            }
          >
            {columns.map((column) => (
              <td key={column.key} className={`px-6 py-5 ${column.className ?? ''}`}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
