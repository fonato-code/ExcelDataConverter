(function () {
    const { createApp, computed, reactive, watch } = Vue;
    const inputConfig = window.ExcelConverterInputConfig || [];
    const inputFormats = window.ExcelConverterInputFormats || [];
    const inputParsers = window.ExcelConverterInputParsers || {};
    const outputFormats = window.ExcelConverterOutputFormats || [];
    const outputBuilders = window.ExcelConverterOutputBuilders || {};
    const PREFERENCES_STORAGE_KEY = "excelconverter.preferences.v1";

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

    function loadPreferences(defaultState) {
        try {
            const saved = JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
            return Object.assign({}, defaultState, saved, {
                input: defaultState.input,
                standardHeaders: defaultState.standardHeaders,
                standardRows: defaultState.standardRows,
                standardColumnKeys: defaultState.standardColumnKeys,
                standardRowKeys: defaultState.standardRowKeys,
                rowConfigs: defaultState.rowConfigs,
                columnConfigs: defaultState.columnConfigs,
                draggedColumnKey: defaultState.draggedColumnKey,
                bulkHeaderRenameMode: defaultState.bulkHeaderRenameMode,
                bulkHeaderRenamePrefix: defaultState.bulkHeaderRenamePrefix,
                bulkHeaderRenameSuffix: defaultState.bulkHeaderRenameSuffix,
                copyFeedback: defaultState.copyFeedback,
                toasts: defaultState.toasts,
                lastAutoCopiedOutput: defaultState.lastAutoCopiedOutput
            });
        } catch (_error) {
            return defaultState;
        }
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

    function cloneRows(rows) {
        return rows.map(function (row) {
            return row.slice();
        });
    }

    createApp({
        setup() {
            let standardColumnKeySeed = 0;
            let standardRowKeySeed = 0;
            let draggedPreviewRowIndex = -1;
            let draggedPreviewColumnKey = "";
            let isSidebarResizing = false;

            function createColumnKey() {
                standardColumnKeySeed += 1;
                return "stdcol_" + standardColumnKeySeed;
            }

            function createColumnKeys(count) {
                return Array.from({ length: count }, function () {
                    return createColumnKey();
                });
            }

            function createRowKey() {
                standardRowKeySeed += 1;
                return "stdrow_" + standardRowKeySeed;
            }

            function createRowKeys(count) {
                return Array.from({ length: count }, function () {
                    return createRowKey();
                });
            }

            function normalizeHeaderToken(value) {
                return String(value || "")
                    .trim()
                    .toLowerCase();
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

            function transformHeaderByMode(value, mode) {
                if (mode === "uppercase") {
                    return String(value || "").toUpperCase();
                }

                if (mode === "lowercase") {
                    return String(value || "").toLowerCase();
                }

                if (mode === "snake_case") {
                    return toSnakeCase(value);
                }

                if (mode === "camelCase") {
                    return toCamelCase(value);
                }

                if (mode === "remove-spaces") {
                    return String(value || "").replace(/\s+/g, "");
                }

                if (mode === "remove-accents") {
                    return String(value || "")
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "");
                }

                return String(value || "");
            }

            const defaultState = {
                theme: "dark",
                input: "",
                inputFormat: "input-default",
                delimiter: "auto",
                decimalSign: "dot",
                firstRowIsHeader: true,
                headerTransform: "none",
                outputFormat: "json",
                xmlRootTagName: "rows",
                xmlRowTagName: "row",
                sqlTableName: "ExcelConverter",
                sqlAddCreateTable: true,
                sqlAddIdentityInsert: false,
                sqlAddTransaction: false,
                sqlAddTruncate: false,
                sqlConvertEmptyToNull: false,
                autoCopyOutput: false,
                standardHeaders: [],
                standardRows: [],
                standardColumnKeys: [],
                standardRowKeys: [],
                rowConfigs: [],
                columnConfigs: [],
                draggedColumnKey: "",
                inputSectionCollapsed: false,
                previewSectionCollapsed: false,
                outputSectionCollapsed: false,
                sidebarOpen: true,
                sidebarWidth: 340,
                bulkHeaderRenameMode: "snake_case",
                bulkHeaderRenamePrefix: "",
                bulkHeaderRenameSuffix: "",
                previewSearch: "",
                previewPage: 1,
                previewPageSize: 50,
                previewSortColumnKey: "",
                previewSortDirection: "none",
                copyFeedback: "",
                toasts: [],
                lastAutoCopiedOutput: ""
            };

            const state = reactive(loadPreferences(defaultState));

            watch(function () {
                return state.theme;
            }, function (theme) {
                document.documentElement.setAttribute("data-theme", theme);
            }, { immediate: true });

            watch(function () {
                return {
                    theme: state.theme,
                    inputFormat: state.inputFormat,
                    delimiter: state.delimiter,
                    decimalSign: state.decimalSign,
                    firstRowIsHeader: state.firstRowIsHeader,
                    headerTransform: state.headerTransform,
                    outputFormat: state.outputFormat,
                    xmlRootTagName: state.xmlRootTagName,
                    xmlRowTagName: state.xmlRowTagName,
                    sqlTableName: state.sqlTableName,
                    sqlAddCreateTable: state.sqlAddCreateTable,
                    sqlAddIdentityInsert: state.sqlAddIdentityInsert,
                    sqlAddTransaction: state.sqlAddTransaction,
                    sqlAddTruncate: state.sqlAddTruncate,
                    sqlConvertEmptyToNull: state.sqlConvertEmptyToNull,
                    autoCopyOutput: state.autoCopyOutput,
                    inputSectionCollapsed: state.inputSectionCollapsed,
                    previewSectionCollapsed: state.previewSectionCollapsed,
                    outputSectionCollapsed: state.outputSectionCollapsed,
                    sidebarOpen: state.sidebarOpen,
                    sidebarWidth: state.sidebarWidth,
                    bulkHeaderRenameMode: state.bulkHeaderRenameMode,
                    bulkHeaderRenamePrefix: state.bulkHeaderRenamePrefix,
                    bulkHeaderRenameSuffix: state.bulkHeaderRenameSuffix
                };
            }, function (preferences) {
                window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
            }, { deep: true });

            const statusMessage = computed(function () {
                if (!state.input.trim()) {
                    return {
                        tone: "info",
                        text: "Cole dados do Excel, CSV ou TSV no campo Input para gerar a saida."
                    };
                }

                const currentInputFormat = inputFormats.find(function (format) {
                    return format.value === state.inputFormat;
                });
                const delimiterLabel = state.delimiter === "tab"
                    ? "Tab"
                    : state.delimiter === "comma"
                        ? "Comma"
                        : "Auto";
                return {
                    tone: "info",
                    text: "Input: " + (currentInputFormat ? currentInputFormat.label : state.inputFormat) + ". Delimitador em uso: " + delimiterLabel + "."
                };
            });

            const parsedInputResult = computed(function () {
                if (!state.input.trim()) {
                    return {
                        data: {
                            headers: [],
                            dataRows: []
                        },
                        error: ""
                    };
                }

                const parser = inputParsers[state.inputFormat];
                if (!parser) {
                    return {
                        data: {
                            headers: [],
                            dataRows: []
                        },
                        error: "Formato de input nao suportado."
                    };
                }

                try {
                    return {
                        data: parser({
                            input: state.input,
                            state: state,
                            utils: {
                                buildDefaultHeaders: buildDefaultHeaders,
                                normalizeHeader: normalizeHeader
                            }
                        }),
                        error: ""
                    };
                } catch (error) {
                    return {
                        data: {
                            headers: [],
                            dataRows: []
                        },
                        error: error && error.message ? error.message : "Erro ao ler o input."
                    };
                }
            });

            const inputFormatError = computed(function () {
                return parsedInputResult.value.error;
            });

            watch(function () {
                return inputFormatError.value;
            }, function (message, previousMessage) {
                if (message && message !== previousMessage) {
                    pushToast(message, "danger");
                }
            });

            watch(function () {
                return parsedInputResult.value;
            }, function (result) {
                const data = result.data || { headers: [], dataRows: [] };
                state.standardHeaders = data.headers.slice();
                state.standardRows = cloneRows(data.dataRows);
                state.standardColumnKeys = createColumnKeys(data.headers.length);
                state.standardRowKeys = createRowKeys(data.dataRows.length);
                state.previewPage = 1;
            }, { immediate: true });

            const standardObject = computed(function () {
                return {
                    headers: state.standardHeaders,
                    dataRows: state.standardRows
                };
            });

            const previewRows = computed(function () {
                return standardObject.value.dataRows;
            });

            const availableRows = computed(function () {
                return state.standardRowKeys.map(function (key, index) {
                    return {
                        key: key,
                        rowIndex: index,
                        row: state.standardRows[index] || []
                    };
                });
            });

            const previewMeta = computed(function () {
                const rowCount = standardObject.value.dataRows.length;
                const columnCount = standardObject.value.headers.length;

                if (!rowCount && !columnCount) {
                    return "Sem dados carregados.";
                }

                if (rowCount > previewRows.value.length) {
                    return "Exibindo " + previewRows.value.length + " de " + rowCount + " linhas e " + columnCount + " colunas.";
                }

                return rowCount + " linhas e " + columnCount + " colunas.";
            });

            const filteredPreviewRows = computed(function () {
                const search = state.previewSearch.trim().toLowerCase();
                let rows = availableRows.value;

                if (search) {
                    rows = rows.filter(function (rowItem) {
                        return rowItem.row.some(function (cell) {
                            return String(cell === undefined || cell === null ? "" : cell)
                                .toLowerCase()
                                .indexOf(search) !== -1;
                        });
                    });
                }

                if (state.previewSortDirection === "none" || !state.previewSortColumnKey) {
                    return rows;
                }

                const sortColumnIndex = state.standardColumnKeys.indexOf(state.previewSortColumnKey);
                if (sortColumnIndex === -1) {
                    return rows;
                }

                return rows.slice().sort(function (left, right) {
                    const leftValue = String(left.row[sortColumnIndex] === undefined || left.row[sortColumnIndex] === null ? "" : left.row[sortColumnIndex]).toLowerCase();
                    const rightValue = String(right.row[sortColumnIndex] === undefined || right.row[sortColumnIndex] === null ? "" : right.row[sortColumnIndex]).toLowerCase();

                    if (leftValue < rightValue) {
                        return state.previewSortDirection === "asc" ? -1 : 1;
                    }

                    if (leftValue > rightValue) {
                        return state.previewSortDirection === "asc" ? 1 : -1;
                    }

                    return 0;
                });
            });

            const previewPageCount = computed(function () {
                if (!filteredPreviewRows.value.length) {
                    return 1;
                }

                return Math.max(1, Math.ceil(filteredPreviewRows.value.length / state.previewPageSize));
            });

            const paginatedPreviewRows = computed(function () {
                const safePage = Math.min(state.previewPage, previewPageCount.value);
                const start = (safePage - 1) * state.previewPageSize;
                return filteredPreviewRows.value.slice(start, start + state.previewPageSize);
            });

            const previewRangeLabel = computed(function () {
                if (!filteredPreviewRows.value.length) {
                    return "0 de 0 linhas";
                }

                const start = ((Math.min(state.previewPage, previewPageCount.value) - 1) * state.previewPageSize) + 1;
                const end = Math.min(start + state.previewPageSize - 1, filteredPreviewRows.value.length);
                return start + "-" + end + " de " + filteredPreviewRows.value.length + " linhas";
            });

            const availableColumns = computed(function () {
                return standardObject.value.headers.map(function (header, index) {
                    return {
                        key: state.standardColumnKeys[index] || ("stdcol_fallback_" + index),
                        header: header,
                        sourceIndex: index
                    };
                });
            });

            watch(availableColumns, function (nextColumns) {
                const previousByKey = state.columnConfigs.reduce(function (accumulator, column) {
                    accumulator[column.key] = column;
                    return accumulator;
                }, {});

                const nextByKey = nextColumns.reduce(function (accumulator, column) {
                    accumulator[column.key] = column;
                    return accumulator;
                }, {});

                const preservedColumns = state.columnConfigs
                    .filter(function (column) {
                        return Object.prototype.hasOwnProperty.call(nextByKey, column.key);
                    })
                    .map(function (column) {
                        const nextColumn = nextByKey[column.key];
                        return {
                            key: nextColumn.key,
                            header: nextColumn.header,
                            sourceIndex: nextColumn.sourceIndex,
                            enabled: column.enabled,
                            outputName: column.outputName,
                            sqlType: column.sqlType,
                            avroType: column.avroType
                        };
                    });

                const newColumns = nextColumns
                    .filter(function (column) {
                        return !Object.prototype.hasOwnProperty.call(previousByKey, column.key);
                    })
                    .map(function (column) {
                        const previous = previousByKey[column.key];
                        return {
                            key: column.key,
                            header: column.header,
                            sourceIndex: column.sourceIndex,
                            enabled: previous ? previous.enabled : true,
                            outputName: previous ? previous.outputName : column.header,
                            sqlType: previous ? previous.sqlType : "",
                            avroType: previous ? previous.avroType : ""
                        };
                    });

                state.columnConfigs = preservedColumns.concat(newColumns).map(function (column) {
                    return {
                        key: column.key,
                        header: column.header,
                        sourceIndex: column.sourceIndex,
                        enabled: column.enabled,
                        outputName: column.outputName || column.header,
                        sqlType: column.sqlType || "",
                        avroType: column.avroType || ""
                    };
                });
            }, { immediate: true });

            watch(availableRows, function (nextRows) {
                const previousByKey = state.rowConfigs.reduce(function (accumulator, rowConfig) {
                    accumulator[rowConfig.key] = rowConfig;
                    return accumulator;
                }, {});

                state.rowConfigs = nextRows.map(function (row) {
                    const previous = previousByKey[row.key];
                    return {
                        key: row.key,
                        enabled: previous ? previous.enabled : true
                    };
                });
            }, { immediate: true });

            const duplicateHeaders = computed(function () {
                const counts = standardObject.value.headers.reduce(function (accumulator, header) {
                    const token = normalizeHeaderToken(header);
                    if (!token) {
                        return accumulator;
                    }

                    accumulator[token] = accumulator[token] || {
                        name: String(header),
                        count: 0
                    };
                    accumulator[token].count += 1;
                    return accumulator;
                }, {});

                return Object.keys(counts)
                    .map(function (key) {
                        return counts[key];
                    })
                    .filter(function (entry) {
                        return entry.count > 1;
                    });
            });

            const duplicateHeaderMessage = computed(function () {
                if (!duplicateHeaders.value.length) {
                    return "";
                }

                return "Colunas duplicadas detectadas: " + duplicateHeaders.value.map(function (entry) {
                    return entry.name;
                }).join(", ") + ".";
            });

            const selectedColumns = computed(function () {
                return state.columnConfigs.filter(function (column) {
                    return column.enabled;
                });
            });

            const selectedRows = computed(function () {
                return availableRows.value.filter(function (row) {
                    const rowConfig = state.rowConfigs.find(function (item) {
                        return item.key === row.key;
                    });
                    return !rowConfig || rowConfig.enabled;
                });
            });

            const orderedHeaders = computed(function () {
                return selectedColumns.value.map(function (column) {
                    return column.outputName || column.header;
                });
            });

            const orderedColumns = computed(function () {
                return selectedColumns.value.map(function (column) {
                    return {
                        key: column.key,
                        header: column.header,
                        outputName: column.outputName || column.header,
                        sourceIndex: column.sourceIndex,
                        sqlType: column.sqlType,
                        avroType: column.avroType
                    };
                });
            });

            const orderedRows = computed(function () {
                return selectedRows.value.map(function (rowItem) {
                    const row = rowItem.row;
                    return selectedColumns.value.map(function (column) {
                        return column.sourceIndex < row.length ? row[column.sourceIndex] : "";
                    });
                });
            });

            const isXmlOutput = computed(function () {
                const selectedFormat = outputFormats.find(function (format) {
                    return format.value === state.outputFormat;
                });
                return !!(selectedFormat && selectedFormat.controls && selectedFormat.controls.xml);
            });

            const isSqlOutput = computed(function () {
                const selectedFormat = outputFormats.find(function (format) {
                    return format.value === state.outputFormat;
                });
                return !!(selectedFormat && selectedFormat.controls && selectedFormat.controls.sql);
            });

            const showDefaultInputConfig = computed(function () {
                return state.inputFormat === "input-default";
            });

            const showColumnTypeControl = computed(function () {
                const selectedFormat = outputFormats.find(function (format) {
                    return format.value === state.outputFormat;
                });
                return !!(selectedFormat && selectedFormat.controls && selectedFormat.controls.types);
            });

            const currentTypeFieldKey = computed(function () {
                if (state.outputFormat === "sql") {
                    return "sqlType";
                }

                if (state.outputFormat === "avro") {
                    return "avroType";
                }

                return "";
            });

            const currentTypeOptions = computed(function () {
                if (state.outputFormat === "sql") {
                    return [
                        { value: "", label: "Auto" },
                        { value: "INT", label: "INT" },
                        { value: "DECIMAL(18,6)", label: "DECIMAL(18,6)" },
                        { value: "VARCHAR(255)", label: "VARCHAR(255)" },
                        { value: "TEXT", label: "TEXT" },
                        { value: "DATE", label: "DATE" },
                        { value: "DATETIME", label: "DATETIME" },
                        { value: "BOOLEAN", label: "BOOLEAN" }
                    ];
                }

                if (state.outputFormat === "avro") {
                    return [
                        { value: "", label: "Auto" },
                        { value: "string", label: "string" },
                        { value: "int", label: "int" },
                        { value: "long", label: "long" },
                        { value: "float", label: "float" },
                        { value: "double", label: "double" },
                        { value: "boolean", label: "boolean" },
                        { value: "bytes", label: "bytes" }
                    ];
                }

                return [];
            });

            const output = computed(function () {
                if (!state.input.trim()) {
                    return "";
                }

                if (inputFormatError.value) {
                    return "";
                }

                try {
                    if (!standardObject.value.dataRows.length && !standardObject.value.headers.length) {
                        return "";
                    }

                    return buildOutput(
                        state.outputFormat,
                        orderedHeaders.value,
                        orderedRows.value,
                        {
                            columns: orderedColumns.value,
                            sqlTableName: state.sqlTableName,
                            addCreateTable: state.sqlAddCreateTable,
                            addIdentityInsert: state.sqlAddIdentityInsert,
                            addTransaction: state.sqlAddTransaction,
                            addTruncate: state.sqlAddTruncate,
                            convertEmptyToNull: state.sqlConvertEmptyToNull,
                            xmlRootTagName: state.xmlRootTagName,
                            xmlRowTagName: state.xmlRowTagName
                        }
                    );
                } catch (error) {
                    return "Erro ao converter: " + error.message;
                }
            });

            const visibleOutput = computed(function () {
                if (state.autoCopyOutput) {
                    return "";
                }

                return output.value;
            });

            async function writeToClipboard(text) {
                if (!text) {
                    state.copyFeedback = "Sem conteudo";
                    pushToast("Nao ha conteudo para copiar.", "warning");
                    return;
                }

                try {
                    await navigator.clipboard.writeText(text);
                    state.copyFeedback = "Copiado";
                    pushToast(
                        state.autoCopyOutput
                            ? "Conversao concluida e copiada para a area de transferencia."
                            : "Resultado copiado para a area de transferencia.",
                        "success"
                    );
                } catch (_error) {
                    state.copyFeedback = "Falha ao copiar";
                    pushToast("Falha ao copiar para a area de transferencia.", "danger");
                }

                window.setTimeout(function () {
                    state.copyFeedback = "";
                }, 1600);
            }

            function downloadOutput() {
                const content = output.value;
                if (!content) {
                    pushToast("Nao ha conteudo para baixar.", "warning");
                    return;
                }

                const extension = getOutputFileExtension(state.outputFormat);
                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");

                link.href = url;
                link.download = "excelconverter-output." + extension;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                pushToast("Arquivo gerado para download.", "success");
            }

            watch(function () {
                return {
                    autoCopyOutput: state.autoCopyOutput,
                    output: output.value
                };
            }, function (current) {
                if (!current.autoCopyOutput) {
                    state.lastAutoCopiedOutput = "";
                    return;
                }

                if (current.output && current.output !== state.lastAutoCopiedOutput) {
                    state.lastAutoCopiedOutput = current.output;
                    writeToClipboard(current.output);
                }
            });

            watch(function () {
                return state.autoCopyOutput;
            }, function (enabled, previousEnabled) {
                if (enabled === previousEnabled) {
                    return;
                }

                pushToast(
                    enabled
                        ? "Auto copia ativada. Novas conversoes serao enviadas direto para a area de transferencia."
                        : "Auto copia desativada. O resultado volta a ser exibido no textarea.",
                    "info"
                );
            });

            watch(function () {
                return state.previewSearch;
            }, function () {
                state.previewPage = 1;
            });

            watch(function () {
                return previewPageCount.value;
            }, function (count) {
                if (state.previewPage > count) {
                    state.previewPage = count;
                }
            });

            watch(function () {
                return duplicateHeaderMessage.value;
            }, function (message, previousMessage) {
                if (message && message !== previousMessage) {
                    pushToast(message, "warning");
                }
            });

            function pushToast(message, tone) {
                const id = Date.now() + Math.random();
                state.toasts.push({
                    id: id,
                    message: message,
                    tone: tone || "info"
                });

                window.setTimeout(function () {
                    dismissToast(id);
                }, 2600);
            }

            function dismissToast(toastId) {
                const toastIndex = state.toasts.findIndex(function (toast) {
                    return toast.id === toastId;
                });

                if (toastIndex !== -1) {
                    state.toasts.splice(toastIndex, 1);
                }
            }

            function syncColumnConfigOrderWithStandard() {
                const configByKey = state.columnConfigs.reduce(function (accumulator, column) {
                    accumulator[column.key] = column;
                    return accumulator;
                }, {});

                state.columnConfigs = state.standardColumnKeys.map(function (key, index) {
                    const existing = configByKey[key];
                    return existing || {
                        key: key,
                        header: state.standardHeaders[index],
                        sourceIndex: index,
                        enabled: true,
                        outputName: state.standardHeaders[index],
                        sqlType: "",
                        avroType: ""
                    };
                });
            }

            function syncOutputNameForHeader(columnIndex, nextHeader, previousHeader) {
                const columnKey = state.standardColumnKeys[columnIndex];
                const targetColumn = state.columnConfigs.find(function (column) {
                    return column.key === columnKey;
                });

                if (targetColumn) {
                    targetColumn.header = nextHeader;
                    if (!targetColumn.outputName || targetColumn.outputName === previousHeader) {
                        targetColumn.outputName = nextHeader;
                    }
                }
            }

            function updateStandardHeader(columnIndex, nextHeader) {
                if (columnIndex < 0 || columnIndex >= state.standardHeaders.length) {
                    return;
                }

                const previousHeader = state.standardHeaders[columnIndex];
                state.standardHeaders[columnIndex] = nextHeader;
                syncOutputNameForHeader(columnIndex, nextHeader, previousHeader);
            }

            function updateStandardCell(rowIndex, columnIndex, nextValue) {
                if (rowIndex < 0 || rowIndex >= state.standardRows.length) {
                    return;
                }

                while (state.standardRows[rowIndex].length < state.standardHeaders.length) {
                    state.standardRows[rowIndex].push("");
                }

                state.standardRows[rowIndex][columnIndex] = nextValue;
            }

            function addStandardRow() {
                state.standardRows.push(Array.from({ length: state.standardHeaders.length }, function () {
                    return "";
                }));
                state.standardRowKeys.push(createRowKey());
                state.rowConfigs.push({
                    key: state.standardRowKeys[state.standardRowKeys.length - 1],
                    enabled: true
                });
            }

            function toggleStandardRowVisibility(rowIndex) {
                if (rowIndex < 0 || rowIndex >= state.standardRows.length) {
                    return;
                }

                const rowKey = state.standardRowKeys[rowIndex];
                const targetConfig = state.rowConfigs.find(function (rowConfig) {
                    return rowConfig.key === rowKey;
                });

                if (targetConfig) {
                    targetConfig.enabled = !targetConfig.enabled;
                }
            }

            function isStandardRowVisible(rowIndex) {
                const rowKey = state.standardRowKeys[rowIndex];
                const targetConfig = state.rowConfigs.find(function (rowConfig) {
                    return rowConfig.key === rowKey;
                });

                return targetConfig ? targetConfig.enabled : true;
            }

            function moveStandardRow(rowIndex, direction) {
                const targetIndex = rowIndex + direction;
                if (
                    rowIndex < 0
                    || rowIndex >= state.standardRows.length
                    || targetIndex < 0
                    || targetIndex >= state.standardRows.length
                ) {
                    return;
                }

                const movedRow = state.standardRows.splice(rowIndex, 1)[0];
                const movedRowKey = state.standardRowKeys.splice(rowIndex, 1)[0];
                const movedRowConfig = state.rowConfigs.splice(rowIndex, 1)[0];
                state.standardRows.splice(targetIndex, 0, movedRow);
                state.standardRowKeys.splice(targetIndex, 0, movedRowKey);
                state.rowConfigs.splice(targetIndex, 0, movedRowConfig);
            }

            function startPreviewRowDrag(rowIndex) {
                draggedPreviewRowIndex = rowIndex;
            }

            function dropPreviewRow(targetRowIndex) {
                if (
                    draggedPreviewRowIndex < 0
                    || targetRowIndex < 0
                    || draggedPreviewRowIndex === targetRowIndex
                ) {
                    draggedPreviewRowIndex = -1;
                    return;
                }

                const movedRow = state.standardRows.splice(draggedPreviewRowIndex, 1)[0];
                const movedRowKey = state.standardRowKeys.splice(draggedPreviewRowIndex, 1)[0];
                const movedRowConfig = state.rowConfigs.splice(draggedPreviewRowIndex, 1)[0];
                state.standardRows.splice(targetRowIndex, 0, movedRow);
                state.standardRowKeys.splice(targetRowIndex, 0, movedRowKey);
                state.rowConfigs.splice(targetRowIndex, 0, movedRowConfig);
                draggedPreviewRowIndex = -1;
            }

            function endPreviewRowDrag() {
                draggedPreviewRowIndex = -1;
            }

            function addStandardColumn() {
                const nextIndex = state.standardHeaders.length;
                const nextHeader = "Col" + (nextIndex + 1);

                state.standardHeaders.push(nextHeader);
                state.standardColumnKeys.push(createColumnKey());
                state.standardRows.forEach(function (row) {
                    row.push("");
                });
            }

            function moveStandardColumnByKey(draggedKey, targetKey) {
                if (!draggedKey || !targetKey || draggedKey === targetKey) {
                    return;
                }

                const draggedIndex = state.standardColumnKeys.indexOf(draggedKey);
                const targetIndex = state.standardColumnKeys.indexOf(targetKey);
                if (draggedIndex === -1 || targetIndex === -1) {
                    return;
                }

                const movedHeader = state.standardHeaders.splice(draggedIndex, 1)[0];
                const movedKey = state.standardColumnKeys.splice(draggedIndex, 1)[0];
                state.standardHeaders.splice(targetIndex, 0, movedHeader);
                state.standardColumnKeys.splice(targetIndex, 0, movedKey);
                state.standardRows.forEach(function (row) {
                    const movedCell = row.splice(draggedIndex, 1)[0];
                    row.splice(targetIndex, 0, movedCell);
                });
                syncColumnConfigOrderWithStandard();
            }

            function startPreviewColumnDrag(columnKey) {
                draggedPreviewColumnKey = columnKey;
            }

            function dropPreviewColumn(targetColumnKey) {
                moveStandardColumnByKey(draggedPreviewColumnKey, targetColumnKey);
                draggedPreviewColumnKey = "";
            }

            function endPreviewColumnDrag() {
                draggedPreviewColumnKey = "";
            }

            function toggleStandardColumnVisibility(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                const targetColumn = state.columnConfigs.find(function (column) {
                    return column.key === columnKey;
                });

                if (targetColumn) {
                    targetColumn.enabled = !targetColumn.enabled;
                }
            }

            function isStandardColumnVisible(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                const targetColumn = state.columnConfigs.find(function (column) {
                    return column.key === columnKey;
                });

                return targetColumn ? targetColumn.enabled : true;
            }

            function applyBulkHeaderRename() {
                if (!state.standardHeaders.length) {
                    pushToast("Nao ha colunas para renomear.", "warning");
                    return;
                }

                state.standardHeaders = state.standardHeaders.map(function (header, index) {
                    const previousHeader = header;
                    const transformed = transformHeaderByMode(header, state.bulkHeaderRenameMode);
                    const nextHeader = state.bulkHeaderRenamePrefix + transformed + state.bulkHeaderRenameSuffix;
                    syncOutputNameForHeader(index, nextHeader, previousHeader);
                    return nextHeader;
                });

                pushToast("Renomeacao em massa aplicada nas colunas.", "success");
            }

            function dedupeStandardHeaders() {
                const counts = {};

                state.standardHeaders = state.standardHeaders.map(function (header, index) {
                    const token = normalizeHeaderToken(header) || ("col" + (index + 1));
                    counts[token] = (counts[token] || 0) + 1;
                    if (counts[token] === 1) {
                        return header;
                    }

                    const nextHeader = String(header || ("Col" + (index + 1))) + "_" + counts[token];
                    syncOutputNameForHeader(index, nextHeader, header);
                    return nextHeader;
                });

                pushToast("Colunas duplicadas foram ajustadas.", "success");
            }

            function moveColumn(draggedKey, targetKey) {
                if (!draggedKey || !targetKey || draggedKey === targetKey) {
                    return;
                }

                const draggedIndex = state.columnConfigs.findIndex(function (column) {
                    return column.key === draggedKey;
                });
                const targetIndex = state.columnConfigs.findIndex(function (column) {
                    return column.key === targetKey;
                });

                if (draggedIndex === -1 || targetIndex === -1) {
                    return;
                }

                const movedColumn = state.columnConfigs.splice(draggedIndex, 1)[0];
                state.columnConfigs.splice(targetIndex, 0, movedColumn);

                const standardDraggedIndex = state.standardColumnKeys.indexOf(draggedKey);
                const standardTargetIndex = state.standardColumnKeys.indexOf(targetKey);
                if (standardDraggedIndex !== -1 && standardTargetIndex !== -1) {
                    const movedHeader = state.standardHeaders.splice(standardDraggedIndex, 1)[0];
                    const movedKey = state.standardColumnKeys.splice(standardDraggedIndex, 1)[0];
                    state.standardHeaders.splice(standardTargetIndex, 0, movedHeader);
                    state.standardColumnKeys.splice(standardTargetIndex, 0, movedKey);
                    state.standardRows.forEach(function (row) {
                        const movedCell = row.splice(standardDraggedIndex, 1)[0];
                        row.splice(standardTargetIndex, 0, movedCell);
                    });
                }
            }

            function startColumnDrag(columnKey) {
                state.draggedColumnKey = columnKey;
            }

            function dropColumn(columnKey) {
                moveColumn(state.draggedColumnKey, columnKey);
                state.draggedColumnKey = "";
            }

            function endColumnDrag() {
                state.draggedColumnKey = "";
            }

            function toggleSection(sectionName) {
                if (sectionName === "input") {
                    state.inputSectionCollapsed = !state.inputSectionCollapsed;
                    return;
                }

                if (sectionName === "preview") {
                    state.previewSectionCollapsed = !state.previewSectionCollapsed;
                    return;
                }

                if (sectionName === "output") {
                    state.outputSectionCollapsed = !state.outputSectionCollapsed;
                }
            }

            function toggleMainAccordion(sectionName) {
                const nextInput = sectionName === "input" ? !state.inputSectionCollapsed : true;
                const nextPreview = sectionName === "preview" ? !state.previewSectionCollapsed : true;
                const nextOutput = sectionName === "output" ? !state.outputSectionCollapsed : true;

                state.inputSectionCollapsed = nextInput;
                state.previewSectionCollapsed = nextPreview;
                state.outputSectionCollapsed = nextOutput;
            }

            function toggleSidebar() {
                state.sidebarOpen = !state.sidebarOpen;
            }

            function cyclePreviewSort(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                if (state.previewSortColumnKey !== columnKey) {
                    state.previewSortColumnKey = columnKey;
                    state.previewSortDirection = "asc";
                    state.previewPage = 1;
                    return;
                }

                if (state.previewSortDirection === "none") {
                    state.previewSortDirection = "asc";
                } else if (state.previewSortDirection === "asc") {
                    state.previewSortDirection = "desc";
                } else {
                    state.previewSortDirection = "none";
                    state.previewSortColumnKey = "";
                }

                state.previewPage = 1;
            }

            function getPreviewSortIcon(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                if (state.previewSortColumnKey !== columnKey || state.previewSortDirection === "none") {
                    return "fas fa-sort";
                }

                return state.previewSortDirection === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
            }

            function startSidebarResize(event) {
                event.preventDefault();
                isSidebarResizing = true;

                function onMove(moveEvent) {
                    if (!isSidebarResizing) {
                        return;
                    }

                    state.sidebarWidth = Math.max(280, Math.min(520, moveEvent.clientX));
                }

                function onUp() {
                    isSidebarResizing = false;
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                }

                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
            }

            function toggleTheme() {
                state.theme = state.theme === "light" ? "dark" : "light";
            }

            function copyOutput() {
                writeToClipboard(output.value);
            }

            function goToPreviewPage(page) {
                state.previewPage = Math.max(1, Math.min(previewPageCount.value, page));
            }

            return {
                state,
                statusMessage,
                inputFormatError,
                standardObject,
                previewRows,
                previewMeta,
                paginatedPreviewRows,
                previewPageCount,
                previewRangeLabel,
                duplicateHeaders,
                duplicateHeaderMessage,
                output,
                visibleOutput,
                isXmlOutput,
                isSqlOutput,
                showDefaultInputConfig,
                showColumnTypeControl,
                currentTypeFieldKey,
                currentTypeOptions,
                inputFormats,
                inputConfig,
                outputFormats,
                startColumnDrag,
                dropColumn,
                endColumnDrag,
                startPreviewRowDrag,
                dropPreviewRow,
                endPreviewRowDrag,
                startPreviewColumnDrag,
                dropPreviewColumn,
                endPreviewColumnDrag,
                toggleSection,
                toggleMainAccordion,
                toggleSidebar,
                cyclePreviewSort,
                getPreviewSortIcon,
                startSidebarResize,
                toggleTheme,
                updateStandardHeader,
                updateStandardCell,
                addStandardRow,
                toggleStandardRowVisibility,
                isStandardRowVisible,
                moveStandardRow,
                addStandardColumn,
                toggleStandardColumnVisibility,
                isStandardColumnVisible,
                applyBulkHeaderRename,
                dedupeStandardHeaders,
                copyOutput,
                downloadOutput,
                goToPreviewPage,
                dismissToast
            };
        },
        template: `
            <div class="app-wrap container-fluid">
                <nav class="topbar">
                    <div class="topbar-brand">
                        <i class="fas fa-table" aria-hidden="true"></i>
                        <span>ExcelConverter</span>
                    </div>
                    <button class="theme-toggle" type="button" @click="toggleTheme" :title="state.theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'">
                        <i :class="state.theme === 'light' ? 'fas fa-moon-stars' : 'fas fa-sun'" aria-hidden="true"></i>
                    </button>
                </nav>

                <div class="toast-stack">
                    <div
                        v-for="toast in state.toasts"
                        :key="toast.id"
                        class="toast-item"
                        :class="'toast-' + toast.tone"
                    >
                        <div class="d-flex align-items-start gap-3">
                            <i
                                :class="toast.tone === 'success' ? 'fas fa-check-circle' : toast.tone === 'danger' ? 'fas fa-exclamation-circle' : toast.tone === 'warning' ? 'fas fa-exclamation-triangle' : 'fas fa-info-circle'"
                                aria-hidden="true"
                            ></i>
                            <div class="flex-grow-1 small">{{ toast.message }}</div>
                            <button class="toast-close" type="button" @click="dismissToast(toast.id)" aria-label="Fechar">
                                <i class="fas fa-times" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="workspace-body">
                    <button class="sidebar-floating-toggle" type="button" @click="toggleSidebar" :title="state.sidebarOpen ? 'Ocultar configuracoes' : 'Exibir configuracoes'">
                        <i class="fas fa-sliders-h" aria-hidden="true"></i>
                    </button>

                    <aside v-show="state.sidebarOpen" class="sidebar-shell" :style="{ width: state.sidebarWidth + 'px' }">
                        <div class="sidebar-card h-100">
                            <div class="sidebar-accent"></div>
                            <button class="sidebar-collapse-btn" type="button" @click="toggleSidebar" title="Ocultar configuracoes">
                                <i class="fas fa-chevron-left" aria-hidden="true"></i>
                            </button>
                            <div class="card-body p-4 sidebar-scroll">
                                <div class="sidebar-title mb-3">Configuracao</div>

                                <div class="border rounded-4 p-3 mb-4 bg-white bg-opacity-50">
                                    <button class="config-section-toggle" type="button" @click="toggleSection('input')">
                                        <div class="d-flex align-items-center justify-content-between gap-3">
                                            <div class="editor-label mb-0">Input</div>
                                            <i class="fas fa-chevron-down config-section-chevron" :class="{ 'is-collapsed': state.inputSectionCollapsed }" aria-hidden="true"></i>
                                        </div>
                                    </button>

                                    <div v-show="!state.inputSectionCollapsed" class="mt-3">
                                        <div v-if="showDefaultInputConfig">
                                            <div
                                                v-for="field in inputConfig"
                                                :key="field.id"
                                                :class="field.type === 'checkbox' ? 'form-check form-switch mb-3' : 'mb-3'"
                                            >
                                                <template v-if="field.type === 'select'">
                                                    <label :for="field.id" class="form-label fw-semibold">{{ field.label }}</label>
                                                    <select :id="field.id" class="form-select form-select-sm" v-model="state[field.id]">
                                                        <option v-for="option in field.options" :key="option.value" :value="option.value">
                                                            {{ option.label }}
                                                        </option>
                                                    </select>
                                                </template>

                                                <template v-else-if="field.type === 'checkbox'">
                                                    <input :id="field.id" class="form-check-input" type="checkbox" role="switch" v-model="state[field.id]">
                                                    <label class="form-check-label fw-semibold" :for="field.id">{{ field.label }}</label>
                                                </template>
                                            </div>
                                        </div>

                                        <div v-else class="small text-secondary">
                                            Este formato de input nao usa as configuracoes de delimiter, decimal sign e header.
                                        </div>
                                    </div>
                                </div>

                                <div class="border rounded-4 p-3 mb-4 bg-white bg-opacity-50">
                                    <button class="config-section-toggle" type="button" @click="toggleSection('output')">
                                        <div class="d-flex align-items-center justify-content-between gap-3">
                                            <div class="editor-label mb-0">Output</div>
                                            <i class="fas fa-chevron-down config-section-chevron" :class="{ 'is-collapsed': state.outputSectionCollapsed }" aria-hidden="true"></i>
                                        </div>
                                    </button>

                                    <div v-show="!state.outputSectionCollapsed" class="mt-3">
                                        <div class="mb-4">
                                            <label class="form-label fw-semibold">Renomeacao em massa</label>
                                            <div class="row g-2">
                                                <div class="col-12">
                                                    <select class="form-select form-select-sm" v-model="state.bulkHeaderRenameMode">
                                                        <option value="keep">Manter texto</option>
                                                        <option value="uppercase">UPPERCASE</option>
                                                        <option value="lowercase">lowercase</option>
                                                        <option value="snake_case">snake_case</option>
                                                        <option value="camelCase">camelCase</option>
                                                        <option value="remove-spaces">Remover espacos</option>
                                                        <option value="remove-accents">Remover acentos</option>
                                                    </select>
                                                </div>
                                                <div class="col-6">
                                                    <input class="form-control form-control-sm" v-model="state.bulkHeaderRenamePrefix" placeholder="Prefixo">
                                                </div>
                                                <div class="col-6">
                                                    <input class="form-control form-control-sm" v-model="state.bulkHeaderRenameSuffix" placeholder="Sufixo">
                                                </div>
                                                <div class="col-12 d-grid">
                                                    <button class="btn btn-outline-primary btn-sm" type="button" @click="applyBulkHeaderRename">
                                                        <i class="fas fa-text-width me-2" aria-hidden="true"></i>Aplicar nas colunas
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="mb-3">
                                            <label class="form-label fw-semibold">Colunas</label>
                                            <div class="small text-secondary mb-2">Marque para incluir no resultado e arraste para reordenar.</div>
                                            <div v-if="state.columnConfigs.length" class="d-grid gap-2">
                                                <div
                                                    v-for="column in state.columnConfigs"
                                                    :key="column.key"
                                                    class="column-item d-flex align-items-center gap-2 border rounded-3 px-2 py-2 bg-body"
                                                    draggable="true"
                                                    @dragstart="startColumnDrag(column.key)"
                                                    @dragover.prevent
                                                    @drop.prevent="dropColumn(column.key)"
                                                    @dragend="endColumnDrag"
                                                >
                                                    <span class="column-grip text-secondary" title="Arrastar">::</span>
                                                    <input :id="'column-' + column.key" class="form-check-input mt-0" type="checkbox" v-model="column.enabled">
                                                    <div class="flex-grow-1">
                                                        <label :for="'column-' + column.key" class="form-check-label small fw-semibold d-block mb-2">
                                                            {{ column.header }}
                                                        </label>
                                                        <div class="row g-2">
                                                            <div class="col-12" :class="showColumnTypeControl ? 'col-md-6' : 'col-md-12'">
                                                                <input
                                                                    class="form-control form-control-sm"
                                                                    type="text"
                                                                    v-model="column.outputName"
                                                                    placeholder="Nome da coluna no output"
                                                                >
                                                            </div>
                                                            <div v-if="showColumnTypeControl" class="col-12 col-md-6">
                                                                <select class="form-select form-select-sm" v-model="column[currentTypeFieldKey]">
                                                                    <option v-for="option in currentTypeOptions" :key="option.value" :value="option.value">
                                                                        {{ option.label }}
                                                                    </option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div v-else class="small text-secondary">Cole um texto no input para detectar as colunas.</div>
                                        </div>

                                        <div v-if="isXmlOutput" class="mb-3">
                                            <label for="xml-root-tag" class="form-label fw-semibold">Root Row Tag Name</label>
                                            <input id="xml-root-tag" class="form-control form-control-sm" v-model="state.xmlRootTagName" placeholder="rows">
                                        </div>

                                        <div v-if="isXmlOutput" class="mb-3">
                                            <label for="xml-row-tag" class="form-label fw-semibold">Row Tag Name</label>
                                            <input id="xml-row-tag" class="form-control form-control-sm" v-model="state.xmlRowTagName" placeholder="row">
                                        </div>

                                        <div v-if="isSqlOutput">
                                            <label for="sql-table-name" class="form-label fw-semibold">Tabela</label>
                                            <input id="sql-table-name" class="form-control form-control-sm" v-model="state.sqlTableName" placeholder="ExcelConverter">
                                        </div>

                                        <div v-if="isSqlOutput" class="form-check form-switch mt-3">
                                            <input id="sql-create-table" class="form-check-input" type="checkbox" role="switch" v-model="state.sqlAddCreateTable">
                                            <label class="form-check-label fw-semibold" for="sql-create-table">Adicionar CREATE TABLE</label>
                                        </div>

                                        <div v-if="isSqlOutput" class="form-check form-switch mt-3">
                                            <input id="sql-identity-insert" class="form-check-input" type="checkbox" role="switch" v-model="state.sqlAddIdentityInsert">
                                            <label class="form-check-label fw-semibold" for="sql-identity-insert">Adicionar IDENTITY_INSERT</label>
                                        </div>

                                        <div v-if="isSqlOutput" class="form-check form-switch mt-3">
                                            <input id="sql-transaction" class="form-check-input" type="checkbox" role="switch" v-model="state.sqlAddTransaction">
                                            <label class="form-check-label fw-semibold" for="sql-transaction">Adicionar TRANSACTION</label>
                                        </div>

                                        <div v-if="isSqlOutput" class="form-check form-switch mt-3">
                                            <input id="sql-truncate" class="form-check-input" type="checkbox" role="switch" v-model="state.sqlAddTruncate">
                                            <label class="form-check-label fw-semibold" for="sql-truncate">Adicionar TRUNCATE</label>
                                        </div>

                                        <div v-if="isSqlOutput" class="form-check form-switch mt-3">
                                            <input id="sql-empty-null" class="form-check-input" type="checkbox" role="switch" v-model="state.sqlConvertEmptyToNull">
                                            <label class="form-check-label fw-semibold" for="sql-empty-null">Converter valores vazios em NULL</label>
                                        </div>
                                    </div>
                                </div>

                            </div>
                            <div class="sidebar-resize-handle" @mousedown="startSidebarResize"></div>
                        </div>
                    </aside>

                    <main class="workspace-main">
                        <div class="row g-4">
                            <section class="col-12">
                                <div class="panel-card input-panel h-100">
                                    <div class="card-body p-4">
                                        <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
                                            <div>
                                                <div class="editor-label mb-1">Input</div>
                                                <h3 class="h5 mb-0">Texto de origem</h3>
                                            </div>
                                            <div class="d-flex align-items-center gap-2 col-12 col-sm-6 col-lg-7 col-xxl-6 px-0">
                                                <select class="form-select form-select-sm" v-model="state.inputFormat">
                                                    <option v-for="format in inputFormats" :key="format.value" :value="format.value">
                                                        {{ format.label }}
                                                    </option>
                                                </select>
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button"  @click="toggleSidebar" >
                                                    <i class="fas fa-cog" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleSection('input')">
                                                    <i :class="state.inputSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div v-show="!state.inputSectionCollapsed">
                                        <div
                                            class="status-chip mb-3"
                                            :class="inputFormatError ? 'error' : statusMessage.tone"
                                        >
                                            {{ inputFormatError || statusMessage.text }}
                                        </div>
                                        <textarea
                                            class="form-control editor-textarea"
                                            v-model="state.input"
                                            placeholder="Cole aqui dados copiados do Excel, CSV ou TSV"
                                            spellcheck="false"
                                        ></textarea>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section class="col-12">
                                <div class="panel-card preview-panel h-100">
                                    <div class="card-body p-4">
                                        <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                            <div>
                                                <div class="editor-label mb-1">Preview</div>
                                                <h3 class="h5 mb-0">Objeto padrao</h3>
                                            </div>
                                            <div class="d-flex align-items-center gap-2">
                                                <div class="small text-secondary">{{ previewMeta }}</div>
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button"  @click="toggleSidebar" >
                                                    <i class="fas fa-cog" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleSection('preview')">
                                                    <i :class="state.previewSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>

                                        <div v-show="!state.previewSectionCollapsed">

                                        
                                        <div v-if="duplicateHeaderMessage" class="status-chip warning mb-3 d-flex align-items-center justify-content-between gap-3 flex-wrap">
                                            <span>{{ duplicateHeaderMessage }}</span>
                                            <button class="btn btn-sm btn-outline-warning" type="button" @click="dedupeStandardHeaders">
                                                <i class="fas fa-magic me-2" aria-hidden="true"></i>Corrigir duplicadas
                                            </button>
                                        </div>

                                        <div v-if="standardObject.headers.length" class="preview-toolbar mb-3">
                                            <div class="input-group input-group-sm preview-search-group">
                                                <span class="input-group-text"><i class="fas fa-search" aria-hidden="true"></i></span>
                                                <input class="form-control" v-model="state.previewSearch" placeholder="Buscar nas linhas">
                                                <button class="btn btn-outline-primary" type="button" @click="addStandardColumn" title="Adicionar coluna">
                                                    <i class="fas fa-columns" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-outline-primary" type="button" @click="addStandardRow" title="Adicionar linha">
                                                    <i class="fas fa-plus" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                            <div class="preview-page-size">
                                                <select class="form-select form-select-sm" v-model.number="state.previewPageSize">
                                                    <option :value="10">10</option>
                                                    <option :value="25">25</option>
                                                    <option :value="50">50</option>
                                                    <option :value="100">100</option>
                                                </select>
                                                <span>linhas por pagina</span>
                                            </div>
                                        </div>

                                        <div v-if="standardObject.headers.length" class="preview-table-wrap">
                                            <table class="table table-sm align-middle mb-0 preview-table">
                                                <thead>
                                                    <tr>
                                                        <th class="preview-actions-col">Acoes</th>
                                                        <th v-for="(header, headerIndex) in standardObject.headers" :key="state.standardColumnKeys[headerIndex]">
                                                            <div
                                                                class="preview-header-cell"
                                                                draggable="true"
                                                                @dragstart="startPreviewColumnDrag(state.standardColumnKeys[headerIndex])"
                                                                @dragover.prevent
                                                                @drop.prevent="dropPreviewColumn(state.standardColumnKeys[headerIndex])"
                                                                @dragend="endPreviewColumnDrag"
                                                            >
                                                                <div class="input-group input-group-sm preview-column-group">
                                                                    <button
                                                                        class="btn btn-outline-secondary preview-handle-btn"
                                                                        type="button"
                                                                        title="Arrastar coluna"
                                                                    >
                                                                        <i class="fas fa-grip-vertical" aria-hidden="true"></i>
                                                                    </button>
                                                                    <input
                                                                        class="form-control form-control-sm preview-input"
                                                                        :value="header"
                                                                        @input="updateStandardHeader(headerIndex, $event.target.value)"
                                                                        placeholder="Nome da coluna"
                                                                    >
                                                                    <button class="btn btn-outline-secondary" type="button" @click="cyclePreviewSort(headerIndex)" title="Ordenar preview">
                                                                        <i :class="getPreviewSortIcon(headerIndex)" aria-hidden="true"></i>
                                                                    </button>
                                                                    <button
                                                                        class="btn"
                                                                        :class="isStandardColumnVisible(headerIndex) ? 'btn-outline-success' : 'btn-outline-secondary'"
                                                                        type="button"
                                                                        @click="toggleStandardColumnVisibility(headerIndex)"
                                                                        :title="isStandardColumnVisible(headerIndex) ? 'Ocultar coluna no output' : 'Exibir coluna no output'"
                                                                    >
                                                                        <i :class="isStandardColumnVisible(headerIndex) ? 'fas fa-eye' : 'fas fa-eye-slash'" aria-hidden="true"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr
                                                        v-for="rowItem in paginatedPreviewRows"
                                                        :key="rowItem.key"
                                                        draggable="true"
                                                        @dragstart="startPreviewRowDrag(rowItem.rowIndex)"
                                                        @dragover.prevent
                                                        @drop.prevent="dropPreviewRow(rowItem.rowIndex)"
                                                        @dragend="endPreviewRowDrag"
                                                    >
                                                        <td class="preview-actions-col">
                                                            <div class="btn-group btn-group-sm preview-row-actions" role="group">
                                                                <button class="btn btn-outline-secondary preview-handle-btn" type="button" title="Arrastar linha">
                                                                    <i class="fas fa-grip-vertical" aria-hidden="true"></i>
                                                                </button>
                                                                <button class="btn btn-outline-secondary" type="button" @click="moveStandardRow(rowItem.rowIndex, -1)" :disabled="rowItem.rowIndex === 0" title="Subir linha">
                                                                    <i class="fas fa-arrow-up" aria-hidden="true"></i>
                                                                </button>
                                                                <button class="btn btn-outline-secondary" type="button" @click="moveStandardRow(rowItem.rowIndex, 1)" :disabled="rowItem.rowIndex === previewRows.length - 1" title="Descer linha">
                                                                    <i class="fas fa-arrow-down" aria-hidden="true"></i>
                                                                </button>
                                                                <button
                                                                    class="btn"
                                                                    :class="isStandardRowVisible(rowItem.rowIndex) ? 'btn-outline-success' : 'btn-outline-secondary'"
                                                                    type="button"
                                                                    @click="toggleStandardRowVisibility(rowItem.rowIndex)"
                                                                    :title="isStandardRowVisible(rowItem.rowIndex) ? 'Ocultar linha no output' : 'Exibir linha no output'"
                                                                >
                                                                    <i :class="isStandardRowVisible(rowItem.rowIndex) ? 'fas fa-eye' : 'fas fa-eye-slash'" aria-hidden="true"></i>
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td v-for="(header, cellIndex) in standardObject.headers" :key="rowItem.key + '-' + cellIndex">
                                                            <input
                                                                class="form-control form-control-sm preview-input"
                                                                :value="cellIndex < rowItem.row.length ? rowItem.row[cellIndex] : ''"
                                                                @input="updateStandardCell(rowItem.rowIndex, cellIndex, $event.target.value)"
                                                                placeholder="-"
                                                            >
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        <div v-if="standardObject.headers.length" class="preview-pagination">
                                            <div class="small text-secondary">{{ previewRangeLabel }}</div>
                                            <div class="btn-group btn-group-sm" role="group">
                                                <button class="btn btn-outline-secondary" type="button" @click="goToPreviewPage(state.previewPage - 1)" :disabled="state.previewPage <= 1">
                                                    <i class="fas fa-chevron-left" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-outline-secondary" type="button" disabled>
                                                    Pagina {{ state.previewPage }} / {{ previewPageCount }}
                                                </button>
                                                <button class="btn btn-outline-secondary" type="button" @click="goToPreviewPage(state.previewPage + 1)" :disabled="state.previewPage >= previewPageCount">
                                                    <i class="fas fa-chevron-right" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>

                                        <div v-else class="preview-empty">
                                            O objeto padrao sera exibido aqui assim que o input for lido com sucesso.
                                        </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section class="col-12">
                                <div class="panel-card output-panel h-100">
                                    <div class="card-body p-4">
                                        <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                            <div class="d-flex align-items-center gap-2">
                                                <div>
                                                    <div class="editor-label mb-1">Output</div>
                                                    <h3 class="h5 mb-0">Resultado convertido</h3>
                                                </div>
                                                
                                            </div>
                                            <div class="d-flex align-items-center gap-2 col-12 col-sm-6 col-lg-7 col-xxl-6 px-0">
                                                <div class="input-group input-group-sm">
                                                    <select class="form-select" v-model="state.outputFormat">
                                                        <option v-for="format in outputFormats" :key="format.value" :value="format.value">
                                                            {{ format.label }}
                                                        </option>
                                                    </select>
                                                    <button class="btn btn-outline-primary" type="button" @click="copyOutput" :title="state.copyFeedback || 'Copiar resultado'">
                                                        <i
                                                            :class="state.copyFeedback === 'Copiado' ? 'fas fa-check' : state.copyFeedback === 'Falha ao copiar' ? 'fas fa-exclamation-triangle' : state.copyFeedback === 'Sem conteudo' ? 'fas fa-ban' : 'fas fa-copy'"
                                                            aria-hidden="true"
                                                        ></i>
                                                    </button>
                                                    <button class="btn btn-outline-primary" type="button" @click="downloadOutput" title="Baixar resultado">
                                                        <i class="fas fa-download" aria-hidden="true"></i>
                                                    </button>
                                                    <button
                                                        class="btn"
                                                        :class="state.autoCopyOutput ? 'btn-success' : 'btn-outline-secondary'"
                                                        type="button"
                                                        @click="state.autoCopyOutput = !state.autoCopyOutput"
                                                        :title="state.autoCopyOutput ? 'Desativar auto copia' : 'Ativar auto copia'"
                                                    >
                                                        <i :class="state.autoCopyOutput ? 'fas fa-clipboard-check' : 'fas fa-clipboard'" aria-hidden="true"></i>
                                                    </button>
                                                </div>
                                                
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button"  @click="toggleSidebar" >
                                                    <i class="fas fa-cog" aria-hidden="true"></i>
                                                </button>

                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleSection('output')">
                                                    <i :class="state.outputSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                                </button>

                                            </div>
                                        </div>
                                        <div v-show="!state.outputSectionCollapsed">
                                        <textarea
                                            class="form-control editor-textarea"
                                            :value="visibleOutput"
                                            readonly
                                            spellcheck="false"
                                            :placeholder="state.autoCopyOutput ? 'Auto copiar ativo. O resultado sera enviado direto para a area de transferencia.' : 'O resultado convertido sera exibido aqui'"
                                        ></textarea>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </main>
                </div>
            </div>
        `
    }).mount("#app");
})();
