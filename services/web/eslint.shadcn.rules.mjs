export const settings = {
  shadcn: {
    ui: "@/components/ui",
    note: "See DESIGN.md for design rules and approved exceptions.",
  },
};

export const rules = {
  "shadcn/no-restyle": ["error", { allow: ["layout"] }],
  "shadcn/no-raw-colors": [
    "error",
    {
      allow: [
        "*-blue-*",
        "*-purple-*",
        "*-cyan-*",
        "*-emerald-*",
        "*-red-*",
        "*-white",
        "*-black",
      ],
    },
  ],
  "shadcn/no-arbitrary-values": [
    "error",
    {
      allow: [
        "text-[8px]",
        "text-[10px]",
        "text-[11px]",
        "text-[15px]",
        "shadow-*",
      ],
    },
  ],
  "shadcn/no-inline-styles": ["error", { allow: ["--*"] }],
  "shadcn/no-unknown-classes": "error",
  "shadcn/require-static-classes": "error",
};

export const componentOverrides = [
  {
    files: ["components/ui/**"],
    rules: {
      "shadcn/no-restyle": "off",
      "shadcn/no-arbitrary-values": "off",
      "shadcn/require-static-classes": "off",
    },
  },
];
