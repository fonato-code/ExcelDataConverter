(function () {
    window.ExcelConverterOutputFormats = window.ExcelConverterOutputFormats || [];
    window.ExcelConverterOutputBuilders = window.ExcelConverterOutputBuilders || {};

    function inferSqlType(rows, columnIndex, utils) {
        const values = rows
            .map(function (row) {
                return columnIndex < row.length ? row[columnIndex] : "";
            })
            .filter(function (value) {
                return value !== "";
            });

        if (!values.length) {
            return "VARCHAR(255)";
        }

        const allNumbers = values.every(function (value) {
            return utils.isNumericValue(value);
        });

        if (allNumbers && values.every(function (value) { return Number.isInteger(value); })) {
            return "INT";
        }

        if (allNumbers) {
            return "DECIMAL(18,6)";
        }

        return "VARCHAR(255)";
    }

    function formatSqlValue(value, utils) {
        if (value === "") {
            return "NULL";
        }

        if (utils.isNumericValue(value)) {
            return String(value);
        }

        return "'" + utils.escapeSqlString(value) + "'";
    }

    function buildSql(headers, rows, tableName, utils) {
        const resolvedTableName = utils.sanitizeSqlIdentifier(tableName || "ExcelConverter");
        const columnDefinitions = headers.map(function (header, index) {
            return "\t" + utils.sanitizeSqlIdentifier(header) + " " + inferSqlType(rows, index, utils);
        });
        const insertColumns = headers.map(function (header) {
            return utils.sanitizeSqlIdentifier(header);
        }).join(",");
        const values = rows.map(function (row) {
            return "\t(" + headers.map(function (_header, index) {
                return formatSqlValue(index < row.length ? row[index] : "", utils);
            }).join(",") + ")";
        }).join(",\n");

        return [
            "CREATE TABLE " + resolvedTableName + " (",
            "\tid INT NOT NULL AUTO_INCREMENT PRIMARY KEY,",
            columnDefinitions.join(",\n"),
            ");",
            "INSERT INTO " + resolvedTableName,
            "\t(" + insertColumns + ")",
            "VALUES",
            values + ";"
        ].join("\n");
    }

    window.ExcelConverterOutputFormats.push({
        value: "sql",
        label: "SQL",
        controls: { columns: true, xml: false, sql: true }
    });

    window.ExcelConverterOutputBuilders.sql = function (context) {
        return buildSql(context.headers, context.rows, context.options.sqlTableName, context.utils);
    };
})();
