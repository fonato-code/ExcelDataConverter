(function () {
    const { createApp, computed, reactive, watch } = Vue;
    const STORAGE_KEY = "excelconverter.array-compare.preferences.v1";
    const inputConfig = window.ExcelConverterInputConfig || [];
    const inputFormats = window.ExcelConverterInputFormats || [];
    const inputParsers = window.ExcelConverterInputParsers || {};
    const outputFormats = window.ExcelConverterOutputFormats || [];
    const outputBuilders = window.ExcelConverterOutputBuilders || {};

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatCellForHtml(value) {
        return escapeHtml(value).replace(/\r?\n/g, "<br>");
    }

    function escapeSqlString(value) {
        return String(value).replace(/'/g, "''");
    }

    function escapePhpString(value) {
        return String(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"");
    }

    function escapeXml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    function sanitizeSqlIdentifier(value) {
        const sanitized = String(value).replace(/[^A-Za-z0-9_]/g, "_");
        return sanitized || "column";
    }

    function sanitizeXmlTagName(value, fallback) {
        const sanitized = String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
        const valid = /^[A-Za-z_]/.test(sanitized) ? sanitized : fallback;
        return valid || fallback;
    }

    function isNumericValue(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function buildObjectsFromRows(rows, headers) {
        return rows.map(function (row) {
            return headers.reduce(function (record, header, index) {
                record[header] = index < row.length ? row[index] : "";
                return record;
            }, {});
        });
    }

    function buildOutput(format, headers, rows, options) {
        const builder = outputBuilders[format];
        if (!builder) {
            return "";
        }

        return builder({
            headers: headers,
            rows: rows,
            columns: options.columns || [],
            options: options,
            utils: {
                buildObjectsFromRows: buildObjectsFromRows,
                formatCellForHtml: formatCellForHtml,
                escapeSqlString: escapeSqlString,
                escapePhpString: escapePhpString,
                escapeXml: escapeXml,
                sanitizeSqlIdentifier: sanitizeSqlIdentifier,
                sanitizeXmlTagName: sanitizeXmlTagName,
                isNumericValue: isNumericValue
            }
        });
    }

    function getOutputFileExtension(format) {
        const extensionMap = {
            json: "json",
            "json-column-arrays": "json",
            "json-row-arrays": "json",
            "json-dictionary": "json",
            ndjson: "ndjson",
            yaml: "yaml",
            "markdown-table": "md",
            "html-table": "html",
            sql: "sql",
            php: "php",
            "xml-properties": "xml",
            "xml-nodes": "xml",
            avro: "json",
            csv: "csv",
            tsv: "tsv"
        };

        return extensionMap[format] || "txt";
    }

    function getCompareExportTabSlug(tab) {
        if (tab === "onlyA") {
            return "so-a";
        }

        if (tab === "onlyB") {
            return "so-b";
        }

        return "em-comum";
    }

    function getCompareExportTabLabel(tab) {
        if (tab === "onlyA") {
            return "So A";
        }

        if (tab === "onlyB") {
            return "So B";
        }

        return "Em comum";
    }

    function normalizeHeader(value, index, transform) {
        const fallback = "column_" + (index + 1);
        if (!value) {
            return fallback;
        }

        if (transform === "uppercase") {
            return value.toUpperCase();
        }

        if (transform === "downcase") {
            return value.toLowerCase();
        }

        return value;
    }

    function buildDefaultHeaders(columnCount) {
        return Array.from({ length: columnCount }, function (_value, index) {
            return "Col" + (index + 1);
        });
    }

    function createPairId() {
        return "pair_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    }

    function loadPreferences(defaultState) {
        try {
            const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
            return Object.assign({}, defaultState, saved, {
                listA: Object.assign({}, defaultState.listA, saved.listA || {}),
                listB: Object.assign({}, defaultState.listB, saved.listB || {}),
                columnPairs: Array.isArray(saved.columnPairs) ? saved.columnPairs : defaultState.columnPairs
            });
        } catch (_error) {
            return defaultState;
        }
    }

    function normalizeCompareValue(rawValue, options) {
        let value = String(rawValue == null ? "" : rawValue);

        if (options.trim) {
            value = value.trim();
        }

        if (options.ignoreSpaces) {
            value = value.replace(/\s+/g, "");
        }

        if (options.ignoreSpecialCharsAndAccents) {
            value = value
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^A-Za-z0-9]/g, "");
        }

        if (options.ignoreLeadingZeros && /^\d+$/.test(value)) {
            value = value.replace(/^0+/, "") || "0";
        }

        return value;
    }

    function sortValues(values, mode) {
        const copy = values.slice();

        if (mode === "az") {
            return copy.sort(function (a, b) {
                return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
            });
        }

        if (mode === "za") {
            return copy.sort(function (a, b) {
                return String(b).localeCompare(String(a), undefined, { sensitivity: "base" });
            });
        }

        if (mode === "09") {
            return copy.sort(function (a, b) {
                const numA = Number(a);
                const numB = Number(b);
                const bothNumeric = Number.isFinite(numA) && Number.isFinite(numB)
                    && String(a).trim() !== ""
                    && String(b).trim() !== "";

                if (bothNumeric) {
                    return numA - numB;
                }

                return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
            });
        }

        if (mode === "90") {
            return copy.sort(function (a, b) {
                const numA = Number(a);
                const numB = Number(b);
                const bothNumeric = Number.isFinite(numA) && Number.isFinite(numB)
                    && String(a).trim() !== ""
                    && String(b).trim() !== "";

                if (bothNumeric) {
                    return numB - numA;
                }

                return String(b).localeCompare(String(a), undefined, { numeric: true, sensitivity: "base" });
            });
        }

        return copy;
    }

    function parseListInput(listState, parseState) {
        const emptyData = {
            headers: [],
            dataRows: []
        };

        if (!String(listState.input || "").trim()) {
            return {
                data: emptyData,
                error: ""
            };
        }

        const parser = inputParsers[listState.inputFormat];
        if (!parser) {
            return {
                data: emptyData,
                error: "Formato de entrada nao suportado."
            };
        }

        try {
            return {
                data: parser({
                    input: listState.input,
                    state: parseState,
                    utils: {
                        buildDefaultHeaders: buildDefaultHeaders,
                        normalizeHeader: normalizeHeader
                    }
                }),
                error: ""
            };
        } catch (error) {
            return {
                data: emptyData,
                error: error && error.message ? error.message : "Erro ao ler o input."
            };
        }
    }

    function buildRowKey(row, columnName, headers, options) {
        const columnIndex = headers.indexOf(columnName);
        if (columnIndex === -1) {
            return "";
        }

        return normalizeCompareValue(row[columnIndex], options);
    }

    function buildCompositeKey(row, headers, columnNames, options) {
        if (!columnNames.length) {
            return "";
        }

        return columnNames.map(function (columnName) {
            return buildRowKey(row, columnName, headers, options);
        }).join("\x1f");
    }

    function indexRowsByKey(rows, headers, columnNames, options) {
        const map = new Map();

        rows.forEach(function (row, rowIndex) {
            const key = buildCompositeKey(row, headers, columnNames, options);
            if (!key) {
                return;
            }

            if (!map.has(key)) {
                map.set(key, []);
            }

            map.get(key).push({
                rowIndex: rowIndex,
                row: row.slice(),
                key: key
            });
        });

        return map;
    }

    function formatCellValue(value) {
        if (value == null) {
            return "";
        }

        return String(value);
    }

    function rowCellsByHeaders(row, headers) {
        return headers.map(function (_header, index) {
            return formatCellValue(index < row.length ? row[index] : "");
        });
    }

    function getRawCellValue(row, header, headers) {
        const columnIndex = headers.indexOf(header);
        if (columnIndex === -1) {
            return "";
        }

        return formatCellValue(columnIndex < row.length ? row[columnIndex] : "");
    }

    createApp({
        setup() {
            const defaultState = {
                theme: "dark",
                listA: {
                    input: "",
                    inputFormat: "input-default",
                    sectionCollapsed: false
                },
                listB: {
                    input: "",
                    inputFormat: "input-default",
                    sectionCollapsed: false
                },
                delimiter: "auto",
                decimalSign: "dot",
                firstRowIsHeader: true,
                headerTransform: "none",
                columnPairs: [{ id: createPairId(), columnA: "", columnB: "" }],
                ignoreLeadingZeros: false,
                trim: true,
                ignoreSpaces: false,
                ignoreSpecialCharsAndAccents: false,
                sortMode: "none",
                optionsSectionCollapsed: false,
                resultsSectionCollapsed: false,
                activeResultTab: "onlyA",
                resultPage: 1,
                resultPageSize: 100,
                resultSearch: "",
                compareDetailOpen: false,
                compareDetailSourceIndex: -1,
                outputFormat: "json",
                sqlTableName: "ExcelConverter",
                sqlAddCreateTable: true,
                sqlAddIdentityInsert: false,
                sqlAddTransaction: false,
                sqlAddTruncate: false,
                sqlConvertEmptyToNull: false,
                sqlInsertBatchSize: 1000,
                xmlRootTagName: "rows",
                xmlRowTagName: "row",
                copyFeedback: "",
                toasts: []
            };

            const state = reactive(loadPreferences(defaultState));
            let toastSeed = 0;

            function pushToast(message, tone) {
                toastSeed += 1;
                const id = "toast_" + toastSeed;
                state.toasts.push({
                    id: id,
                    message: message,
                    tone: tone || "info"
                });

                window.setTimeout(function () {
                    const index = state.toasts.findIndex(function (toast) {
                        return toast.id === id;
                    });

                    if (index !== -1) {
                        state.toasts.splice(index, 1);
                    }
                }, 4200);
            }

            function dismissToast(id) {
                const index = state.toasts.findIndex(function (toast) {
                    return toast.id === id;
                });

                if (index !== -1) {
                    state.toasts.splice(index, 1);
                }
            }

            watch(function () {
                return state.theme;
            }, function (theme) {
                document.documentElement.setAttribute("data-theme", theme);
                document.documentElement.setAttribute("data-bs-theme", theme === "dark" ? "dark" : "light");
            }, { immediate: true });

            watch(function () {
                return {
                    theme: state.theme,
                    listA: {
                        inputFormat: state.listA.inputFormat,
                        sectionCollapsed: state.listA.sectionCollapsed
                    },
                    listB: {
                        inputFormat: state.listB.inputFormat,
                        sectionCollapsed: state.listB.sectionCollapsed
                    },
                    delimiter: state.delimiter,
                    decimalSign: state.decimalSign,
                    firstRowIsHeader: state.firstRowIsHeader,
                    headerTransform: state.headerTransform,
                    columnPairs: state.columnPairs,
                    ignoreLeadingZeros: state.ignoreLeadingZeros,
                    trim: state.trim,
                    ignoreSpaces: state.ignoreSpaces,
                    ignoreSpecialCharsAndAccents: state.ignoreSpecialCharsAndAccents,
                    sortMode: state.sortMode,
                    optionsSectionCollapsed: state.optionsSectionCollapsed,
                    resultsSectionCollapsed: state.resultsSectionCollapsed,
                    activeResultTab: state.activeResultTab,
                    resultPageSize: state.resultPageSize,
                    outputFormat: state.outputFormat,
                    sqlTableName: state.sqlTableName
                };
            }, function (preferences) {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
            }, { deep: true });

            const parseState = computed(function () {
                return {
                    delimiter: state.delimiter,
                    decimalSign: state.decimalSign,
                    firstRowIsHeader: state.firstRowIsHeader,
                    headerTransform: state.headerTransform
                };
            });

            const parsedListA = computed(function () {
                const result = parseListInput(state.listA, parseState.value);
                return {
                    headers: result.data.headers || [],
                    dataRows: result.data.dataRows || [],
                    error: result.error
                };
            });

            const parsedListB = computed(function () {
                const result = parseListInput(state.listB, parseState.value);
                return {
                    headers: result.data.headers || [],
                    dataRows: result.data.dataRows || [],
                    error: result.error
                };
            });

            const listAMeta = computed(function () {
                if (!state.listA.input.trim()) {
                    return "Sem dados";
                }

                if (parsedListA.value.error) {
                    return "Erro no parse";
                }

                return parsedListA.value.dataRows.length + " linha(s), " + parsedListA.value.headers.length + " coluna(s)";
            });

            const listBMeta = computed(function () {
                if (!state.listB.input.trim()) {
                    return "Sem dados";
                }

                if (parsedListB.value.error) {
                    return "Erro no parse";
                }

                return parsedListB.value.dataRows.length + " linha(s), " + parsedListB.value.headers.length + " coluna(s)";
            });

            const compareOptions = computed(function () {
                return {
                    trim: state.trim,
                    ignoreSpaces: state.ignoreSpaces,
                    ignoreSpecialCharsAndAccents: state.ignoreSpecialCharsAndAccents,
                    ignoreLeadingZeros: state.ignoreLeadingZeros
                };
            });

            const validColumnPairs = computed(function () {
                return state.columnPairs.filter(function (pair) {
                    return pair.columnA && pair.columnB
                        && parsedListA.value.headers.indexOf(pair.columnA) !== -1
                        && parsedListB.value.headers.indexOf(pair.columnB) !== -1;
                });
            });

            const comparisonResult = computed(function () {
                const emptyResult = {
                    ready: false,
                    error: "",
                    summary: {
                        totalA: 0,
                        totalB: 0,
                        uniqueA: 0,
                        uniqueB: 0,
                        onlyA: 0,
                        onlyB: 0,
                        inBoth: 0
                    },
                    onlyInA: [],
                    onlyInB: [],
                    inBoth: [],
                    pairLabels: [],
                    headersA: [],
                    headersB: []
                };

                if (!state.listA.input.trim() && !state.listB.input.trim()) {
                    return Object.assign({}, emptyResult, {
                        error: "Cole dados em Lista A e/ou Lista B para comparar."
                    });
                }

                if (parsedListA.value.error) {
                    return Object.assign({}, emptyResult, {
                        error: "Lista A: " + parsedListA.value.error
                    });
                }

                if (parsedListB.value.error) {
                    return Object.assign({}, emptyResult, {
                        error: "Lista B: " + parsedListB.value.error
                    });
                }

                if (!validColumnPairs.value.length) {
                    return Object.assign({}, emptyResult, {
                        error: "Defina ao menos um par de colunas para comparacao."
                    });
                }

                const columnNamesA = validColumnPairs.value.map(function (pair) {
                    return pair.columnA;
                });
                const columnNamesB = validColumnPairs.value.map(function (pair) {
                    return pair.columnB;
                });
                const pairLabels = validColumnPairs.value.map(function (pair) {
                    return pair.columnA + " ↔ " + pair.columnB;
                });

                const options = compareOptions.value;
                const rowsA = parsedListA.value.dataRows;
                const rowsB = parsedListB.value.dataRows;
                const headersA = parsedListA.value.headers;
                const headersB = parsedListB.value.headers;

                const mapA = indexRowsByKey(rowsA, headersA, columnNamesA, options);
                const mapB = indexRowsByKey(rowsB, headersB, columnNamesB, options);

                const keysA = sortValues(Array.from(mapA.keys()), state.sortMode);
                const keysB = sortValues(Array.from(mapB.keys()), state.sortMode);
                const keySetA = new Set(keysA);
                const keySetB = new Set(keysB);

                const onlyInA = [];
                const onlyInB = [];
                const inBoth = [];

                keysA.forEach(function (key) {
                    if (!keySetB.has(key)) {
                        (mapA.get(key) || []).forEach(function (entry) {
                            onlyInA.push({
                                key: key,
                                rowIndex: entry.rowIndex,
                                row: entry.row.slice()
                            });
                        });
                    }
                });

                keysB.forEach(function (key) {
                    if (!keySetA.has(key)) {
                        (mapB.get(key) || []).forEach(function (entry) {
                            onlyInB.push({
                                key: key,
                                rowIndex: entry.rowIndex,
                                row: entry.row.slice()
                            });
                        });
                    }
                });

                keysA.forEach(function (key) {
                    if (!keySetB.has(key)) {
                        return;
                    }

                    const entriesA = mapA.get(key) || [];
                    const entriesB = mapB.get(key) || [];
                    const maxMatches = Math.max(entriesA.length, entriesB.length);

                    for (let index = 0; index < maxMatches; index += 1) {
                        const entryA = entriesA[index];
                        const entryB = entriesB[index];

                        inBoth.push({
                            key: key,
                            rowIndexA: entryA ? entryA.rowIndex : null,
                            rowIndexB: entryB ? entryB.rowIndex : null,
                            rowA: entryA ? entryA.row.slice() : [],
                            rowB: entryB ? entryB.row.slice() : []
                        });
                    }
                });

                return {
                    ready: true,
                    error: "",
                    summary: {
                        totalA: rowsA.length,
                        totalB: rowsB.length,
                        uniqueA: keySetA.size,
                        uniqueB: keySetB.size,
                        onlyA: onlyInA.length,
                        onlyB: onlyInB.length,
                        inBoth: inBoth.length
                    },
                    onlyInA: onlyInA,
                    onlyInB: onlyInB,
                    inBoth: inBoth,
                    pairLabels: pairLabels,
                    headersA: headersA,
                    headersB: headersB
                };
            });

            const activeResultItems = computed(function () {
                if (!comparisonResult.value.ready) {
                    return [];
                }

                if (state.activeResultTab === "onlyA") {
                    return comparisonResult.value.onlyInA;
                }

                if (state.activeResultTab === "onlyB") {
                    return comparisonResult.value.onlyInB;
                }

                return comparisonResult.value.inBoth;
            });

            const comparedHeadersA = computed(function () {
                return new Set(validColumnPairs.value.map(function (pair) {
                    return pair.columnA;
                }));
            });

            const comparedHeadersB = computed(function () {
                return new Set(validColumnPairs.value.map(function (pair) {
                    return pair.columnB;
                }));
            });

            const resultTableHeaders = computed(function () {
                if (!comparisonResult.value.ready) {
                    return [];
                }

                if (state.activeResultTab === "onlyA") {
                    return comparisonResult.value.headersA.slice();
                }

                if (state.activeResultTab === "onlyB") {
                    return comparisonResult.value.headersB.slice();
                }

                return comparisonResult.value.headersA.map(function (header) {
                    return "A · " + header;
                }).concat(comparisonResult.value.headersB.map(function (header) {
                    return "B · " + header;
                }));
            });

            const resultTableHeaderMeta = computed(function () {
                if (!comparisonResult.value.ready) {
                    return [];
                }

                if (state.activeResultTab === "onlyA") {
                    return comparisonResult.value.headersA.map(function (header) {
                        return {
                            label: header,
                            isCompareColumn: comparedHeadersA.value.has(header)
                        };
                    });
                }

                if (state.activeResultTab === "onlyB") {
                    return comparisonResult.value.headersB.map(function (header) {
                        return {
                            label: header,
                            isCompareColumn: comparedHeadersB.value.has(header)
                        };
                    });
                }

                return comparisonResult.value.headersA.map(function (header) {
                    return {
                        label: "A · " + header,
                        isCompareColumn: comparedHeadersA.value.has(header)
                    };
                }).concat(comparisonResult.value.headersB.map(function (header) {
                    return {
                        label: "B · " + header,
                        isCompareColumn: comparedHeadersB.value.has(header)
                    };
                }));
            });

            const resultTableRows = computed(function () {
                if (!comparisonResult.value.ready) {
                    return [];
                }

                if (state.activeResultTab === "onlyA") {
                    const headers = comparisonResult.value.headersA;
                    return comparisonResult.value.onlyInA.map(function (item, sourceIndex) {
                        return {
                            key: item.key,
                            cells: rowCellsByHeaders(item.row, headers),
                            sourceIndex: sourceIndex
                        };
                    });
                }

                if (state.activeResultTab === "onlyB") {
                    const headers = comparisonResult.value.headersB;
                    return comparisonResult.value.onlyInB.map(function (item, sourceIndex) {
                        return {
                            key: item.key,
                            cells: rowCellsByHeaders(item.row, headers),
                            sourceIndex: sourceIndex
                        };
                    });
                }

                const headersA = comparisonResult.value.headersA;
                const headersB = comparisonResult.value.headersB;
                return comparisonResult.value.inBoth.map(function (item, sourceIndex) {
                    return {
                        key: item.key,
                        cells: rowCellsByHeaders(item.rowA, headersA).concat(rowCellsByHeaders(item.rowB, headersB)),
                        sourceIndex: sourceIndex,
                        bothItem: item
                    };
                });
            });

            const filteredResultTableRows = computed(function () {
                const search = state.resultSearch.trim().toLowerCase();
                const rows = resultTableRows.value;

                if (!search) {
                    return rows;
                }

                return rows.filter(function (rowItem) {
                    if (String(rowItem.key || "").toLowerCase().indexOf(search) !== -1) {
                        return true;
                    }

                    return rowItem.cells.some(function (cell) {
                        return String(cell || "").toLowerCase().indexOf(search) !== -1;
                    });
                });
            });

            const resultPageCount = computed(function () {
                return Math.max(1, Math.ceil(filteredResultTableRows.value.length / state.resultPageSize));
            });

            const paginatedResultRows = computed(function () {
                const safePage = Math.min(state.resultPage, resultPageCount.value);
                const start = (safePage - 1) * state.resultPageSize;
                return filteredResultTableRows.value.slice(start, start + state.resultPageSize);
            });

            const resultRangeLabel = computed(function () {
                const total = filteredResultTableRows.value.length;
                const fullTotal = resultTableRows.value.length;

                if (!total) {
                    return state.resultSearch.trim()
                        ? "Nenhuma linha encontrada na busca"
                        : "Nenhuma linha";
                }

                const safePage = Math.min(state.resultPage, resultPageCount.value);
                const start = ((safePage - 1) * state.resultPageSize) + 1;
                const end = Math.min(start + state.resultPageSize - 1, total);
                const suffix = state.resultSearch.trim() && fullTotal !== total
                    ? " (filtrado de " + fullTotal + ")"
                    : "";

                return "Linhas " + start + "–" + end + " de " + total + suffix;
            });

            const compareDetailContent = computed(function () {
                if (!state.compareDetailOpen || state.compareDetailSourceIndex < 0 || !comparisonResult.value.ready) {
                    return null;
                }

                const item = comparisonResult.value.inBoth[state.compareDetailSourceIndex];
                if (!item) {
                    return null;
                }

                const options = compareOptions.value;
                const headersA = comparisonResult.value.headersA;
                const headersB = comparisonResult.value.headersB;

                const pairDetails = validColumnPairs.value.map(function (pair) {
                    const rawA = getRawCellValue(item.rowA, pair.columnA, headersA);
                    const rawB = getRawCellValue(item.rowB, pair.columnB, headersB);
                    const normalizedA = buildRowKey(item.rowA, pair.columnA, headersA, options);
                    const normalizedB = buildRowKey(item.rowB, pair.columnB, headersB, options);

                    return {
                        columnA: pair.columnA,
                        columnB: pair.columnB,
                        rawA: rawA,
                        rawB: rawB,
                        normalizedA: normalizedA,
                        normalizedB: normalizedB,
                        matches: normalizedA === normalizedB
                    };
                });

                return {
                    key: item.key,
                    rowIndexA: item.rowIndexA,
                    rowIndexB: item.rowIndexB,
                    pairDetails: pairDetails,
                    listA: headersA.map(function (header, index) {
                        return {
                            header: header,
                            value: formatCellValue(index < item.rowA.length ? item.rowA[index] : ""),
                            isCompareColumn: comparedHeadersA.value.has(header)
                        };
                    }),
                    listB: headersB.map(function (header, index) {
                        return {
                            header: header,
                            value: formatCellValue(index < item.rowB.length ? item.rowB[index] : ""),
                            isCompareColumn: comparedHeadersB.value.has(header)
                        };
                    })
                };
            });

            const resultTableColspan = computed(function () {
                return resultTableHeaders.value.length + 2 + (state.activeResultTab === "both" ? 1 : 0);
            });

            const compareExportPayload = computed(function () {
                if (!comparisonResult.value.ready || !resultTableRows.value.length || !resultTableHeaders.value.length) {
                    return {
                        headers: [],
                        rows: [],
                        columns: []
                    };
                }

                const headers = resultTableHeaders.value.slice();
                const rows = resultTableRows.value.map(function (rowItem) {
                    return rowItem.cells.slice();
                });
                const columns = headers.map(function (header, index) {
                    return {
                        key: "compare_col_" + index,
                        header: header,
                        sourceIndex: index,
                        enabled: true,
                        outputName: header,
                        sqlType: "",
                        avroType: ""
                    };
                });

                return {
                    headers: headers,
                    rows: rows,
                    columns: columns
                };
            });

            const isSqlOutput = computed(function () {
                const selectedFormat = outputFormats.find(function (format) {
                    return format.value === state.outputFormat;
                });
                return !!(selectedFormat && selectedFormat.controls && selectedFormat.controls.sql);
            });

            const compareExportTabLabel = computed(function () {
                return getCompareExportTabLabel(state.activeResultTab);
            });

            const compareOutputResult = computed(function () {
                const payload = compareExportPayload.value;

                if (!payload.headers.length || !payload.rows.length) {
                    return {
                        text: "",
                        error: comparisonResult.value.ready
                            ? "Nao ha linhas para exportar na guia " + compareExportTabLabel.value + "."
                            : ""
                    };
                }

                const exportOptions = {
                    columns: payload.columns,
                    sqlTableName: state.sqlTableName,
                    addCreateTable: state.sqlAddCreateTable,
                    addIdentityInsert: state.sqlAddIdentityInsert,
                    addTransaction: state.sqlAddTransaction,
                    addTruncate: state.sqlAddTruncate,
                    convertEmptyToNull: state.sqlConvertEmptyToNull,
                    sqlInsertBatchSize: state.sqlInsertBatchSize,
                    xmlRootTagName: state.xmlRootTagName,
                    xmlRowTagName: state.xmlRowTagName
                };

                try {
                    return {
                        text: buildOutput(
                            state.outputFormat,
                            payload.headers,
                            payload.rows,
                            exportOptions
                        ),
                        error: ""
                    };
                } catch (error) {
                    return {
                        text: "",
                        error: error && error.message ? error.message : "Erro ao gerar exportacao."
                    };
                }
            });

            function goToResultPage(page) {
                state.resultPage = Math.max(1, Math.min(resultPageCount.value, page));
            }

            function setActiveResultTab(tab) {
                state.activeResultTab = tab;
                state.resultPage = 1;
                state.resultSearch = "";
                closeCompareDetail();
            }

            function openCompareDetail(sourceIndex) {
                state.compareDetailSourceIndex = sourceIndex;
                state.compareDetailOpen = true;
            }

            function closeCompareDetail() {
                state.compareDetailOpen = false;
                state.compareDetailSourceIndex = -1;
            }

            async function writeCompareOutputToClipboard() {
                const text = compareOutputResult.value.text;
                if (!text) {
                    state.copyFeedback = "Sem conteudo";
                    pushToast(compareOutputResult.value.error || "Nao ha conteudo para copiar.", "warning");
                    return;
                }

                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
                    pushToast("Copia para a area de transferencia nao disponivel neste browser.", "danger");
                    return;
                }

                try {
                    await navigator.clipboard.writeText(text);
                    state.copyFeedback = "Copiado";
                    pushToast("Exportacao copiada (" + compareExportTabLabel.value + ").", "success");
                } catch (_error) {
                    state.copyFeedback = "Falha ao copiar";
                    pushToast("Falha ao copiar para a area de transferencia.", "danger");
                }

                window.setTimeout(function () {
                    state.copyFeedback = "";
                }, 1600);
            }

            function downloadCompareOutput() {
                const content = compareOutputResult.value.text;
                if (!content) {
                    pushToast(compareOutputResult.value.error || "Nao ha conteudo para baixar.", "warning");
                    return;
                }

                const extension = getOutputFileExtension(state.outputFormat);
                const slug = getCompareExportTabSlug(state.activeResultTab);
                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");

                link.href = url;
                link.download = "excelconverter-comparacao-" + slug + "." + extension;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                pushToast("Arquivo gerado (" + compareExportTabLabel.value + ").", "success");
            }

            watch(function () {
                return compareOutputResult.value.error;
            }, function (message, previousMessage) {
                if (message && message !== previousMessage) {
                    pushToast(message, "danger");
                }
            });

            watch(function () {
                return state.activeResultTab + "|" + state.resultPageSize + "|" + filteredResultTableRows.value.length;
            }, function () {
                if (state.resultPage > resultPageCount.value) {
                    state.resultPage = resultPageCount.value;
                }
            });

            watch(function () {
                return comparisonResult.value.ready
                    ? comparisonResult.value.onlyInA.length
                        + "|"
                        + comparisonResult.value.onlyInB.length
                        + "|"
                        + comparisonResult.value.inBoth.length
                    : "";
            }, function () {
                state.resultPage = 1;
                closeCompareDetail();
            });

            watch(function () {
                return state.resultPageSize;
            }, function () {
                state.resultPage = 1;
            });

            watch(function () {
                return state.resultSearch;
            }, function () {
                state.resultPage = 1;
            });

            function toggleTheme() {
                state.theme = state.theme === "light" ? "dark" : "light";
            }

            function toggleListSection(listKey) {
                state[listKey].sectionCollapsed = !state[listKey].sectionCollapsed;
            }

            function addColumnPair() {
                state.columnPairs.push({
                    id: createPairId(),
                    columnA: "",
                    columnB: ""
                });
            }

            function removeColumnPair(pairId) {
                if (state.columnPairs.length <= 1) {
                    state.columnPairs[0].columnA = "";
                    state.columnPairs[0].columnB = "";
                    return;
                }

                state.columnPairs = state.columnPairs.filter(function (pair) {
                    return pair.id !== pairId;
                });
            }

            function moveColumnPair(pairId, direction) {
                const index = state.columnPairs.findIndex(function (pair) {
                    return pair.id === pairId;
                });

                if (index === -1) {
                    return;
                }

                const targetIndex = direction === "up" ? index - 1 : index + 1;
                if (targetIndex < 0 || targetIndex >= state.columnPairs.length) {
                    return;
                }

                const copy = state.columnPairs.slice();
                const temp = copy[index];
                copy[index] = copy[targetIndex];
                copy[targetIndex] = temp;
                state.columnPairs = copy;
            }

            async function pasteListFromClipboard(listKey) {
                if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
                    pushToast("Leitura da area de transferencia nao disponivel neste browser.", "danger");
                    return;
                }

                try {
                    const text = await navigator.clipboard.readText();
                    if (!text || !String(text).trim()) {
                        pushToast("A area de transferencia esta vazia.", "warning");
                        return;
                    }

                    state[listKey].input = String(text);
                    const parsed = listKey === "listA" ? parsedListA.value : parsedListB.value;

                    if (parsed.error) {
                        pushToast(parsed.error, "danger");
                        return;
                    }

                    pushToast(
                        (listKey === "listA" ? "Lista A" : "Lista B")
                            + " colada: "
                            + parsed.dataRows.length
                            + " linha(s), "
                            + parsed.headers.length
                            + " coluna(s).",
                        "success"
                    );
                } catch (_error) {
                    pushToast("Nao foi possivel ler a area de transferencia.", "danger");
                }
            }

            watch(function () {
                return parsedListA.value.headers.join("\x1f") + "|" + parsedListB.value.headers.join("\x1f");
            }, function () {
                state.columnPairs.forEach(function (pair) {
                    if (pair.columnA && parsedListA.value.headers.indexOf(pair.columnA) === -1) {
                        pair.columnA = "";
                    }

                    if (pair.columnB && parsedListB.value.headers.indexOf(pair.columnB) === -1) {
                        pair.columnB = "";
                    }
                });

                if (parsedListA.value.headers.length && parsedListB.value.headers.length) {
                    const firstPair = state.columnPairs[0];
                    if (!firstPair.columnA && !firstPair.columnB) {
                        firstPair.columnA = parsedListA.value.headers[0];
                        firstPair.columnB = parsedListB.value.headers[0];
                    }
                }
            });

            return {
                state,
                inputConfig,
                inputFormats,
                parsedListA,
                parsedListB,
                listAMeta,
                listBMeta,
                validColumnPairs,
                comparisonResult,
                activeResultItems,
                resultTableHeaders,
                resultTableHeaderMeta,
                resultTableRows,
                filteredResultTableRows,
                paginatedResultRows,
                resultPageCount,
                resultRangeLabel,
                resultTableColspan,
                compareDetailContent,
                outputFormats,
                isSqlOutput,
                compareExportTabLabel,
                compareOutputResult,
                writeCompareOutputToClipboard,
                downloadCompareOutput,
                goToResultPage,
                setActiveResultTab,
                openCompareDetail,
                closeCompareDetail,
                toggleTheme,
                toggleListSection,
                addColumnPair,
                removeColumnPair,
                moveColumnPair,
                pasteListFromClipboard,
                dismissToast
            };
        },
        template: `
            <div class="app-wrap container-fluid">
                <nav class="topbar">
                    <div class="d-flex align-items-center gap-4">
                        <div class="topbar-brand">
                            <i class="fas fa-table" aria-hidden="true"></i>
                            <span>ExcelConverter</span>
                        </div>
                        <div class="topbar-nav">
                            <a class="topbar-link" href="index.html">Conversor</a>
                            <a class="topbar-link" href="locale-normalizer.html">Normalizacao</a>
                            <a class="topbar-link is-active" href="compare-arrays.html">Comparar</a>
                        </div>
                    </div>
                    <button class="theme-toggle" type="button" @click="toggleTheme" :title="state.theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'">
                        <i :class="state.theme === 'light' ? 'fas fa-moon-stars' : 'fas fa-sun'" aria-hidden="true"></i>
                    </button>
                </nav>

                <div class="compare-page-shell">
                    <section class="panel-card input-panel mb-4">
                        <div class="card-body p-4 p-lg-5">
                            <div class="editor-label mb-2">Modulo Isolado</div>
                            <h1 class="h3 mb-3">Comparar duas listas</h1>
                            <p class="text-secondary mb-0">Cole duas entradas no mesmo formato do conversor, mapeie colunas entre as listas e compare com regras de normalizacao.</p>
                        </div>
                    </section>

                    <div class="compare-lists-grid mb-4">
                        <section class="panel-card input-panel h-100">
                            <div class="card-body p-4">
                                <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                    <div @click="toggleListSection('listA')">
                                        <div class="editor-label mb-1">Lista A</div>
                                        <h2 class="h5 mb-0">Entrada A</h2>
                                    </div>
                                    <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-grow-1">
                                        <div class="small text-secondary text-nowrap">{{ listAMeta }}</div>
                                        <div class="input-group input-group-sm input-toolbar-group flex-grow-1" style="min-width: min(100%, 220px); max-width: 20rem;">
                                            <label class="input-group-text mb-0 d-none d-lg-inline" for="list-a-format">Formato</label>
                                            <select id="list-a-format" class="form-select" v-model="state.listA.inputFormat">
                                                <option v-for="format in inputFormats" :key="'a-' + format.value" :value="format.value">
                                                    {{ format.label }}
                                                </option>
                                            </select>
                                            <button class="btn btn-outline-primary" type="button" @click="pasteListFromClipboard('listA')" title="Colar da area de transferencia" aria-label="Colar Lista A">
                                                <i class="fas fa-clipboard" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                        <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleListSection('listA')" :title="state.listA.sectionCollapsed ? 'Expandir secao' : 'Colapsar secao'">
                                            <i :class="state.listA.sectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                </div>
                                <div v-if="!state.listA.sectionCollapsed">
                                    <div class="status-chip mb-3" :class="parsedListA.error ? 'error' : 'info'">
                                        {{ parsedListA.error || 'Cole dados da Lista A.' }}
                                    </div>
                                    <textarea class="form-control editor-textarea compare-list-textarea" v-model="state.listA.input" placeholder="Cole aqui a primeira lista" spellcheck="false"></textarea>
                                </div>
                            </div>
                        </section>

                        <section class="panel-card input-panel h-100">
                            <div class="card-body p-4">
                                <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                    <div @click="toggleListSection('listB')">
                                        <div class="editor-label mb-1">Lista B</div>
                                        <h2 class="h5 mb-0">Entrada B</h2>
                                    </div>
                                    <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-grow-1">
                                        <div class="small text-secondary text-nowrap">{{ listBMeta }}</div>
                                        <div class="input-group input-group-sm input-toolbar-group flex-grow-1" style="min-width: min(100%, 220px); max-width: 20rem;">
                                            <label class="input-group-text mb-0 d-none d-lg-inline" for="list-b-format">Formato</label>
                                            <select id="list-b-format" class="form-select" v-model="state.listB.inputFormat">
                                                <option v-for="format in inputFormats" :key="'b-' + format.value" :value="format.value">
                                                    {{ format.label }}
                                                </option>
                                            </select>
                                            <button class="btn btn-outline-primary" type="button" @click="pasteListFromClipboard('listB')" title="Colar da area de transferencia" aria-label="Colar Lista B">
                                                <i class="fas fa-clipboard" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                        <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleListSection('listB')" :title="state.listB.sectionCollapsed ? 'Expandir secao' : 'Colapsar secao'">
                                            <i :class="state.listB.sectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                </div>
                                <div v-if="!state.listB.sectionCollapsed">
                                    <div class="status-chip mb-3" :class="parsedListB.error ? 'error' : 'info'">
                                        {{ parsedListB.error || 'Cole dados da Lista B.' }}
                                    </div>
                                    <textarea class="form-control editor-textarea compare-list-textarea" v-model="state.listB.input" placeholder="Cole aqui a segunda lista" spellcheck="false"></textarea>
                                </div>
                            </div>
                        </section>
                    </div>

                    <section class="panel-card preview-panel mb-4">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                <div>
                                    <div class="editor-label mb-1">Opcoes</div>
                                    <h2 class="h5 mb-0">Formatacao e comparacao</h2>
                                </div>
                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="state.optionsSectionCollapsed = !state.optionsSectionCollapsed">
                                    <i :class="state.optionsSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                </button>
                            </div>

                            <div v-if="!state.optionsSectionCollapsed" class="compare-options-body">
                                <div class="compare-parse-config mb-4">
                                    <div class="small fw-semibold text-secondary mb-2">Leitura das listas (comum a A e B)</div>
                                    <div class="compare-parse-grid">
                                        <div v-for="field in inputConfig" :key="field.id">
                                            <label class="form-label small fw-semibold">{{ field.label }}</label>
                                            <select v-if="field.type === 'select'" class="form-select form-select-sm" v-model="state[field.id]">
                                                <option v-for="option in field.options" :key="option.value" :value="option.value">
                                                    {{ option.label }}
                                                </option>
                                            </select>
                                            <div v-else-if="field.type === 'checkbox'" class="form-check mt-2">
                                                <input class="form-check-input" type="checkbox" :id="'compare-' + field.id" v-model="state[field.id]">
                                                <label class="form-check-label" :for="'compare-' + field.id">{{ field.label }}</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="mb-4">
                                    <div class="d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap">
                                        <div>
                                            <div class="small fw-semibold">Colunas de comparacao</div>
                                            <div class="small text-secondary">Ordem dos pares define a chave composta (ex.: CD_ATIVO ↔ CD_PERCURSO).</div>
                                        </div>
                                        <button class="btn btn-sm btn-outline-primary" type="button" @click="addColumnPair">
                                            <i class="fas fa-plus" aria-hidden="true"></i>
                                            <span class="ms-1">Adicionar par</span>
                                        </button>
                                    </div>

                                    <div class="compare-column-pairs">
                                        <div v-for="(pair, pairIndex) in state.columnPairs" :key="pair.id" class="column-pair-row">
                                            <span class="column-pair-order">{{ pairIndex + 1 }}</span>
                                            <select class="form-select form-select-sm" v-model="pair.columnA" :disabled="!parsedListA.headers.length">
                                                <option value="">Coluna Lista A</option>
                                                <option v-for="header in parsedListA.headers" :key="'a-col-' + pair.id + '-' + header" :value="header">
                                                    {{ header }}
                                                </option>
                                            </select>
                                            <span class="column-pair-arrow" aria-hidden="true">↔</span>
                                            <select class="form-select form-select-sm" v-model="pair.columnB" :disabled="!parsedListB.headers.length">
                                                <option value="">Coluna Lista B</option>
                                                <option v-for="header in parsedListB.headers" :key="'b-col-' + pair.id + '-' + header" :value="header">
                                                    {{ header }}
                                                </option>
                                            </select>
                                            <div class="column-pair-actions">
                                                <button class="btn btn-sm btn-outline-secondary" type="button" @click="moveColumnPair(pair.id, 'up')" :disabled="pairIndex === 0" title="Subir">
                                                    <i class="fas fa-arrow-up" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-sm btn-outline-secondary" type="button" @click="moveColumnPair(pair.id, 'down')" :disabled="pairIndex === state.columnPairs.length - 1" title="Descer">
                                                    <i class="fas fa-arrow-down" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-sm btn-outline-danger" type="button" @click="removeColumnPair(pair.id)" title="Remover par">
                                                    <i class="fas fa-times" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="compare-normalize-grid">
                                    <div class="form-check">
                                        <input id="compare-trim" class="form-check-input" type="checkbox" v-model="state.trim">
                                        <label class="form-check-label" for="compare-trim">Trim</label>
                                    </div>
                                    <div class="form-check">
                                        <input id="compare-ignore-spaces" class="form-check-input" type="checkbox" v-model="state.ignoreSpaces">
                                        <label class="form-check-label" for="compare-ignore-spaces">Ignorar espacos</label>
                                    </div>
                                    <div class="form-check">
                                        <input id="compare-ignore-zeros" class="form-check-input" type="checkbox" v-model="state.ignoreLeadingZeros">
                                        <label class="form-check-label" for="compare-ignore-zeros">Ignorar zeros a esquerda</label>
                                    </div>
                                    <div class="form-check">
                                        <input id="compare-ignore-special" class="form-check-input" type="checkbox" v-model="state.ignoreSpecialCharsAndAccents">
                                        <label class="form-check-label" for="compare-ignore-special">Ignorar caracteres especiais e acentuacao</label>
                                    </div>
                                    <div>
                                        <label class="form-label small fw-semibold" for="compare-sort">Ordenacao (antes da comparacao)</label>
                                        <select id="compare-sort" class="form-select form-select-sm" v-model="state.sortMode">
                                            <option value="none">Nenhuma</option>
                                            <option value="az">A → Z</option>
                                            <option value="za">Z → A</option>
                                            <option value="09">0 → 9</option>
                                            <option value="90">9 → 0</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="panel-card output-panel">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                <div>
                                    <div class="editor-label mb-1">Resultado</div>
                                    <h2 class="h5 mb-0">Comparacao</h2>
                                </div>
                                <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-grow-1 output-header-actions">
                                    <div
                                        v-if="comparisonResult.ready && resultTableRows.length"
                                        class="input-group input-group-sm output-toolbar-group"
                                    >
                                        <template v-if="isSqlOutput">
                                            <label class="input-group-text mb-0 small d-none d-md-inline" for="compare-output-sql-table-name">Tabela</label>
                                            <input
                                                id="compare-output-sql-table-name"
                                                class="form-control output-sql-table-input"
                                                v-model="state.sqlTableName"
                                                placeholder="ExcelConverter"
                                                title="Nome da tabela SQL"
                                            >
                                        </template>
                                        <label class="input-group-text mb-0 small d-none d-lg-inline" for="compare-output-format-select">Formato</label>
                                        <select id="compare-output-format-select" class="form-select output-format-select" v-model="state.outputFormat">
                                            <option v-for="format in outputFormats" :key="format.value" :value="format.value">
                                                {{ format.label }}
                                            </option>
                                        </select>
                                        <button class="btn btn-outline-primary" type="button" @click="writeCompareOutputToClipboard" :title="state.copyFeedback || ('Copiar guia ' + compareExportTabLabel)">
                                            <i
                                                :class="state.copyFeedback === 'Copiado' ? 'fas fa-check' : state.copyFeedback === 'Falha ao copiar' ? 'fas fa-exclamation-triangle' : state.copyFeedback === 'Sem conteudo' ? 'fas fa-ban' : 'fas fa-copy'"
                                                aria-hidden="true"
                                            ></i>
                                        </button>
                                        <button class="btn btn-outline-primary" type="button" @click="downloadCompareOutput" :title="'Baixar guia ' + compareExportTabLabel">
                                            <i class="fas fa-download" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                    <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="state.resultsSectionCollapsed = !state.resultsSectionCollapsed">
                                        <i :class="state.resultsSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>

                            <div v-if="!state.resultsSectionCollapsed">
                                <div class="status-chip mb-3" :class="comparisonResult.error ? 'warning' : (comparisonResult.ready ? 'info' : 'info')">
                                    {{ comparisonResult.error || (comparisonResult.ready ? 'Comparacao pronta.' : 'Aguardando dados.') }}
                                </div>

                                <template v-if="comparisonResult.ready">
                                    <div class="compare-summary-grid mb-4">
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ comparisonResult.summary.totalA }}</div>
                                            <div class="compare-summary-label">Linhas A</div>
                                        </div>
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ comparisonResult.summary.totalB }}</div>
                                            <div class="compare-summary-label">Linhas B</div>
                                        </div>
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ comparisonResult.summary.onlyA }}</div>
                                            <div class="compare-summary-label">So em A</div>
                                        </div>
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ comparisonResult.summary.onlyB }}</div>
                                            <div class="compare-summary-label">So em B</div>
                                        </div>
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ comparisonResult.summary.inBoth }}</div>
                                            <div class="compare-summary-label">Em comum</div>
                                        </div>
                                    </div>

                                    <div class="small text-secondary mb-3" v-if="comparisonResult.pairLabels.length">
                                        Chave: {{ comparisonResult.pairLabels.join(' + ') }}
                                    </div>

                                    <ul class="nav nav-pills compare-result-tabs mb-3">
                                        <li class="nav-item">
                                            <button class="nav-link" :class="{ active: state.activeResultTab === 'onlyA' }" type="button" @click="setActiveResultTab('onlyA')">
                                                So A ({{ comparisonResult.onlyInA.length }})
                                            </button>
                                        </li>
                                        <li class="nav-item">
                                            <button class="nav-link" :class="{ active: state.activeResultTab === 'onlyB' }" type="button" @click="setActiveResultTab('onlyB')">
                                                So B ({{ comparisonResult.onlyInB.length }})
                                            </button>
                                        </li>
                                        <li class="nav-item">
                                            <button class="nav-link" :class="{ active: state.activeResultTab === 'both' }" type="button" @click="setActiveResultTab('both')">
                                                Em comum ({{ comparisonResult.inBoth.length }})
                                            </button>
                                        </li>
                                    </ul>

                                    <template v-if="activeResultItems.length && resultTableHeaders.length">
                                        <div class="preview-toolbar mb-3">
                                            <div class="preview-page-size">
                                                <select class="form-select form-select-sm" v-model.number="state.resultPageSize">
                                                    <option :value="10">10</option>
                                                    <option :value="25">25</option>
                                                    <option :value="50">50</option>
                                                    <option :value="100">100</option>
                                                    <option :value="250">250</option>
                                                    <option :value="500">500</option>
                                                    <option :value="1000">1000</option>
                                                </select>
                                                <span>linhas por pagina</span>
                                            </div>
                                            <div class="input-group input-group-sm preview-search-group">
                                                <span class="input-group-text"><i class="fas fa-search" aria-hidden="true"></i></span>
                                                <input class="form-control" v-model="state.resultSearch" placeholder="Buscar nas linhas">
                                            </div>
                                        </div>
                                        <div class="small text-secondary mb-2 px-1">{{ resultRangeLabel }}</div>

                                        <div class="preview-table-wrap compare-result-table-wrap">
                                            <table class="table table-sm align-middle mb-0 preview-table compare-result-table">
                                                <thead>
                                                    <tr>
                                                        <th v-if="state.activeResultTab === 'both'" class="compare-actions-col">Detalhe</th>
                                                        <th class="compare-index-col">#</th>
                                                        <th class="compare-key-col">Chave</th>
                                                        <th
                                                            v-for="(headerMeta, headerIndex) in resultTableHeaderMeta"
                                                            :key="'result-header-' + headerIndex"
                                                            :class="{ 'compare-column-key': headerMeta.isCompareColumn }"
                                                        >
                                                            {{ headerMeta.label }}
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr v-for="(rowItem, rowIndex) in paginatedResultRows" :key="'result-row-' + state.activeResultTab + '-' + rowIndex + '-' + rowItem.key">
                                                        <td v-if="state.activeResultTab === 'both'" class="compare-actions-col">
                                                            <button
                                                                class="btn btn-outline-primary btn-sm"
                                                                type="button"
                                                                title="Ver detalhes da comparacao"
                                                                @click="openCompareDetail(rowItem.sourceIndex)"
                                                            >
                                                                <i class="fas fa-search-plus" aria-hidden="true"></i>
                                                            </button>
                                                        </td>
                                                        <td class="compare-index-col">
                                                            <div class="form-control form-control-sm preview-input compare-readonly-cell">{{ ((state.resultPage - 1) * state.resultPageSize) + rowIndex + 1 }}</div>
                                                        </td>
                                                        <td class="compare-key-col">
                                                            <div class="form-control form-control-sm preview-input compare-readonly-cell" :title="rowItem.key">{{ rowItem.key }}</div>
                                                        </td>
                                                        <td
                                                            v-for="(cell, cellIndex) in rowItem.cells"
                                                            :key="'result-cell-' + rowIndex + '-' + cellIndex"
                                                            :class="{ 'compare-column-key': resultTableHeaderMeta[cellIndex] && resultTableHeaderMeta[cellIndex].isCompareColumn }"
                                                        >
                                                            <div class="form-control form-control-sm preview-input compare-readonly-cell" :title="cell">{{ cell }}</div>
                                                        </td>
                                                    </tr>
                                                    <tr v-if="!paginatedResultRows.length">
                                                        <td class="preview-empty-row" :colspan="resultTableColspan">
                                                            {{ state.resultSearch.trim() ? 'Nenhuma linha encontrada na busca.' : 'Nenhuma linha nesta pagina.' }}
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        <div class="preview-pagination">
                                            <div class="small text-secondary">{{ resultRangeLabel }}</div>
                                            <div class="btn-group btn-group-sm" role="group">
                                                <button class="btn btn-outline-secondary" type="button" @click="goToResultPage(state.resultPage - 1)" :disabled="state.resultPage <= 1">
                                                    <i class="fas fa-chevron-left" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-outline-secondary" type="button" disabled>
                                                    Pagina {{ state.resultPage }} / {{ resultPageCount }}
                                                </button>
                                                <button class="btn btn-outline-secondary" type="button" @click="goToResultPage(state.resultPage + 1)" :disabled="state.resultPage >= resultPageCount">
                                                    <i class="fas fa-chevron-right" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </template>
                                    <div v-else class="preview-empty">
                                        <template v-if="state.activeResultTab === 'onlyA'">Nenhum registro exclusivo na Lista A.</template>
                                        <template v-else-if="state.activeResultTab === 'onlyB'">Nenhum registro exclusivo na Lista B.</template>
                                        <template v-else>Nenhum registro em comum com os criterios actuais.</template>
                                    </div>

                                    <div v-if="resultTableRows.length" class="compare-export-panel mt-4">
                                        <div class="editor-label mb-2">Exportacao</div>
                                        <div class="small text-secondary mb-2">
                                            Exporta apenas a guia <strong>{{ compareExportTabLabel }}</strong> ({{ resultTableRows.length }} linha(s), {{ resultTableHeaders.length }} coluna(s)). Colunas # e Chave nao sao incluidas.
                                        </div>
                                        <div v-if="compareOutputResult.error" class="alert alert-danger py-2 px-3 mb-2 small" role="alert">
                                            {{ compareOutputResult.error }}
                                        </div>
                                        <textarea
                                            class="form-control editor-textarea compare-export-textarea"
                                            :value="compareOutputResult.text"
                                            readonly
                                            spellcheck="false"
                                            placeholder="O resultado exportado da guia seleccionada aparecera aqui"
                                        ></textarea>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </section>
                </div>

                <div
                    v-if="state.compareDetailOpen && compareDetailContent"
                    class="compare-detail-backdrop"
                    @click.self="closeCompareDetail"
                >
                    <div class="compare-detail-modal panel-card" role="dialog" aria-modal="true" aria-labelledby="compare-detail-title">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
                                <div>
                                    <div class="editor-label mb-1">Em comum</div>
                                    <h2 id="compare-detail-title" class="h5 mb-0">Detalhes da comparacao</h2>
                                </div>
                                <button class="btn btn-outline-secondary btn-sm" type="button" @click="closeCompareDetail" aria-label="Fechar">
                                    <i class="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </div>

                            <div class="status-chip info mb-3">
                                <strong>Chave:</strong> {{ compareDetailContent.key }}
                            </div>

                            <div class="mb-4">
                                <div class="small fw-semibold mb-2">Colunas usadas na comparacao</div>
                                <div class="preview-table-wrap">
                                    <table class="table table-sm preview-table compare-detail-pairs-table mb-0">
                                        <thead>
                                            <tr>
                                                <th>Lista A</th>
                                                <th>Lista B</th>
                                                <th>Valor A (bruto)</th>
                                                <th>Valor B (bruto)</th>
                                                <th>Normalizado A</th>
                                                <th>Normalizado B</th>
                                                <th>Resultado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="(pair, pairIndex) in compareDetailContent.pairDetails" :key="'detail-pair-' + pairIndex">
                                                <td class="compare-column-key">{{ pair.columnA }}</td>
                                                <td class="compare-column-key">{{ pair.columnB }}</td>
                                                <td>{{ pair.rawA }}</td>
                                                <td>{{ pair.rawB }}</td>
                                                <td>{{ pair.normalizedA }}</td>
                                                <td>{{ pair.normalizedB }}</td>
                                                <td>
                                                    <span class="badge" :class="pair.matches ? 'text-bg-success' : 'text-bg-danger'">
                                                        {{ pair.matches ? 'Igual' : 'Diferente' }}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div class="compare-detail-lists-grid">
                                <div>
                                    <div class="small fw-semibold mb-2">
                                        Lista A
                                        <span class="text-secondary" v-if="compareDetailContent.rowIndexA != null">(linha {{ compareDetailContent.rowIndexA + 1 }})</span>
                                    </div>
                                    <div class="preview-table-wrap">
                                        <table class="table table-sm preview-table mb-0">
                                            <tbody>
                                                <tr v-for="(field, fieldIndex) in compareDetailContent.listA" :key="'detail-a-' + fieldIndex" :class="{ 'compare-column-key': field.isCompareColumn }">
                                                    <th class="compare-detail-field-name">{{ field.header }}</th>
                                                    <td><div class="compare-readonly-cell compare-detail-value">{{ field.value }}</div></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div>
                                    <div class="small fw-semibold mb-2">
                                        Lista B
                                        <span class="text-secondary" v-if="compareDetailContent.rowIndexB != null">(linha {{ compareDetailContent.rowIndexB + 1 }})</span>
                                    </div>
                                    <div class="preview-table-wrap">
                                        <table class="table table-sm preview-table mb-0">
                                            <tbody>
                                                <tr v-for="(field, fieldIndex) in compareDetailContent.listB" :key="'detail-b-' + fieldIndex" :class="{ 'compare-column-key': field.isCompareColumn }">
                                                    <th class="compare-detail-field-name">{{ field.header }}</th>
                                                    <td><div class="compare-readonly-cell compare-detail-value">{{ field.value }}</div></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="toast-stack" aria-live="polite" aria-atomic="true">
                    <div
                        v-for="toast in state.toasts"
                        :key="toast.id"
                        class="toast-item"
                        :class="'toast-' + toast.tone"
                    >
                        <div class="d-flex align-items-start justify-content-between gap-3">
                            <div>{{ toast.message }}</div>
                            <button class="toast-close" type="button" @click="dismissToast(toast.id)" aria-label="Fechar aviso">
                                <i class="fas fa-times" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `
    }).mount("#array-compare-app");
})();
