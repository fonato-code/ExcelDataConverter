(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function formatPhpValue(value, utils) {
        if (value === "") {
            return "\"\"";
        }

        if (utils.isNumericValue(value)) {
            return String(value);
        }

        return "\"" + utils.escapePhpString(value) + "\"";
    }

    function buildPhpArray(headers, rows, utils) {
        return [
            "array(",
            rows.map(function (row) {
                return "\tarray(" + headers.map(function (header, index) {
                    const cellValue = index < row.length ? row[index] : "";
                    return "\"" + utils.escapePhpString(header) + "\"=>" + formatPhpValue(cellValue, utils);
                }).join(",") + ")";
            }).join(",\n"),
            ");"
        ].join("\n");
    }

    window.ExcelConverterOutputFormats.push({
        value: "php",
        label: "PHP",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders.php = function (context) {
        return buildPhpArray(context.headers, context.rows, context.utils);
    };
})();
