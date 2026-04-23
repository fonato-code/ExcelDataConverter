(function () {
    const { createApp, computed, reactive, watch } = Vue;
    const inputConfig = window.ExcelConverterInputConfig || [];
    const inputFormats = window.ExcelConverterInputFormats || [];
    const inputParsers = window.ExcelConverterInputParsers || {};
    const outputFormats = window.ExcelConverterOutputFormats || [];
    const outputBuilders = window.ExcelConverterOutputBuilders || {};

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

    createApp({
        setup() {
            const state = reactive({
                theme: "light",
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
                columnConfigs: [],
                draggedColumnKey: "",
                inputSectionCollapsed: false,
                outputSectionCollapsed: false
            });

            watch(function () {
                return state.theme;
            }, function (theme) {
                document.documentElement.setAttribute("data-theme", theme);
            }, { immediate: true });

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

            const standardObject = computed(function () {
                if (!state.input.trim()) {
                    return {
                        headers: [],
                        dataRows: []
                    };
                }

                const parser = inputParsers[state.inputFormat];
                if (!parser) {
                    return {
                        headers: [],
                        dataRows: []
                    };
                }

                return parser({
                    input: state.input,
                    state: state,
                    utils: {
                        buildDefaultHeaders: buildDefaultHeaders,
                        normalizeHeader: normalizeHeader
                    }
                });
            });

            const availableColumns = computed(function () {
                return standardObject.value.headers.map(function (header, index) {
                    return {
                        key: header + "__" + index,
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

                state.columnConfigs = nextColumns.map(function (column) {
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
            }, { immediate: true });

            const selectedColumns = computed(function () {
                return state.columnConfigs.filter(function (column) {
                    return column.enabled;
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
                return standardObject.value.dataRows.map(function (row) {
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
                            xmlRootTagName: state.xmlRootTagName,
                            xmlRowTagName: state.xmlRowTagName
                        }
                    );
                } catch (error) {
                    return "Erro ao converter: " + error.message;
                }
            });

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

                if (sectionName === "output") {
                    state.outputSectionCollapsed = !state.outputSectionCollapsed;
                }
            }

            function toggleTheme() {
                state.theme = state.theme === "light" ? "dark" : "light";
            }

            return {
                state,
                statusMessage,
                output,
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
                toggleSection,
                toggleTheme
            };
        },
        template: `
            <div class="app-wrap container-fluid">

                <div class="row g-4">
                    <aside class="col-12 col-xl-3">
                        <div class="sidebar-card h-100">
                            <div class="sidebar-accent"></div>
                            <div class="card-body p-4 sidebar-scroll">
                                <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
                                    <div class="sidebar-title mb-0">Configuracoes</div>
                                    <button class="theme-toggle" type="button" @click="toggleTheme">
                                        {{ state.theme === 'light' ? 'Escuro' : 'Claro' }}
                                    </button>
                                </div>

                                <div class="border rounded-4 p-3 mb-4 bg-white bg-opacity-50">
                                    <button class="config-section-toggle" type="button" @click="toggleSection('input')">
                                        <div class="d-flex align-items-center justify-content-between gap-3">
                                            <div class="editor-label mb-0">Input</div>
                                            <span class="config-section-chevron" :class="{ 'is-collapsed': state.inputSectionCollapsed }">▼</span>
                                        </div>
                                    </button>

                                    <div v-show="!state.inputSectionCollapsed && showDefaultInputConfig" class="mt-3">
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
                                </div>

                                <div class="border rounded-4 p-3 mb-4 bg-white bg-opacity-50">
                                    <button class="config-section-toggle" type="button" @click="toggleSection('output')">
                                        <div class="d-flex align-items-center justify-content-between gap-3">
                                            <div class="editor-label mb-0">Output</div>
                                            <span class="config-section-chevron" :class="{ 'is-collapsed': state.outputSectionCollapsed }">▼</span>
                                        </div>
                                    </button>

                                    <div v-show="!state.outputSectionCollapsed" class="mt-3">
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
                                            <input id="xml-root-tag" class="form-control" v-model="state.xmlRootTagName" placeholder="rows">
                                        </div>

                                        <div v-if="isXmlOutput" class="mb-3">
                                            <label for="xml-row-tag" class="form-label fw-semibold">Row Tag Name</label>
                                            <input id="xml-row-tag" class="form-control" v-model="state.xmlRowTagName" placeholder="row">
                                        </div>

                                        <div v-if="isSqlOutput">
                                            <label for="sql-table-name" class="form-label fw-semibold">Tabela</label>
                                            <input id="sql-table-name" class="form-control" v-model="state.sqlTableName" placeholder="ExcelConverter">
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </aside>

                    <main class="col-12 col-xl-9">
                        <div class="row g-4">
                            <section class="col-12">
                                <div class="panel-card input-panel h-100">
                                    <div class="card-body p-4">
                                        <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
                                            <div>
                                                <div class="editor-label mb-1">Input</div>
                                                <h3 class="h5 mb-0">Texto de origem</h3>
                                            </div>
                                            <div class="col-12 col-sm-5 col-lg-6 col-xxl-5 px-0">
                                                <select class="form-select form-select-sm" v-model="state.inputFormat">
                                                    <option v-for="format in inputFormats" :key="format.value" :value="format.value">
                                                        {{ format.label }}
                                                    </option>
                                                </select>
                                            </div>
                                        </div>
                                        <textarea
                                            class="form-control editor-textarea"
                                            v-model="state.input"
                                            placeholder="Cole aqui dados copiados do Excel, CSV ou TSV"
                                            spellcheck="false"
                                        ></textarea>
                                    </div>
                                </div>
                            </section>

                            <section class="col-12">
                                <div class="panel-card output-panel h-100">
                                    <div class="card-body p-4">
                                        <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                            <div>
                                                <div class="editor-label mb-1">Output</div>
                                                <h3 class="h5 mb-0">Resultado convertido</h3>
                                            </div>
                                            <div class="col-12 col-sm-4 col-lg-5 col-xxl-4 px-0">
                                                <select class="form-select form-select-sm" v-model="state.outputFormat">
                                                    <option v-for="format in outputFormats" :key="format.value" :value="format.value">
                                                        {{ format.label }}
                                                    </option>
                                                </select>
                                            </div>
                                        </div>
                                        <textarea
                                            class="form-control editor-textarea"
                                            :value="output"
                                            readonly
                                            spellcheck="false"
                                            placeholder="O resultado convertido sera exibido aqui"
                                        ></textarea>
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
