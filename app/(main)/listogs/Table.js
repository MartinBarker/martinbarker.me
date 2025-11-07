'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';
import styles from './listogs.module.css';

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

export default function VideoTable({ videoData, onFilteredDataChange = () => {} }) {
  const [search, setSearch] = useState('');
  const [selectedReleaseTypes, setSelectedReleaseTypes] = useState([]);
  const [isReleaseDropdownOpen, setIsReleaseDropdownOpen] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]);
  const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);
  const [useCustomYearRange, setUseCustomYearRange] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [yearRangeStart, setYearRangeStart] = useState('');
  const [yearRangeEnd, setYearRangeEnd] = useState('');
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 4, // Show 4 rows by default
  });

  const releaseDropdownRef = useRef(null);
  const labelDropdownRef = useRef(null);
  const yearDropdownRef = useRef(null);
  const countryDropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (releaseDropdownRef.current && !releaseDropdownRef.current.contains(event.target)) {
        setIsReleaseDropdownOpen(false);
      }
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(event.target)) {
        setIsLabelDropdownOpen(false);
      }
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target)) {
        setIsYearDropdownOpen(false);
      }
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target)) {
        setIsCountryDropdownOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsReleaseDropdownOpen(false);
        setIsLabelDropdownOpen(false);
        setIsYearDropdownOpen(false);
        setIsCountryDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Memoize rawData so reference is stable
  const rawData = useMemo(() => flattenVideoData(videoData), [videoData]);
  const releaseTypeOptions = useMemo(() => {
    const counts = {};
    rawData.forEach(row => {
      const key = row.releaseType && row.releaseType.trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });

    return Object.entries(counts)
      .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
      .map(([type, count]) => ({ value: type, count }));
  }, [rawData]);

  const labelOptions = useMemo(() => {
    const counts = {};
    rawData.forEach(row => {
      const labels = Array.isArray(row.labelsAndCompanies)
        ? row.labelsAndCompanies
        : row.labelsAndCompanies
          ? [row.labelsAndCompanies]
          : [];

      labels.forEach(label => {
        if (!label || typeof label !== 'string') return;
        const trimmed = label.trim();
        if (!trimmed) return;
        counts[trimmed] = (counts[trimmed] || 0) + 1;
      });
    });

    return Object.entries(counts)
      .sort(([labelA], [labelB]) => labelA.localeCompare(labelB))
      .map(([value, count]) => ({ value, count }));
  }, [rawData]);

  const yearOptions = useMemo(() => {
    const counts = {};
    rawData.forEach(row => {
      if (!row.year) return;
      const yearStr = row.year.toString().trim();
      if (yearStr && /^\d{3,4}$/.test(yearStr)) {
        counts[yearStr] = (counts[yearStr] || 0) + 1;
      }
    });

    return Object.entries(counts)
      .sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10))
      .map(([value, count]) => ({ value, count }));
  }, [rawData]);

  useEffect(() => {
    if (!releaseTypeOptions.length) {
      setSelectedReleaseTypes([]);
      return;
    }

    setSelectedReleaseTypes(prev => {
      const validTypes = new Set(releaseTypeOptions.map(option => option.value));
      const filtered = prev.filter(type => validTypes.has(type));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [releaseTypeOptions]);

  const countryOptions = useMemo(() => {
    const counts = {};
    rawData.forEach(row => {
      if (!row.country) return;
      const value = row.country.toString().trim();
      if (!value) return;
      counts[value] = (counts[value] || 0) + 1;
    });

    return Object.entries(counts)
      .sort(([countryA], [countryB]) => countryA.localeCompare(countryB))
      .map(([value, count]) => ({ value, count }));
  }, [rawData]);

  useEffect(() => {
    if (!yearOptions.length) {
      setSelectedYears(prev => (prev.length ? [] : prev));
      return;
    }

    setSelectedYears(prev => {
      const validYears = new Set(yearOptions.map(option => option.value));
      const filtered = prev.filter(year => validYears.has(year));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [yearOptions]);

  useEffect(() => {
    if (!labelOptions.length) {
      setSelectedLabels(prev => (prev.length ? [] : prev));
      return;
    }

    setSelectedLabels(prev => {
      const validLabels = new Set(labelOptions.map(option => option.value));
      const filtered = prev.filter(label => validLabels.has(label));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [labelOptions]);

  useEffect(() => {
    if (!countryOptions.length) {
      setSelectedCountries(prev => (prev.length ? [] : prev));
      return;
    }

    setSelectedCountries(prev => {
      const validCountries = new Set(countryOptions.map(option => option.value));
      const filtered = prev.filter(country => validCountries.has(country));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [countryOptions]);

  const orderedSelectedReleaseTypes = useMemo(() => {
    if (!selectedReleaseTypes.length) return [];
    const selectedSet = new Set(selectedReleaseTypes);
    return releaseTypeOptions
      .filter(option => selectedSet.has(option.value))
      .map(option => option.value);
  }, [releaseTypeOptions, selectedReleaseTypes]);

  const orderedSelectedLabels = useMemo(() => {
    if (!selectedLabels.length) return [];
    const selectedSet = new Set(selectedLabels);
    return labelOptions
      .filter(option => selectedSet.has(option.value))
      .map(option => option.value);
  }, [labelOptions, selectedLabels]);

  const orderedSelectedYears = useMemo(() => {
    if (!selectedYears.length) return [];
    const selectedSet = new Set(selectedYears);
    return yearOptions
      .filter(option => selectedSet.has(option.value))
      .map(option => option.value);
  }, [yearOptions, selectedYears]);

  const orderedSelectedCountries = useMemo(() => {
    if (!selectedCountries.length) return [];
    const selectedSet = new Set(selectedCountries);
    return countryOptions
      .filter(option => selectedSet.has(option.value))
      .map(option => option.value);
  }, [countryOptions, selectedCountries]);

  const activeReleaseTypeFilter =
    selectedReleaseTypes.length > 0 &&
    selectedReleaseTypes.length < releaseTypeOptions.length;

  const releaseTypeSummary = useMemo(() => {
    if (!releaseTypeOptions.length) {
      return 'No release types available';
    }

    if (!selectedReleaseTypes.length) {
      return 'Find a release type';
    }

    if (selectedReleaseTypes.length === releaseTypeOptions.length) {
      return 'All release types';
    }

    if (orderedSelectedReleaseTypes.length === 1) {
      return orderedSelectedReleaseTypes[0];
    }

    return `${orderedSelectedReleaseTypes.length} selected`;
  }, [orderedSelectedReleaseTypes, releaseTypeOptions.length, selectedReleaseTypes.length]);

  const labelSummary = useMemo(() => {
    if (!labelOptions.length) {
      return 'No labels or companies available';
    }

    if (!selectedLabels.length) {
      return 'Find a label or company';
    }

    if (selectedLabels.length === labelOptions.length) {
      return 'All labels & companies';
    }

    if (orderedSelectedLabels.length === 1) {
      return orderedSelectedLabels[0];
    }

    return `${orderedSelectedLabels.length} selected`;
  }, [labelOptions.length, orderedSelectedLabels, selectedLabels.length]);

  const toggleReleaseType = value => {
    setSelectedReleaseTypes(prev => {
      if (prev.includes(value)) {
        return prev.filter(item => item !== value);
      }
      return [...prev, value];
    });
  };

  const clearReleaseTypeSelection = () => {
    setSelectedReleaseTypes([]);
    setIsReleaseDropdownOpen(false);
  };

  const toggleLabelOption = value => {
    setSelectedLabels(prev => {
      if (prev.includes(value)) {
        return prev.filter(item => item !== value);
      }
      return [...prev, value];
    });
  };

  const clearLabelSelection = () => {
    setSelectedLabels([]);
    setIsLabelDropdownOpen(false);
  };

  const toggleYearOption = value => {
    setSelectedYears(prev => {
      if (prev.includes(value)) {
        return prev.filter(item => item !== value);
      }
      return [...prev, value];
    });
  };

  const clearYearSelection = () => {
    setSelectedYears([]);
    setIsYearDropdownOpen(false);
  };

  const toggleCountryOption = value => {
    setSelectedCountries(prev => {
      if (prev.includes(value)) {
        return prev.filter(item => item !== value);
      }
      return [...prev, value];
    });
  };

  const clearCountrySelection = () => {
    setSelectedCountries([]);
    setIsCountryDropdownOpen(false);
  };

  const toggleCustomYearRange = () => {
    setUseCustomYearRange(prev => {
      if (prev) {
        setYearRangeStart('');
        setYearRangeEnd('');
        return false;
      }
      return true;
    });
  };

  const clearCustomYearRange = () => {
    setUseCustomYearRange(false);
    setYearRangeStart('');
    setYearRangeEnd('');
  };

  const clearAllFilters = () => {
    setSelectedReleaseTypes([]);
    setSelectedYears([]);
    setSelectedLabels([]);
    setSelectedCountries([]);
    clearCustomYearRange();
    setIsReleaseDropdownOpen(false);
    setIsLabelDropdownOpen(false);
    setIsYearDropdownOpen(false);
    setIsCountryDropdownOpen(false);
  };

  const anyFiltersApplied =
    activeReleaseTypeFilter ||
    selectedLabels.length > 0 ||
    selectedYears.length > 0 ||
    selectedCountries.length > 0 ||
    useCustomYearRange;

  const handleReleaseBoxKeyDown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsReleaseDropdownOpen(prev => !prev);
    }
  };

  const handleLabelBoxKeyDown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsLabelDropdownOpen(prev => !prev);
    }
  };

  const handleYearBoxKeyDown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsYearDropdownOpen(prev => !prev);
    }
  };

  const handleCountryBoxKeyDown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsCountryDropdownOpen(prev => !prev);
    }
  };

  const yearSummary = useMemo(() => {
    if (useCustomYearRange) {
      if (yearRangeStart && yearRangeEnd) {
        return `${yearRangeStart} - ${yearRangeEnd}`;
      }
      if (yearRangeStart) {
        return `From ${yearRangeStart}`;
      }
      return 'Custom range';
    }

    if (!yearOptions.length) {
      return 'No years available';
    }

    if (!selectedYears.length) {
      return 'Find a year';
    }

    if (selectedYears.length === yearOptions.length) {
      return 'All years';
    }

    if (orderedSelectedYears.length === 1) {
      return orderedSelectedYears[0];
    }

    return `${orderedSelectedYears.length} selected`;
  }, [orderedSelectedYears, selectedYears.length, useCustomYearRange, yearRangeEnd, yearRangeStart, yearOptions.length]);

  const countrySummary = useMemo(() => {
    if (!countryOptions.length) {
      return 'No countries available';
    }

    if (!selectedCountries.length) {
      return 'Find a country';
    }

    if (selectedCountries.length === countryOptions.length) {
      return 'All countries';
    }

    if (orderedSelectedCountries.length === 1) {
      return orderedSelectedCountries[0];
    }

    return `${orderedSelectedCountries.length} selected`;
  }, [countryOptions.length, orderedSelectedCountries, selectedCountries.length]);
  const data = useMemo(() => {
    let filteredData = rawData;
    
    // Apply release type filter
    if (activeReleaseTypeFilter) {
      const selectedSet = new Set(selectedReleaseTypes);
      filteredData = filteredData.filter(row => selectedSet.has(row.releaseType));
    }

    if (selectedLabels.length > 0) {
      const selectedSet = new Set(selectedLabels);
      filteredData = filteredData.filter(row => {
        const labels = Array.isArray(row.labelsAndCompanies)
          ? row.labelsAndCompanies
          : row.labelsAndCompanies
            ? [row.labelsAndCompanies]
            : [];

        if (!labels.length) return false;
        return labels.some(label => selectedSet.has(label));
      });
    }

    if (selectedCountries.length > 0) {
      const selectedSet = new Set(selectedCountries);
      filteredData = filteredData.filter(row => {
        if (!row.country) return false;
        const country = row.country.toString().trim();
        if (!country) return false;
        return selectedSet.has(country);
      });
    }
    
    // Apply year filter
    if (useCustomYearRange && yearRangeStart) {
      const startYear = parseInt(yearRangeStart, 10);
      const endYear = yearRangeEnd ? parseInt(yearRangeEnd, 10) : startYear;

      if (!Number.isNaN(startYear)) {
        filteredData = filteredData.filter(row => {
          if (!row.year) return false;
          const year = parseInt(row.year, 10);
          if (Number.isNaN(year)) return false;
          if (!yearRangeEnd) {
            return year === startYear;
          }
          if (Number.isNaN(endYear)) {
            return year >= startYear;
          }
          return year >= startYear && year <= endYear;
        });
      }
    } else if (selectedYears.length > 0) {
      const selectedSet = new Set(selectedYears);
      filteredData = filteredData.filter(row => {
        if (!row.year) return false;
        return selectedSet.has(row.year.toString().trim());
      });
    }
    
    // Apply search filter
    if (search) {
      const lower = search.toLowerCase();
      filteredData = filteredData.filter(row =>
        Object.values(row).some(
          v => typeof v === 'string' && v.toLowerCase().includes(lower)
        )
      );
    }
    
    return filteredData;
  }, [rawData, search, activeReleaseTypeFilter, selectedReleaseTypes, selectedLabels, selectedCountries, useCustomYearRange, selectedYears, yearRangeStart, yearRangeEnd]);

  useEffect(() => {
    onFilteredDataChange(data);
  }, [data, onFilteredDataChange]);

  const columns = useMemo(() => [
    {
      accessorKey: 'releaseTitle',
      header: 'Release',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'artist',
      header: 'Artist',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'year',
      header: 'Year',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'releaseType',
      header: 'Release Type',
      cell: info => info.getValue() || 'N/A',
      enableSorting: true,
    },
    {
      accessorKey: 'labelsAndCompanies',
      header: 'Labels & Companies',
      cell: info => {
        const value = info.getValue();
        if (!value) return 'N/A';
        if (Array.isArray(value)) {
          if (value.length === 0) return 'N/A';
          return value.join(', ');
        }
        return value;
      },
      enableSorting: false,
    },
    {
      accessorKey: 'country',
      header: 'Country',
      cell: info => info.getValue() || 'N/A',
      enableSorting: true,
    },
    {
      accessorKey: 'title',
      header: 'Video Title',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'fullUrl',
      header: 'YouTube Link',
      cell: info => (
        <a href={info.getValue()} target="_blank" rel="noopener noreferrer">
          {info.row.original.videoId}
        </a>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'discogsUrl',
      header: 'Discogs Link',
      cell: info => (
        <a href={info.getValue()} target="_blank" rel="noopener noreferrer">
          Discogs
        </a>
      ),
      enableSorting: false,
    },
  ], []);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { 
      pagination,
      sorting,
    },
    autoResetPageIndex: false,
    autoResetExpanded: false,
  });

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.filterCard}>
        <div className={styles.filterHeaderRow}>
          <span className={styles.filterHeaderTitle}>Filter Results</span>
          {anyFiltersApplied && (
            <button
              type="button"
              className={styles.clearFiltersButton}
              onClick={clearAllFilters}
            >
              Clear All
            </button>
          )}
        </div>

        <div className={styles.activeFiltersRow}>
          <span className={styles.filterByLabel}>Filter by</span>
          {!anyFiltersApplied && (
            <span className={styles.filterChipPlaceholder}>All release types, labels & countries</span>
          )}

          {activeReleaseTypeFilter && orderedSelectedReleaseTypes.map(type => (
            <button
              key={`release-${type}`}
              type="button"
              className={styles.filterChip}
              onClick={() => toggleReleaseType(type)}
            >
              <span>{type}</span>
              <span className={styles.filterChipRemove} aria-hidden="true">×</span>
              <span className={styles.srOnly}>Remove {type}</span>
            </button>
          ))}

          {activeReleaseTypeFilter && (
            <button
              type="button"
              className={styles.clearChipButton}
              onClick={clearReleaseTypeSelection}
            >
              Remove release type filter
            </button>
          )}

          {orderedSelectedLabels.length > 0 && orderedSelectedLabels.map(label => (
            <button
              key={`label-${label}`}
              type="button"
              className={styles.filterChip}
              onClick={() => toggleLabelOption(label)}
            >
              <span>{label}</span>
              <span className={styles.filterChipRemove} aria-hidden="true">×</span>
              <span className={styles.srOnly}>Remove label or company {label}</span>
            </button>
          ))}

          {orderedSelectedLabels.length > 0 && (
            <button
              type="button"
              className={styles.clearChipButton}
              onClick={clearLabelSelection}
            >
              Remove label filter
            </button>
          )}

          {!useCustomYearRange && orderedSelectedYears.map(year => (
            <button
              key={`year-${year}`}
              type="button"
              className={styles.filterChip}
              onClick={() => toggleYearOption(year)}
            >
              <span>{year}</span>
              <span className={styles.filterChipRemove} aria-hidden="true">×</span>
              <span className={styles.srOnly}>Remove year {year}</span>
            </button>
          ))}

          {!useCustomYearRange && orderedSelectedYears.length > 0 && (
            <button
              type="button"
              className={styles.clearChipButton}
              onClick={clearYearSelection}
            >
              Remove year filter
            </button>
          )}

          {orderedSelectedCountries.length > 0 && orderedSelectedCountries.map(country => (
            <button
              key={`country-${country}`}
              type="button"
              className={styles.filterChip}
              onClick={() => toggleCountryOption(country)}
            >
              <span>{country}</span>
              <span className={styles.filterChipRemove} aria-hidden="true">×</span>
              <span className={styles.srOnly}>Remove country {country}</span>
            </button>
          ))}

          {orderedSelectedCountries.length > 0 && (
            <button
              type="button"
              className={styles.clearChipButton}
              onClick={clearCountrySelection}
            >
              Remove country filter
            </button>
          )}

          {useCustomYearRange && (
            <button
              type="button"
              className={styles.filterChip}
              onClick={clearCustomYearRange}
            >
              <span>
                {yearRangeStart
                  ? `Years: ${yearRangeStart}${yearRangeEnd ? ` - ${yearRangeEnd}` : ''}`
                  : 'Custom Year Range'}
              </span>
              <span className={styles.filterChipRemove} aria-hidden="true">×</span>
              <span className={styles.srOnly}>Remove custom year range</span>
            </button>
          )}

        </div>

        <div className={styles.dropdownRow}>
          <div
            className={styles.dropdownWrapper}
            ref={releaseDropdownRef}
          >
            <label className={styles.dropdownLabel} htmlFor="release-types-input">
              Release Type
            </label>
            <div
              className={`${styles.dropdownBox} ${isReleaseDropdownOpen ? styles.dropdownBoxOpen : ''}`}
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={isReleaseDropdownOpen}
              aria-controls="release-types-listbox"
              tabIndex={0}
              onClick={() => setIsReleaseDropdownOpen(prev => !prev)}
              onKeyDown={handleReleaseBoxKeyDown}
            >
              <input
                id="release-types-input"
                className={styles.dropdownInput}
                readOnly
                tabIndex={-1}
                value={releaseTypeSummary}
                aria-autocomplete="list"
                aria-controls="release-types-listbox"
              />
              <button
                type="button"
                className={styles.dropdownButton}
                aria-label={isReleaseDropdownOpen ? 'Hide release type options' : 'Show release type options'}
                onClick={event => {
                  event.stopPropagation();
                  setIsReleaseDropdownOpen(prev => !prev);
                }}
                tabIndex={-1}
              >
                <svg viewBox="0 0 1024 1024" className={styles.dropdownButtonIcon} aria-hidden="true">
                  <path d="M512 640a32 32 0 0 1-22.63-9.37l-256-256a32 32 0 0 1 45.26-45.26L512 562.75l233.37-233.38a32 32 0 0 1 45.26 45.26l-256 256A32 32 0 0 1 512 640z" />
                </svg>
              </button>
            </div>
            <div
              className={styles.dropdownList}
              id="release-types-listbox"
              role="listbox"
              aria-multiselectable="true"
              hidden={!isReleaseDropdownOpen}
            >
              {releaseTypeOptions.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={styles.dropdownItemAction}
                    onClick={clearReleaseTypeSelection}
                  >
                    Clear selection
                  </button>
                  {releaseTypeOptions.map(option => {
                    const isSelected = selectedReleaseTypes.includes(option.value);
                    return (
                      <div
                        key={option.value}
                        className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <label className={styles.dropdownItemLabelRow}>
                          <input
                            type="checkbox"
                            className={styles.dropdownCheckbox}
                            checked={isSelected}
                            onChange={() => toggleReleaseType(option.value)}
                          />
                          <span className={styles.dropdownItemLabel}>{option.value}</span>
                        </label>
                        <span className={styles.dropdownItemCount}>{option.count}</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className={styles.dropdownEmpty}>No release types found</div>
              )}
            </div>
          </div>

          <div
            className={styles.dropdownWrapper}
            ref={labelDropdownRef}
          >
            <label className={styles.dropdownLabel} htmlFor="label-filter-input">
              Labels &amp; Companies
            </label>
            <div
              className={`${styles.dropdownBox} ${isLabelDropdownOpen ? styles.dropdownBoxOpen : ''}`}
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={isLabelDropdownOpen}
              aria-controls="label-filter-listbox"
              tabIndex={0}
              onClick={() => setIsLabelDropdownOpen(prev => !prev)}
              onKeyDown={handleLabelBoxKeyDown}
            >
              <input
                id="label-filter-input"
                className={styles.dropdownInput}
                readOnly
                tabIndex={-1}
                value={labelSummary}
                aria-autocomplete="list"
                aria-controls="label-filter-listbox"
              />
              <button
                type="button"
                className={styles.dropdownButton}
                aria-label={isLabelDropdownOpen ? 'Hide label options' : 'Show label options'}
                onClick={event => {
                  event.stopPropagation();
                  setIsLabelDropdownOpen(prev => !prev);
                }}
                tabIndex={-1}
              >
                <svg viewBox="0 0 1024 1024" className={styles.dropdownButtonIcon} aria-hidden="true">
                  <path d="M512 640a32 32 0 0 1-22.63-9.37l-256-256a32 32 0 0 1 45.26-45.26L512 562.75l233.37-233.38a32 32 0 0 1 45.26 45.26l-256 256A32 32 0 0 1 512 640z" />
                </svg>
              </button>
            </div>
            <div
              className={styles.dropdownList}
              id="label-filter-listbox"
              role="listbox"
              aria-multiselectable="true"
              hidden={!isLabelDropdownOpen}
            >
              {labelOptions.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={styles.dropdownItemAction}
                    onClick={clearLabelSelection}
                    disabled={selectedLabels.length === 0}
                  >
                    Clear label selections
                  </button>
                  {labelOptions.map(option => {
                    const isSelected = selectedLabels.includes(option.value);
                    return (
                      <div
                        key={option.value}
                        className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <label className={styles.dropdownItemLabelRow}>
                          <input
                            type="checkbox"
                            className={styles.dropdownCheckbox}
                            checked={isSelected}
                            onChange={() => toggleLabelOption(option.value)}
                          />
                          <span className={styles.dropdownItemLabel}>{option.value}</span>
                        </label>
                        <span className={styles.dropdownItemCount}>{option.count}</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className={styles.dropdownEmpty}>No labels or companies found</div>
              )}
            </div>
          </div>

          <div
            className={styles.dropdownWrapper}
            ref={yearDropdownRef}
          >
            <label className={styles.dropdownLabel} htmlFor="year-filter-input">
              Year
            </label>
            <div
              className={`${styles.dropdownBox} ${isYearDropdownOpen ? styles.dropdownBoxOpen : ''}`}
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={isYearDropdownOpen}
              aria-controls="year-filter-listbox"
              tabIndex={0}
              onClick={() => setIsYearDropdownOpen(prev => !prev)}
              onKeyDown={handleYearBoxKeyDown}
            >
              <input
                id="year-filter-input"
                className={styles.dropdownInput}
                readOnly
                tabIndex={-1}
                value={yearSummary}
                aria-autocomplete="list"
                aria-controls="year-filter-listbox"
              />
              <button
                type="button"
                className={styles.dropdownButton}
                aria-label={isYearDropdownOpen ? 'Hide year options' : 'Show year options'}
                onClick={event => {
                  event.stopPropagation();
                  setIsYearDropdownOpen(prev => !prev);
                }}
                tabIndex={-1}
              >
                <svg viewBox="0 0 1024 1024" className={styles.dropdownButtonIcon} aria-hidden="true">
                  <path d="M512 640a32 32 0 0 1-22.63-9.37l-256-256a32 32 0 0 1 45.26-45.26L512 562.75l233.37-233.38a32 32 0 0 1 45.26 45.26l-256 256A32 32 0 0 1 512 640z" />
                </svg>
              </button>
            </div>
            <div
              className={styles.dropdownList}
              id="year-filter-listbox"
              role="listbox"
              aria-multiselectable="true"
              hidden={!isYearDropdownOpen}
            >
              {yearOptions.length > 0 ? (
                <>
                  <div
                    className={`${styles.dropdownItem} ${useCustomYearRange ? styles.dropdownItemSelected : ''}`}
                    role="option"
                    aria-selected={useCustomYearRange}
                  >
                    <label className={styles.dropdownItemLabelRow}>
                      <input
                        type="checkbox"
                        className={styles.dropdownCheckbox}
                        checked={useCustomYearRange}
                        onChange={toggleCustomYearRange}
                      />
                      <span className={styles.dropdownItemLabel}>Use custom year range</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    className={styles.dropdownItemAction}
                    onClick={clearYearSelection}
                    disabled={selectedYears.length === 0}
                  >
                    Clear year selections
                  </button>
                  {yearOptions.map(option => {
                    const isSelected = selectedYears.includes(option.value);
                    return (
                      <div
                        key={option.value}
                        className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <label className={styles.dropdownItemLabelRow}>
                          <input
                            type="checkbox"
                            className={styles.dropdownCheckbox}
                            checked={isSelected}
                            onChange={() => toggleYearOption(option.value)}
                          />
                          <span className={styles.dropdownItemLabel}>{option.value}</span>
                        </label>
                        <span className={styles.dropdownItemCount}>{option.count}</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className={styles.dropdownEmpty}>No years found</div>
              )}
            </div>
          </div>

          {useCustomYearRange && (
            <>
              <div className={styles.simpleSelectWrapper}>
                <label className={styles.dropdownLabel} htmlFor="year-range-start">
                  From Year
                </label>
                <input
                  id="year-range-start"
                  type="number"
                  value={yearRangeStart}
                  onChange={(e) => setYearRangeStart(e.target.value)}
                  placeholder="e.g., 1970"
                  className={styles.rangeInput}
                />
              </div>
              <div className={styles.simpleSelectWrapper}>
                <label className={styles.dropdownLabel} htmlFor="year-range-end">
                  To Year (optional)
                </label>
                <input
                  id="year-range-end"
                  type="number"
                  value={yearRangeEnd}
                  onChange={(e) => setYearRangeEnd(e.target.value)}
                  placeholder="e.g., 1980"
                  className={styles.rangeInput}
                />
              </div>
            </>
          )}

          <div
            className={styles.dropdownWrapper}
            ref={countryDropdownRef}
          >
            <label className={styles.dropdownLabel} htmlFor="country-filter-input">
              Country
            </label>
            <div
              className={`${styles.dropdownBox} ${isCountryDropdownOpen ? styles.dropdownBoxOpen : ''}`}
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={isCountryDropdownOpen}
              aria-controls="country-filter-listbox"
              tabIndex={0}
              onClick={() => setIsCountryDropdownOpen(prev => !prev)}
              onKeyDown={handleCountryBoxKeyDown}
            >
              <input
                id="country-filter-input"
                className={styles.dropdownInput}
                readOnly
                tabIndex={-1}
                value={countrySummary}
                aria-autocomplete="list"
                aria-controls="country-filter-listbox"
              />
              <button
                type="button"
                className={styles.dropdownButton}
                aria-label={isCountryDropdownOpen ? 'Hide country options' : 'Show country options'}
                onClick={event => {
                  event.stopPropagation();
                  setIsCountryDropdownOpen(prev => !prev);
                }}
                tabIndex={-1}
              >
                <svg viewBox="0 0 1024 1024" className={styles.dropdownButtonIcon} aria-hidden="true">
                  <path d="M512 640a32 32 0 0 1-22.63-9.37l-256-256a32 32 0 0 1 45.26-45.26L512 562.75l233.37-233.38a32 32 0 0 1 45.26 45.26l-256 256A32 32 0 0 1 512 640z" />
                </svg>
              </button>
            </div>
            <div
              className={styles.dropdownList}
              id="country-filter-listbox"
              role="listbox"
              aria-multiselectable="true"
              hidden={!isCountryDropdownOpen}
            >
              {countryOptions.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={styles.dropdownItemAction}
                    onClick={clearCountrySelection}
                    disabled={selectedCountries.length === 0}
                  >
                    Clear country selections
                  </button>
                  {countryOptions.map(option => {
                    const isSelected = selectedCountries.includes(option.value);
                    return (
                      <div
                        key={option.value}
                        className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <label className={styles.dropdownItemLabelRow}>
                          <input
                            type="checkbox"
                            className={styles.dropdownCheckbox}
                            checked={isSelected}
                            onChange={() => toggleCountryOption(option.value)}
                          />
                          <span className={styles.dropdownItemLabel}>{option.value}</span>
                        </label>
                        <span className={styles.dropdownItemCount}>{option.count}</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className={styles.dropdownEmpty}>No countries found</div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.filterFooter}>
          Showing {data.length} of {rawData.length} videos
        </div>
      </div>
      
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
                    cursor: header.column.getCanSort() ? 'pointer' : 'default',
                    userSelect: 'none',
                    position: 'relative',
                  }}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      <span style={{ 
                        fontSize: '12px', 
                        opacity: header.column.getIsSorted() ? 1 : 0.5,
                        fontWeight: 'bold'
                      }}>
                        {header.column.getIsSorted() === 'asc' ? '↑' : 
                         header.column.getIsSorted() === 'desc' ? '↓' : '↕'}
                      </span>
                    )}
                  </div>
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
