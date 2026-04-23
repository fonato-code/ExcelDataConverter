(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function buildDictionary(rows, headers) {
        const valueHeaders = headers.slice(1);
        return rows.reduce(function (result, row) {
            if (!row.length) {
                return result;
            }

            const key = String(row[0]);
            result[key] = valueHeaders.reduce(function (entry, header, index) {
                const rowIndex = index + 1;
                entry[header] = rowIndex < row.length ? row[rowIndex] : "";
                return entry;
            }, {});
            return result;
        }, {});
    }

    window.ExcelConverterOutputFormats.push({
        value: "json-dictionary",
        label: "JSON - Dictionary",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders["json-dictionary"] = function (context) {
        return JSON.stringify(buildDictionary(context.rows, context.headers), null, 2);
    };
})();
