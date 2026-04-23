(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function inferAvroType(rows, columnIndex, utils) {
        const values = rows
            .map(function (row) {
                return columnIndex < row.length ? row[columnIndex] : "";
            })
            .filter(function (value) {
                return value !== "";
            });

        if (!values.length) {
            return ["null", "string"];
        }

        const allNumbers = values.every(function (value) {
            return utils.isNumericValue(value);
        });
        const allBooleans = values.every(function (value) {
            return typeof value === "boolean";
        });

        if (allBooleans) {
            return ["null", "boolean"];
        }

        if (allNumbers && values.every(function (value) { return Number.isInteger(value); })) {
            return ["null", "int"];
        }

        if (allNumbers) {
            return ["null", "double"];
        }

        return ["null", "string"];
    }

    function buildAvro(headers, rows, utils) {
        const schema = {
            type: "record",
            name: "ExcelConverterRecord",
            namespace: "excelconverter.generated",
            fields: headers.map(function (header, index) {
                return {
                    name: utils.sanitizeXmlTagName(header, "Col" + (index + 1)),
                    type: inferAvroType(rows, index, utils),
                    default: null
                };
            })
        };

        const records = utils.buildObjectsFromRows(rows, schema.fields.map(function (field) {
            return field.name;
        }));

        return JSON.stringify({
            schema: schema,
            records: records
        }, null, 2);
    }

    window.ExcelConverterOutputFormats.push({
        value: "avro",
        label: "Avro",
        controls: { columns: true, xml: false, sql: false }
    });

    window.ExcelConverterOutputBuilders.avro = function (context) {
        return buildAvro(context.headers, context.rows, context.utils);
    };
})();
