(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function buildColumnArrays(rows, headers) {
        return headers.reduce(function (result, header, columnIndex) {
            result[header] = rows.map(function (row) {
                return columnIndex < row.length ? row[columnIndex] : "";
            });
            return result;
        }, {});
    }

    window.ExcelConverterOutputFormats.push({
        value: "json-column-arrays",
        label: "JSON - Column Arrays",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders["json-column-arrays"] = function (context) {
        return JSON.stringify(buildColumnArrays(context.rows, context.headers), null, 2);
    };
})();
