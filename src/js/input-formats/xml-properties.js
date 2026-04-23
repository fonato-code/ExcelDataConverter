(function () {
    window.ExcelConverterInputFormats = window.ExcelConverterInputFormats || [];
    window.ExcelConverterInputParsers = window.ExcelConverterInputParsers || {};

    window.ExcelConverterInputFormats.push({
        value: "xml-properties",
        label: "XML - Properties"
    });

    window.ExcelConverterInputParsers["xml-properties"] = function (context) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(context.input, "application/xml");

        if (xml.querySelector("parsererror")) {
            throw new Error("XML invalido");
        }

        const rows = Array.from(xml.documentElement.children);
        if (!rows.length) {
            return {
                headers: [],
                dataRows: []
            };
        }

        const rawHeaders = [];
        rows.forEach(function (row) {
            Array.from(row.attributes).forEach(function (attribute) {
                if (rawHeaders.indexOf(attribute.name) === -1) {
                    rawHeaders.push(attribute.name);
                }
            });
        });

        return {
            headers: rawHeaders.map(function (header, index) {
                return context.utils.normalizeHeader(header, index, context.state.headerTransform);
            }),
            dataRows: rows.map(function (row) {
                return rawHeaders.map(function (header) {
                    return row.getAttribute(header) || "";
                });
            })
        };
    };
})();
