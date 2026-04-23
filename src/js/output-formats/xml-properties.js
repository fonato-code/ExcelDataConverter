(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function buildXmlProperties(headers, rows, options, utils) {
        const rootTag = utils.sanitizeXmlTagName(options.xmlRootTagName || "rows", "rows");
        const rowTag = utils.sanitizeXmlTagName(options.xmlRowTagName || "row", "row");
        const lines = [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<" + rootTag + ">"
        ];

        rows.forEach(function (row) {
            const attributes = headers.map(function (header, index) {
                const cellValue = index < row.length ? row[index] : "";
                return utils.sanitizeXmlTagName(header, "Col" + (index + 1)) + "=\"" + utils.escapeXml(cellValue) + "\"";
            }).join(" ");
            lines.push("\t<" + rowTag + " " + attributes + "></" + rowTag + ">");
        });

        lines.push("</" + rootTag + ">");
        return lines.join("\n");
    }

    window.ExcelConverterOutputFormats.push({
        value: "xml-properties",
        label: "XML - Properties",
        controls: { columns: true, xml: true, sql: false }
    });

    window.ExcelConverterOutputBuilders["xml-properties"] = function (context) {
        return buildXmlProperties(context.headers, context.rows, context.options, context.utils);
    };
})();
