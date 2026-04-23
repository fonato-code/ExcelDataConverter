(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    window.ExcelConverterOutputFormats.push({
        value: "json",
        label: "JSON",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders.json = function (context) {
        return JSON.stringify(context.utils.buildObjectsFromRows(context.rows, context.headers), null, 2);
    };
})();
