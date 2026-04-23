(function () {
    window.ExcelConverterInputFormats = window.ExcelConverterInputFormats || [];
    window.ExcelConverterInputParsers = window.ExcelConverterInputParsers || {};

    function getCellValue(cell) {
        return cell ? cell.textContent.trim() : "";
    }

    window.ExcelConverterInputFormats.push({
        value: "html-table",
        label: "HTML - Tables"
    });

    window.ExcelConverterInputParsers["html-table"] = function (context) {
        const parser = new DOMParser();
        const documentNode = parser.parseFromString(context.input, "text/html");
        const table = documentNode.querySelector("table");

        if (!table) {
            throw new Error("Tabela HTML nao encontrada");
        }

        const rows = Array.from(table.querySelectorAll("tr")).map(function (row) {
            return Array.from(row.querySelectorAll("th,td")).map(getCellValue);
        }).filter(function (row) {
            return row.length > 0;
        });

        if (!rows.length) {
            return {
                headers: [],
                dataRows: []
            };
        }

        if (context.state.firstRowIsHeader) {
            return {
                headers: rows[0].map(function (header, index) {
                    return context.utils.normalizeHeader(header, index, context.state.headerTransform);
                }),
                dataRows: rows.slice(1)
            };
        }

        const maxColumnCount = rows.reduce(function (max, row) {
            return Math.max(max, row.length);
        }, 0);

        return {
            headers: context.utils.buildDefaultHeaders(maxColumnCount),
            dataRows: rows
        };
    };
})();
