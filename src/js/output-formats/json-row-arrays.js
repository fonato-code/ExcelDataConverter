(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    window.ExcelConverterOutputFormats.push({
        value: "json-row-arrays",
        label: "JSON RowArrays",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders["json-row-arrays"] = function (context) {
        return JSON.stringify(context.rows, null, 2);
    };
})();
