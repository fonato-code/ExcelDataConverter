(function () {
    window.ExcelConverterInputFormats = window.ExcelConverterInputFormats || [];
    window.ExcelConverterInputParsers = window.ExcelConverterInputParsers || {};

    function normalizeHeaders(headers, transform, utils) {
        return headers.map(function (header, index) {
            return utils.normalizeHeader(String(header), index, transform);
        });
    }

    function createParser(source) {
        let index = 0;

        function skipWhitespace() {
            while (index < source.length && /\s/.test(source[index])) {
                index += 1;
            }
        }

        function match(text) {
            skipWhitespace();
            if (source.slice(index, index + text.length) === text) {
                index += text.length;
                return true;
            }
            return false;
        }

        function expect(text) {
            if (!match(text)) {
                throw new Error("PHP invalido");
            }
        }

        function parseString() {
            skipWhitespace();
            const quote = source[index];
            if (quote !== "\"" && quote !== "'") {
                throw new Error("String PHP invalida");
            }

            index += 1;
            let result = "";

            while (index < source.length) {
                const char = source[index];
                if (char === "\\") {
                    const nextChar = source[index + 1];
                    result += nextChar || "";
                    index += 2;
                    continue;
                }

                if (char === quote) {
                    index += 1;
                    return result;
                }

                result += char;
                index += 1;
            }

            throw new Error("String PHP nao finalizada");
        }

        function parseNumber() {
            skipWhitespace();
            const start = index;
            while (index < source.length && /[-0-9.]/.test(source[index])) {
                index += 1;
            }
            return Number(source.slice(start, index));
        }

        function parseIdentifier() {
            skipWhitespace();
            const start = index;
            while (index < source.length && /[A-Za-z_]/.test(source[index])) {
                index += 1;
            }
            return source.slice(start, index);
        }

        function parseValue() {
            skipWhitespace();

            if (source[index] === "\"" || source[index] === "'") {
                return parseString();
            }

            if (source.slice(index, index + 5).toLowerCase() === "array") {
                return parseArray();
            }

            if (/[-0-9]/.test(source[index])) {
                return parseNumber();
            }

            const identifier = parseIdentifier().toLowerCase();
            if (identifier === "true") {
                return true;
            }
            if (identifier === "false") {
                return false;
            }
            if (identifier === "null") {
                return null;
            }

            throw new Error("Valor PHP nao suportado");
        }

        function parseArray() {
            expect("array");
            expect("(");

            const entries = [];
            let isAssociative = false;

            while (true) {
                skipWhitespace();
                if (match(")")) {
                    break;
                }

                const firstValue = parseValue();
                skipWhitespace();

                if (match("=>")) {
                    isAssociative = true;
                    const secondValue = parseValue();
                    entries.push({
                        key: firstValue,
                        value: secondValue
                    });
                } else {
                    entries.push({
                        value: firstValue
                    });
                }

                skipWhitespace();
                match(",");
            }

            if (isAssociative) {
                return entries.reduce(function (result, entry) {
                    result[String(entry.key)] = entry.value;
                    return result;
                }, {});
            }

            return entries.map(function (entry) {
                return entry.value;
            });
        }

        return {
            parse: function () {
                const parsed = parseValue();
                skipWhitespace();
                if (source[index] === ";") {
                    index += 1;
                }
                skipWhitespace();
                if (index < source.length) {
                    throw new Error("PHP invalido");
                }
                return parsed;
            }
        };
    }

    function isPlainObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function toStandardObject(parsed, context) {
        if (Array.isArray(parsed)) {
            if (!parsed.length) {
                return { headers: [], dataRows: [] };
            }

            if (parsed.every(Array.isArray)) {
                if (context.state.firstRowIsHeader) {
                    return {
                        headers: normalizeHeaders(parsed[0], context.state.headerTransform, context.utils),
                        dataRows: parsed.slice(1)
                    };
                }

                const maxColumnCount = parsed.reduce(function (max, row) {
                    return Math.max(max, row.length);
                }, 0);

                return {
                    headers: context.utils.buildDefaultHeaders(maxColumnCount),
                    dataRows: parsed
                };
            }

            if (parsed.every(isPlainObject)) {
                const headers = [];
                parsed.forEach(function (item) {
                    Object.keys(item).forEach(function (key) {
                        if (headers.indexOf(key) === -1) {
                            headers.push(key);
                        }
                    });
                });

                return {
                    headers: normalizeHeaders(headers, context.state.headerTransform, context.utils),
                    dataRows: parsed.map(function (item) {
                        return headers.map(function (header) {
                            return Object.prototype.hasOwnProperty.call(item, header) ? item[header] : "";
                        });
                    })
                };
            }

            return {
                headers: ["Value"],
                dataRows: parsed.map(function (value) {
                    return [value];
                })
            };
        }

        if (isPlainObject(parsed)) {
            const headers = Object.keys(parsed);
            return {
                headers: normalizeHeaders(headers, context.state.headerTransform, context.utils),
                dataRows: [headers.map(function (header) {
                    return parsed[header];
                })]
            };
        }

        return {
            headers: ["Value"],
            dataRows: [[parsed]]
        };
    }

    window.ExcelConverterInputFormats.push({
        value: "php",
        label: "PHP"
    });

    window.ExcelConverterInputParsers.php = function (context) {
        const parsed = createParser(context.input).parse();
        return toStandardObject(parsed, context);
    };
})();
