(function () {
    window.ExcelConverterInputFormats = window.ExcelConverterInputFormats || [];
    window.ExcelConverterInputParsers = window.ExcelConverterInputParsers || {};

    function detectDelimiter(text) {
        const scores = {
            ",": scoreDelimiter(text, ","),
            "\t": scoreDelimiter(text, "\t")
        };

        return scores["\t"] > scores[","] ? "\t" : ",";
    }

    function scoreDelimiter(text, delimiter) {
        const rows = parseDelimitedText(text, delimiter).slice(0, 5);
        return rows.reduce(function (total, row) {
            return total + (row.length > 1 ? row.length : 0);
        }, 0);
    }

    function parseDelimitedText(text, delimiter) {
        const rows = [];
        let row = [];
        let field = "";
        let inQuotes = false;

        function pushField() {
            row.push(field);
            field = "";
        }

        function pushRow() {
            if (row.length === 1 && row[0] === "" && field === "") {
                row = [];
                return;
            }

            rows.push(row);
            row = [];
        }

        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            const nextChar = text[index + 1];

            if (char === "\"") {
                if (inQuotes && nextChar === "\"") {
                    field += "\"";
                    index += 1;
                    continue;
                }

                inQuotes = !inQuotes;
                continue;
            }

            if (!inQuotes && char === delimiter) {
                pushField();
                continue;
            }

            if (!inQuotes && (char === "\n" || char === "\r")) {
                pushField();
                pushRow();

                if (char === "\r" && nextChar === "\n") {
                    index += 1;
                }

                continue;
            }

            field += char;
        }

        if (field !== "" || row.length) {
            pushField();
            pushRow();
        }

        return rows.filter(function (currentRow) {
            return currentRow.some(function (cell) {
                return cell !== "";
            });
        });
    }

    function normalizeNumericString(value, decimalSign) {
        const compactValue = value.replace(/\s/g, "");
        const dotPattern = /^-?\d+(\.\d+)?$/;
        const commaPattern = /^-?\d+(,\d+)?$/;
        const usThousandsPattern = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
        const brThousandsPattern = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;

        if (decimalSign === "comma") {
            if (brThousandsPattern.test(compactValue)) {
                return compactValue.replace(/\./g, "").replace(",", ".");
            }

            if (commaPattern.test(compactValue)) {
                return compactValue.replace(",", ".");
            }

            if (dotPattern.test(compactValue)) {
                return compactValue;
            }

            return null;
        }

        if (decimalSign === "dot") {
            if (usThousandsPattern.test(compactValue) && compactValue.indexOf(".") !== -1) {
                return compactValue.replace(/,/g, "");
            }

            if (dotPattern.test(compactValue)) {
                return compactValue;
            }

            return null;
        }

        return null;
    }

    function parseCell(rawValue, decimalSign) {
        const value = String(rawValue).trim();
        if (value === "") {
            return "";
        }

        const normalized = normalizeNumericString(value, decimalSign);

        if (normalized && /^-?\d+(\.\d+)?$/.test(normalized)) {
            return Number(normalized);
        }

        if (/^(true|false)$/i.test(value)) {
            return value.toLowerCase() === "true";
        }

        return value;
    }

    function buildRows(text, delimiter, decimalSign) {
        return parseDelimitedText(text, delimiter).map(function (row) {
            return row.map(function (cell) {
                return parseCell(cell, decimalSign);
            });
        });
    }

    window.ExcelConverterInputFormats.push({
        value: "input-default",
        label: "Excel / CSV / TSV"
    });

    window.ExcelConverterInputParsers["input-default"] = function (context) {
        const delimiter = context.state.delimiter === "tab"
            ? "\t"
            : context.state.delimiter === "comma"
                ? ","
                : detectDelimiter(context.input);

        const rows = buildRows(context.input, delimiter, context.state.decimalSign);
        if (!rows.length) {
            return {
                headers: [],
                dataRows: []
            };
        }

        if (!context.state.firstRowIsHeader) {
            const maxColumnCount = rows.reduce(function (max, row) {
                return Math.max(max, row.length);
            }, 0);

            return {
                headers: context.utils.buildDefaultHeaders(maxColumnCount),
                dataRows: rows
            };
        }

        return {
            headers: rows[0].map(function (cell, index) {
                return context.utils.normalizeHeader(String(cell), index, context.state.headerTransform);
            }),
            dataRows: rows.slice(1)
        };
    };
})();
