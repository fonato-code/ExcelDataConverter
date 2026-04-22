(function () {
    const { createApp, computed, reactive } = Vue;

    function detectDelimiter(text) {
        const sample = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 5);

        if (!sample.length) {
            return ",";
        }

        const tabScore = sample.reduce((count, line) => count + ((line.match(/\t/g) || []).length), 0);
        const commaScore = sample.reduce((count, line) => count + ((line.match(/,/g) || []).length), 0);
        return tabScore > commaScore ? "\t" : ",";
    }

    function splitLine(line, delimiter) {
        return line.split(delimiter).map((part) => part.trim());
    }

    function normalizeKey(value, index, transform) {
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

    function parseCell(rawValue, decimalSign) {
        const value = rawValue.trim();
        if (value === "") {
            return "";
        }

        const normalized = decimalSign === "comma"
            ? value.replace(/\./g, "").replace(",", ".")
            : value.replace(/,/g, "");

        if (/^-?\d+(\.\d+)?$/.test(normalized)) {
            return Number(normalized);
        }

        if (/^(true|false)$/i.test(value)) {
            return value.toLowerCase() === "true";
        }

        return value;
    }

    function buildRows(text, delimiter, decimalSign) {
        return text
            .split(/\r?\n/)
            .filter((line) => line.trim() !== "")
            .map((line) => splitLine(line, delimiter).map((cell) => parseCell(cell, decimalSign)));
    }

    createApp({
        setup() {
            const state = reactive({
                input: "",
                delimiter: "auto",
                decimalSign: "dot",
                firstRowIsHeader: true,
                headerTransform: "none",
                outputFormat: "json"
            });

            const resolvedDelimiter = computed(function () {
                if (state.delimiter === "tab") {
                    return "\t";
                }

                if (state.delimiter === "comma") {
                    return ",";
                }

                return detectDelimiter(state.input);
            });

            const statusMessage = computed(function () {
                if (!state.input.trim()) {
                    return {
                        tone: "info",
                        text: "Cole dados do Excel, CSV ou TSV no campo Input para gerar a saida."
                    };
                }

                const delimiterLabel = resolvedDelimiter.value === "\t" ? "Tab" : "Comma";
                return {
                    tone: "info",
                    text: "Delimitador em uso: " + delimiterLabel + ". Formato de saida atual: JSON."
                };
            });

            const output = computed(function () {
                if (!state.input.trim()) {
                    return "";
                }

                try {
                    const rows = buildRows(state.input, resolvedDelimiter.value, state.decimalSign);
                    if (!rows.length) {
                        return "";
                    }

                    if (!state.firstRowIsHeader) {
                        return JSON.stringify(rows, null, 2);
                    }

                    const [headerRow, ...dataRows] = rows;
                    const headers = headerRow.map(function (cell, index) {
                        return normalizeKey(String(cell), index, state.headerTransform);
                    });

                    const objects = dataRows.map(function (row) {
                        return headers.reduce(function (record, header, index) {
                            record[header] = index < row.length ? row[index] : "";
                            return record;
                        }, {});
                    });

                    return JSON.stringify(objects, null, 2);
                } catch (error) {
                    return "Erro ao converter: " + error.message;
                }
            });

            return {
                state,
                statusMessage,
                output
            };
        },
        template: `
            <div class="app-shell">
                <aside class="sidebar">
                    <div class="brand">
                        <h1>ExcelConverter</h1>
                        <p>Converta conteudo copiado de planilhas para JSON sem depender de build ou bibliotecas externas alem do Vue local.</p>
                    </div>

                    <div class="settings">
                        <div class="field">
                            <label for="delimiter">Delimiter</label>
                            <select id="delimiter" v-model="state.delimiter">
                                <option value="auto">Auto</option>
                                <option value="comma">Comma</option>
                                <option value="tab">Tab</option>
                            </select>
                        </div>

                        <div class="field">
                            <label for="decimal-sign">DecimalSign</label>
                            <select id="decimal-sign" v-model="state.decimalSign">
                                <option value="dot">Dot</option>
                                <option value="comma">Comma</option>
                            </select>
                        </div>

                        <label class="toggle" for="header-row">
                            <input id="header-row" type="checkbox" v-model="state.firstRowIsHeader">
                            <span>First row is header</span>
                        </label>

                        <div class="field">
                            <label for="header-transform">Header transform</label>
                            <select id="header-transform" v-model="state.headerTransform">
                                <option value="none">none</option>
                                <option value="uppercase">uppercase</option>
                                <option value="downcase">downcase</option>
                            </select>
                        </div>
                    </div>

                    <div class="note">
                        O modo Auto compara virgulas e tabs nas primeiras linhas coladas. Para conteudos CSV em padrao brasileiro, ajuste DecimalSign para Comma.
                    </div>
                </aside>

                <main class="workspace">
                    <div class="workspace-header">
                        <div>
                            <h2>Conversao</h2>
                            <p>Cole o conteudo bruto no painel esquerdo e acompanhe o JSON gerado em tempo real.</p>
                        </div>
                        <div class="status" :class="statusMessage.tone">
                            {{ statusMessage.text }}
                        </div>
                    </div>

                    <div class="panels">
                        <section class="panel">
                            <div class="panel-head">
                                <strong>Input</strong>
                            </div>
                            <textarea
                                v-model="state.input"
                                placeholder="Cole aqui dados copiados do Excel, CSV ou TSV"
                                spellcheck="false"
                            ></textarea>
                        </section>

                        <section class="panel">
                            <div class="panel-head">
                                <strong>Output</strong>
                                <div class="field">
                                    <select v-model="state.outputFormat">
                                        <option value="json">JSON</option>
                                    </select>
                                </div>
                            </div>
                            <textarea
                                :value="output"
                                readonly
                                spellcheck="false"
                                placeholder="O resultado convertido sera exibido aqui"
                            ></textarea>
                        </section>
                    </div>
                </main>
            </div>
        `
    }).mount("#app");
})();
