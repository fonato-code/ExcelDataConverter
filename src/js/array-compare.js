(function () {
    const { createApp, computed, reactive, watch } = Vue;
    const STORAGE_KEY = "excelconverter.array-compare.preferences.v1";
    const inputConfig = window.ExcelConverterInputConfig || [];
    const inputFormats = window.ExcelConverterInputFormats || [];
    const inputParsers = window.ExcelConverterInputParsers || {};

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

    function formatRowPreview(row, headers, limit) {
        const maxColumns = typeof limit === "number" ? limit : 6;
        return headers.slice(0, maxColumns).map(function (header, index) {
            const cell = index < row.length ? row[index] : "";
            return header + ": " + String(cell);
        }).join(" | ");
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
                activeResultTab: "summary",
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
                    activeResultTab: state.activeResultTab
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
                    pairLabels: []
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
                                preview: formatRowPreview(entry.row, headersA),
                                values: columnNamesA.map(function (columnName) {
                                    return buildRowKey(entry.row, columnName, headersA, options);
                                })
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
                                preview: formatRowPreview(entry.row, headersB),
                                values: columnNamesB.map(function (columnName) {
                                    return buildRowKey(entry.row, columnName, headersB, options);
                                })
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
                            previewA: entryA ? formatRowPreview(entryA.row, headersA) : "",
                            previewB: entryB ? formatRowPreview(entryB.row, headersB) : "",
                            valuesA: entryA
                                ? columnNamesA.map(function (columnName) {
                                    return buildRowKey(entryA.row, columnName, headersA, options);
                                })
                                : [],
                            valuesB: entryB
                                ? columnNamesB.map(function (columnName) {
                                    return buildRowKey(entryB.row, columnName, headersB, options);
                                })
                                : []
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
                    pairLabels: pairLabels
                };
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
                                <button class="btn btn-outline-secondary btn-sm section-toggle-btn border-0" type="button" @click="state.resultsSectionCollapsed = !state.resultsSectionCollapsed">
                                    <i :class="state.resultsSectionCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>
                                </button>
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
                                            <button class="nav-link" :class="{ active: state.activeResultTab === 'onlyA' }" type="button" @click="state.activeResultTab = 'onlyA'">
                                                So A ({{ comparisonResult.onlyInA.length }})
                                            </button>
                                        </li>
                                        <li class="nav-item">
                                            <button class="nav-link" :class="{ active: state.activeResultTab === 'onlyB' }" type="button" @click="state.activeResultTab = 'onlyB'">
                                                So B ({{ comparisonResult.onlyInB.length }})
                                            </button>
                                        </li>
                                        <li class="nav-item">
                                            <button class="nav-link" :class="{ active: state.activeResultTab === 'both' }" type="button" @click="state.activeResultTab = 'both'">
                                                Em comum ({{ comparisonResult.inBoth.length }})
                                            </button>
                                        </li>
                                    </ul>

                                    <div class="preview-table-wrap" v-if="state.activeResultTab === 'onlyA'">
                                        <table class="table table-sm preview-table" v-if="comparisonResult.onlyInA.length">
                                            <thead>
                                                <tr>
                                                    <th>#</th>
                                                    <th>Chave</th>
                                                    <th>Valores</th>
                                                    <th>Linha</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr v-for="(item, index) in comparisonResult.onlyInA" :key="'only-a-' + index">
                                                    <td>{{ index + 1 }}</td>
                                                    <td>{{ item.key }}</td>
                                                    <td>{{ item.values.join(' | ') }}</td>
                                                    <td class="text-start">{{ item.preview }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <div v-else class="preview-empty">Nenhum registro exclusivo na Lista A.</div>
                                    </div>

                                    <div class="preview-table-wrap" v-else-if="state.activeResultTab === 'onlyB'">
                                        <table class="table table-sm preview-table" v-if="comparisonResult.onlyInB.length">
                                            <thead>
                                                <tr>
                                                    <th>#</th>
                                                    <th>Chave</th>
                                                    <th>Valores</th>
                                                    <th>Linha</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr v-for="(item, index) in comparisonResult.onlyInB" :key="'only-b-' + index">
                                                    <td>{{ index + 1 }}</td>
                                                    <td>{{ item.key }}</td>
                                                    <td>{{ item.values.join(' | ') }}</td>
                                                    <td class="text-start">{{ item.preview }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <div v-else class="preview-empty">Nenhum registro exclusivo na Lista B.</div>
                                    </div>

                                    <div class="preview-table-wrap" v-else>
                                        <table class="table table-sm preview-table" v-if="comparisonResult.inBoth.length">
                                            <thead>
                                                <tr>
                                                    <th>#</th>
                                                    <th>Chave</th>
                                                    <th>Lista A</th>
                                                    <th>Lista B</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr v-for="(item, index) in comparisonResult.inBoth" :key="'both-' + index">
                                                    <td>{{ index + 1 }}</td>
                                                    <td>{{ item.key }}</td>
                                                    <td class="text-start">{{ item.previewA || '—' }}</td>
                                                    <td class="text-start">{{ item.previewB || '—' }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <div v-else class="preview-empty">Nenhum registro em comum com os criterios actuais.</div>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </section>
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
