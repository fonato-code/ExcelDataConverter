(function () {
    const { createApp, computed, reactive, watch, nextTick, onMounted, onBeforeUnmount } = Vue;
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
                originalStandardHeaders: defaultState.originalStandardHeaders,
                originalStandardRows: defaultState.originalStandardRows,
                originalStandardColumnKeys: defaultState.originalStandardColumnKeys,
                originalStandardRowKeys: defaultState.originalStandardRowKeys,
                previewColumnWidths: defaultState.previewColumnWidths,
                previewColumnMenuKey: defaultState.previewColumnMenuKey,
                previewColumnMenuTop: defaultState.previewColumnMenuTop,
                previewColumnMenuLeft: defaultState.previewColumnMenuLeft,
                previewColumnMenuMaxHeight: defaultState.previewColumnMenuMaxHeight,
                rowConfigs: defaultState.rowConfigs,
                columnConfigs: defaultState.columnConfigs,
                draggedColumnKey: defaultState.draggedColumnKey,
                bulkHeaderRenameMode: defaultState.bulkHeaderRenameMode,
                bulkHeaderRenamePrefix: defaultState.bulkHeaderRenamePrefix,
                bulkHeaderRenameSuffix: defaultState.bulkHeaderRenameSuffix,
                inputSectionCollapsed: false,
                previewSectionCollapsed: true,
                outputSectionCollapsed: true,
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

            function findFocusableElement(selector) {
                return document.querySelector(selector);
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

            function padDatePart(value) {
                return String(value).padStart(2, "0");
            }

            function normalizeNumericString(value, locale) {
                const trimmed = String(value || "").trim().replace(/\s+/g, "");
                if (!trimmed) {
                    return null;
                }

                if (locale === "pt-BR") {
                    const normalized = trimmed.replace(/\./g, "").replace(",", ".");
                    const parsed = Number(normalized);
                    return Number.isFinite(parsed) ? parsed : null;
                }

                if (locale === "en-US") {
                    const normalized = trimmed.replace(/,/g, "");
                    const parsed = Number(normalized);
                    return Number.isFinite(parsed) ? parsed : null;
                }

                const hasComma = trimmed.indexOf(",") !== -1;
                const hasDot = trimmed.indexOf(".") !== -1;

                if (hasComma && hasDot) {
                    const lastComma = trimmed.lastIndexOf(",");
                    const lastDot = trimmed.lastIndexOf(".");
                    const decimalSeparator = lastComma > lastDot ? "," : ".";
                    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
                    const normalized = trimmed.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
                    const parsed = Number(normalized);
                    return Number.isFinite(parsed) ? parsed : null;
                }

                if (hasComma) {
                    const commaOccurrences = (trimmed.match(/,/g) || []).length;
                    const normalized = commaOccurrences > 1 ? trimmed.replace(/,/g, "") : trimmed.replace(",", ".");
                    const parsed = Number(normalized);
                    return Number.isFinite(parsed) ? parsed : null;
                }

                const parsed = Number(trimmed);
                return Number.isFinite(parsed) ? parsed : null;
            }

            function formatNumericByLocale(value, locale) {
                if (!Number.isFinite(value)) {
                    return "";
                }

                if (locale === "pt-BR") {
                    return new Intl.NumberFormat("pt-BR", {
                        useGrouping: false,
                        maximumFractionDigits: 20
                    }).format(value);
                }

                if (locale === "en-US") {
                    return new Intl.NumberFormat("en-US", {
                        useGrouping: false,
                        maximumFractionDigits: 20
                    }).format(value);
                }

                return String(value);
            }

            function parseDateByFormat(value, format) {
                const trimmed = String(value || "").trim();
                if (!trimmed) {
                    return null;
                }

                function buildDateParts(year, month, day, hour, minute, second, millisecond, meta) {
                    const parsedYear = Number(year);
                    const parsedMonth = Number(month);
                    const parsedDay = Number(day);
                    const parsedHour = Number(hour || 0);
                    const parsedMinute = Number(minute || 0);
                    const parsedSecond = Number(second || 0);
                    const parsedMillisecond = Number(millisecond || 0);

                    if (!parsedYear || parsedMonth < 1 || parsedMonth > 12 || parsedDay < 1 || parsedDay > 31) {
                        return null;
                    }

                    return {
                        year: parsedYear,
                        month: parsedMonth,
                        day: parsedDay,
                        hour: parsedHour,
                        minute: parsedMinute,
                        second: parsedSecond,
                        millisecond: parsedMillisecond,
                        hasDate: true,
                        hasTime: Boolean(meta && meta.hasTime),
                        hasSeconds: Boolean(meta && meta.hasSeconds),
                        hasMilliseconds: Boolean(meta && meta.hasMilliseconds),
                        isUtc: Boolean(meta && meta.isUtc)
                    };
                }

                function parseSlashDate(order) {
                    const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:\.(\d{1,3}))?)?$/);
                    if (!match) {
                        return null;
                    }

                    const first = match[1];
                    const second = match[2];
                    const year = match[3];
                    const hour = match[4];
                    const minute = match[5];
                    const secondValue = match[6];
                    const millisecond = match[7];

                    return order === "dmy"
                        ? buildDateParts(year, second, first, hour, minute, secondValue, millisecond, {
                            hasTime: Boolean(hour),
                            hasSeconds: Boolean(secondValue),
                            hasMilliseconds: Boolean(millisecond)
                        })
                        : buildDateParts(year, first, second, hour, minute, secondValue, millisecond, {
                            hasTime: Boolean(hour),
                            hasSeconds: Boolean(secondValue),
                            hasMilliseconds: Boolean(millisecond)
                        });
                }

                function parseDashDate() {
                    const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:\.(\d{1,3}))?)?$/);
                    if (!match) {
                        return null;
                    }

                    return buildDateParts(match[1], match[2], match[3], match[4], match[5], match[6], match[7], {
                        hasTime: Boolean(match[4]),
                        hasSeconds: Boolean(match[6]),
                        hasMilliseconds: Boolean(match[7])
                    });
                }

                function parseIsoDate(expectUtc) {
                    const regex = expectUtc
                        ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?Z$/
                        : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;
                    const match = trimmed.match(regex);
                    if (!match) {
                        return null;
                    }

                    return buildDateParts(match[1], match[2], match[3], match[4], match[5], match[6], match[7], {
                        hasTime: true,
                        hasSeconds: Boolean(match[6]),
                        hasMilliseconds: Boolean(match[7]),
                        isUtc: expectUtc
                    });
                }

                function parseSerialDate() {
                    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
                        return null;
                    }

                    const serial = Number(trimmed);
                    if (!Number.isFinite(serial)) {
                        return null;
                    }

                    const excelBaseUtc = Date.UTC(1899, 11, 30);
                    const milliseconds = Math.round(serial * 86400000);
                    const date = new Date(excelBaseUtc + milliseconds);

                    return buildDateParts(
                        date.getUTCFullYear(),
                        date.getUTCMonth() + 1,
                        date.getUTCDate(),
                        date.getUTCHours(),
                        date.getUTCMinutes(),
                        date.getUTCSeconds(),
                        date.getUTCMilliseconds(),
                        {
                            hasTime: serial % 1 !== 0,
                            hasSeconds: date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0,
                            hasMilliseconds: date.getUTCMilliseconds() !== 0
                        }
                    );
                }

                function parseCompactDate() {
                    const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(\d{1,3})?)?$/);
                    if (!match) {
                        return null;
                    }

                    return buildDateParts(match[1], match[2], match[3], match[4], match[5], match[6], match[7], {
                        hasTime: Boolean(match[4]),
                        hasSeconds: Boolean(match[6]),
                        hasMilliseconds: Boolean(match[7])
                    });
                }

                function parseUnixTimestamp() {
                    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
                        return null;
                    }

                    const timestamp = Number(trimmed);
                    if (!Number.isFinite(timestamp)) {
                        return null;
                    }

                    const milliseconds = Math.abs(timestamp) >= 100000000000 ? timestamp : timestamp * 1000;
                    const date = new Date(milliseconds);
                    if (Number.isNaN(date.getTime())) {
                        return null;
                    }

                    return buildDateParts(
                        date.getUTCFullYear(),
                        date.getUTCMonth() + 1,
                        date.getUTCDate(),
                        date.getUTCHours(),
                        date.getUTCMinutes(),
                        date.getUTCSeconds(),
                        date.getUTCMilliseconds(),
                        {
                            hasTime: true,
                            hasSeconds: true,
                            hasMilliseconds: date.getUTCMilliseconds() !== 0,
                            isUtc: true
                        }
                    );
                }

                const parsersByFormat = {
                    "dd/mm/yyyy hh:mm:ss.fff": function () { return parseSlashDate("dmy"); },
                    "mm/dd/yyyy hh:mm:ss.fff": function () { return parseSlashDate("mdy"); },
                    "yyyy-mm-dd hh:mm:ss.fff": parseDashDate,
                    "iso-datetime": function () { return parseIsoDate(false); },
                    "iso-datetime-utc": function () { return parseIsoDate(true); },
                    "serial-date": parseSerialDate,
                    "compact-date": parseCompactDate,
                    "unix-timestamp": parseUnixTimestamp
                };

                if (format && format !== "auto" && parsersByFormat[format]) {
                    return parsersByFormat[format]();
                }

                const numericOnly = /^-?\d+(?:\.\d+)?$/.test(trimmed);
                if (numericOnly) {
                    const integerDigits = trimmed.replace(/[^0-9]/g, "").length;

                    if (integerDigits >= 14) {
                        return parseCompactDate() || parseUnixTimestamp() || parseSerialDate();
                    }

                    if (integerDigits >= 10) {
                        return parseUnixTimestamp() || parseSerialDate();
                    }

                    return parseSerialDate() || parseUnixTimestamp();
                }

                return parseSlashDate("dmy")
                    || parseSlashDate("mdy")
                    || parseDashDate()
                    || parseIsoDate(true)
                    || parseIsoDate(false);
            }

            function formatDateByFormat(parts, format, manualMask) {
                if (!parts) {
                    return "";
                }

                const tokens = {
                    YYYY: String(parts.year),
                    MM: padDatePart(parts.month),
                    DD: padDatePart(parts.day),
                    HH: padDatePart(parts.hour || 0),
                    mm: padDatePart(parts.minute || 0),
                    ss: padDatePart(parts.second || 0),
                    fff: String(parts.millisecond || 0).padStart(3, "0")
                };

                function replaceMask(mask) {
                    return String(mask || "").replace(/YYYY|MM|DD|HH|mm|ss|fff/g, function (token) {
                        return tokens[token];
                    });
                }

                function formatFlexibleDate(baseMask) {
                    if (!parts.hasTime) {
                        return replaceMask(baseMask.split(" ")[0]);
                    }

                    if (!parts.hasSeconds) {
                        return replaceMask(baseMask.replace(/:ss(?:\.fff)?$/, ""));
                    }

                    if (!parts.hasMilliseconds) {
                        return replaceMask(baseMask.replace(/\.fff$/, ""));
                    }

                    return replaceMask(baseMask);
                }

                if (format === "manual") {
                    return replaceMask(manualMask || "YYYY-MM-DD");
                }

                if (format === "dd/mm/yyyy hh:mm:ss.fff") {
                    return formatFlexibleDate("DD/MM/YYYY HH:mm:ss.fff");
                }

                if (format === "mm/dd/yyyy hh:mm:ss.fff") {
                    return formatFlexibleDate("MM/DD/YYYY HH:mm:ss.fff");
                }

                if (format === "yyyy-mm-dd hh:mm:ss.fff") {
                    return formatFlexibleDate("YYYY-MM-DD HH:mm:ss.fff");
                }

                if (format === "iso-datetime") {
                    return parts.hasMilliseconds
                        ? replaceMask("YYYY-MM-DDTHH:mm:ss.fff")
                        : replaceMask("YYYY-MM-DDTHH:mm:ss");
                }

                if (format === "iso-datetime-utc") {
                    return (parts.hasMilliseconds
                        ? replaceMask("YYYY-MM-DDTHH:mm:ss.fff")
                        : replaceMask("YYYY-MM-DDTHH:mm:ss")) + "Z";
                }

                if (format === "serial-date") {
                    const excelBaseUtc = Date.UTC(1899, 11, 30);
                    const currentUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
                    return String((currentUtc - excelBaseUtc) / 86400000);
                }

                if (format === "compact-date") {
                    return parts.hasTime
                        ? replaceMask("YYYYMMDDHHmmssfff")
                        : replaceMask("YYYYMMDD");
                }

                if (format === "unix-timestamp") {
                    const currentUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
                    return String(Math.floor(currentUtc / 1000));
                }

                return formatFlexibleDate("YYYY-MM-DD HH:mm:ss.fff");
            }

            function escapeSelectorToken(value) {
                if (window.CSS && typeof window.CSS.escape === "function") {
                    return window.CSS.escape(String(value));
                }

                return String(value).replace(/["\\]/g, "\\$&");
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
                originalStandardHeaders: [],
                originalStandardRows: [],
                originalStandardColumnKeys: [],
                originalStandardRowKeys: [],
                previewColumnWidths: {},
                previewColumnMenuKey: "",
                previewColumnMenuTop: 0,
                previewColumnMenuLeft: 0,
                previewColumnMenuMaxHeight: 0,
                previewColumnMenuWidth: 320,
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
                pendingFocusColumnKey: "",
                pendingFocusRowKey: "",
                copyFeedback: "",
                toasts: [],
                lastAutoCopiedOutput: ""
            };

            const state = reactive(loadPreferences(defaultState));

            watch(function () {
                return state.theme;
            }, function (theme) {
                document.documentElement.setAttribute("data-theme", theme);
                document.documentElement.setAttribute("data-bs-theme", theme === "dark" ? "dark" : "light");
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
                state.originalStandardHeaders = data.headers.slice();
                state.originalStandardRows = cloneRows(data.dataRows);
                state.originalStandardColumnKeys = state.standardColumnKeys.slice();
                state.originalStandardRowKeys = state.standardRowKeys.slice();
                state.previewColumnWidths = {};
                state.previewColumnMenuKey = "";
                state.previewColumnMenuWidth = defaultState.previewColumnMenuWidth;
                state.columnConfigs = [];
                state.rowConfigs = [];
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

                function matchesColumnFilter(rowItem, column) {
                    if (!column.filterOperator) {
                        return true;
                    }

                    const rawValue = column.sourceIndex < rowItem.row.length ? rowItem.row[column.sourceIndex] : "";
                    const stringValue = String(rawValue === undefined || rawValue === null ? "" : rawValue);
                    const normalizedValue = stringValue.toLowerCase();
                    const filterValue = String(column.filterValue || "").toLowerCase();
                    const filterValueTo = String(column.filterValueTo || "").toLowerCase();
                    const numericValue = Number(stringValue);
                    const numericFilter = Number(column.filterValue);
                    const numericFilterTo = Number(column.filterValueTo);

                    if (column.filterOperator === "contains") {
                        return normalizedValue.indexOf(filterValue) !== -1;
                    }

                    if (column.filterOperator === "equals") {
                        return normalizedValue === filterValue;
                    }

                    if (column.filterOperator === "starts-with") {
                        return normalizedValue.startsWith(filterValue);
                    }

                    if (column.filterOperator === "ends-with") {
                        return normalizedValue.endsWith(filterValue);
                    }

                    if (column.filterOperator === "empty") {
                        return normalizedValue.trim() === "";
                    }

                    if (column.filterOperator === "not-empty") {
                        return normalizedValue.trim() !== "";
                    }

                    if (column.filterOperator === "gt") {
                        return Number.isFinite(numericValue) && Number.isFinite(numericFilter) && numericValue > numericFilter;
                    }

                    if (column.filterOperator === "lt") {
                        return Number.isFinite(numericValue) && Number.isFinite(numericFilter) && numericValue < numericFilter;
                    }

                    if (column.filterOperator === "between") {
                        return Number.isFinite(numericValue) && Number.isFinite(numericFilter) && Number.isFinite(numericFilterTo) && numericValue >= numericFilter && numericValue <= numericFilterTo;
                    }

                    if (column.filterOperator === "duplicates") {
                        const duplicateToken = normalizedValue.trim();
                        if (!duplicateToken) {
                            return false;
                        }

                        const duplicateCount = availableRows.value.reduce(function (count, currentRowItem) {
                            const currentRaw = column.sourceIndex < currentRowItem.row.length ? currentRowItem.row[column.sourceIndex] : "";
                            const currentToken = String(currentRaw === undefined || currentRaw === null ? "" : currentRaw).toLowerCase().trim();
                            return currentToken === duplicateToken ? count + 1 : count;
                        }, 0);

                        return duplicateCount > 1;
                    }

                    return true;
                }

                rows = rows.filter(function (rowItem) {
                    return state.columnConfigs.every(function (column) {
                        return matchesColumnFilter(rowItem, column);
                    });
                });

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
                            avroType: column.avroType,
                            filterOperator: column.filterOperator,
                            filterValue: column.filterValue,
                            filterValueTo: column.filterValueTo,
                            bulkFillMode: column.bulkFillMode,
                            bulkFillValue: column.bulkFillValue,
                            bulkFillAuxValue: column.bulkFillAuxValue,
                            bulkFillSequenceStart: column.bulkFillSequenceStart,
                            bulkFillSequenceStep: column.bulkFillSequenceStep,
                            mergeTargetName: column.mergeTargetName,
                            mergeSeparator: column.mergeSeparator,
                            mergeSourceKeys: Array.isArray(column.mergeSourceKeys) ? column.mergeSourceKeys.slice() : [],
                            mergeRemoveOriginals: column.mergeRemoveOriginals,
                            splitDelimiter: column.splitDelimiter,
                            splitTargetNames: column.splitTargetNames,
                            splitRemoveOriginal: column.splitRemoveOriginal,
                            localeNormalizeMode: column.localeNormalizeMode,
                            localeNumberInput: column.localeNumberInput,
                            localeNumberOutput: column.localeNumberOutput,
                            localeDateInput: column.localeDateInput,
                            localeDateOutput: column.localeDateOutput,
                            localeDateOutputManual: column.localeDateOutputManual
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
                            avroType: previous ? previous.avroType : "",
                            filterOperator: previous ? previous.filterOperator : "",
                            filterValue: previous ? previous.filterValue : "",
                            filterValueTo: previous ? previous.filterValueTo : "",
                            bulkFillMode: previous ? previous.bulkFillMode : "set",
                            bulkFillValue: previous ? previous.bulkFillValue : "",
                            bulkFillAuxValue: previous ? previous.bulkFillAuxValue : "",
                            bulkFillSequenceStart: previous ? previous.bulkFillSequenceStart : "1",
                            bulkFillSequenceStep: previous ? previous.bulkFillSequenceStep : "1",
                            mergeTargetName: previous ? previous.mergeTargetName : column.header,
                            mergeSeparator: previous ? previous.mergeSeparator : " ",
                            mergeSourceKeys: previous && Array.isArray(previous.mergeSourceKeys) ? previous.mergeSourceKeys.slice() : [column.key],
                            mergeRemoveOriginals: previous ? previous.mergeRemoveOriginals : false,
                            splitDelimiter: previous ? previous.splitDelimiter : ",",
                            splitTargetNames: previous ? previous.splitTargetNames : "",
                            splitRemoveOriginal: previous ? previous.splitRemoveOriginal : false,
                            localeNormalizeMode: previous ? previous.localeNormalizeMode : "number",
                            localeNumberInput: previous ? previous.localeNumberInput : "auto",
                            localeNumberOutput: previous ? previous.localeNumberOutput : "raw",
                            localeDateInput: previous ? previous.localeDateInput : "auto",
                            localeDateOutput: previous ? previous.localeDateOutput : "dd/mm/yyyy hh:mm:ss.fff",
                            localeDateOutputManual: previous ? previous.localeDateOutputManual : "DD/MM/YYYY HH:mm:ss.fff"
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
                        avroType: column.avroType || "",
                        filterOperator: column.filterOperator || "",
                        filterValue: column.filterValue || "",
                        filterValueTo: column.filterValueTo || "",
                        bulkFillMode: column.bulkFillMode || "set",
                        bulkFillValue: column.bulkFillValue || "",
                        bulkFillAuxValue: column.bulkFillAuxValue || "",
                        bulkFillSequenceStart: column.bulkFillSequenceStart === undefined ? "1" : String(column.bulkFillSequenceStart),
                        bulkFillSequenceStep: column.bulkFillSequenceStep === undefined ? "1" : String(column.bulkFillSequenceStep),
                        mergeTargetName: column.mergeTargetName || column.header,
                        mergeSeparator: column.mergeSeparator === undefined ? " " : column.mergeSeparator,
                        mergeSourceKeys: Array.isArray(column.mergeSourceKeys) && column.mergeSourceKeys.length ? column.mergeSourceKeys.slice() : [column.key],
                        mergeRemoveOriginals: Boolean(column.mergeRemoveOriginals),
                        splitDelimiter: column.splitDelimiter === undefined ? "," : column.splitDelimiter,
                        splitTargetNames: column.splitTargetNames || "",
                        splitRemoveOriginal: Boolean(column.splitRemoveOriginal),
                        localeNormalizeMode: column.localeNormalizeMode || "number",
                        localeNumberInput: column.localeNumberInput || "auto",
                        localeNumberOutput: column.localeNumberOutput || "raw",
                        localeDateInput: column.localeDateInput || "auto",
                        localeDateOutput: column.localeDateOutput || "dd/mm/yyyy hh:mm:ss.fff",
                        localeDateOutputManual: column.localeDateOutputManual || "DD/MM/YYYY HH:mm:ss.fff"
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
                return state.columnConfigs.map(function (column) {
                    return [column.filterOperator, column.filterValue, column.filterValueTo].join("|");
                }).join("||");
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

            function focusPreviewHeaderByColumnKey(columnKey) {
                if (!columnKey) {
                    return;
                }

                nextTick(function () {
                    const target = findFocusableElement('[data-column-key="' + escapeSelectorToken(columnKey) + '"] .preview-header-input');
                    if (target) {
                        target.focus();
                        if (typeof target.select === "function") {
                            target.select();
                        }
                        target.scrollIntoView({
                            block: "nearest",
                            inline: "center"
                        });
                    }
                });
            }

            function focusPreviewCellByKeys(rowKey, columnKey) {
                if (!rowKey || !columnKey) {
                    return;
                }

                nextTick(function () {
                    const target = findFocusableElement(
                        '[data-row-key="' + escapeSelectorToken(rowKey) + '"] [data-cell-column-key="' + escapeSelectorToken(columnKey) + '"]'
                    );
                    if (target) {
                        target.focus();
                        if (typeof target.select === "function") {
                            target.select();
                        }
                        target.scrollIntoView({
                            block: "nearest",
                            inline: "center"
                        });
                    }
                });
            }

            function addStandardRow() {
                const newRow = Array.from({ length: state.standardHeaders.length }, function () {
                    return "";
                });
                const newRowKey = createRowKey();

                state.standardRows.push(newRow);
                state.standardRowKeys.push(newRowKey);
                state.rowConfigs.push({
                    key: newRowKey,
                    enabled: true
                });

                state.previewPage = Math.max(1, Math.ceil(state.standardRows.length / state.previewPageSize));
                state.pendingFocusRowKey = newRowKey;
                state.pendingFocusColumnKey = state.standardColumnKeys[0] || "";
                focusPreviewCellByKeys(newRowKey, state.standardColumnKeys[0] || "");
            }

            function duplicateStandardRow(rowIndex) {
                if (rowIndex < 0 || rowIndex >= state.standardRows.length) {
                    return;
                }

                const duplicatedRow = (state.standardRows[rowIndex] || []).slice();
                const duplicatedKey = createRowKey();
                const sourceRowKey = state.standardRowKeys[rowIndex];
                const sourceConfig = state.rowConfigs.find(function (rowConfig) {
                    return rowConfig.key === sourceRowKey;
                });

                state.standardRows.splice(rowIndex + 1, 0, duplicatedRow);
                state.standardRowKeys.splice(rowIndex + 1, 0, duplicatedKey);
                state.rowConfigs.splice(rowIndex + 1, 0, {
                    key: duplicatedKey,
                    enabled: sourceConfig ? sourceConfig.enabled : true
                });

                state.previewPage = Math.max(1, Math.ceil((rowIndex + 2) / state.previewPageSize));
                state.pendingFocusRowKey = duplicatedKey;
                state.pendingFocusColumnKey = state.standardColumnKeys[0] || "";
                focusPreviewCellByKeys(duplicatedKey, state.standardColumnKeys[0] || "");
                pushToast("Linha duplicada.", "success");
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
                const newColumnKey = createColumnKey();

                state.standardHeaders.push(nextHeader);
                state.standardColumnKeys.push(newColumnKey);
                state.standardRows.forEach(function (row) {
                    row.push("");
                });

                state.pendingFocusColumnKey = newColumnKey;
                focusPreviewHeaderByColumnKey(newColumnKey);
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

            function insertStandardColumnAt(insertIndex, header, initialValues) {
                const safeInsertIndex = Math.max(0, Math.min(insertIndex, state.standardHeaders.length));
                const newColumnKey = createColumnKey();
                const nextHeader = header || ("Col" + (safeInsertIndex + 1));

                state.standardHeaders.splice(safeInsertIndex, 0, nextHeader);
                state.standardColumnKeys.splice(safeInsertIndex, 0, newColumnKey);
                state.standardRows.forEach(function (row, rowIndex) {
                    const nextValue = Array.isArray(initialValues) && rowIndex < initialValues.length ? initialValues[rowIndex] : "";
                    row.splice(safeInsertIndex, 0, nextValue);
                });

                return newColumnKey;
            }

            function removeStandardColumnAt(removeIndex) {
                if (removeIndex < 0 || removeIndex >= state.standardHeaders.length) {
                    return;
                }

                const removedKey = state.standardColumnKeys[removeIndex];
                state.standardHeaders.splice(removeIndex, 1);
                state.standardColumnKeys.splice(removeIndex, 1);
                state.standardRows.forEach(function (row) {
                    row.splice(removeIndex, 1);
                });
                delete state.previewColumnWidths[removedKey];
            }

            function getColumnConfigByIndex(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                return state.columnConfigs.find(function (column) {
                    return column.key === columnKey;
                });
            }

            function getMenuColumnIndex() {
                return state.standardColumnKeys.indexOf(state.previewColumnMenuKey);
            }

            function getMenuColumnConfig() {
                return getColumnConfigByIndex(getMenuColumnIndex()) || {
                    bulkFillMode: "set",
                    bulkFillValue: "",
                    bulkFillAuxValue: "",
                    bulkFillSequenceStart: "1",
                    bulkFillSequenceStep: "1",
                    filterOperator: "",
                    filterValue: "",
                    filterValueTo: "",
                    mergeTargetName: "",
                    mergeSeparator: " ",
                    mergeSourceKeys: [],
                    mergeRemoveOriginals: false,
                    splitDelimiter: ",",
                    splitTargetNames: "",
                    splitRemoveOriginal: false,
                    localeNormalizeMode: "number",
                    localeNumberInput: "auto",
                    localeNumberOutput: "raw",
                    localeDateInput: "auto",
                    localeDateOutput: "dd/mm/yyyy hh:mm:ss.fff",
                    localeDateOutputManual: "DD/MM/YYYY HH:mm:ss.fff"
                };
            }

            function applyColumnSplit(columnIndex) {
                const column = getColumnConfigByIndex(columnIndex);
                if (!column) {
                    return;
                }

                const delimiter = column.splitDelimiter;
                if (!delimiter) {
                    pushToast("Informe o delimitador para dividir a coluna.", "warning");
                    return;
                }

                const splitValues = state.standardRows.map(function (row) {
                    const rawValue = row[columnIndex] === undefined || row[columnIndex] === null ? "" : String(row[columnIndex]);
                    return rawValue.split(delimiter);
                });
                const partsCount = splitValues.reduce(function (max, parts) {
                    return Math.max(max, parts.length);
                }, 0);

                if (!partsCount || partsCount === 1) {
                    pushToast("Nenhuma divisao encontrada com o delimitador informado.", "warning");
                    return;
                }

                const targetNames = String(column.splitTargetNames || "")
                    .split(",")
                    .map(function (item) {
                        return item.trim();
                    })
                    .filter(Boolean);
                const sourceHeader = state.standardHeaders[columnIndex] || "Coluna";
                const insertedKeys = [];

                for (let partIndex = 0; partIndex < partsCount; partIndex += 1) {
                    const headerName = targetNames[partIndex] || (sourceHeader + "_" + (partIndex + 1));
                    const partValues = splitValues.map(function (parts) {
                        return partIndex < parts.length ? parts[partIndex] : "";
                    });
                    insertedKeys.push(insertStandardColumnAt(columnIndex + partIndex + 1, headerName, partValues));
                }

                if (column.splitRemoveOriginal) {
                    removeStandardColumnAt(columnIndex);
                }

                state.previewColumnMenuKey = "";
                const focusKey = insertedKeys[0] || "";
                state.pendingFocusColumnKey = focusKey;
                focusPreviewHeaderByColumnKey(focusKey);
                pushToast("Coluna dividida com sucesso.", "success");
            }

            function applyColumnMerge(columnIndex) {
                const column = getColumnConfigByIndex(columnIndex);
                if (!column) {
                    return;
                }

                const mergeSourceKeys = Array.isArray(column.mergeSourceKeys)
                    ? column.mergeSourceKeys.filter(function (key) {
                        return state.standardColumnKeys.indexOf(key) !== -1;
                    })
                    : [];

                if (!mergeSourceKeys.length) {
                    pushToast("Selecione ao menos uma coluna para mesclar.", "warning");
                    return;
                }

                const mergeIndexes = mergeSourceKeys.map(function (key) {
                    return state.standardColumnKeys.indexOf(key);
                }).filter(function (index) {
                    return index !== -1;
                });

                const separator = column.mergeSeparator === undefined ? " " : column.mergeSeparator;
                const targetName = String(column.mergeTargetName || state.standardHeaders[columnIndex] || "Coluna mesclada").trim() || "Coluna mesclada";
                const mergedValues = state.standardRows.map(function (row) {
                    return mergeIndexes.map(function (sourceIndex) {
                        return sourceIndex < row.length ? String(row[sourceIndex] === undefined || row[sourceIndex] === null ? "" : row[sourceIndex]) : "";
                    }).filter(function (value) {
                        return value !== "";
                    }).join(separator);
                });

                const insertIndex = Math.max.apply(null, mergeIndexes) + 1;
                const mergedKey = insertStandardColumnAt(insertIndex, targetName, mergedValues);

                if (column.mergeRemoveOriginals) {
                    mergeIndexes.sort(function (left, right) {
                        return right - left;
                    }).forEach(function (sourceIndex) {
                        removeStandardColumnAt(sourceIndex);
                    });
                }

                state.previewColumnMenuKey = "";
                state.pendingFocusColumnKey = mergedKey;
                focusPreviewHeaderByColumnKey(mergedKey);
                pushToast("Colunas mescladas com sucesso.", "success");
            }

            function isColumnFiltered(columnIndex) {
                const column = getColumnConfigByIndex(columnIndex);
                return !!(column && column.filterOperator);
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

            function resetPreviewChanges() {
                state.standardHeaders = state.originalStandardHeaders.slice();
                state.standardRows = cloneRows(state.originalStandardRows);
                state.standardColumnKeys = state.originalStandardColumnKeys.slice();
                state.standardRowKeys = state.originalStandardRowKeys.slice();
                state.previewColumnWidths = {};
                state.previewColumnMenuKey = "";
                state.columnConfigs = [];
                state.rowConfigs = [];
                state.previewPage = 1;
                pushToast("Preview restaurado para o estado original.", "success");
            }

            function togglePreviewColumnMenu(columnKey) {
                const event = arguments[1];

                if (state.previewColumnMenuKey === columnKey) {
                    state.previewColumnMenuKey = "";
                    return;
                }

                if (event && event.currentTarget) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const estimatedMenuHeight = 720;
                    const estimatedMenuWidth = state.previewColumnMenuWidth || 320;
                    const openBelowTop = rect.bottom + 8;
                    const openAboveTop = rect.top - estimatedMenuHeight - 8;
                    const shouldOpenAbove = openBelowTop + estimatedMenuHeight > window.innerHeight - 16 && rect.top > window.innerHeight * 0.35;

                    state.previewColumnMenuTop = shouldOpenAbove
                        ? Math.max(16, openAboveTop)
                        : Math.max(16, Math.min(window.innerHeight - 24, openBelowTop));
                    state.previewColumnMenuLeft = Math.max(16, Math.min(window.innerWidth - estimatedMenuWidth - 16, rect.right - (estimatedMenuWidth - 32)));
                    state.previewColumnMenuMaxHeight = Math.max(220, window.innerHeight - state.previewColumnMenuTop - 16);
                }

                state.previewColumnMenuKey = columnKey;
            }

            function startPreviewColumnResize(columnKey, event) {
                event.preventDefault();
                event.stopPropagation();

                const headerCell = event.target.closest("th");
                const initialWidth = headerCell ? headerCell.getBoundingClientRect().width : 180;
                const startX = event.clientX;
                const currentWidth = state.previewColumnWidths[columnKey] || initialWidth;

                function onMove(moveEvent) {
                    const nextWidth = Math.max(120, currentWidth + (moveEvent.clientX - startX));
                    state.previewColumnWidths[columnKey] = nextWidth;
                }

                function onUp() {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                }

                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
            }

            function getPreviewColumnStyle(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                const width = state.previewColumnWidths[columnKey];
                if (!width) {
                    return {};
                }

                return {
                    width: width + "px",
                    minWidth: width + "px"
                };
            }

            function getPreviewColumnMenuStyle() {
                return {
                    position: "fixed",
                    top: state.previewColumnMenuTop + "px",
                    left: state.previewColumnMenuLeft + "px",
                    width: state.previewColumnMenuWidth + "px",
                    maxHeight: state.previewColumnMenuMaxHeight + "px"
                };
            }

            function applyBulkFill(columnIndex) {
                const columnKey = state.standardColumnKeys[columnIndex];
                const column = state.columnConfigs.find(function (item) {
                    return item.key === columnKey;
                });

                if (!column) {
                    return;
                }

                const targetRowIndexes = filteredPreviewRows.value.map(function (rowItem) {
                    return rowItem.rowIndex;
                });

                if (column.bulkFillMode === "numeric-sequence") {
                    const start = Number(column.bulkFillSequenceStart);
                    const step = Number(column.bulkFillSequenceStep);

                    if (!Number.isFinite(start) || !Number.isFinite(step)) {
                        pushToast("Informe valor inicial e incremento numericos.", "warning");
                        return;
                    }

                    targetRowIndexes.forEach(function (rowIndex, sequenceIndex) {
                        updateStandardCell(rowIndex, columnIndex, String(start + (step * sequenceIndex)));
                    });

                    pushToast("Sequencia numerica aplicada na coluna.", "success");
                    return;
                }

                targetRowIndexes.forEach(function (rowIndex) {
                    const currentValue = String(
                        columnIndex < state.standardRows[rowIndex].length && state.standardRows[rowIndex][columnIndex] !== undefined && state.standardRows[rowIndex][columnIndex] !== null
                            ? state.standardRows[rowIndex][columnIndex]
                            : ""
                    );
                    let nextValue = currentValue;

                    if (column.bulkFillMode === "set") {
                        nextValue = column.bulkFillValue;
                    } else if (column.bulkFillMode === "replace") {
                        nextValue = currentValue.split(column.bulkFillValue).join(column.bulkFillAuxValue);
                    } else if (column.bulkFillMode === "prefix") {
                        nextValue = column.bulkFillValue + currentValue;
                    } else if (column.bulkFillMode === "suffix") {
                        nextValue = currentValue + column.bulkFillValue;
                    } else if (column.bulkFillMode === "uppercase") {
                        nextValue = currentValue.toUpperCase();
                    } else if (column.bulkFillMode === "lowercase") {
                        nextValue = currentValue.toLowerCase();
                    } else if (column.bulkFillMode === "trim") {
                        nextValue = currentValue.trim();
                    } else if (column.bulkFillMode === "clear") {
                        nextValue = "";
                    } else if (column.bulkFillMode === "fill-empty") {
                        nextValue = currentValue.trim() === "" ? column.bulkFillValue : currentValue;
                    } else if (column.bulkFillMode === "snake_case") {
                        nextValue = toSnakeCase(currentValue);
                    } else if (column.bulkFillMode === "camelCase") {
                        nextValue = toCamelCase(currentValue);
                    } else if (column.bulkFillMode === "remove-spaces") {
                        nextValue = currentValue.replace(/\s+/g, "");
                    } else if (column.bulkFillMode === "remove-accents") {
                        nextValue = currentValue.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    } else if (column.bulkFillMode === "remove-special") {
                        nextValue = currentValue.replace(/[^A-Za-z0-9\s]/g, "");
                    }

                    updateStandardCell(rowIndex, columnIndex, nextValue);
                });

                pushToast("Preenchimento em massa aplicado na coluna.", "success");
            }

            function applyLocaleNormalization(columnIndex) {
                const column = getColumnConfigByIndex(columnIndex);
                if (!column) {
                    return;
                }

                const targetRowIndexes = filteredPreviewRows.value.map(function (rowItem) {
                    return rowItem.rowIndex;
                });
                let changedCount = 0;
                let skippedCount = 0;

                targetRowIndexes.forEach(function (rowIndex) {
                    const currentValue = columnIndex < state.standardRows[rowIndex].length
                        ? String(state.standardRows[rowIndex][columnIndex] === undefined || state.standardRows[rowIndex][columnIndex] === null ? "" : state.standardRows[rowIndex][columnIndex])
                        : "";

                    if (!currentValue.trim()) {
                        return;
                    }

                    if (column.localeNormalizeMode === "number") {
                        const parsedNumber = normalizeNumericString(currentValue, column.localeNumberInput);
                        if (!Number.isFinite(parsedNumber)) {
                            skippedCount += 1;
                            return;
                        }

                        updateStandardCell(rowIndex, columnIndex, formatNumericByLocale(parsedNumber, column.localeNumberOutput));
                        changedCount += 1;
                        return;
                    }

                    const parsedDate = parseDateByFormat(currentValue, column.localeDateInput);
                    if (!parsedDate) {
                        skippedCount += 1;
                        return;
                    }

                    updateStandardCell(rowIndex, columnIndex, formatDateByFormat(parsedDate, column.localeDateOutput, column.localeDateOutputManual));
                    changedCount += 1;
                });

                if (!changedCount && skippedCount) {
                    pushToast("Nenhum valor compativel foi normalizado nesta coluna.", "warning");
                    return;
                }

                pushToast(
                    "Normalizacao aplicada: " + changedCount + " valor(es) alterado(s)" + (skippedCount ? ", " + skippedCount + " ignorado(s)." : "."),
                    "success"
                );
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

            async function handleInputPaste() {
                window.setTimeout(async function () {
                    await nextTick();

                    if (inputFormatError.value) {
                        return;
                    }

                    if (!state.standardHeaders.length && !state.standardRows.length) {
                        return;
                    }

                    state.inputSectionCollapsed = true;
                    state.previewSectionCollapsed = false;
                    state.outputSectionCollapsed = true;

                    await nextTick();
                    const previewSection = document.getElementById("preview-section");
                    if (previewSection) {
                        previewSection.scrollIntoView({
                            behavior: "smooth",
                            block: "start"
                        });
                    }
                }, 0);
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

            onMounted(function () {
                function onKeyDown(event) {
                    const activeTag = document.activeElement && document.activeElement.tagName
                        ? document.activeElement.tagName.toLowerCase()
                        : "";
                    const isEditableTarget = activeTag === "input"
                        || activeTag === "textarea"
                        || activeTag === "select"
                        || (document.activeElement && document.activeElement.isContentEditable);

                    if (event.key === "Escape" && state.sidebarOpen) {
                        state.sidebarOpen = false;
                    }

                    if (event.key === "Escape") {
                        state.previewColumnMenuKey = "";
                    }

                    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
                        if (event.key.toLowerCase() === "r") {
                            event.preventDefault();
                            addStandardRow();
                            return;
                        }

                        if (event.key.toLowerCase() === "c") {
                            event.preventDefault();
                            addStandardColumn();
                            return;
                        }
                    }

                    if (isEditableTarget) {
                        return;
                    }
                }

                function onWindowClick(event) {
                    const target = event.target;
                    if (target && typeof target.closest === "function") {
                        if (target.closest(".preview-column-menu-wrap") || target.closest(".preview-column-menu")) {
                            return;
                        }
                    }
                    state.previewColumnMenuKey = "";
                }

                function onViewportChange(event) {
                    if (!state.previewColumnMenuKey) {
                        return;
                    }
                    if (event && event.type === "scroll") {
                        const target = event.target;
                        if (target && target.nodeType === 1 && typeof target.closest === "function" && target.closest(".preview-column-menu")) {
                            return;
                        }
                    }
                    state.previewColumnMenuKey = "";
                }

                window.addEventListener("keydown", onKeyDown);
                window.addEventListener("click", onWindowClick);
                window.addEventListener("scroll", onViewportChange, true);
                window.addEventListener("resize", onViewportChange);
                state._onWindowKeyDown = onKeyDown;
                state._onWindowClick = onWindowClick;
                state._onViewportChange = onViewportChange;
            });

            onBeforeUnmount(function () {
                if (state._onWindowKeyDown) {
                    window.removeEventListener("keydown", state._onWindowKeyDown);
                }
                if (state._onWindowClick) {
                    window.removeEventListener("click", state._onWindowClick);
                }
                if (state._onViewportChange) {
                    window.removeEventListener("scroll", state._onViewportChange, true);
                    window.removeEventListener("resize", state._onViewportChange);
                }
            });

            return {
                state,
                statusMessage,
                inputFormatError,
                standardObject,
                previewRows,
                previewMeta,
                availableColumns,
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
                handleInputPaste,
                toggleTheme,
                updateStandardHeader,
                updateStandardCell,
                addStandardRow,
                duplicateStandardRow,
                toggleStandardRowVisibility,
                isStandardRowVisible,
                moveStandardRow,
                addStandardColumn,
                applyColumnMerge,
                applyColumnSplit,
                toggleStandardColumnVisibility,
                isStandardColumnVisible,
                resetPreviewChanges,
                togglePreviewColumnMenu,
                startPreviewColumnResize,
                getPreviewColumnStyle,
                getPreviewColumnMenuStyle,
                applyBulkFill,
                applyLocaleNormalization,
                getColumnConfigByIndex,
                getMenuColumnIndex,
                getMenuColumnConfig,
                isColumnFiltered,
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
                            <section id="input-section" class="col-12">
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
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleMainAccordion('input')">
                                                    <i :class="state.inputSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div v-if="!state.inputSectionCollapsed">
                                        <div
                                            class="status-chip mb-3"
                                            :class="inputFormatError ? 'error' : statusMessage.tone"
                                        >
                                            {{ inputFormatError || statusMessage.text }}
                                        </div>
                                        <textarea
                                            class="form-control editor-textarea"
                                            v-model="state.input"
                                            @paste="handleInputPaste"
                                            @change="handleInputPaste"
                                            placeholder="Cole aqui dados copiados do Excel, CSV ou TSV"
                                            spellcheck="false"
                                        ></textarea>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section id="preview-section" class="col-12">
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
                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleMainAccordion('preview')">
                                                    <i :class="state.previewSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>

                                        <div v-if="!state.previewSectionCollapsed">

                                        
                                        <div v-if="duplicateHeaderMessage" class="status-chip warning mb-3 d-flex align-items-center justify-content-between gap-3 flex-wrap">
                                            <span>{{ duplicateHeaderMessage }}</span>
                                            <button class="btn btn-sm btn-outline-warning" type="button" @click="dedupeStandardHeaders">
                                                <i class="fas fa-magic me-2" aria-hidden="true"></i>Corrigir duplicadas
                                            </button>
                                        </div>

                                        <div v-if="standardObject.headers.length" class="preview-toolbar mb-3">
                                            <div class="preview-page-size">
                                                <select class="form-select form-select-sm" v-model.number="state.previewPageSize">
                                                    <option :value="10">10</option>
                                                    <option :value="25">25</option>
                                                    <option :value="50">50</option>
                                                    <option :value="100">100</option>
                                                </select>
                                                <span>linhas por pagina</span>
                                                <button class="btn btn-outline-secondary btn-sm" type="button" @click="resetPreviewChanges" title="Restaurar estado original">
                                                    <i class="fas fa-undo" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                            <div class="input-group input-group-sm preview-search-group" style="width:400px">
                                                <span class="input-group-text"><i class="fas fa-search" aria-hidden="true"></i></span>
                                                <input class="form-control" v-model="state.previewSearch" placeholder="Buscar nas linhas">
                                                <button class="btn btn-outline-primary" type="button" @click="addStandardColumn" title="Adicionar coluna (Ctrl+Shift+C)">
                                                    <i class="fas fa-columns" aria-hidden="true"></i>
                                                </button>
                                                <button class="btn btn-outline-primary" type="button" @click="addStandardRow" title="Adicionar linha (Ctrl+Shift+R)">
                                                    <i class="fas fa-plus" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>

                                        <div v-if="standardObject.headers.length" class="preview-table-wrap">
                                            <table class="table table-sm align-middle mb-0 preview-table">
                                                <thead>
                                                    <tr>
                                                        <th class="preview-actions-col">Acoes</th>
                                                        <th v-for="(header, headerIndex) in standardObject.headers" :key="state.standardColumnKeys[headerIndex]" :style="getPreviewColumnStyle(headerIndex)" :class="{ 'preview-column-filtered': isColumnFiltered(headerIndex), 'preview-column-hidden': !isStandardColumnVisible(headerIndex) }" :data-column-key="state.standardColumnKeys[headerIndex]">
                                                            <div
                                                                class="preview-header-cell preview-column-menu-wrap"
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
                                                                        class="form-control form-control-sm preview-input preview-header-input"
                                                                        :value="header"
                                                                        @input="updateStandardHeader(headerIndex, $event.target.value)"
                                                                        placeholder="Nome da coluna"
                                                                    >
                                                                    <button class="btn btn-outline-secondary" type="button" @click="cyclePreviewSort(headerIndex)" title="Ordenar preview">
                                                                        <i :class="getPreviewSortIcon(headerIndex)" aria-hidden="true"></i>
                                                                    </button>
                                                                    <button class="btn btn-outline-secondary" type="button" @click.stop="togglePreviewColumnMenu(state.standardColumnKeys[headerIndex], $event)" title="Opcoes da coluna">
                                                                        <i class="fas fa-ellipsis-v" aria-hidden="true"></i>
                                                                    </button>
                                                                </div>
                                                                <div class="preview-column-resize-handle" @mousedown="startPreviewColumnResize(state.standardColumnKeys[headerIndex], $event)"></div>
                                                            </div>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr
                                                        v-for="rowItem in paginatedPreviewRows"
                                                        :key="rowItem.key"
                                                        :data-row-key="rowItem.key"
                                                        :class="{ 'preview-row-hidden': !isStandardRowVisible(rowItem.rowIndex) }"
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
                                                                <button class="btn btn-outline-secondary" type="button" @click="duplicateStandardRow(rowItem.rowIndex)" title="Duplicar linha">
                                                                    <i class="fas fa-clone" aria-hidden="true"></i>
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td v-for="(header, cellIndex) in standardObject.headers" :key="rowItem.key + '-' + cellIndex" :style="getPreviewColumnStyle(cellIndex)" :class="{ 'preview-column-filtered': isColumnFiltered(cellIndex), 'preview-column-hidden': !isStandardColumnVisible(cellIndex) }">
                                                            <input
                                                                class="form-control form-control-sm preview-input"
                                                                :data-cell-column-key="state.standardColumnKeys[cellIndex]"
                                                                :value="cellIndex < rowItem.row.length ? rowItem.row[cellIndex] : ''"
                                                                @input="updateStandardCell(rowItem.rowIndex, cellIndex, $event.target.value)"
                                                                placeholder="-"
                                                            >
                                                        </td>
                                                    </tr>
                                                    <tr v-if="!paginatedPreviewRows.length">
                                                        <td class="preview-empty-row" :colspan="standardObject.headers.length + 1">
                                                            Nenhuma linha encontrada com os filtros atuais.
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

                            <section id="output-section" class="col-12">
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

                                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="toggleMainAccordion('output')">
                                                    <i :class="state.outputSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                                </button>

                                            </div>
                                        </div>
                                        <div v-if="!state.outputSectionCollapsed">
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

                <div
                    v-if="state.previewColumnMenuKey"
                    class="preview-column-menu"
                    :style="getPreviewColumnMenuStyle()"
                    @click.stop
                >
                    <div class="accordion accordion-flush preview-column-menu-accordion" id="previewColumnMenuAccordion">
                        <div class="accordion-item">
                            <h2 id="pcMenuPropriedadesHeading" class="accordion-header">
                                <button
                                    class="accordion-button"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#pcMenuPropriedades"
                                    aria-expanded="true"
                                    aria-controls="pcMenuPropriedades"
                                >
                                    Propriedades
                                </button>
                            </h2>
                            <div id="pcMenuPropriedades" class="accordion-collapse collapse show" aria-labelledby="pcMenuPropriedadesHeading">
                                <div class="accordion-body">
                                    <button class="btn btn-sm btn-outline-secondary w-100 mb-3" type="button" @click="toggleStandardColumnVisibility(getMenuColumnIndex())">
                                        <i :class="isStandardColumnVisible(getMenuColumnIndex()) ? 'fas fa-eye-slash me-2' : 'fas fa-eye me-2'" aria-hidden="true"></i>
                                        {{ isStandardColumnVisible(getMenuColumnIndex()) ? 'Ocultar no output' : 'Exibir no output' }}
                                    </button>
                                    <div v-if="showColumnTypeControl" class="preview-column-menu-group">
                                        <div class="small fw-semibold mb-2">Tipo da coluna</div>
                                        <select class="form-select form-select-sm" v-model="getMenuColumnConfig()[currentTypeFieldKey]">
                                            <option v-for="option in currentTypeOptions" :key="option.value" :value="option.value">
                                                {{ option.label }}
                                            </option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 id="pcMenuBulkFillHeading" class="accordion-header">
                                <button
                                    class="accordion-button collapsed"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#pcMenuBulkFill"
                                    aria-expanded="false"
                                    aria-controls="pcMenuBulkFill"
                                >
                                    Preenchimento em massa
                                </button>
                            </h2>
                            <div id="pcMenuBulkFill" class="accordion-collapse collapse" aria-labelledby="pcMenuBulkFillHeading">
                                <div class="accordion-body">
                                    <div class="preview-column-menu-group">
                                        <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().bulkFillMode">
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
                                            v-if="['set','replace','prefix','suffix','fill-empty'].includes(getMenuColumnConfig().bulkFillMode)"
                                            class="form-control form-control-sm mb-2"
                                            v-model="getMenuColumnConfig().bulkFillValue"
                                            placeholder="Valor"
                                        >
                                        <div v-if="getMenuColumnConfig().bulkFillMode === 'numeric-sequence'" class="row g-2 mb-2">
                                            <div class="col-6">
                                                <input class="form-control form-control-sm" v-model="getMenuColumnConfig().bulkFillSequenceStart" placeholder="Valor inicial">
                                            </div>
                                            <div class="col-6">
                                                <input class="form-control form-control-sm" v-model="getMenuColumnConfig().bulkFillSequenceStep" placeholder="Incremento">
                                            </div>
                                        </div>
                                        <input v-if="getMenuColumnConfig().bulkFillMode === 'replace'" class="form-control form-control-sm mb-2" v-model="getMenuColumnConfig().bulkFillAuxValue" placeholder="Substituir por">
                                        <button class="btn btn-sm btn-outline-primary w-100" type="button" @click="applyBulkFill(getMenuColumnIndex())">Aplicar</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 id="pcMenuMergeHeading" class="accordion-header">
                                <button
                                    class="accordion-button collapsed"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#pcMenuMerge"
                                    aria-expanded="false"
                                    aria-controls="pcMenuMerge"
                                >
                                    Mesclar colunas
                                </button>
                            </h2>
                            <div id="pcMenuMerge" class="accordion-collapse collapse" aria-labelledby="pcMenuMergeHeading">
                                <div class="accordion-body">
                                    <div class="preview-column-menu-group">
                                        <div class="preview-menu-checkbox-list mb-2">
                                            <label v-for="column in availableColumns" :key="'merge-' + column.key" class="preview-menu-checkbox-item">
                                                <input class="form-check-input" type="checkbox" :value="column.key" v-model="getMenuColumnConfig().mergeSourceKeys">
                                                <span>{{ column.header || 'Coluna sem nome' }}</span>
                                            </label>
                                        </div>
                                        <input class="form-control form-control-sm mb-2" v-model="getMenuColumnConfig().mergeTargetName" placeholder="Nome da nova coluna">
                                        <input class="form-control form-control-sm mb-2" v-model="getMenuColumnConfig().mergeSeparator" placeholder="Separador">
                                        <label class="form-check mb-2">
                                            <input class="form-check-input" type="checkbox" v-model="getMenuColumnConfig().mergeRemoveOriginals">
                                            <span class="form-check-label">Remover colunas originais</span>
                                        </label>
                                        <button class="btn btn-sm btn-outline-primary w-100" type="button" @click="applyColumnMerge(getMenuColumnIndex())">Mesclar</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 id="pcMenuSplitHeading" class="accordion-header">
                                <button
                                    class="accordion-button collapsed"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#pcMenuSplit"
                                    aria-expanded="false"
                                    aria-controls="pcMenuSplit"
                                >
                                    Dividir colunas
                                </button>
                            </h2>
                            <div id="pcMenuSplit" class="accordion-collapse collapse" aria-labelledby="pcMenuSplitHeading">
                                <div class="accordion-body">
                                    <div class="preview-column-menu-group">
                                        <input class="form-control form-control-sm mb-2" v-model="getMenuColumnConfig().splitDelimiter" placeholder="Delimitador">
                                        <input class="form-control form-control-sm mb-2" v-model="getMenuColumnConfig().splitTargetNames" placeholder="Nomes das novas colunas, separados por virgula">
                                        <label class="form-check mb-2">
                                            <input class="form-check-input" type="checkbox" v-model="getMenuColumnConfig().splitRemoveOriginal">
                                            <span class="form-check-label">Remover coluna original</span>
                                        </label>
                                        <button class="btn btn-sm btn-outline-primary w-100" type="button" @click="applyColumnSplit(getMenuColumnIndex())">Dividir</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 id="pcMenuLocaleHeading" class="accordion-header">
                                <button
                                    class="accordion-button collapsed"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#pcMenuLocale"
                                    aria-expanded="false"
                                    aria-controls="pcMenuLocale"
                                >
                                    Normalizacao por locale
                                </button>
                            </h2>
                            <div id="pcMenuLocale" class="accordion-collapse collapse" aria-labelledby="pcMenuLocaleHeading">
                                <div class="accordion-body">
                                    <div class="preview-column-menu-group">
                                        <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().localeNormalizeMode">
                                            <option value="number">Numeros</option>
                                            <option value="date">Datas</option>
                                        </select>

                                        <template v-if="getMenuColumnConfig().localeNormalizeMode === 'number'">
                                            <div class="small text-secondary mb-2">Converte a leitura e a escrita numerica por padrao regional.</div>
                                            <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().localeNumberInput">
                                                <option value="auto">Entrada: Auto</option>
                                                <option value="pt-BR">Entrada: pt-BR</option>
                                                <option value="en-US">Entrada: en-US</option>
                                            </select>
                                            <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().localeNumberOutput">
                                                <option value="raw">Saida: valor bruto</option>
                                                <option value="pt-BR">Saida: pt-BR</option>
                                                <option value="en-US">Saida: en-US</option>
                                            </select>
                                        </template>

                                        <template v-else>
                                            <div class="small text-secondary mb-2">Padroniza datas da coluna para o formato desejado.</div>
                                            <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().localeDateInput">
                                                <option value="auto">Entrada: Auto</option>
                                                <option value="dd/mm/yyyy hh:mm:ss.fff">Entrada: DD/MM/YYYY HH:mm:ss.fff</option>
                                                <option value="mm/dd/yyyy hh:mm:ss.fff">Entrada: MM/DD/YYYY HH:mm:ss.fff</option>
                                                <option value="yyyy-mm-dd hh:mm:ss.fff">Entrada: YYYY-MM-DD HH:mm:ss.fff</option>
                                                <option value="iso-datetime">Entrada: ISO Datetime (YYYY-MM-DDTHH:mm:ss)</option>
                                                <option value="iso-datetime-utc">Entrada: ISO Datetime UTC (YYYY-MM-DDTHH:mm:ssZ)</option>
                                                <option value="serial-date">Entrada: Serial Date (01/01/1900)</option>
                                                <option value="compact-date">Entrada: Compact Date (YYYYMMDDHHmmssfff)</option>
                                                <option value="unix-timestamp">Entrada: Unix timestamp / Epoch time (01/01/1970)</option>
                                            </select>
                                            <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().localeDateOutput">
                                                <option value="dd/mm/yyyy hh:mm:ss.fff">Saida: DD/MM/YYYY HH:mm:ss.fff</option>
                                                <option value="mm/dd/yyyy hh:mm:ss.fff">Saida: MM/DD/YYYY HH:mm:ss.fff</option>
                                                <option value="yyyy-mm-dd hh:mm:ss.fff">Saida: YYYY-MM-DD HH:mm:ss.fff</option>
                                                <option value="iso-datetime">Saida: ISO Datetime (YYYY-MM-DDTHH:mm:ss)</option>
                                                <option value="iso-datetime-utc">Saida: ISO Datetime UTC (YYYY-MM-DDTHH:mm:ssZ)</option>
                                                <option value="serial-date">Saida: Serial Date (01/01/1900)</option>
                                                <option value="compact-date">Saida: Compact Date (YYYYMMDDHHmmssfff)</option>
                                                <option value="unix-timestamp">Saida: Unix timestamp / Epoch time (01/01/1970)</option>
                                                <option value="manual">Saida: Manual</option>
                                            </select>
                                            <input
                                                v-if="getMenuColumnConfig().localeDateOutput === 'manual'"
                                                class="form-control form-control-sm mb-2"
                                                v-model="getMenuColumnConfig().localeDateOutputManual"
                                                placeholder="Mascara manual. Ex: DD/MM/YYYY HH:mm:ss.fff"
                                            >
                                        </template>

                                        <button class="btn btn-sm btn-outline-primary w-100" type="button" @click="applyLocaleNormalization(getMenuColumnIndex())">Aplicar normalizacao</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 id="pcMenuFiltersHeading" class="accordion-header">
                                <button
                                    class="accordion-button collapsed"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#pcMenuFilters"
                                    aria-expanded="false"
                                    aria-controls="pcMenuFilters"
                                >
                                    Filtros por coluna
                                </button>
                            </h2>
                            <div id="pcMenuFilters" class="accordion-collapse collapse" aria-labelledby="pcMenuFiltersHeading">
                                <div class="accordion-body">
                                    <div class="preview-column-menu-group">
                                        <select class="form-select form-select-sm mb-2" v-model="getMenuColumnConfig().filterOperator">
                                            <option value="">Sem filtro</option>
                                            <option value="contains">Contem</option>
                                            <option value="equals">Igual</option>
                                            <option value="starts-with">Comeca com</option>
                                            <option value="ends-with">Termina com</option>
                                            <option value="empty">Vazio</option>
                                            <option value="not-empty">Nao vazio</option>
                                            <option value="gt">Maior que</option>
                                            <option value="lt">Menor que</option>
                                            <option value="between">Entre</option>
                                            <option value="duplicates">Duplicadas</option>
                                        </select>
                                        <div v-if="getMenuColumnConfig().filterOperator === 'between'" class="row g-2">
                                            <div class="col-6">
                                                <input class="form-control form-control-sm" v-model="getMenuColumnConfig().filterValue" placeholder="Valor inicial">
                                            </div>
                                            <div class="col-6">
                                                <input class="form-control form-control-sm" v-model="getMenuColumnConfig().filterValueTo" placeholder="Valor final">
                                            </div>
                                        </div>
                                        <input
                                            v-else-if="['contains','equals','starts-with','ends-with','gt','lt'].includes(getMenuColumnConfig().filterOperator)"
                                            class="form-control form-control-sm"
                                            v-model="getMenuColumnConfig().filterValue"
                                            placeholder="Valor do filtro"
                                        >
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `
    }).mount("#app");
})();
