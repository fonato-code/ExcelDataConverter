(function () {
    window.ExcelConverterInputFormats = window.ExcelConverterInputFormats || [];
    window.ExcelConverterInputParsers = window.ExcelConverterInputParsers || {};

    window.ExcelConverterInputFormats.push({
        value: "xml-nodes",
        label: "XML - Nodes"
    });

    window.ExcelConverterInputParsers["xml-nodes"] = function (context) {
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
            Array.from(row.children).forEach(function (child) {
                if (rawHeaders.indexOf(child.tagName) === -1) {
                    rawHeaders.push(child.tagName);
                }
            });
        });

        return {
            headers: rawHeaders.map(function (header, index) {
                return context.utils.normalizeHeader(header, index, context.state.headerTransform);
            }),
            dataRows: rows.map(function (row) {
                return rawHeaders.map(function (header) {
                    const node = Array.from(row.children).find(function (child) {
                        return child.tagName === header;
                    });
                    return node ? node.textContent.trim() : "";
                });
            })
        };
    };
})();
