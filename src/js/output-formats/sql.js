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

    function isNullTextValue(value) {
        return typeof value === "string" && value.trim().toUpperCase() === "NULL";
    }

    function formatSqlValue(value, utils, options) {
        if (options.convertNullTextToNull && isNullTextValue(value)) {
            return "NULL";
        }

        if (options.convertEmptyToNull && value === "") {
            return "NULL";
        }

        if (value === "") {
            return "''";
        }

        if (utils.isNumericValue(value)) {
            return String(value);
        }

        return "'" + utils.escapeSqlString(value) + "'";
    }

    function buildSql(headers, rows, tableName, utils, columns, options) {
        const resolvedTableName = utils.sanitizeSqlIdentifier(tableName || "ExcelConverter");
        const columnDefinitions = headers.map(function (header, index) {
            const selectedColumn = columns[index];
            const declaredType = selectedColumn && selectedColumn.sqlType
                ? selectedColumn.sqlType
                : inferSqlType(rows, index, utils);
            return "\t" + utils.sanitizeSqlIdentifier(header) + " " + declaredType;
        });
        const insertColumns = headers.map(function (header) {
            return utils.sanitizeSqlIdentifier(header);
        }).join(",");
        const batchSize = Math.max(1, Math.floor(Number(options.sqlInsertBatchSize) || 1000));
        const insertStatements = [];

        for (let offset = 0; offset < rows.length; offset += batchSize) {
            const chunk = rows.slice(offset, offset + batchSize);
            const values = chunk.map(function (row) {
                return "\t(" + headers.map(function (_header, index) {
                    return formatSqlValue(index < row.length ? row[index] : "", utils, options);
                }).join(",") + ")";
            }).join(",\n");

            insertStatements.push([
                "INSERT INTO " + resolvedTableName,
                "\t(" + insertColumns + ")",
                "VALUES",
                values + ";"
            ].join("\n"));
        }

        const statements = [
            options.addCreateTable ? [
                "CREATE TABLE " + resolvedTableName + " (",
                columnDefinitions.join(",\n"),
                ");"
            ].join("\n") : "",
            options.addTruncate ? "TRUNCATE TABLE " + resolvedTableName + ";" : "",
            options.addIdentityInsert ? "SET IDENTITY_INSERT " + resolvedTableName + " ON;" : "",
            insertStatements.join("\n"),
            options.addIdentityInsert ? "SET IDENTITY_INSERT " + resolvedTableName + " OFF;" : ""
        ].filter(Boolean).join("\n");

        if (options.addTransaction) {
            return [
                "BEGIN TRY",
                "\tBEGIN TRANSACTION",
                statements.split("\n").map(function (line) {
                    return "\t" + line;
                }).join("\n"),
                "\tCOMMIT",
                "END TRY",
                "BEGIN CATCH",
                "\tPRINT ('Ocorreu um erro ao executar a TRANSACTION')",
                "\tROLLBACK",
                "END CATCH"
            ].join("\n");
        }

        return statements;
    }

    window.ExcelConverterOutputFormats.push({
        value: "sql",
        label: "SQL",
        controls: { columns: true, xml: false, sql: true, types: true }
    });

    window.ExcelConverterOutputBuilders.sql = function (context) {
        return buildSql(context.headers, context.rows, context.options.sqlTableName, context.utils, context.columns, context.options);
    };
})();
