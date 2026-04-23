(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function buildXmlNodes(headers, rows, options, utils) {
        const xmlHeaders = headers.map(function (header, index) {
            return utils.sanitizeXmlTagName(header, "Col" + (index + 1));
        });
        const rootTag = utils.sanitizeXmlTagName(options.xmlRootTagName || "rows", "rows");
        const rowTag = utils.sanitizeXmlTagName(options.xmlRowTagName || "row", "row");
        const lines = [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<" + rootTag + ">"
        ];

        rows.forEach(function (row) {
            lines.push("\t<" + rowTag + ">");
            xmlHeaders.forEach(function (header, index) {
                const cellValue = index < row.length ? row[index] : "";
                lines.push("\t\t<" + header + ">" + utils.escapeXml(cellValue) + "</" + header + ">");
            });
            lines.push("\t</" + rowTag + ">");
        });

        lines.push("</" + rootTag + ">");
        return lines.join("\n");
    }

    window.ExcelConverterOutputFormats.push({
        value: "xml-nodes",
        label: "XML - Nodes",
        controls: { columns: true, xml: true, sql: false }
    });

    window.ExcelConverterOutputBuilders["xml-nodes"] = function (context) {
        return buildXmlNodes(context.headers, context.rows, context.options, context.utils);
    };
})();
