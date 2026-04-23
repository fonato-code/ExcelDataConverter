(function () {
    window.ExcelConverterInputConfig = [
        {
            id: "delimiter",
            label: "Delimiter",
            type: "select",
            options: [
                { value: "auto", label: "Auto" },
                { value: "comma", label: "Comma" },
                { value: "tab", label: "Tab" }
            ]
        },
        {
            id: "decimalSign",
            label: "DecimalSign",
            type: "select",
            options: [
                { value: "dot", label: "Dot" },
                { value: "comma", label: "Comma" }
            ]
        },
        {
            id: "firstRowIsHeader",
            label: "First row is header",
            type: "checkbox"
        },
        {
            id: "headerTransform",
            label: "Header transform",
            type: "select",
            options: [
                { value: "none", label: "none" },
                { value: "uppercase", label: "uppercase" },
                { value: "downcase", label: "downcase" }
            ]
        }
    ];
})();
