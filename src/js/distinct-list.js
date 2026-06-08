(function () {
    const { createApp, computed, reactive, watch, onMounted, onBeforeUnmount, nextTick } = Vue;
    const STORAGE_KEY = "excelconverter.distinct-list.preferences.v1";
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

    function toSnakeCase(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .replace(/[^A-Za-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .replace(/_+/g, "_")
            .toLowerCase();
    }

    function toCamelCase(value) {
        const snake = toSnakeCase(value);
        return snake.replace(/_([a-z0-9])/g, function (_match, character) {
            return character.toUpperCase();
        });
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

    function createGroupColumnId() {
        return "group_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    }

    function loadPreferences(defaultState) {
        try {
            const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
            return Object.assign({}, defaultState, saved, {
                list: Object.assign({}, defaultState.list, saved.list || {}),
                groupColumns: Array.isArray(saved.groupColumns) ? saved.groupColumns : defaultState.groupColumns,
                ignoredColumns: Array.isArray(saved.ignoredColumns) ? saved.ignoredColumns : defaultState.ignoredColumns,
                excludedRowKeys: Array.isArray(saved.excludedRowKeys) ? saved.excludedRowKeys : defaultState.excludedRowKeys
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

    function formatCellValue(value) {
        if (value == null) {
            return "";
        }

        return String(value);
    }

    function getRawCellValue(row, header, headers) {
        const columnIndex = headers.indexOf(header);
        if (columnIndex === -1) {
            return "";
        }

        return formatCellValue(columnIndex < row.length ? row[columnIndex] : "");
    }

    function formatSelectLabel(value) {
        if (value === "") {
            return "(null)";
        }

        return value;
    }

    function getMostFrequentValue(tallyMap) {
        let best = "";
        let bestCount = -1;

        tallyMap.forEach(function (count, value) {
            if (count > bestCount) {
                bestCount = count;
                best = value;
            }
        });

        return best;
    }

    function getValueOptions(tallyMap) {
        const items = [];

        tallyMap.forEach(function (count, value) {
            items.push({
                value: value,
                count: count
            });
        });

        items.sort(function (a, b) {
            if (b.count !== a.count) {
                return b.count - a.count;
            }

            return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
        });

        return items.map(function (item) {
            return item.value;
        });
    }

    function buildGroups(rows, headers, groupColumnNames, valueColumnNames, options) {
        const map = new Map();

        rows.forEach(function (row) {
            const key = buildCompositeKey(row, headers, groupColumnNames, options);

            if (!map.has(key)) {
                map.set(key, {
                    key: key,
                    groupRaw: {},
                    valueTallies: {}
                });
            }

            const group = map.get(key);

            groupColumnNames.forEach(function (columnName) {
                if (!(columnName in group.groupRaw)) {
                    group.groupRaw[columnName] = getRawCellValue(row, columnName, headers);
                }
            });

            valueColumnNames.forEach(function (columnName) {
                const rawValue = getRawCellValue(row, columnName, headers);

                if (!group.valueTallies[columnName]) {
                    group.valueTallies[columnName] = new Map();
                }

                const tally = group.valueTallies[columnName];
                tally.set(rawValue, (tally.get(rawValue) || 0) + 1);
            });
        });

        return map;
    }

    createApp({
        setup() {
            const defaultState = {
                theme: "dark",
                list: {
                    input: "",
                    inputFormat: "input-default",
                    sectionCollapsed: false
                },
                delimiter: "auto",
                decimalSign: "dot",
                firstRowIsHeader: true,
                headerTransform: "none",
                groupColumns: [{ id: createGroupColumnId(), column: "" }],
                ignoredColumns: [],
                ignoredColumnsMenuOpen: false,
                ignoredColumnsSearch: "",
                ignoreLeadingZeros: false,
                trim: true,
                ignoreSpaces: false,
                ignoreSpecialCharsAndAccents: false,
                optionsSectionCollapsed: false,
                resultsSectionCollapsed: false,
                resultPage: 1,
                resultPageSize: 100,
                resultSearch: "",
                previewSortColumnKey: "",
                previewSortDirection: "none",
                excludedRowKeys: [],
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
                exportPreviewCollapsed: true,
                toasts: []
            };

            const state = reactive(loadPreferences(defaultState));
            const selectedValues = reactive({});
            const cellValueModes = reactive({});
            const cellValueReviewed = reactive({});
            const ignoredColumnsMenuStyle = reactive({
                top: 0,
                left: 0,
                width: 280
            });
            const valueCellPicker = reactive({
                open: false,
                groupKey: "",
                column: "",
                top: 0,
                left: 0,
                width: 180,
                options: []
            });
            const columnMenu = reactive({
                open: false,
                column: "",
                top: 0,
                left: 0,
                width: 320,
                maxHeight: 400
            });
            const bulkFillByColumn = reactive({});
            let ignoredColumnsTriggerEl = null;
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
                    list: {
                        inputFormat: state.list.inputFormat,
                        sectionCollapsed: state.list.sectionCollapsed
                    },
                    delimiter: state.delimiter,
                    decimalSign: state.decimalSign,
                    firstRowIsHeader: state.firstRowIsHeader,
                    headerTransform: state.headerTransform,
                    groupColumns: state.groupColumns,
                    ignoredColumns: state.ignoredColumns,
                    ignoreLeadingZeros: state.ignoreLeadingZeros,
                    trim: state.trim,
                    ignoreSpaces: state.ignoreSpaces,
                    ignoreSpecialCharsAndAccents: state.ignoreSpecialCharsAndAccents,
                    optionsSectionCollapsed: state.optionsSectionCollapsed,
                    resultsSectionCollapsed: state.resultsSectionCollapsed,
                    resultPageSize: state.resultPageSize,
                    previewSortColumnKey: state.previewSortColumnKey,
                    previewSortDirection: state.previewSortDirection,
                    excludedRowKeys: state.excludedRowKeys,
                    outputFormat: state.outputFormat,
                    sqlTableName: state.sqlTableName,
                    exportPreviewCollapsed: state.exportPreviewCollapsed
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

            const parsedList = computed(function () {
                const result = parseListInput(state.list, parseState.value);
                return {
                    headers: result.data.headers || [],
                    dataRows: result.data.dataRows || [],
                    error: result.error
                };
            });

            const listMeta = computed(function () {
                if (!state.list.input.trim()) {
                    return "Sem dados";
                }

                if (parsedList.value.error) {
                    return "Erro no parse";
                }

                return parsedList.value.dataRows.length + " linha(s), " + parsedList.value.headers.length + " coluna(s)";
            });

            const groupOptions = computed(function () {
                return {
                    trim: state.trim,
                    ignoreSpaces: state.ignoreSpaces,
                    ignoreSpecialCharsAndAccents: state.ignoreSpecialCharsAndAccents,
                    ignoreLeadingZeros: state.ignoreLeadingZeros
                };
            });

            const validGroupColumns = computed(function () {
                return state.groupColumns
                    .map(function (entry) {
                        return entry.column;
                    })
                    .filter(function (columnName) {
                        return columnName && parsedList.value.headers.indexOf(columnName) !== -1;
                    });
            });

            const ignoredColumnSet = computed(function () {
                return new Set(state.ignoredColumns);
            });

            const groupingColumnSet = computed(function () {
                return new Set(validGroupColumns.value);
            });

            const valueColumns = computed(function () {
                return parsedList.value.headers.filter(function (header) {
                    return !groupingColumnSet.value.has(header) && !ignoredColumnSet.value.has(header);
                });
            });

            const ignoredColumnChoices = computed(function () {
                const search = state.ignoredColumnsSearch.trim().toLowerCase();

                return parsedList.value.headers.filter(function (header) {
                    if (!search) {
                        return true;
                    }

                    return header.toLowerCase().indexOf(search) !== -1;
                });
            });

            const ignoredColumnsLabel = computed(function () {
                const count = state.ignoredColumns.length;

                if (!count) {
                    return "Nenhuma coluna ignorada";
                }

                if (count === 1) {
                    return "1 coluna ignorada";
                }

                return count + " colunas ignoradas";
            });

            function getCellModeKey(groupKey, columnName) {
                return String(groupKey) + "\x1f" + String(columnName);
            }

            function getCellValueMode(groupKey, columnName) {
                return cellValueModes[getCellModeKey(groupKey, columnName)] || "list";
            }

            function setCellValueMode(groupKey, columnName, mode) {
                cellValueModes[getCellModeKey(groupKey, columnName)] = mode;
            }

            function markCellReviewed(groupKey, columnName) {
                cellValueReviewed[getCellModeKey(groupKey, columnName)] = true;
            }

            function isCellReviewed(groupKey, columnName) {
                return !!cellValueReviewed[getCellModeKey(groupKey, columnName)];
            }

            function getCellChevronClass(groupKey, columnName, options, isCustom) {
                if (!options || options.length <= 1 || isCustom || isCellReviewed(groupKey, columnName)) {
                    return "distinct-value-picker-btn-resolved";
                }

                return "distinct-value-picker-btn-attention";
            }

            function getCellChevronTitle(groupKey, columnName, options, isCustom) {
                if (getCellChevronClass(groupKey, columnName, options, isCustom) === "distinct-value-picker-btn-attention") {
                    return "Multiplos valores — escolha ou adicione um valor";
                }

                return "Valor confirmado";
            }

            function syncCellValueMode(groupKey, columnName, baseOptions) {
                const current = selectedValues[groupKey]
                    ? selectedValues[groupKey][columnName]
                    : undefined;
                const modeKey = getCellModeKey(groupKey, columnName);

                if (current == null || current === undefined) {
                    delete cellValueModes[modeKey];
                    return;
                }

                if (cellValueModes[modeKey] === "custom") {
                    return;
                }

                if (baseOptions.indexOf(current) === -1) {
                    cellValueModes[modeKey] = "custom";
                    return;
                }

                cellValueModes[modeKey] = "list";
            }

            const previewHeaders = computed(function () {
                return validGroupColumns.value.concat(valueColumns.value);
            });

            const distinctResult = computed(function () {
                const emptyResult = {
                    ready: false,
                    error: "",
                    summary: {
                        totalRows: 0,
                        distinctGroups: 0,
                        valueColumns: 0
                    },
                    groups: []
                };

                if (!state.list.input.trim()) {
                    return Object.assign({}, emptyResult, {
                        error: "Cole dados no Input para gerar a lista distinta."
                    });
                }

                if (parsedList.value.error) {
                    return Object.assign({}, emptyResult, {
                        error: parsedList.value.error
                    });
                }

                if (!validGroupColumns.value.length) {
                    return Object.assign({}, emptyResult, {
                        error: "Defina ao menos uma coluna de agrupamento."
                    });
                }

                const options = groupOptions.value;
                const rows = parsedList.value.dataRows;
                const headers = parsedList.value.headers;
                const groupMap = buildGroups(
                    rows,
                    headers,
                    validGroupColumns.value,
                    valueColumns.value,
                    options
                );

                const groups = Array.from(groupMap.values()).map(function (group) {
                    const valueOptions = {};
                    const valueDefaults = {};

                    valueColumns.value.forEach(function (columnName) {
                        const tally = group.valueTallies[columnName] || new Map();
                        valueOptions[columnName] = getValueOptions(tally);
                        valueDefaults[columnName] = getMostFrequentValue(tally);
                    });

                    return {
                        key: group.key,
                        groupRaw: group.groupRaw,
                        valueOptions: valueOptions,
                        valueDefaults: valueDefaults
                    };
                });

                groups.sort(function (a, b) {
                    return String(a.key).localeCompare(String(b.key), undefined, { numeric: true, sensitivity: "base" });
                });

                return {
                    ready: true,
                    error: "",
                    summary: {
                        totalRows: rows.length,
                        distinctGroups: groups.length,
                        valueColumns: valueColumns.value.length
                    },
                    groups: groups
                };
            });

            watch(function () {
                return distinctResult.value.ready
                    ? distinctResult.value.groups.map(function (group) {
                        return group.key;
                    }).join("\x1f")
                    : "";
            }, function () {
                if (!distinctResult.value.ready) {
                    Object.keys(selectedValues).forEach(function (key) {
                        delete selectedValues[key];
                    });
                    Object.keys(cellValueModes).forEach(function (key) {
                        delete cellValueModes[key];
                    });
                    Object.keys(cellValueReviewed).forEach(function (key) {
                        delete cellValueReviewed[key];
                    });
                    state.excludedRowKeys = [];
                    closeValueCellPicker();
                    return;
                }

                const activeKeys = new Set();

                distinctResult.value.groups.forEach(function (group) {
                    activeKeys.add(group.key);

                    if (!selectedValues[group.key]) {
                        selectedValues[group.key] = {};
                    }

                    valueColumns.value.forEach(function (columnName) {
                        const options = group.valueOptions[columnName] || [];
                        const current = selectedValues[group.key][columnName];
                        const fallback = group.valueDefaults[columnName];

                        if (!options.length) {
                            if (current == null || current === undefined) {
                                selectedValues[group.key][columnName] = "";
                            }
                            syncCellValueMode(group.key, columnName, options);
                            return;
                        }

                        if (current == null || current === undefined) {
                            selectedValues[group.key][columnName] = fallback;
                        }

                        syncCellValueMode(group.key, columnName, options);
                    });
                });

                Object.keys(selectedValues).forEach(function (key) {
                    if (!activeKeys.has(key)) {
                        delete selectedValues[key];
                    }
                });

                const activeModeKeys = new Set();

                distinctResult.value.groups.forEach(function (group) {
                    valueColumns.value.forEach(function (columnName) {
                        activeModeKeys.add(getCellModeKey(group.key, columnName));
                    });
                });

                Object.keys(cellValueReviewed).forEach(function (modeKey) {
                    if (!activeModeKeys.has(modeKey)) {
                        delete cellValueReviewed[modeKey];
                    }
                });

                state.excludedRowKeys = state.excludedRowKeys.filter(function (rowKey) {
                    return activeKeys.has(rowKey);
                });
            });

            const previewRows = computed(function () {
                if (!distinctResult.value.ready) {
                    return [];
                }

                return distinctResult.value.groups.map(function (group, index) {
                    const groupCells = validGroupColumns.value.map(function (columnName) {
                        return formatCellValue(group.groupRaw[columnName]);
                    });

                    const valueCells = valueColumns.value.map(function (columnName) {
                        const options = (group.valueOptions[columnName] || []).slice();
                        const selected = selectedValues[group.key]
                            ? selectedValues[group.key][columnName]
                            : group.valueDefaults[columnName];

                        return {
                            column: columnName,
                            value: selected,
                            options: options,
                            isCustom: getCellValueMode(group.key, columnName) === "custom"
                        };
                    });

                    return {
                        key: group.key,
                        index: index,
                        groupCells: groupCells,
                        valueCells: valueCells
                    };
                });
            });

            function getPreviewRowCellValue(rowItem, header) {
                const groupIndex = validGroupColumns.value.indexOf(header);
                if (groupIndex !== -1) {
                    return rowItem.groupCells[groupIndex];
                }

                const valueIndex = valueColumns.value.indexOf(header);
                if (valueIndex !== -1) {
                    return rowItem.valueCells[valueIndex].value;
                }

                return "";
            }

            const sortedPreviewRows = computed(function () {
                const rows = previewRows.value.slice();

                if (state.previewSortDirection === "none" || !state.previewSortColumnKey) {
                    return rows;
                }

                const sortHeader = state.previewSortColumnKey;

                return rows.sort(function (left, right) {
                    const leftValue = String(getPreviewRowCellValue(left, sortHeader) || "").toLowerCase();
                    const rightValue = String(getPreviewRowCellValue(right, sortHeader) || "").toLowerCase();

                    if (leftValue < rightValue) {
                        return state.previewSortDirection === "asc" ? -1 : 1;
                    }

                    if (leftValue > rightValue) {
                        return state.previewSortDirection === "asc" ? 1 : -1;
                    }

                    return 0;
                });
            });

            const activePreviewRows = computed(function () {
                return sortedPreviewRows.value.filter(function (rowItem) {
                    return state.excludedRowKeys.indexOf(rowItem.key) === -1;
                });
            });

            const excludedRowCount = computed(function () {
                return state.excludedRowKeys.filter(function (rowKey) {
                    return previewRows.value.some(function (rowItem) {
                        return rowItem.key === rowKey;
                    });
                }).length;
            });

            const filteredPreviewRows = computed(function () {
                const search = state.resultSearch.trim().toLowerCase();
                const rows = sortedPreviewRows.value;

                if (!search) {
                    return rows;
                }

                return rows.filter(function (rowItem) {
                    if (String(rowItem.key || "").toLowerCase().indexOf(search) !== -1) {
                        return true;
                    }

                    if (rowItem.groupCells.some(function (cell) {
                        return String(cell || "").toLowerCase().indexOf(search) !== -1;
                    })) {
                        return true;
                    }

                    return rowItem.valueCells.some(function (cellItem) {
                        return String(cellItem.value || "").toLowerCase().indexOf(search) !== -1;
                    });
                });
            });

            const resultPageCount = computed(function () {
                return Math.max(1, Math.ceil(filteredPreviewRows.value.length / state.resultPageSize));
            });

            const paginatedPreviewRows = computed(function () {
                const safePage = Math.min(state.resultPage, resultPageCount.value);
                const start = (safePage - 1) * state.resultPageSize;
                return filteredPreviewRows.value.slice(start, start + state.resultPageSize);
            });

            const resultRangeLabel = computed(function () {
                const total = filteredPreviewRows.value.length;
                const fullTotal = previewRows.value.length;

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

            const resultTableColspan = computed(function () {
                return previewHeaders.value.length + 1;
            });

            const exportPayload = computed(function () {
                if (!distinctResult.value.ready || !activePreviewRows.value.length || !previewHeaders.value.length) {
                    return {
                        headers: [],
                        rows: [],
                        columns: []
                    };
                }

                const headers = previewHeaders.value.slice();
                const rows = activePreviewRows.value.map(function (rowItem) {
                    const groupPart = rowItem.groupCells.slice();
                    const valuePart = rowItem.valueCells.map(function (cellItem) {
                        return formatCellValue(cellItem.value);
                    });

                    return groupPart.concat(valuePart);
                });
                const columns = headers.map(function (header, index) {
                    return {
                        key: "distinct_col_" + index,
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

            const distinctOutputResult = computed(function () {
                const payload = exportPayload.value;

                if (!payload.headers.length || !payload.rows.length) {
                    return {
                        text: "",
                        error: distinctResult.value.ready
                            ? "Nao ha linhas para exportar."
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

            function toggleTheme() {
                state.theme = state.theme === "light" ? "dark" : "light";
            }

            function toggleListSection() {
                state.list.sectionCollapsed = !state.list.sectionCollapsed;
            }

            function toggleExportPreview() {
                state.exportPreviewCollapsed = !state.exportPreviewCollapsed;
            }

            function addGroupColumn() {
                state.groupColumns.push({
                    id: createGroupColumnId(),
                    column: ""
                });
            }

            function removeGroupColumn(groupId) {
                if (state.groupColumns.length <= 1) {
                    state.groupColumns[0].column = "";
                    return;
                }

                state.groupColumns = state.groupColumns.filter(function (entry) {
                    return entry.id !== groupId;
                });
            }

            function moveGroupColumn(groupId, direction) {
                const index = state.groupColumns.findIndex(function (entry) {
                    return entry.id === groupId;
                });

                if (index === -1) {
                    return;
                }

                const targetIndex = direction === "up" ? index - 1 : index + 1;
                if (targetIndex < 0 || targetIndex >= state.groupColumns.length) {
                    return;
                }

                const copy = state.groupColumns.slice();
                const temp = copy[index];
                copy[index] = copy[targetIndex];
                copy[targetIndex] = temp;
                state.groupColumns = copy;
            }

            function toggleIgnoredColumn(header) {
                if (isGroupingColumn(header)) {
                    return;
                }

                const index = state.ignoredColumns.indexOf(header);
                if (index === -1) {
                    state.ignoredColumns.push(header);
                    return;
                }

                state.ignoredColumns.splice(index, 1);
            }

            function toggleIgnoredColumnsMenu(event) {
                if (state.ignoredColumnsMenuOpen) {
                    closeIgnoredColumnsMenu();
                    return;
                }

                const trigger = event && event.currentTarget instanceof Element
                    ? event.currentTarget
                    : ignoredColumnsTriggerEl;

                if (!(trigger instanceof Element)) {
                    return;
                }

                ignoredColumnsTriggerEl = trigger;
                const rect = trigger.getBoundingClientRect();
                ignoredColumnsMenuStyle.top = rect.bottom + 6;
                ignoredColumnsMenuStyle.left = rect.left;
                ignoredColumnsMenuStyle.width = Math.max(rect.width, 280);
                closeDistinctColumnMenu();
                state.ignoredColumnsMenuOpen = true;
            }

            function closeIgnoredColumnsMenu() {
                state.ignoredColumnsMenuOpen = false;
                state.ignoredColumnsSearch = "";
            }

            function getIgnoredColumnsMenuStyle() {
                return {
                    position: "fixed",
                    top: ignoredColumnsMenuStyle.top + "px",
                    left: ignoredColumnsMenuStyle.left + "px",
                    width: ignoredColumnsMenuStyle.width + "px",
                    maxHeight: "18rem",
                    zIndex: 1070
                };
            }

            function closeValueCellPicker() {
                valueCellPicker.open = false;
                valueCellPicker.groupKey = "";
                valueCellPicker.column = "";
                valueCellPicker.options = [];
            }

            function openValueCellPicker(groupKey, columnName, options, event) {
                const trigger = event && event.currentTarget instanceof Element
                    ? event.currentTarget
                    : null;

                if (!(trigger instanceof Element)) {
                    return;
                }

                const rect = trigger.getBoundingClientRect();
                valueCellPicker.open = true;
                valueCellPicker.groupKey = groupKey;
                valueCellPicker.column = columnName;
                valueCellPicker.top = rect.bottom + 4;
                valueCellPicker.left = rect.left;
                valueCellPicker.width = Math.max(rect.width, 160);
                valueCellPicker.options = options.slice();
                closeIgnoredColumnsMenu();
                closeDistinctColumnMenu();
            }

            function isValueColumn(header) {
                return valueColumns.value.indexOf(header) !== -1;
            }

            function getBulkFillConfig(columnName) {
                if (!bulkFillByColumn[columnName]) {
                    bulkFillByColumn[columnName] = {
                        bulkFillMode: "set",
                        bulkFillValue: "",
                        bulkFillAuxValue: "",
                        bulkFillSequenceStart: "1",
                        bulkFillSequenceStep: "1"
                    };
                }

                return bulkFillByColumn[columnName];
            }

            function closeDistinctColumnMenu() {
                columnMenu.open = false;
                columnMenu.column = "";
            }

            function toggleDistinctColumnMenu(columnName, event) {
                if (columnMenu.open && columnMenu.column === columnName) {
                    closeDistinctColumnMenu();
                    return;
                }

                const trigger = event && event.currentTarget instanceof Element
                    ? event.currentTarget
                    : null;

                if (!(trigger instanceof Element)) {
                    return;
                }

                closeIgnoredColumnsMenu();
                closeValueCellPicker();

                const rect = trigger.getBoundingClientRect();
                const estimatedMenuHeight = columnMenu.maxHeight || 400;
                const estimatedMenuWidth = columnMenu.width || 320;
                const openBelowTop = rect.bottom + 8;
                const openAboveTop = rect.top - estimatedMenuHeight - 8;
                const shouldOpenAbove = openBelowTop + estimatedMenuHeight > window.innerHeight - 16 && rect.top > window.innerHeight * 0.35;

                columnMenu.top = shouldOpenAbove
                    ? Math.max(16, openAboveTop)
                    : Math.max(16, Math.min(window.innerHeight - 24, openBelowTop));
                columnMenu.left = Math.max(16, Math.min(window.innerWidth - estimatedMenuWidth - 16, rect.right - (estimatedMenuWidth - 32)));
                columnMenu.maxHeight = Math.max(220, window.innerHeight - columnMenu.top - 16);
                columnMenu.open = true;
                columnMenu.column = columnName;
            }

            function getDistinctColumnMenuStyle() {
                return {
                    position: "fixed",
                    top: columnMenu.top + "px",
                    left: columnMenu.left + "px",
                    width: columnMenu.width + "px",
                    maxHeight: columnMenu.maxHeight + "px",
                    zIndex: 1070
                };
            }

            function applyDistinctBulkFill(columnName) {
                const config = getBulkFillConfig(columnName);
                const targetRows = filteredPreviewRows.value.filter(function (row) {
                    return !isRowExcluded(row.key);
                });

                if (config.bulkFillMode === "numeric-sequence") {
                    const start = Number(config.bulkFillSequenceStart);
                    const step = Number(config.bulkFillSequenceStep);

                    if (!Number.isFinite(start) || !Number.isFinite(step)) {
                        pushToast("Informe valor inicial e incremento numericos.", "warning");
                        return;
                    }

                    targetRows.forEach(function (rowItem, sequenceIndex) {
                        const nextValue = String(start + (step * sequenceIndex));
                        updateSelectedValue(rowItem.key, columnName, nextValue);
                        setCellValueMode(rowItem.key, columnName, "custom");
                        markCellReviewed(rowItem.key, columnName);
                    });

                    pushToast("Sequencia numerica aplicada na coluna.", "success");
                    closeDistinctColumnMenu();
                    return;
                }

                targetRows.forEach(function (rowItem) {
                    const cellItem = rowItem.valueCells.find(function (item) {
                        return item.column === columnName;
                    });
                    const currentValue = String(cellItem && cellItem.value != null ? cellItem.value : "");
                    let nextValue = currentValue;

                    if (config.bulkFillMode === "set") {
                        nextValue = config.bulkFillValue;
                    } else if (config.bulkFillMode === "replace") {
                        nextValue = currentValue.split(config.bulkFillValue).join(config.bulkFillAuxValue);
                    } else if (config.bulkFillMode === "prefix") {
                        nextValue = config.bulkFillValue + currentValue;
                    } else if (config.bulkFillMode === "suffix") {
                        nextValue = currentValue + config.bulkFillValue;
                    } else if (config.bulkFillMode === "uppercase") {
                        nextValue = currentValue.toUpperCase();
                    } else if (config.bulkFillMode === "lowercase") {
                        nextValue = currentValue.toLowerCase();
                    } else if (config.bulkFillMode === "trim") {
                        nextValue = currentValue.trim();
                    } else if (config.bulkFillMode === "clear") {
                        nextValue = "";
                    } else if (config.bulkFillMode === "fill-empty") {
                        nextValue = currentValue.trim() === "" ? config.bulkFillValue : currentValue;
                    } else if (config.bulkFillMode === "snake_case") {
                        nextValue = toSnakeCase(currentValue);
                    } else if (config.bulkFillMode === "camelCase") {
                        nextValue = toCamelCase(currentValue);
                    } else if (config.bulkFillMode === "remove-spaces") {
                        nextValue = currentValue.replace(/\s+/g, "");
                    } else if (config.bulkFillMode === "remove-accents") {
                        nextValue = currentValue.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    } else if (config.bulkFillMode === "remove-special") {
                        nextValue = currentValue.replace(/[^A-Za-z0-9\s]/g, "");
                    }

                    updateSelectedValue(rowItem.key, columnName, nextValue);
                    setCellValueMode(rowItem.key, columnName, "custom");
                    markCellReviewed(rowItem.key, columnName);
                });

                pushToast("Preenchimento em massa aplicado na coluna.", "success");
                closeDistinctColumnMenu();
            }

            function getValueCellPickerStyle() {
                return {
                    position: "fixed",
                    top: valueCellPicker.top + "px",
                    left: valueCellPicker.left + "px",
                    width: valueCellPicker.width + "px",
                    maxHeight: "14rem",
                    zIndex: 1070
                };
            }

            function handleGlobalOutsideClick(event) {
                const target = event.target;
                if (!(target instanceof Element)) {
                    return;
                }

                if (state.ignoredColumnsMenuOpen) {
                    if (!target.closest(".distinct-multiselect-wrap") && !target.closest(".distinct-multiselect-panel")) {
                        closeIgnoredColumnsMenu();
                    }
                }

                if (valueCellPicker.open) {
                    if (!target.closest(".distinct-value-cell") && !target.closest(".distinct-value-picker")) {
                        closeValueCellPicker();
                    }
                }

                if (columnMenu.open) {
                    if (!target.closest(".preview-column-menu-wrap") && !target.closest(".preview-column-menu")) {
                        closeDistinctColumnMenu();
                    }
                }
            }

            function isIgnoredColumn(header) {
                return state.ignoredColumns.indexOf(header) !== -1;
            }

            function isGroupingColumn(header) {
                return groupingColumnSet.value.has(header);
            }

            function updateSelectedValue(groupKey, columnName, value) {
                if (!selectedValues[groupKey]) {
                    selectedValues[groupKey] = {};
                }

                selectedValues[groupKey][columnName] = value;
            }

            function selectListValue(groupKey, columnName, value) {
                updateSelectedValue(groupKey, columnName, value);
                setCellValueMode(groupKey, columnName, "list");
                markCellReviewed(groupKey, columnName);
                closeValueCellPicker();
            }

            function startCustomValue(groupKey, columnName) {
                setCellValueMode(groupKey, columnName, "custom");
                if (!selectedValues[groupKey]) {
                    selectedValues[groupKey] = {};
                }

                if (selectedValues[groupKey][columnName] == null) {
                    selectedValues[groupKey][columnName] = "";
                }

                markCellReviewed(groupKey, columnName);
                closeValueCellPicker();
                focusCustomCellInput(groupKey, columnName);
            }

            function focusCustomCellInput(groupKey, columnName) {
                const modeKey = getCellModeKey(groupKey, columnName);

                nextTick(function () {
                    const inputs = document.querySelectorAll("[data-distinct-custom-cell]");

                    for (let index = 0; index < inputs.length; index += 1) {
                        const input = inputs[index];

                        if (input instanceof HTMLInputElement && input.getAttribute("data-distinct-custom-cell") === modeKey) {
                            input.focus();
                            input.select();
                            return;
                        }
                    }
                });
            }

            function openCustomValueEdit(groupKey, columnName, event) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                closeValueCellPicker();

                if (getCellValueMode(groupKey, columnName) === "custom") {
                    focusCustomCellInput(groupKey, columnName);
                    return;
                }

                startCustomValue(groupKey, columnName);
            }

            function updateCustomValue(groupKey, columnName, value) {
                updateSelectedValue(groupKey, columnName, value);
                setCellValueMode(groupKey, columnName, "custom");
                markCellReviewed(groupKey, columnName);
            }

            function cyclePreviewSort(header) {
                if (state.previewSortColumnKey !== header) {
                    state.previewSortColumnKey = header;
                    state.previewSortDirection = "asc";
                    state.resultPage = 1;
                    return;
                }

                if (state.previewSortDirection === "asc") {
                    state.previewSortDirection = "desc";
                } else if (state.previewSortDirection === "desc") {
                    state.previewSortDirection = "none";
                    state.previewSortColumnKey = "";
                } else {
                    state.previewSortDirection = "asc";
                }

                state.resultPage = 1;
            }

            function getPreviewSortIcon(header) {
                if (state.previewSortColumnKey !== header || state.previewSortDirection === "none") {
                    return "fas fa-sort";
                }

                return state.previewSortDirection === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
            }

            function isRowExcluded(rowKey) {
                return state.excludedRowKeys.indexOf(rowKey) !== -1;
            }

            function toggleRowExcluded(rowKey) {
                const index = state.excludedRowKeys.indexOf(rowKey);
                if (index === -1) {
                    state.excludedRowKeys.push(rowKey);
                    return;
                }

                state.excludedRowKeys.splice(index, 1);
            }

            async function pasteListFromClipboard() {
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

                    state.list.input = String(text);

                    if (parsedList.value.error) {
                        pushToast(parsedList.value.error, "danger");
                        return;
                    }

                    pushToast(
                        "Dados colados: "
                            + parsedList.value.dataRows.length
                            + " linha(s), "
                            + parsedList.value.headers.length
                            + " coluna(s).",
                        "success"
                    );
                } catch (_error) {
                    pushToast("Nao foi possivel ler a area de transferencia.", "danger");
                }
            }

            async function writeDistinctOutputToClipboard() {
                const text = distinctOutputResult.value.text;
                if (!text) {
                    state.copyFeedback = "Sem conteudo";
                    pushToast(distinctOutputResult.value.error || "Nao ha conteudo para copiar.", "warning");
                    return;
                }

                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
                    pushToast("Copia para a area de transferencia nao disponivel neste browser.", "danger");
                    return;
                }

                try {
                    await navigator.clipboard.writeText(text);
                    state.copyFeedback = "Copiado";
                    pushToast("Exportacao copiada.", "success");
                } catch (_error) {
                    state.copyFeedback = "Falha ao copiar";
                    pushToast("Falha ao copiar para a area de transferencia.", "danger");
                }

                window.setTimeout(function () {
                    state.copyFeedback = "";
                }, 1600);
            }

            function downloadDistinctOutput() {
                const content = distinctOutputResult.value.text;
                if (!content) {
                    pushToast(distinctOutputResult.value.error || "Nao ha conteudo para baixar.", "warning");
                    return;
                }

                const extension = getOutputFileExtension(state.outputFormat);
                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");

                link.href = url;
                link.download = "excelconverter-distintos." + extension;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                pushToast("Arquivo gerado.", "success");
            }

            watch(function () {
                return distinctOutputResult.value.error;
            }, function (message, previousMessage) {
                if (message && message !== previousMessage) {
                    pushToast(message, "danger");
                }
            });

            watch(function () {
                return state.resultPageSize + "|" + filteredPreviewRows.value.length;
            }, function () {
                if (state.resultPage > resultPageCount.value) {
                    state.resultPage = resultPageCount.value;
                }
            });

            watch(function () {
                return distinctResult.value.ready ? distinctResult.value.groups.length : "";
            }, function () {
                state.resultPage = 1;
            });

            watch(function () {
                return state.resultSearch;
            }, function () {
                state.resultPage = 1;
            });

            watch(function () {
                return parsedList.value.headers.join("\x1f");
            }, function () {
                state.groupColumns.forEach(function (entry) {
                    if (entry.column && parsedList.value.headers.indexOf(entry.column) === -1) {
                        entry.column = "";
                    }
                });

                state.ignoredColumns = state.ignoredColumns.filter(function (header) {
                    return parsedList.value.headers.indexOf(header) !== -1;
                });

                if (parsedList.value.headers.length) {
                    const firstEntry = state.groupColumns[0];
                    if (!firstEntry.column) {
                        firstEntry.column = parsedList.value.headers[0];
                    }
                }
            });

            watch(function () {
                return validGroupColumns.value.join("\x1f");
            }, function () {
                state.ignoredColumns = state.ignoredColumns.filter(function (header) {
                    return validGroupColumns.value.indexOf(header) === -1;
                });
            });

            onMounted(function () {
                document.addEventListener("mousedown", handleGlobalOutsideClick);
            });

            onBeforeUnmount(function () {
                document.removeEventListener("mousedown", handleGlobalOutsideClick);
            });

            return {
                state,
                inputConfig,
                inputFormats,
                parsedList,
                listMeta,
                validGroupColumns,
                valueColumns,
                previewHeaders,
                distinctResult,
                previewRows,
                activePreviewRows,
                excludedRowCount,
                filteredPreviewRows,
                paginatedPreviewRows,
                resultPageCount,
                resultRangeLabel,
                resultTableColspan,
                outputFormats,
                isSqlOutput,
                distinctOutputResult,
                selectedValues,
                formatSelectLabel,
                writeDistinctOutputToClipboard,
                downloadDistinctOutput,
                goToResultPage,
                toggleTheme,
                toggleListSection,
                toggleExportPreview,
                addGroupColumn,
                removeGroupColumn,
                moveGroupColumn,
                toggleIgnoredColumn,
                toggleIgnoredColumnsMenu,
                closeIgnoredColumnsMenu,
                getIgnoredColumnsMenuStyle,
                ignoredColumnChoices,
                ignoredColumnsLabel,
                isIgnoredColumn,
                isGroupingColumn,
                getCellModeKey,
                getCellValueMode,
                openValueCellPicker,
                closeValueCellPicker,
                getValueCellPickerStyle,
                valueCellPicker,
                selectListValue,
                startCustomValue,
                openCustomValueEdit,
                updateCustomValue,
                updateSelectedValue,
                getCellChevronClass,
                getCellChevronTitle,
                cyclePreviewSort,
                getPreviewSortIcon,
                isRowExcluded,
                toggleRowExcluded,
                pasteListFromClipboard,
                dismissToast,
                columnMenu,
                isValueColumn,
                getBulkFillConfig,
                toggleDistinctColumnMenu,
                closeDistinctColumnMenu,
                getDistinctColumnMenuStyle,
                applyDistinctBulkFill
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
                            <a class="topbar-link" href="compare-arrays.html">Comparar</a>
                            <a class="topbar-link is-active" href="distinct-list.html">Distintos</a>
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
                            <h1 class="h3 mb-3">Lista distinta</h1>
                            <p class="text-secondary mb-0">Importe dados tabulares, escolha colunas de agrupamento e gere uma lista distinta. Para as demais colunas, escolha qual valor manter em cada grupo.</p>
                        </div>
                    </section>

                    <section class="panel-card input-panel mb-4">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                <div @click="toggleListSection">
                                    <div class="editor-label mb-1">Input</div>
                                    <h2 class="h5 mb-0">Texto de origem</h2>
                                </div>
                                <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-grow-1">
                                    <div class="small text-secondary text-nowrap">{{ listMeta }}</div>
                                    <div class="input-group input-group-sm input-toolbar-group flex-grow-1" style="min-width: min(100%, 220px); max-width: 20rem;">
                                        <label class="input-group-text mb-0 d-none d-lg-inline" for="distinct-input-format">Formato</label>
                                        <select id="distinct-input-format" class="form-select" v-model="state.list.inputFormat">
                                            <option v-for="format in inputFormats" :key="'input-' + format.value" :value="format.value">
                                                {{ format.label }}
                                            </option>
                                        </select>
                                        <button class="btn btn-outline-primary" type="button" @click="pasteListFromClipboard" title="Colar da area de transferencia" aria-label="Colar da area de transferencia">
                                            <i class="fas fa-clipboard" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                    <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleListSection" :title="state.list.sectionCollapsed ? 'Expandir secao' : 'Colapsar secao'">
                                        <i :class="state.list.sectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <div v-if="!state.list.sectionCollapsed">
                                <div class="status-chip mb-3" :class="parsedList.error ? 'error' : 'info'">
                                    {{ parsedList.error || 'Cole dados copiados do Excel, CSV, TSV ou outro formato suportado.' }}
                                </div>
                                <textarea class="form-control editor-textarea compare-list-textarea" v-model="state.list.input" placeholder="Cole aqui os dados de origem" spellcheck="false"></textarea>
                            </div>
                        </div>
                    </section>

                    <section class="panel-card preview-panel mb-4">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                <div>
                                    <div class="editor-label mb-1">Opcoes</div>
                                    <h2 class="h5 mb-0">Agrupamento e formatacao</h2>
                                </div>
                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="state.optionsSectionCollapsed = !state.optionsSectionCollapsed">
                                    <i :class="state.optionsSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                </button>
                            </div>

                            <div v-if="!state.optionsSectionCollapsed" class="compare-options-body">
                                <div class="compare-parse-config mb-4">
                                    <div class="small fw-semibold text-secondary mb-2">Leitura dos dados</div>
                                    <div class="compare-parse-grid">
                                        <div v-for="field in inputConfig" :key="field.id">
                                            <label class="form-label small fw-semibold">{{ field.label }}</label>
                                            <select v-if="field.type === 'select'" class="form-select form-select-sm" v-model="state[field.id]">
                                                <option v-for="option in field.options" :key="option.value" :value="option.value">
                                                    {{ option.label }}
                                                </option>
                                            </select>
                                            <div v-else-if="field.type === 'checkbox'" class="form-check mt-2">
                                                <input class="form-check-input" type="checkbox" :id="'distinct-' + field.id" v-model="state[field.id]">
                                                <label class="form-check-label" :for="'distinct-' + field.id">{{ field.label }}</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="mb-4">
                                    <div class="d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap">
                                        <div>
                                            <div class="small fw-semibold">Colunas de agrupamento</div>
                                            <div class="small text-secondary">Ordem define a chave composta do agrupamento (ex.: NOME + CD_CINTO).</div>
                                        </div>
                                        <button class="btn btn-sm btn-outline-primary" type="button" @click="addGroupColumn">
                                            <i class="fas fa-plus" aria-hidden="true"></i>
                                            <span class="ms-1">Adicionar coluna</span>
                                        </button>
                                    </div>

                                    <div class="compare-column-pairs">
                                        <div v-for="(entry, entryIndex) in state.groupColumns" :key="entry.id" class="group-column-row">
                                            <span class="column-pair-order">{{ entryIndex + 1 }}</span>
                                            <select class="form-select form-select-sm" v-model="entry.column" :disabled="!parsedList.headers.length">
                                                <option value="">Selecione a coluna</option>
                                                <option v-for="header in parsedList.headers" :key="'group-' + entry.id + '-' + header" :value="header">
                                                    {{ header }}
                                                </option>
                                            </select>
                                            <div class="column-pair-actions">
                                                <button class="btn btn-sm btn-outline-secondary" type="button" @click="moveGroupColumn(entry.id, 'up')" :disabled="entryIndex === 0" title="Subir">
                                                    <i class="fas fa-arrow-up" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-sm btn-outline-secondary" type="button" @click="moveGroupColumn(entry.id, 'down')" :disabled="entryIndex === state.groupColumns.length - 1" title="Descer">
                                                    <i class="fas fa-arrow-down" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-sm btn-outline-danger" type="button" @click="removeGroupColumn(entry.id)" title="Remover coluna">
                                                    <i class="fas fa-times" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="mb-4" v-if="parsedList.headers.length">
                                    <div class="small fw-semibold mb-2">Colunas ignoradas</div>
                                    <div class="small text-secondary mb-2">Colunas ignoradas nao aparecem na previsualizacao nem no export.</div>
                                    <div class="distinct-multiselect-wrap">
                                        <button
                                            class="form-select form-select-sm distinct-multiselect-trigger text-start"
                                            type="button"
                                            @click="toggleIgnoredColumnsMenu($event)"
                                            :aria-expanded="state.ignoredColumnsMenuOpen ? 'true' : 'false'"
                                        >
                                            {{ ignoredColumnsLabel }}
                                        </button>
                                    </div>
                                </div>

                                <div class="compare-normalize-grid">
                                    <div class="form-check">
                                        <input id="distinct-trim" class="form-check-input" type="checkbox" v-model="state.trim">
                                        <label class="form-check-label" for="distinct-trim">Trim</label>
                                    </div>
                                    <div class="form-check">
                                        <input id="distinct-ignore-spaces" class="form-check-input" type="checkbox" v-model="state.ignoreSpaces">
                                        <label class="form-check-label" for="distinct-ignore-spaces">Ignorar espacos</label>
                                    </div>
                                    <div class="form-check">
                                        <input id="distinct-ignore-zeros" class="form-check-input" type="checkbox" v-model="state.ignoreLeadingZeros">
                                        <label class="form-check-label" for="distinct-ignore-zeros">Ignorar zeros a esquerda</label>
                                    </div>
                                    <div class="form-check">
                                        <input id="distinct-ignore-special" class="form-check-input" type="checkbox" v-model="state.ignoreSpecialCharsAndAccents">
                                        <label class="form-check-label" for="distinct-ignore-special">Ignorar caracteres especiais e acentuacao</label>
                                    </div>
                                </div>
                                <div class="small text-secondary mt-2">Estas opcoes afetam apenas a chave de agrupamento. Os valores exibidos e exportados permanecem originais.</div>
                            </div>
                        </div>
                    </section>

                    <section class="panel-card output-panel">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                <div>
                                    <div class="editor-label mb-1">Previsualizacao</div>
                                    <h2 class="h5 mb-0">Lista distinta</h2>
                                </div>
                                <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-grow-1 output-header-actions">
                                    <div
                                        v-if="distinctResult.ready && previewRows.length"
                                        class="input-group input-group-sm output-toolbar-group"
                                    >
                                        <template v-if="isSqlOutput">
                                            <label class="input-group-text mb-0 small d-none d-md-inline" for="distinct-output-sql-table-name">Tabela</label>
                                            <input
                                                id="distinct-output-sql-table-name"
                                                class="form-control output-sql-table-input"
                                                v-model="state.sqlTableName"
                                                placeholder="ExcelConverter"
                                                title="Nome da tabela SQL"
                                            >
                                        </template>
                                        <label class="input-group-text mb-0 small d-none d-lg-inline" for="distinct-output-format-select">Formato</label>
                                        <select id="distinct-output-format-select" class="form-select output-format-select" v-model="state.outputFormat">
                                            <option v-for="format in outputFormats" :key="format.value" :value="format.value">
                                                {{ format.label }}
                                            </option>
                                        </select>
                                        <button class="btn btn-outline-primary" type="button" @click="writeDistinctOutputToClipboard" :title="state.copyFeedback || 'Copiar exportacao'">
                                            <i
                                                :class="state.copyFeedback === 'Copiado' ? 'fas fa-check' : state.copyFeedback === 'Falha ao copiar' ? 'fas fa-exclamation-triangle' : state.copyFeedback === 'Sem conteudo' ? 'fas fa-ban' : 'fas fa-copy'"
                                                aria-hidden="true"
                                            ></i>
                                        </button>
                                        <button class="btn btn-outline-primary" type="button" @click="downloadDistinctOutput" title="Baixar exportacao">
                                            <i class="fas fa-download" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                    <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="state.resultsSectionCollapsed = !state.resultsSectionCollapsed">
                                        <i :class="state.resultsSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>

                            <div v-if="!state.resultsSectionCollapsed">
                                <div class="status-chip mb-3" :class="distinctResult.error ? 'warning' : (distinctResult.ready ? 'info' : 'info')">
                                    {{ distinctResult.error || (distinctResult.ready ? 'Lista distinta pronta.' : 'Aguardando dados.') }}
                                </div>

                                <template v-if="distinctResult.ready">
                                    <div class="compare-summary-grid mb-4">
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ distinctResult.summary.totalRows }}</div>
                                            <div class="compare-summary-label">Linhas originais</div>
                                        </div>
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ distinctResult.summary.distinctGroups }}</div>
                                            <div class="compare-summary-label">Grupos distintos</div>
                                        </div>
                                        <div class="compare-summary-card">
                                            <div class="compare-summary-value">{{ activePreviewRows.length }}</div>
                                            <div class="compare-summary-label">Linhas activas</div>
                                        </div>
                                        <div class="compare-summary-card" v-if="excludedRowCount">
                                            <div class="compare-summary-value">{{ excludedRowCount }}</div>
                                            <div class="compare-summary-label">Desconsideradas</div>
                                        </div>
                                    </div>

                                    <div class="small text-secondary mb-3" v-if="validGroupColumns.length">
                                        Chave: {{ validGroupColumns.join(' + ') }}
                                    </div>

                                    <template v-if="previewRows.length && previewHeaders.length">
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

                                        <div class="preview-table-wrap distinct-preview-table-wrap">
                                            <table class="table table-sm align-middle mb-0 preview-table distinct-preview-table">
                                                <thead>
                                                    <tr>
                                                        <th class="preview-actions-col distinct-index-col">
                                                            <div class="preview-header-cell">
                                                                <div class="input-group input-group-sm preview-column-group">
                                                                    <span class="form-control form-control-sm preview-input preview-header-label">#</span>
                                                                </div>
                                                            </div>
                                                        </th>
                                                        <th
                                                            v-for="(header, headerIndex) in previewHeaders"
                                                            :key="'preview-header-' + headerIndex"
                                                            :class="{ 'compare-column-key': validGroupColumns.indexOf(header) !== -1 }"
                                                        >
                                                            <div class="preview-header-cell" :class="{ 'preview-column-menu-wrap': isValueColumn(header) }">
                                                                <div class="input-group input-group-sm preview-column-group">
                                                                    <span class="form-control form-control-sm preview-input preview-header-label" :title="header">{{ header }}</span>
                                                                    <button class="btn btn-outline-secondary" type="button" @click="cyclePreviewSort(header)" title="Ordenar coluna">
                                                                        <i :class="getPreviewSortIcon(header)" aria-hidden="true"></i>
                                                                    </button>
                                                                    <button
                                                                        v-if="isValueColumn(header)"
                                                                        class="btn btn-outline-secondary"
                                                                        type="button"
                                                                        @click.stop="toggleDistinctColumnMenu(header, $event)"
                                                                        title="Opcoes da coluna"
                                                                    >
                                                                        <i class="fas fa-ellipsis-v" aria-hidden="true"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr
                                                        v-for="(rowItem, rowIndex) in paginatedPreviewRows"
                                                        :key="'preview-row-' + rowIndex + '-' + rowItem.key"
                                                        :class="{ 'preview-row-hidden': isRowExcluded(rowItem.key) }"
                                                    >
                                                        <td class="preview-actions-col distinct-index-col">
                                                            <div class="btn-group btn-group-sm preview-row-actions distinct-row-actions" role="group">
                                                                <button
                                                                    class="btn"
                                                                    :class="isRowExcluded(rowItem.key) ? 'btn-outline-secondary' : 'btn-outline-success'"
                                                                    type="button"
                                                                    @click="toggleRowExcluded(rowItem.key)"
                                                                    :title="isRowExcluded(rowItem.key) ? 'Incluir linha no export' : 'Desconsiderar linha no export'"
                                                                >
                                                                    <i :class="isRowExcluded(rowItem.key) ? 'fas fa-eye-slash' : 'fas fa-eye'" aria-hidden="true"></i>
                                                                </button>
                                                                <span class="form-control form-control-sm preview-input distinct-row-index">{{ ((state.resultPage - 1) * state.resultPageSize) + rowIndex + 1 }}</span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            v-for="(cell, cellIndex) in rowItem.groupCells"
                                                            :key="'group-cell-' + rowIndex + '-' + cellIndex"
                                                            class="compare-column-key"
                                                        >
                                                            <div class="form-control form-control-sm preview-input" :title="cell">{{ cell || '(null)' }}</div>
                                                        </td>
                                                        <td
                                                            v-for="(cellItem, cellIndex) in rowItem.valueCells"
                                                            :key="'value-cell-' + rowIndex + '-' + cellIndex"
                                                        >
                                                            <div v-if="!cellItem.isCustom" class="distinct-value-cell" @click="openValueCellPicker(rowItem.key, cellItem.column, cellItem.options, $event)" @contextmenu.prevent="openCustomValueEdit(rowItem.key, cellItem.column, $event)">
                                                                <div class="form-control form-control-sm preview-input distinct-value-display" :title="formatSelectLabel(cellItem.value)">
                                                                    {{ formatSelectLabel(cellItem.value) }}
                                                                </div>
                                                                <button
                                                                    class="btn btn-sm distinct-value-picker-btn"
                                                                    :class="getCellChevronClass(rowItem.key, cellItem.column, cellItem.options, cellItem.isCustom)"
                                                                    type="button"
                                                                    :title="getCellChevronTitle(rowItem.key, cellItem.column, cellItem.options, cellItem.isCustom)"
                                                                    @click.stop="openValueCellPicker(rowItem.key, cellItem.column, cellItem.options, $event)"
                                                                >
                                                                    <i class="fas fa-chevron-down" aria-hidden="true"></i>
                                                                </button>
                                                            </div>
                                                            <div v-else class="distinct-value-cell distinct-value-cell-custom" @contextmenu.prevent="openCustomValueEdit(rowItem.key, cellItem.column, $event)">
                                                                <input
                                                                    class="form-control form-control-sm preview-input distinct-value-input"
                                                                    :data-distinct-custom-cell="getCellModeKey(rowItem.key, cellItem.column)"
                                                                    :value="cellItem.value"
                                                                    :title="formatSelectLabel(cellItem.value)"
                                                                    placeholder="Novo valor"
                                                                    spellcheck="false"
                                                                    @input="updateCustomValue(rowItem.key, cellItem.column, $event.target.value)"
                                                                >
                                                                <button
                                                                    class="btn btn-sm distinct-value-picker-btn"
                                                                    :class="getCellChevronClass(rowItem.key, cellItem.column, cellItem.options, cellItem.isCustom)"
                                                                    type="button"
                                                                    :title="getCellChevronTitle(rowItem.key, cellItem.column, cellItem.options, cellItem.isCustom)"
                                                                    @click.stop="openValueCellPicker(rowItem.key, cellItem.column, cellItem.options, $event)"
                                                                >
                                                                    <i class="fas fa-chevron-down" aria-hidden="true"></i>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    <tr v-if="!paginatedPreviewRows.length">
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
                                        Nenhum grupo distinto com os criterios actuais.
                                    </div>

                                    <div v-if="previewRows.length" class="compare-export-panel mt-4">
                                        <div class="d-flex align-items-center justify-content-between gap-3 mb-2">
                                            <div class="compare-export-panel-head" @click="toggleExportPreview">
                                                <div class="editor-label mb-1">Visualizar</div>
                                                <h3 class="h6 mb-0">Visualizar Exportacao</h3>
                                            </div>
                                            <button
                                                class="btn btn-outline-secondary btn-sm section-toggle-btn border-0"
                                                type="button"
                                                @click="toggleExportPreview"
                                                :title="state.exportPreviewCollapsed ? 'Expandir visualizacao' : 'Minimizar visualizacao'"
                                            >
                                                <i :class="state.exportPreviewCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                        <template v-if="!state.exportPreviewCollapsed">
                                            <div class="small text-secondary mb-2">
                                                Exporta {{ activePreviewRows.length }} linha(s) activa(s) com {{ previewHeaders.length }} coluna(s). Linhas desconsideradas e colunas ignoradas nao sao incluidas.
                                            </div>
                                            <div v-if="distinctOutputResult.error" class="alert alert-danger py-2 px-3 mb-2 small" role="alert">
                                                {{ distinctOutputResult.error }}
                                            </div>
                                            <textarea
                                                class="form-control editor-textarea compare-export-textarea"
                                                :value="distinctOutputResult.text"
                                                readonly
                                                spellcheck="false"
                                                placeholder="O resultado exportado aparecera aqui"
                                            ></textarea>
                                        </template>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </section>
                </div>

                <teleport to="body">
                    <div
                        v-if="state.ignoredColumnsMenuOpen"
                        class="distinct-multiselect-panel"
                        :style="getIgnoredColumnsMenuStyle()"
                        @click.stop
                    >
                        <div class="distinct-multiselect-search">
                            <input
                                class="form-control form-control-sm"
                                v-model="state.ignoredColumnsSearch"
                                placeholder="Buscar coluna"
                                spellcheck="false"
                            >
                        </div>
                        <div class="distinct-multiselect-options">
                            <label
                                v-for="header in ignoredColumnChoices"
                                :key="'ignored-choice-' + header"
                                class="distinct-multiselect-option"
                                :class="{ 'is-disabled': isGroupingColumn(header) }"
                            >
                                <input
                                    class="form-check-input"
                                    type="checkbox"
                                    :checked="isIgnoredColumn(header)"
                                    :disabled="isGroupingColumn(header)"
                                    @change="toggleIgnoredColumn(header)"
                                >
                                <span class="distinct-multiselect-option-label" :title="header">{{ header }}</span>
                                <span v-if="isGroupingColumn(header)" class="distinct-multiselect-option-note">agrupamento</span>
                            </label>
                            <div v-if="!ignoredColumnChoices.length" class="distinct-multiselect-empty">
                                Nenhuma coluna encontrada.
                            </div>
                        </div>
                    </div>
                </teleport>

                <teleport to="body">
                    <div
                        v-if="columnMenu.open"
                        class="preview-column-menu"
                        :style="getDistinctColumnMenuStyle()"
                        @click.stop
                    >
                        <div class="p-3">
                            <div class="small fw-semibold mb-2">Preenchimento em massa</div>
                            <div class="small text-secondary mb-2">Aplica nas linhas visiveis no preview (filtros, pesquisa e ordenacao activos).</div>
                            <div class="preview-column-menu-group">
                                <select class="form-select form-select-sm mb-2" v-model="getBulkFillConfig(columnMenu.column).bulkFillMode">
                                    <option value="set">Definir valor</option>
                                    <option value="replace">Substituir texto</option>
                                    <option value="prefix">Prefixo</option>
                                    <option value="suffix">Sufixo</option>
                                    <option value="numeric-sequence">Sequencia numerica</option>
                                    <option value="uppercase">UPPERCASE</option>
                                    <option value="lowercase">lowercase</option>
                                    <option value="trim">Trim</option>
                                    <option value="clear">Limpar</option>
                                    <option value="fill-empty">Preencher vazios</option>
                                    <option value="snake_case">snake_case</option>
                                    <option value="camelCase">camelCase</option>
                                    <option value="remove-spaces">Remover espacos</option>
                                    <option value="remove-accents">Remover acentos</option>
                                    <option value="remove-special">Remover caracteres especiais</option>
                                </select>
                                <input
                                    v-if="['set','replace','prefix','suffix','fill-empty'].includes(getBulkFillConfig(columnMenu.column).bulkFillMode)"
                                    class="form-control form-control-sm mb-2"
                                    v-model="getBulkFillConfig(columnMenu.column).bulkFillValue"
                                    placeholder="Valor"
                                >
                                <div v-if="getBulkFillConfig(columnMenu.column).bulkFillMode === 'numeric-sequence'" class="row g-2 mb-2">
                                    <div class="col-6">
                                        <input class="form-control form-control-sm" v-model="getBulkFillConfig(columnMenu.column).bulkFillSequenceStart" placeholder="Valor inicial">
                                    </div>
                                    <div class="col-6">
                                        <input class="form-control form-control-sm" v-model="getBulkFillConfig(columnMenu.column).bulkFillSequenceStep" placeholder="Incremento">
                                    </div>
                                </div>
                                <input v-if="getBulkFillConfig(columnMenu.column).bulkFillMode === 'replace'" class="form-control form-control-sm mb-2" v-model="getBulkFillConfig(columnMenu.column).bulkFillAuxValue" placeholder="Substituir por">
                                <button class="btn btn-sm btn-outline-primary w-100" type="button" @click="applyDistinctBulkFill(columnMenu.column)">Aplicar</button>
                            </div>
                        </div>
                    </div>
                </teleport>

                <teleport to="body">
                    <div
                        v-if="valueCellPicker.open"
                        class="distinct-value-picker"
                        :style="getValueCellPickerStyle()"
                        @click.stop
                    >
                        <button
                            v-for="option in valueCellPicker.options"
                            :key="'picker-option-' + valueCellPicker.groupKey + '-' + valueCellPicker.column + '-' + option"
                            class="distinct-value-picker-option"
                            type="button"
                            @click="selectListValue(valueCellPicker.groupKey, valueCellPicker.column, option)"
                        >
                            {{ formatSelectLabel(option) }}
                        </button>
                        <button
                            class="distinct-value-picker-option distinct-value-picker-add"
                            type="button"
                            @click="startCustomValue(valueCellPicker.groupKey, valueCellPicker.column)"
                        >
                            + Adicionar novo valor
                        </button>
                    </div>
                </teleport>

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
    }).mount("#distinct-list-app");
})();
