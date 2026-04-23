(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function buildHtmlTable(rows, headers, utils) {
        const headMarkup = [
            "  <thead>",
            "    <tr>",
            headers.map(function (header) {
                return "      <th>" + utils.formatCellForHtml(header) + "</th>";
            }).join("\n"),
            "    </tr>",
            "  </thead>"
        ].join("\n");

        const bodyMarkup = [
            "  <tbody>",
            rows.map(function (row) {
                return [
                    "    <tr>",
                    headers.map(function (_header, index) {
                        const cellValue = index < row.length ? row[index] : "";
                        return "      <td>" + utils.formatCellForHtml(cellValue) + "</td>";
                    }).join("\n"),
                    "    </tr>"
                ].join("\n");
            }).join("\n"),
            "  </tbody>"
        ].join("\n");

        return [
            "<table>",
            headMarkup,
            bodyMarkup,
            "</table>"
        ].join("\n");
    }

    window.ExcelConverterOutputFormats.push({
        value: "html-table",
        label: "HTML - Tables",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders["html-table"] = function (context) {
        return buildHtmlTable(context.rows, context.headers, context.utils);
    };
})();
