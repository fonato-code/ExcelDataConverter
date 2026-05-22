(function () {
    const { createApp, computed, reactive, watch } = Vue;
    const STORAGE_KEY = "excelconverter.locale-normalizer.preferences.v1";

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

            return order === "dmy"
                ? buildDateParts(match[3], match[2], match[1], match[4], match[5], match[6], match[7], {
                    hasTime: Boolean(match[4]),
                    hasSeconds: Boolean(match[6]),
                    hasMilliseconds: Boolean(match[7])
                })
                : buildDateParts(match[3], match[1], match[2], match[4], match[5], match[6], match[7], {
                    hasTime: Boolean(match[4]),
                    hasSeconds: Boolean(match[6]),
                    hasMilliseconds: Boolean(match[7])
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

    function splitInputLines(value) {
        return String(value || "").split(/\r\n|\n|\r/);
    }

    function normalizeNumberLine(line, numberInputLocale, numberOutputLocale) {
        const trimmed = String(line || "").trim();
        if (!trimmed) {
            return { value: "", error: "" };
        }

        const parsed = normalizeNumericString(trimmed, numberInputLocale);
        if (!Number.isFinite(parsed)) {
            return {
                value: line,
                error: "O valor informado nao foi reconhecido como numero nesse locale."
            };
        }

        return {
            value: formatNumericByLocale(parsed, numberOutputLocale),
            error: ""
        };
    }

    function normalizeDateLine(line, dateInputFormat, dateOutputFormat, dateOutputManual) {
        const trimmed = String(line || "").trim();
        if (!trimmed) {
            return { value: "", error: "" };
        }

        const parsedDate = parseDateByFormat(trimmed, dateInputFormat);
        if (!parsedDate) {
            return {
                value: line,
                error: "O valor informado nao foi reconhecido como data nesse formato."
            };
        }

        return {
            value: formatDateByFormat(parsedDate, dateOutputFormat, dateOutputManual),
            error: ""
        };
    }

    function loadPreferences(defaultState) {
        try {
            const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
            return Object.assign({}, defaultState, saved);
        } catch (_error) {
            return defaultState;
        }
    }

    createApp({
        setup() {
            const state = reactive(loadPreferences({
                theme: "dark",
                inputValue: "",
                normalizeMode: "number",
                numberInputLocale: "auto",
                numberOutputLocale: "raw",
                dateInputFormat: "auto",
                dateOutputFormat: "dd/mm/yyyy hh:mm:ss.fff",
                dateOutputManual: "DD/MM/YYYY HH:mm:ss.fff",
                copyFeedback: ""
            }));

            watch(function () {
                return state.theme;
            }, function (theme) {
                document.documentElement.setAttribute("data-theme", theme);
            }, { immediate: true });

            watch(function () {
                return {
                    theme: state.theme,
                    normalizeMode: state.normalizeMode,
                    numberInputLocale: state.numberInputLocale,
                    numberOutputLocale: state.numberOutputLocale,
                    dateInputFormat: state.dateInputFormat,
                    dateOutputFormat: state.dateOutputFormat,
                    dateOutputManual: state.dateOutputManual
                };
            }, function (preferences) {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
            }, { deep: true });

            const result = computed(function () {
                const inputValue = String(state.inputValue || "");
                if (!inputValue.trim()) {
                    return {
                        value: "",
                        error: "",
                        info: "Cole um valor para visualizar a normalizacao."
                    };
                }

                const lines = splitInputLines(inputValue);
                const hasMultipleLines = lines.length > 1 || inputValue.indexOf("\n") !== -1 || inputValue.indexOf("\r") !== -1;
                const outputLines = [];
                let errorCount = 0;
                let convertedCount = 0;

                lines.forEach(function (line) {
                    let lineResult;

                    if (state.normalizeMode === "number") {
                        lineResult = normalizeNumberLine(line, state.numberInputLocale, state.numberOutputLocale);
                    } else {
                        lineResult = normalizeDateLine(
                            line,
                            state.dateInputFormat,
                            state.dateOutputFormat,
                            state.dateOutputManual
                        );
                    }

                    if (lineResult.error) {
                        errorCount += 1;
                    } else if (String(line || "").trim()) {
                        convertedCount += 1;
                    }

                    outputLines.push(lineResult.value);
                });

                const value = outputLines.join("\n");
                const nonEmptyLineCount = lines.filter(function (line) {
                    return String(line || "").trim();
                }).length;

                if (errorCount > 0) {
                    return {
                        value: value,
                        error: errorCount + " linha(s) nao foram reconhecidas no formato indicado.",
                        info: convertedCount > 0
                            ? (convertedCount + " de " + nonEmptyLineCount + " linha(s) convertida(s).")
                            : ""
                    };
                }

                if (state.normalizeMode === "number") {
                    return {
                        value: value,
                        error: "",
                        info: hasMultipleLines
                            ? (convertedCount + " numero(s) convertido(s).")
                            : "Numero convertido com sucesso."
                    };
                }

                return {
                    value: value,
                    error: "",
                    info: hasMultipleLines
                        ? (convertedCount + " data(s) convertida(s).")
                        : "Data convertida com sucesso."
                };
            });

            function toggleTheme() {
                state.theme = state.theme === "light" ? "dark" : "light";
            }

            async function copyResult() {
                if (!result.value.value) {
                    state.copyFeedback = "Sem conteudo";
                    return;
                }

                try {
                    await navigator.clipboard.writeText(result.value.value);
                    state.copyFeedback = "Copiado";
                    window.setTimeout(function () {
                        if (state.copyFeedback === "Copiado") {
                            state.copyFeedback = "";
                        }
                    }, 1600);
                } catch (_error) {
                    state.copyFeedback = "Falha ao copiar";
                }
            }

            return {
                state,
                result,
                toggleTheme,
                copyResult
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
                            <a class="topbar-link is-active" href="locale-normalizer.html">Normalizacao</a>
                            <a class="topbar-link" href="compare-arrays.html">Comparar</a>
                        </div>
                    </div>
                    <button class="theme-toggle" type="button" @click="toggleTheme" :title="state.theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'">
                        <i :class="state.theme === 'light' ? 'fas fa-moon-stars' : 'fas fa-sun'" aria-hidden="true"></i>
                    </button>
                </nav>

                <div class="locale-page-shell">
                    <section class="panel-card input-panel mb-4">
                        <div class="card-body p-4 p-lg-5">
                            <div class="editor-label mb-2">Modulo Isolado</div>
                            <h1 class="h3 mb-3">Normalizacao por Locale</h1>
                            <p class="text-secondary mb-0">Use esta pagina para testar normalizacao de datas e numeros isoladamente, com os mesmos controles do menu de coluna.</p>
                        </div>
                    </section>

                    <div class="locale-grid">
                        <section class="panel-card preview-panel">
                            <div class="card-body p-4">
                                <div class="editor-label mb-2">Configuracoes</div>
                                <h2 class="h5 mb-4">Estrutura atual</h2>

                                <div class="locale-controls-grid">
                                    <div>
                                        <label class="form-label small fw-semibold">Tipo de normalizacao</label>
                                        <select class="form-select" v-model="state.normalizeMode">
                                            <option value="number">Numeros</option>
                                            <option value="date">Datas</option>
                                        </select>
                                    </div>

                                    <template v-if="state.normalizeMode === 'number'">
                                        <div>
                                            <label class="form-label small fw-semibold">Formato de entrada</label>
                                            <select class="form-select" v-model="state.numberInputLocale">
                                                <option value="auto">Auto</option>
                                                <option value="pt-BR">pt-BR</option>
                                                <option value="en-US">en-US</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="form-label small fw-semibold">Formato de saida</label>
                                            <select class="form-select" v-model="state.numberOutputLocale">
                                                <option value="raw">Valor bruto</option>
                                                <option value="pt-BR">pt-BR</option>
                                                <option value="en-US">en-US</option>
                                            </select>
                                        </div>
                                    </template>

                                    <template v-else>
                                        <div>
                                            <label class="form-label small fw-semibold">Formato de entrada</label>
                                            <select class="form-select" v-model="state.dateInputFormat">
                                                <option value="auto">Auto</option>
                                                <option value="dd/mm/yyyy hh:mm:ss.fff">DD/MM/YYYY HH:mm:ss.fff</option>
                                                <option value="mm/dd/yyyy hh:mm:ss.fff">MM/DD/YYYY HH:mm:ss.fff</option>
                                                <option value="yyyy-mm-dd hh:mm:ss.fff">YYYY-MM-DD HH:mm:ss.fff</option>
                                                <option value="iso-datetime">ISO Datetime (YYYY-MM-DDTHH:mm:ss)</option>
                                                <option value="iso-datetime-utc">ISO Datetime UTC (YYYY-MM-DDTHH:mm:ssZ)</option>
                                                <option value="serial-date">Serial Date (01/01/1900)</option>
                                                <option value="compact-date">Compact Date (YYYYMMDDHHmmssfff)</option>
                                                <option value="unix-timestamp">Unix timestamp / Epoch time (01/01/1970)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="form-label small fw-semibold">Formato de saida</label>
                                            <select class="form-select" v-model="state.dateOutputFormat">
                                                <option value="dd/mm/yyyy hh:mm:ss.fff">DD/MM/YYYY HH:mm:ss.fff</option>
                                                <option value="mm/dd/yyyy hh:mm:ss.fff">MM/DD/YYYY HH:mm:ss.fff</option>
                                                <option value="yyyy-mm-dd hh:mm:ss.fff">YYYY-MM-DD HH:mm:ss.fff</option>
                                                <option value="iso-datetime">ISO Datetime (YYYY-MM-DDTHH:mm:ss)</option>
                                                <option value="iso-datetime-utc">ISO Datetime UTC (YYYY-MM-DDTHH:mm:ssZ)</option>
                                                <option value="serial-date">Serial Date (01/01/1900)</option>
                                                <option value="compact-date">Compact Date (YYYYMMDDHHmmssfff)</option>
                                                <option value="unix-timestamp">Unix timestamp / Epoch time (01/01/1970)</option>
                                                <option value="manual">Manual</option>
                                            </select>
                                        </div>
                                        <div v-if="state.dateOutputFormat === 'manual'">
                                            <label class="form-label small fw-semibold">Mascara manual</label>
                                            <input class="form-control" v-model="state.dateOutputManual" placeholder="Ex: DD/MM/YYYY HH:mm:ss.fff">
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </section>

                        <section class="panel-card output-panel">
                            <div class="card-body p-4">
                                <div class="editor-label mb-2">Teste</div>
                                <h2 class="h5 mb-4">Entrada e resultado</h2>

                                <div class="mb-3">
                                    <label class="form-label small fw-semibold">Valor de entrada</label>
                                    <textarea class="form-control editor-textarea locale-textarea" v-model="state.inputValue" placeholder="Cole um numero, data, serial date, compact date ou timestamp"></textarea>
                                </div>

                                <div class="mb-3 status-chip" :class="result.error ? 'error' : 'info'">
                                    {{ result.error || result.info }}
                                </div>

                                <div class="mb-3">
                                    <label class="form-label small fw-semibold">Resultado final</label>
                                    <textarea class="form-control editor-textarea locale-textarea" :value="result.value" readonly placeholder="O resultado normalizado aparecera aqui"></textarea>
                                </div>

                                <div class="locale-actions">
                                    <button class="btn btn-outline-primary" type="button" @click="copyResult" :title="state.copyFeedback || 'Copiar resultado'">
                                        <i :class="state.copyFeedback === 'Copiado' ? 'fas fa-check' : state.copyFeedback === 'Falha ao copiar' ? 'fas fa-exclamation-triangle' : state.copyFeedback === 'Sem conteudo' ? 'fas fa-ban' : 'fas fa-copy'" aria-hidden="true"></i>
                                        <span class="ms-2">Copiar</span>
                                    </button>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        `
    }).mount("#locale-normalizer-app");
})();
