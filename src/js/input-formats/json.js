(function () {
    window.ExcelConverterInputFormats = window.ExcelConverterInputFormats || [];
    window.ExcelConverterInputParsers = window.ExcelConverterInputParsers || {};

    function isPlainObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function normalizeHeaders(headers, transform, utils) {
        return headers.map(function (header, index) {
            return utils.normalizeHeader(String(header), index, transform);
        });
    }

    function parseArrayOfArrays(data, context) {
        if (!data.length) {
            return {
                headers: [],
                dataRows: []
            };
        }

        if (context.state.firstRowIsHeader) {
            return {
                headers: normalizeHeaders(data[0], context.state.headerTransform, context.utils),
                dataRows: data.slice(1)
            };
        }

        const maxColumnCount = data.reduce(function (max, row) {
            return Math.max(max, Array.isArray(row) ? row.length : 0);
        }, 0);

        return {
            headers: context.utils.buildDefaultHeaders(maxColumnCount),
            dataRows: data
        };
    }

    function parseArrayOfObjects(data, context) {
        const headers = [];
        data.forEach(function (item) {
            Object.keys(item).forEach(function (key) {
                if (headers.indexOf(key) === -1) {
                    headers.push(key);
                }
            });
        });

        const normalizedHeaders = normalizeHeaders(headers, context.state.headerTransform, context.utils);
        const dataRows = data.map(function (item) {
            return headers.map(function (header) {
                return Object.prototype.hasOwnProperty.call(item, header) ? item[header] : "";
            });
        });

        return {
            headers: normalizedHeaders,
            dataRows: dataRows
        };
    }

    function parseColumnArrays(data, context) {
        const headers = Object.keys(data);
        const maxLength = headers.reduce(function (max, header) {
            return Math.max(max, Array.isArray(data[header]) ? data[header].length : 0);
        }, 0);

        return {
            headers: normalizeHeaders(headers, context.state.headerTransform, context.utils),
            dataRows: Array.from({ length: maxLength }, function (_value, rowIndex) {
                return headers.map(function (header) {
                    return rowIndex < data[header].length ? data[header][rowIndex] : "";
                });
            })
        };
    }

    function parseDictionary(data, context) {
        const outerKeys = Object.keys(data);
        const innerHeaders = [];

        outerKeys.forEach(function (key) {
            Object.keys(data[key]).forEach(function (innerKey) {
                if (innerHeaders.indexOf(innerKey) === -1) {
                    innerHeaders.push(innerKey);
                }
            });
        });

        const rawHeaders = ["Key"].concat(innerHeaders);
        return {
            headers: normalizeHeaders(rawHeaders, context.state.headerTransform, context.utils),
            dataRows: outerKeys.map(function (key) {
                return [key].concat(innerHeaders.map(function (innerKey) {
                    return Object.prototype.hasOwnProperty.call(data[key], innerKey) ? data[key][innerKey] : "";
                }));
            })
        };
    }

    function parseSingleObject(data, context) {
        const headers = Object.keys(data);
        return {
            headers: normalizeHeaders(headers, context.state.headerTransform, context.utils),
            dataRows: [headers.map(function (header) {
                return data[header];
            })]
        };
    }

    window.ExcelConverterInputFormats.push({
        value: "json",
        label: "JSON"
    });

    window.ExcelConverterInputParsers.json = function (context) {
        const parsed = JSON.parse(context.input);

        if (Array.isArray(parsed)) {
            if (!parsed.length) {
                return {
                    headers: [],
                    dataRows: []
                };
            }

            if (parsed.every(Array.isArray)) {
                return parseArrayOfArrays(parsed, context);
            }

            if (parsed.every(isPlainObject)) {
                return parseArrayOfObjects(parsed, context);
            }

            return {
                headers: ["Value"],
                dataRows: parsed.map(function (value) {
                    return [value];
                })
            };
        }

        if (isPlainObject(parsed)) {
            const values = Object.values(parsed);

            if (values.length && values.every(Array.isArray)) {
                return parseColumnArrays(parsed, context);
            }

            if (values.length && values.every(isPlainObject)) {
                return parseDictionary(parsed, context);
            }

            return parseSingleObject(parsed, context);
        }

        return {
            headers: ["Value"],
            dataRows: [[parsed]]
        };
    };
})();
