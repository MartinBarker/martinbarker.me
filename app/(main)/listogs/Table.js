'use client';
import React, { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';

// Helper to flatten videoData object to array with deduplication
function flattenVideoData(videoData) {
  const rows = [];
  const seenVideoIds = new Set();
  
  if (!videoData) return rows;
  
  Object.values(videoData).forEach(releaseObj => {
    if (Array.isArray(releaseObj)) {
      releaseObj.forEach(video => {
        // Only add if we haven't seen this videoId before
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          rows.push(video);
        } else if (video && !video.videoId) {
          // Include videos without videoId (shouldn't happen but be safe)
          rows.push(video);
        }
      });
    } else if (releaseObj && typeof releaseObj === 'object') {
      Object.values(releaseObj).forEach(video => {
        // Only add if we haven't seen this videoId before
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          rows.push(video);
        } else if (video && !video.videoId) {
          // Include videos without videoId (shouldn't happen but be safe)
          rows.push(video);
        }
      });
    }
  });
  
  return rows;
}

export default function VideoTable({ videoData }) {
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 4, // Show 4 rows by default
  });

  // Memoize rawData so reference is stable
  const rawData = useMemo(() => flattenVideoData(videoData), [videoData]);
  const data = useMemo(() => {
    if (!search) return rawData;
    const lower = search.toLowerCase();
    return rawData.filter(row =>
      Object.values(row).some(
        v => typeof v === 'string' && v.toLowerCase().includes(lower)
      )
    );
  }, [rawData, search]);

  const columns = useMemo(
    () => [
      {
        accessorKey: 'releaseTitle',
        header: 'Release',
        cell: info => info.getValue(),
      },
      {
        accessorKey: 'artist',
        header: 'Artist',
        cell: info => info.getValue(),
      },
      {
        accessorKey: 'year',
        header: 'Year',
        cell: info => info.getValue(),
      },
      {
        accessorKey: 'title',
        header: 'Video Title',
        cell: info => info.getValue(),
      },
      {
        accessorKey: 'fullUrl',
        header: 'YouTube Link',
        cell: info => (
          <a href={info.getValue()} target="_blank" rel="noopener noreferrer">
            {info.row.original.videoId}
          </a>
        ),
      },
      {
        accessorKey: 'discogsUrl',
        header: 'Discogs Link',
        cell: info => (
          <a href={info.getValue()} target="_blank" rel="noopener noreferrer">
            Discogs
          </a>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: { pagination },
    autoResetPageIndex: false,
    autoResetExpanded: false,
  });

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  style={{
                    borderBottom: '1px solid #ccc',
                    padding: '8px',
                    background: '#f5f5f5',
                    textAlign: 'left',
                  }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <React.Fragment key={row.id}>
              <tr>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
              <tr>
                <td colSpan={row.getVisibleCells().length} style={{ padding: 0, background: '#fafafa' }}>
                  {row.original.videoId && (
                    <div style={{ padding: '12px 0', textAlign: 'center' }}>
                      <iframe
                        width="360"
                        height="203"
                        src={`https://www.youtube.com/embed/${row.original.videoId}`}
                        title="YouTube video"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Pagination controls (left) */}
        <button onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()}>
          {'<<'}
        </button>
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          {'<'}
        </button>
        <span>
          Page{' '}
          <strong>
            {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </strong>
        </span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          {'>'}
        </button>
        <button onClick={() => table.lastPage()} disabled={!table.getCanNextPage()}>
          {'>>'}
        </button>
        <span>
          | Go to page:{' '}
          <input
            type="number"
            min={1}
            max={table.getPageCount()}
            value={table.getState().pagination.pageIndex + 1}
            onChange={e => {
              const page = e.target.value ? Number(e.target.value) - 1 : 0;
              table.setPageIndex(page);
            }}
            style={{ width: '60px' }}
          />
        </span>
        <select
          value={table.getState().pagination.pageSize}
          onChange={e => {
            table.setPageSize(Number(e.target.value));
          }}
        >
          {[10, 20, 30, 40, 50].map(pageSize => (
            <option key={pageSize} value={pageSize}>
              Show {pageSize}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto' }}>
          {table.getRowCount()} videos
        </span>
        {/* Search box (right, small) */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search"
          style={{
            marginLeft: 12,
            padding: '4px 8px',
            fontSize: 14,
            width: 140,
            borderRadius: 4,
            border: '1px solid #ccc',
          }}
        />
      </div>
    </div>
  );
}
