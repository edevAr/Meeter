/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#0c0d12",
        panel: "#12141c",
        card: "#181b26",
        line: "#2a2e3c",
        mist: "#8d91a7",
        snow: "#f6f7fb",
        accent: "#6c75f1",
        rec: "#ff5c5c",
        mint: "#3ecf8e",
        sun: "#f5c14a",
      },
      fontFamily: {
        sans: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        note: ['"Source Serif 4"', "Georgia", "serif"],
        title: ["Caveat", "Segoe Script", "cursive"],
      },
      boxShadow: {
        sticky: "0 22px 50px -20px rgba(0,0,0,.55)",
        dock: "0 20px 60px rgba(0,0,0,.45)",
      },
    },
  },
  plugins: [],
};
